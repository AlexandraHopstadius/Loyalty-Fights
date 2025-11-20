const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { Pool } = require('pg');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const fs = require('fs');
const STATE_FILE = path.join(__dirname, 'fights.json');
// Disable legacy file-based fight persistence so default fights never reappear.
const DISABLE_FILE = true;
const { exec } = require('child_process');
// Track processed create IDs to avoid duplicate insertions when an admin
// submits via multiple channels (WS + HTTP) or retries.
const processedCreateIds = new Set();
const MAX_CREATE_IDS = 200;
// Database setup (Render Postgres via DATABASE_URL)
const DATABASE_URL = process.env.DATABASE_URL;
let pool = null; // pg Pool (if configured)

// Ephemeral multi-card support (in-memory). Each card has its own state and expiry.
// For production, back this with a DB table.
const cards = new Map(); // slug -> { club, createdAt, expiresAt, state }

function generateSlug(len = 8){
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i=0;i<len;i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// Turn a club name into a URL-friendly slug: remove diacritics, lowercase, strip
// non-alphanumerics, collapse dashes. Limit length to 40 chars. Return null if
// empty after cleaning.
function slugifyClubName(name){
  if (!name) return null;
  try { name = String(name); } catch(_) { return null; }
  // Normalize accents (diacritics) then strip combining marks manually for broad Node compatibility.
  let s = name.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  s = s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').replace(/-{2,}/g,'-');
  if (!s) return null;
  return s.slice(0,40);
}

const RESERVED_SLUGS = new Set(['admin','register','start','state','health','whoami','cards','c','styles.css','fightcard.js','ws-client.js']);

function defaultState(){
  return { current: 0, fights: [], standby: false, infoVisible: true };
}

function createCard({ club, wantClubSlug }, ttlHours = 48){
  let slugCandidate = null;
  if (wantClubSlug){
    const name = club && (club.club || club.name || club.clubName); // attempt multiple keys
    const friendly = slugifyClubName(name);
    if (friendly){
      if (!RESERVED_SLUGS.has(friendly)) {
        slugCandidate = friendly;
        console.log('[cards] Using club-based slug candidate:', friendly);
      } else {
        console.log('[cards] Club slug reserved, falling back to random:', friendly);
      }
    } else {
      console.log('[cards] Club name produced empty slug, falling back to random');
    }
  }
  let slug;
  if (slugCandidate){
    slug = slugCandidate;
    // ensure uniqueness; append short random suffix if already taken
    if (cards.has(slug)){
      let attempt = 0;
      while(cards.has(slug) && attempt < 5){
        slug = slugCandidate + '-' + generateSlug(4).toLowerCase();
        attempt++;
      }
      if (cards.has(slug)){
        // fallback to random slug completely
        slug = generateSlug(8);
      }
    }
  } else {
    do { slug = generateSlug(8); } while(cards.has(slug));
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + Math.max(1, ttlHours) * 3600 * 1000);
  const rec = { club: club || {}, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(), state: defaultState() };
  cards.set(slug, rec);
  return { slug, record: rec };
}

function wantSSL(url){
  if (!url) return false;
  // Render Postgres requires SSL. Allow disabling via PG_SSL_DISABLE=1
  if (process.env.PG_SSL_DISABLE === '1') return false;
  // If URL explicitly disables SSL
  if (/sslmode\s*=\s*disable/i.test(url)) return false;
  return true;
}

async function initDb(){
  if (!DATABASE_URL){
    console.log('[db] DATABASE_URL not set; using local file storage only');
    return false;
  }
  try{
    pool = new Pool({ connectionString: DATABASE_URL, ssl: wantSSL(DATABASE_URL) ? { rejectUnauthorized: false } : undefined });
    await pool.query('select 1');
    // Create tables if missing
    await pool.query(`
      create table if not exists fights (
        id serial primary key,
        a text not null,
        b text not null,
        weight text,
        klass text,
        a_gym text,
        b_gym text,
        winner text,
        method text,
        position integer not null
      );
    `);
    // Ensure 'method' column exists for older deployments
    try { await pool.query("alter table fights add column if not exists method text"); } catch(_) { /* ignore */ }
    await pool.query(`
      create table if not exists metadata (
        key text primary key,
        value jsonb
      );
    `);
    console.log('[db] Connected and ensured schema');
    return true;
  }catch(e){
    console.warn('[db] Failed to initialize Postgres:', e && e.message ? e.message : e);
    pool = null;
    return false;
  }
}

async function loadStateFromDb(){
  if (!pool) return false;
  try{
    const fr = await pool.query('select id,a,b,weight,klass,a_gym,b_gym,winner,method,position from fights order by position asc, id asc');
    const fights = fr.rows.map(r=>({ id:r.id, a:r.a, b:r.b, weight:r.weight||'', klass:r.klass||'', aGym:r.a_gym||'', bGym:r.b_gym||'', winner:r.winner||undefined, method:r.method||undefined }));
  const mr = await pool.query("select key,value from metadata where key in ('current','standby','infoVisible','eventName','eventFont','eventColor','eventSize','eventImage','eventImageSize','eventInfo','eventBgColor','eventFootnoteImage','fightsVisible','social')");
    const meta = Object.fromEntries(mr.rows.map(r=> [r.key, r.value]));
    if (Array.isArray(fights)) state.fights = fights;
    if (typeof meta.current === 'number') state.current = meta.current;
    else if (meta.current && typeof meta.current === 'object' && typeof meta.current.v === 'number') state.current = meta.current.v;
    if (typeof meta.standby === 'boolean') state.standby = meta.standby;
    else if (meta.standby && typeof meta.standby === 'object' && typeof meta.standby.v === 'boolean') state.standby = !!meta.standby.v;
    if (typeof meta.infoVisible === 'boolean') state.infoVisible = meta.infoVisible;
    else if (meta.infoVisible && typeof meta.infoVisible === 'object' && typeof meta.infoVisible.v === 'boolean') state.infoVisible = !!meta.infoVisible.v;
  console.log('[db] Loaded state from database:', fights.length, 'fights');
  if (typeof meta.eventName === 'string') state.eventName = meta.eventName;
  else if (meta.eventName && typeof meta.eventName === 'object' && typeof meta.eventName.v === 'string') state.eventName = meta.eventName.v;
  if (typeof meta.eventFont === 'string') state.eventFont = meta.eventFont;
  else if (meta.eventFont && typeof meta.eventFont === 'object' && typeof meta.eventFont.v === 'string') state.eventFont = meta.eventFont.v;
  if (typeof meta.eventColor === 'string') state.eventColor = meta.eventColor;
  else if (meta.eventColor && typeof meta.eventColor === 'object' && typeof meta.eventColor.v === 'string') state.eventColor = meta.eventColor.v;
  if (typeof meta.eventSize === 'number') state.eventSize = meta.eventSize;
  else if (meta.eventSize && typeof meta.eventSize === 'object' && typeof meta.eventSize.v === 'number') state.eventSize = meta.eventSize.v;
  if (typeof meta.eventImage === 'string') state.eventImage = /^\[object/i.test(meta.eventImage) ? '' : meta.eventImage;
  else if (meta.eventImage && typeof meta.eventImage === 'object' && typeof meta.eventImage.v === 'string') state.eventImage = meta.eventImage.v;
  if (typeof meta.eventImageSize === 'number') state.eventImageSize = meta.eventImageSize;
  else if (meta.eventImageSize && typeof meta.eventImageSize === 'object' && typeof meta.eventImageSize.v === 'number') state.eventImageSize = meta.eventImageSize.v;
  if (typeof meta.eventInfo === 'string') state.eventInfo = meta.eventInfo;
  else if (meta.eventInfo && typeof meta.eventInfo === 'object' && typeof meta.eventInfo.v === 'string') state.eventInfo = meta.eventInfo.v;
  if (typeof meta.eventBgColor === 'string') state.eventBgColor = meta.eventBgColor;
  else if (meta.eventBgColor && typeof meta.eventBgColor === 'object' && typeof meta.eventBgColor.v === 'string') state.eventBgColor = meta.eventBgColor.v;
  if (typeof meta.eventFootnoteImage === 'string') state.eventFootnoteImage = /^\[object/i.test(meta.eventFootnoteImage) ? '' : meta.eventFootnoteImage;
  else if (meta.eventFootnoteImage && typeof meta.eventFootnoteImage === 'object' && typeof meta.eventFootnoteImage.v === 'string') state.eventFootnoteImage = meta.eventFootnoteImage.v;
  if (typeof meta.fightsVisible === 'boolean') state.fightsVisible = meta.fightsVisible;
  else if (meta.fightsVisible && typeof meta.fightsVisible === 'object' && typeof meta.fightsVisible.v === 'boolean') state.fightsVisible = !!meta.fightsVisible.v;
  // social (stored as object)
  if (meta.social && typeof meta.social === 'object') {
    try { state.social = meta.social; } catch(_) { /* ignore parse errors */ }
  }
    return true;
  }catch(e){
    console.warn('[db] load failed:', e && e.message ? e.message : e);
    return false;
  }
}

async function saveStateToDb(){
  if (!pool) return;
  const client = await pool.connect();
  try{
    await client.query('begin');
    await client.query('delete from fights');
    for (let i=0;i<state.fights.length;i++){
      const f = state.fights[i];
      await client.query(
        'insert into fights (a,b,weight,klass,a_gym,b_gym,winner,method,position) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [f.a||'', f.b||'', f.weight||'', f.klass||'', f.aGym||'', f.bGym||'', f.winner||null, f.method||null, i]
      );
    }
  // upsert metadata
    await client.query("insert into metadata(key,value) values('current', to_jsonb($1::int)) on conflict(key) do update set value=excluded.value", [state.current|0]);
    await client.query("insert into metadata(key,value) values('standby', to_jsonb($1::boolean)) on conflict(key) do update set value=excluded.value", [!!state.standby]);
    await client.query("insert into metadata(key,value) values('infoVisible', to_jsonb($1::boolean)) on conflict(key) do update set value=excluded.value", [!!state.infoVisible]);
  await client.query("insert into metadata(key,value) values('eventName', to_jsonb($1::text)) on conflict(key) do update set value=excluded.value", [state.eventName||'']);
  await client.query("insert into metadata(key,value) values('eventFont', to_jsonb($1::text)) on conflict(key) do update set value=excluded.value", [state.eventFont||'bebas']);
  await client.query("insert into metadata(key,value) values('eventColor', to_jsonb($1::text)) on conflict(key) do update set value=excluded.value", [state.eventColor||'']);
  await client.query("insert into metadata(key,value) values('eventSize', to_jsonb($1::int)) on conflict(key) do update set value=excluded.value", [Number.isFinite(state.eventSize)? state.eventSize : null]);
  await client.query("insert into metadata(key,value) values('eventImage', to_jsonb($1::text)) on conflict(key) do update set value=excluded.value", [state.eventImage||'']);
  await client.query("insert into metadata(key,value) values('eventImageSize', to_jsonb($1::int)) on conflict(key) do update set value=excluded.value", [Number.isFinite(state.eventImageSize)? state.eventImageSize : null]);
  await client.query("insert into metadata(key,value) values('eventInfo', to_jsonb($1::text)) on conflict(key) do update set value=excluded.value", [state.eventInfo||'']);
  await client.query("insert into metadata(key,value) values('eventBgColor', to_jsonb($1::text)) on conflict(key) do update set value=excluded.value", [state.eventBgColor||'']);
  await client.query("insert into metadata(key,value) values('eventFootnoteImage', to_jsonb($1::text)) on conflict(key) do update set value=excluded.value", [state.eventFootnoteImage||'']);
  await client.query("insert into metadata(key,value) values('fightsVisible', to_jsonb($1::boolean)) on conflict(key) do update set value=excluded.value", [state.fightsVisible!==false]);
  await client.query("insert into metadata(key,value) values('social', to_jsonb($1::json)) on conflict(key) do update set value=excluded.value", [state.social || {}]);
    await client.query('commit');
    console.log('[db] Saved state to database');
  }catch(e){
    try{ await client.query('rollback'); }catch(_){ }
    console.warn('[db] save failed:', e && e.message ? e.message : e);
  }finally{
    client.release();
  }
}

function fightsEqual(a, b){
  if (!a || !b) return false;
  return (a.a||'')=== (b.a||'') && (a.b||'')===(b.b||'') && (a.weight||'')===(b.weight||'') && (a.klass||'')===(b.klass||'') && (a.aGym||'')===(b.aGym||'') && (a.bGym||'')===(b.bGym||'');
}

// Simple in-memory state
const state = {
  current: 0,
  fights: [], // will be initialized from fights.json if present
  eventName: '',
  eventFont: 'bebas', // default font key
  eventColor: '#ffffff',
  eventSize: null, // optional integer (rem *10). e.g. 35 => 3.5rem
  eventImage: '',
  eventImageSize: null, // optional integer (rem *10) controlling image max height
  eventInfo: '', // free-form info text displayed under title (admin editable)
  eventBgColor: '', // background color for viewer
  eventFootnoteImage: '', // optional footnote image displayed in viewer footer
  fightsVisible: true,
  // Social links/info block (each key: { enabled:boolean, value:string })
  social: {
    website: { enabled: false, value: '' },
    facebook: { enabled: false, value: '' },
    instagram: { enabled: false, value: '' },
    additional: { enabled: false, value: '' }
  }
};
// allow a standby flag to pause the now-strip on clients
state.standby = false;
// infoVisible controls whether the event info block is shown
state.infoVisible = true;

// Broadcast tracking: incrementing id and ack map
let lastBroadcastId = 0;
const broadcastAcks = new Map(); // id -> Set of clientIds that acked

// Assign simple incremental IDs to connected clients so we can track acks
let nextClientId = 1;
// track number of connected admin clients so we can enable standby when none remain
let adminCount = 0;

// try to load initial fights from file
function loadState(){
  // Intentionally no-op: file persistence disabled.
  if (!DISABLE_FILE){
    try{
      if (fs.existsSync(STATE_FILE)){
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        const j = JSON.parse(raw);
        if (Array.isArray(j.fights)) state.fights = j.fights;
        if (typeof j.current === 'number') state.current = j.current;
      }
    }catch(e){ console.warn('Failed to load state file', e.message); }
  }
}

async function saveState(){
  // Persist only to DB (if configured) and broadcast; skip file & GitHub when disabled.
  if (DISABLE_FILE){
    try{ await saveStateToDb(); }catch(e){ console.warn('[db] saveStateToDb error (no-file mode):', e && e.message ? e.message : e); }
    try{
      const bid = ++lastBroadcastId;
      broadcastAcks.set(bid, new Set());
      broadcast({ type: 'state', state, broadcastId: bid });
      console.log(`[state] broadcast id=${bid} (file persistence disabled)`);
    }catch(e){ console.warn('Broadcast after save failed', e && e.message ? e.message : e); }
    return;
  }
  try{
  fs.writeFileSync(STATE_FILE, JSON.stringify({ fights: state.fights, current: state.current, standby: !!state.standby, infoVisible: !!state.infoVisible, fightsVisible: state.fightsVisible!==false, eventName: state.eventName||'', eventFont: state.eventFont||'bebas', eventColor: state.eventColor||'', eventSize: state.eventSize, eventImage: state.eventImage||'', eventImageSize: state.eventImageSize, eventInfo: state.eventInfo||'', eventBgColor: state.eventBgColor||'', eventFootnoteImage: state.eventFootnoteImage||'', social: state.social||{} }, null, 2), 'utf8');
    try{ await saveStateToDb(); }catch(e){ console.warn('[db] saveStateToDb error:', e && e.message ? e.message : e); }
    try{ await commitStateToGitHub(); }catch(err){
      console.warn('GitHub commit failed:', err && err.message ? err.message : err);
      try{ await commitStateWithLocalGit(); }catch(e){ console.warn('Local git push also failed:', e && e.message ? e.message : e); }
    }
    try{
      const bid = ++lastBroadcastId;
      broadcastAcks.set(bid, new Set());
      broadcast({ type: 'state', state, broadcastId: bid });
      console.log(`Saved fights.json; broadcastId=${bid}; clients=${wss.clients.size}`);
    }catch(e){ console.warn('Broadcast after save failed', e && e.message ? e.message : e); }
  }catch(e){ console.warn('Failed to save state file', e && e.message ? e.message : e); }
}

// If you want admin changes to update the GitHub Pages source, set these environment vars on the server:
// GITHUB_TOKEN = a personal access token with 'repo' permission (keep secret)
// GITHUB_REPO = 'owner/repo', e.g. 'AlexandraHopstadius/Loyalty-Fights'
async function commitStateToGitHub(){
  try{
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO;
    if (!token || !repo) return; // not configured
    const path = 'fights.json';
    const apiBase = 'https://api.github.com';
    const headers = { 'Authorization': `token ${token}`, 'User-Agent':'loyalty-fights', 'Accept':'application/vnd.github.v3+json' };

    // get existing file to obtain SHA if present
    let sha;
    const getUrl = `${apiBase}/repos/${repo}/contents/${encodeURIComponent(path)}`;
    const getRes = await fetch(getUrl, { headers });
    if (getRes.status === 200){ const j = await getRes.json(); sha = j.sha; }

  const content = Buffer.from(JSON.stringify({ fights: state.fights, current: state.current, fightsVisible: state.fightsVisible!==false, eventName: state.eventName, eventFont: state.eventFont, eventColor: state.eventColor, eventSize: state.eventSize, eventImage: state.eventImage||'', eventImageSize: state.eventImageSize, eventInfo: state.eventInfo||'', eventBgColor: state.eventBgColor||'', eventFootnoteImage: state.eventFootnoteImage||'', social: state.social||{} }, null, 2)).toString('base64');
    const body = { message: 'Update fights.json (admin)', content, committer: { name: 'Loyalty Fights', email: 'noreply@local' } };
    if (sha) body.sha = sha;

    const putRes = await fetch(getUrl, { method: 'PUT', headers: {...headers, 'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (!putRes.ok){ const txt = await putRes.text(); throw new Error('GitHub commit failed: '+putRes.status+' '+txt); }
    console.log('Committed fights.json to GitHub');
  }catch(e){
    // bubble up the error
    throw e;
  }
}

function commitStateWithLocalGit(){
  // Return a Promise so callers can await the attempt
  return new Promise((resolve, reject) => {
    // This attempts to commit and push fights.json using the local git CLI and credentials.
    // It is a fallback for users who have working git push access from this machine.
    const cmd = `git add "${STATE_FILE}" && git commit -m "Update fights.json (admin)" || echo "no-changes" && git push origin main`;
    exec(cmd, { cwd: __dirname }, (err, stdout, stderr) => {
      if (err) {
        console.warn('Local git push failed:', err.message);
        if (stderr) console.warn(stderr.toString());
        return reject(err);
      }
      const out = stdout.toString();
      if (out.includes('no-changes')){
        console.log('Local git: no changes to commit');
        return resolve(out.trim());
      } else {
        console.log('Local git push output:', out.trim());
        return resolve(out.trim());
      }
    });
  });
}

loadState();
// Force empty fights on startup always.
state.fights = [];
state.current = 0;
// Attempt to initialize DB and, if successful, prefer loading from DB
(async ()=>{
  const ok = await initDb();
  if (ok){
    const loaded = await loadStateFromDb();
    if (loaded){
      console.log('[db] State active from Postgres');
      // User request: always start with zero fights for fresh admin links.
      if (state.fights && state.fights.length){
        console.log('[startup] Clearing existing', state.fights.length, 'fights to start with an empty card');
        state.fights = [];
        state.current = 0;
  try { await saveState(); } catch(e){ console.warn('[startup] Failed to persist cleared fights', e&&e.message?e.message:e); }
      }
    }
  }
})();

// Announce which home page this service will serve at '/'
if ((process.env.HOME_PAGE || '').toLowerCase() === 'admin') {
  console.log('[routing] HOME_PAGE=admin -> serving admin.html at /');
} else if ((process.env.HOME_PAGE || '').toLowerCase() === 'viewer') {
  console.log('[routing] HOME_PAGE=viewer -> serving index.html at /');
} else {
  console.log('[routing] HOME_PAGE not set -> default Express static will serve /index.html');
}

// Explicit root routing so Render proxies and browser caches can't bypass it
app.get('/', (req, res, next) => {
  try {
    const home = (process.env.HOME_PAGE || '').toLowerCase();
    if (home === 'admin') {
      return res.sendFile(path.join(__dirname, 'admin.html'));
    }
    if (home === 'viewer') {
      return res.sendFile(path.join(__dirname, 'index.html'));
    }
  } catch (_) { /* ignore and fall through */ }
  return next(); // fall back to static middleware (which will serve index.html)
});

// Always provide a dedicated /admin path as well
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
// Nice landing page shortcut
app.get('/start', (req, res) => res.sendFile(path.join(__dirname, 'create.html')));
app.get('/register', (req, res) => {
  // Force fresh load of the latest form markup & assets
  res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma','no-cache');
  res.set('Expires','0');
  res.sendFile(path.join(__dirname, 'register.html'));
});

// Viewer/Admin routes for a specific card slug
app.get('/c/:slug', (req, res) => {
  const { slug } = req.params;
  const rec = cards.get(slug);
  if (!rec) return res.status(404).send('Not found');
  if (new Date(rec.expiresAt) < new Date()) return res.status(410).send('Link expired');
  res.set('Cache-Control','no-store');
  return res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/admin/:slug', (req, res) => {
  const { slug } = req.params;
  const rec = cards.get(slug);
  if (!rec) return res.status(404).send('Not found');
  if (new Date(rec.expiresAt) < new Date()) return res.status(410).send('Link expired');
  res.set('Cache-Control','no-store');
  return res.sendFile(path.join(__dirname, 'admin.html'));
});

// serve static files
// serve static files
app.use(express.static(path.join(__dirname)));

// Very small CORS helper so fetch() from a different origin (e.g., GitHub Pages)
app.use(function(req, res, next){
  // In production you should restrict this to your static host (e.g., https://your-site.github.io)
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Lightweight request logger to help trace missing responses
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    try { console.log(`[http] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${ms}ms`); } catch(_){}
  });
  next();
});

// simple token check for admin route (token in query string)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'letmein';

// endpoint for admin to post actions (ws handles broadcasts too)
// Increase JSON payload limit to allow data URLs for event images
app.use(express.json({ limit: '12mb' }));
// Create a new card after registration/payment
app.post('/cards', (req, res) => {
  try{
    const ttl = Math.min(72, Math.max(24, Number(req.body && req.body.ttlHours || 48)));
    const club = req.body && req.body.club ? req.body.club : {};
    const wantClubSlug = !!(req.body && req.body.useClubSlug);
  const { slug, record } = createCard({ club, wantClubSlug }, ttl);
    const viewerUrl = `/c/${slug}`;
    const adminUrl = `/admin/${slug}?token=${encodeURIComponent(process.env.ADMIN_TOKEN || 'letmein')}`;
  return res.json({ ok:true, slug, expiresAt: record.expiresAt, viewerUrl, adminUrl, clubSlugRequested: wantClubSlug });
  }catch(e){
    return res.status(500).json({ ok:false, error: e && e.message ? e.message : String(e) });
  }
});

app.post('/admin/action', async (req, res) => {
  const token = req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  const msg = req.body;
  // broadcast the incoming command immediately (so connected admin clients see it)
  broadcast(msg);
  let newFight = null;
  // update server state for current/winner messages
  if (msg.type === 'setCurrent') {
    state.current = msg.index;
    // Clearing standby when admin explicitly sets a live index makes the
    // now-strip reappear for viewers (admin expectation: selecting a live
    // match should resume live display).
    state.standby = false;
  }
  if (msg.type === 'setWinner'){ const f = state.fights[msg.index]; if (f) f.winner = msg.side; }
  if (msg.type === 'clearWinner'){ const f = state.fights[msg.index]; if (f) { delete f.winner; delete f.method; } }
  if (msg.type === 'setWinMethod'){
    const f = state.fights[msg.index];
    const m = (msg.method||'').toString().trim();
    if (!f){ console.warn('[admin-http] setWinMethod: index out of range', msg.index); }
    else {
      if (m) { f.method = m; console.log('[admin-http] setWinMethod applied', { index: msg.index, method: m, a: f.a, b: f.b }); }
      else { delete f.method; console.log('[admin-http] setWinMethod cleared', { index: msg.index, a: f.a, b: f.b }); }
    }
  }
  if (msg.type === 'reorderFights'){
    const order = Array.isArray(msg.order) ? msg.order.map(n=>Number(n)).filter(n=>Number.isFinite(n)) : [];
    if (order.length){
      const byId = new Map(state.fights.map(x=>[x.id, x]));
      const curId = (state.fights[state.current] && state.fights[state.current].id) || null;
      let matched = 0;
      const reordered = [];
      order.forEach(id=>{ const it = byId.get(id); if (it){ reordered.push(it); byId.delete(id); matched++; } });
      if (matched === 0 && order.length === state.fights.length && order.every((n)=> Number.isInteger(n) && n>=0 && n<state.fights.length)){
        // Fallback: treat numbers as indices into current list
        order.forEach(idx=>{ const it = state.fights[idx]; if (it) reordered.push(it); });
      } else {
        byId.forEach(v=> reordered.push(v));
      }
      state.fights = reordered;
      if (curId!=null){ const ni = state.fights.findIndex(x=>x.id===curId); state.current = ni>=0? ni : Math.min(state.current, state.fights.length-1); }
    }
  }
  if (msg.type === 'setStandby') state.standby = !!msg.on;
  if (msg.type === 'setInfoVisible') state.infoVisible = !!msg.on;
  if (msg.type === 'setEventName') state.eventName = (msg.name||'').toString().slice(0,120);
  if (msg.type === 'setEventFont') state.eventFont = (msg.font||'bebas').toString().slice(0,40);
  if (msg.type === 'setEventColor') state.eventColor = (msg.color||'').toString().slice(0,20);
  if (msg.type === 'setEventSize') {
    const sz = Number(msg.size);
    if (Number.isFinite(sz)) state.eventSize = Math.min(80, Math.max(6, Math.round(sz))); // tenths of rem (min 0.6rem, max 8.0rem)
  }
  if (msg.type === 'setFightsVisible') state.fightsVisible = !!msg.on;
  if (msg.type === 'clearAllFights') {
    state.fights = [];
    state.current = 0;
    console.log('[admin] All fights cleared');
  }
  if (msg.type === 'setEventMeta') {
    if (msg.name!=null) state.eventName = (msg.name||'').toString().slice(0,120);
    if (msg.font!=null) state.eventFont = (msg.font||'bebas').toString().slice(0,40);
    if (msg.color!=null) state.eventColor = (msg.color||'').toString().slice(0,20);
    if (msg.size!=null){
      const sz = Number(msg.size);
      if (Number.isFinite(sz)) state.eventSize = Math.min(80, Math.max(6, Math.round(sz)));
    }
    if (msg.image!=null) {
      let v = '';
      if (typeof msg.image === 'string') v = msg.image;
      else if (msg.image && typeof msg.image === 'object') {
        if (typeof msg.image.src === 'string') v = msg.image.src; else if (typeof msg.image.v === 'string') v = msg.image.v;
      }
      state.eventImage = v;
    }
    if (msg.imageSize!=null){
      const isz = Number(msg.imageSize);
      if (Number.isFinite(isz)) state.eventImageSize = Math.min(300, Math.max(40, Math.round(isz)));
    }
    if (msg.info!=null){
      const info = (msg.info||'').toString();
      state.eventInfo = info.slice(0, 800); // limit length
      // If non-empty info text was provided, ensure info box is visible for viewers
      try{ if (state.eventInfo && state.eventInfo.trim()) state.infoVisible = true; }catch(_){ }
    }
    if (msg.bgColor!=null){
      state.eventBgColor = (msg.bgColor||'').toString().slice(0,20);
    }
    if (msg.footnoteImage!=null){
      let fv = '';
      if (typeof msg.footnoteImage === 'string') fv = msg.footnoteImage;
      else if (msg.footnoteImage && typeof msg.footnoteImage === 'object'){
        if (typeof msg.footnoteImage.src === 'string') fv = msg.footnoteImage.src; else if (typeof msg.footnoteImage.v === 'string') fv = msg.footnoteImage.v;
      }
      state.eventFootnoteImage = fv;
      console.log('[meta] footnoteImage received (HTTP) length=', state.eventFootnoteImage.length);
    }
    console.log('[meta] setEventMeta HTTP:', {name:state.eventName,font:state.eventFont,color:state.eventColor,size:state.eventSize,image: !!state.eventImage});
  }
  if (msg.type === 'setSocial') {
    // validate shape { website:{enabled,value}, facebook:{...}, instagram:{...}, additional:{...} }
    const incoming = msg.social && typeof msg.social === 'object' ? msg.social : {};
    function sanitize(entry){
      if (!entry || typeof entry !== 'object') return { enabled:false, value:'' };
      return {
        enabled: !!entry.enabled,
        value: (entry.value||'').toString().slice(0,180) // limit length per field
      };
    }
    state.social = {
      website: sanitize(incoming.website),
      facebook: sanitize(incoming.facebook),
      instagram: sanitize(incoming.instagram),
      additional: sanitize(incoming.additional)
    };
    console.log('[social] HTTP setSocial applied', state.social);
  }
  if (msg.type === 'createFight') {
    // idempotency key
    const rid = msg.rid || (msg.data && msg.data.rid);
    if (rid && processedCreateIds.has(rid)){
      return res.json({ ok:true, dedup:true });
    }
    const data = msg.data || {};
    const a = (data.a||'').trim();
    const b = (data.b||'').trim();
    const weight = (data.weight||'').trim();
    const klass = (data.klass||'').trim();
    const aGym = (data.aGym||'').trim();
    const bGym = (data.bGym||'').trim();
    if (!a || !b) { return res.status(400).json({ error:'missing fighter names' }); }
    const nextId = state.fights.reduce((m,f)=> Math.max(m, f.id||0), 0) + 1;
    newFight = { id: nextId, a, b, weight, klass, aGym, bGym };
    // extra content-based dedup safeguard
    const exists = state.fights.some(f=> fightsEqual(f, newFight));
    if (!exists){
      state.fights.push(newFight);
      // Ensure fights list becomes visible for viewers and resume live view
      state.fightsVisible = true;
      state.standby = false;
    } else {
      newFight = state.fights.find(f=> fightsEqual(f, newFight));
    }
    if (rid){
      processedCreateIds.add(rid);
      // prune
      if (processedCreateIds.size > MAX_CREATE_IDS){
        // delete first item inserted (iteration order in Set is insertion order)
        const first = processedCreateIds.values().next().value;
        if (first) processedCreateIds.delete(first);
      }
    }
  }
  if (msg.type === 'deleteFight'){
    const idx = Number.isInteger(msg.index) ? msg.index : -1;
    if (idx>=0 && idx < state.fights.length){
      state.fights.splice(idx,1);
      if (state.current >= state.fights.length){ state.current = Math.max(0, state.fights.length-1); }
    }
  }
  // persist and ensure the full state is broadcast after save
  await saveState();
  return res.json({ ok:true, fight: newFight });
});

// give clients the current state
app.get('/state', (req,res)=> res.json(state));

function broadcast(obj){
  const s = JSON.stringify(obj);
  wss.clients.forEach(c=>{ if (c.readyState===WebSocket.OPEN) c.send(s); });
}

wss.on('connection', (ws, req)=>{
  // assign a small id for tracking
  const clientId = nextClientId++;
  ws._clientId = clientId;
  ws._isAdmin = false;
  // send current state on connect
  ws.send(JSON.stringify({ type:'state', state }));
  ws.on('message', async (m)=>{
    try{ const msg = JSON.parse(m.toString());
      // handle ack messages from clients
      if (msg && msg.type === 'ack' && typeof msg.broadcastId === 'number'){
        const s = broadcastAcks.get(msg.broadcastId);
        if (s) s.add(ws._clientId);
        return;
      }
      // allow admin via ws if token present in query
      if (msg && msg.type === 'admin' && msg.token === ADMIN_TOKEN){
        // mark this ws as an admin connection (so we can detect admin disconnects)
        if (!ws._isAdmin){ ws._isAdmin = true; adminCount++; }
        // forward admin command
        broadcast(msg.payload);
        if (msg.payload.type === 'setCurrent') {
          state.current = msg.payload.index;
          // clear standby on explicit live selection via WS-admin
          state.standby = false;
        }
        if (msg.payload.type === 'setInfoVisible') state.infoVisible = !!msg.payload.on;
        if (msg.payload.type === 'setWinner'){ const f = state.fights[msg.payload.index]; if (f) f.winner = msg.payload.side; }
        if (msg.payload.type === 'clearWinner'){ const f = state.fights[msg.payload.index]; if (f) { delete f.winner; delete f.method; } }
        if (msg.payload.type === 'setWinMethod'){
          const f = state.fights[msg.payload.index];
          const m = (msg.payload.method||'').toString().trim();
          if (!f){ console.warn('[admin-ws] setWinMethod: index out of range', msg.payload.index); }
          else {
            if (m) { f.method = m; console.log('[admin-ws] setWinMethod applied', { index: msg.payload.index, method: m, a: f.a, b: f.b }); }
            else { delete f.method; console.log('[admin-ws] setWinMethod cleared', { index: msg.payload.index, a: f.a, b: f.b }); }
          }
        }
        if (msg.payload.type === 'reorderFights'){
          const order = Array.isArray(msg.payload.order) ? msg.payload.order.map(n=>Number(n)).filter(n=>Number.isFinite(n)) : [];
          if (order.length){
            const byId = new Map(state.fights.map(x=>[x.id, x]));
            const curId = (state.fights[state.current] && state.fights[state.current].id) || null;
            let matched = 0;
            const reordered = [];
            order.forEach(id=>{ const it = byId.get(id); if (it){ reordered.push(it); byId.delete(id); matched++; } });
            if (matched === 0 && order.length === state.fights.length && order.every((n)=> Number.isInteger(n) && n>=0 && n<state.fights.length)){
              // Fallback: treat numbers as indices into current list
              order.forEach(idx=>{ const it = state.fights[idx]; if (it) reordered.push(it); });
            } else {
              byId.forEach(v=> reordered.push(v));
            }
            state.fights = reordered;
            if (curId!=null){ const ni = state.fights.findIndex(x=>x.id===curId); state.current = ni>=0? ni : Math.min(state.current, state.fights.length-1); }
          }
        }
        if (msg.payload.type === 'setStandby') state.standby = !!msg.payload.on;
  if (msg.payload.type === 'setEventName') state.eventName = (msg.payload.name||'').toString().slice(0,120);
  if (msg.payload.type === 'setEventFont') state.eventFont = (msg.payload.font||'bebas').toString().slice(0,40);
  if (msg.payload.type === 'setEventColor') state.eventColor = (msg.payload.color||'').toString().slice(0,20);
  if (msg.payload.type === 'setEventSize') {
    const sz = Number(msg.payload.size);
    if (Number.isFinite(sz)) state.eventSize = Math.min(60, Math.max(6, Math.round(sz)));
  }
        if (msg.payload.type === 'setFightsVisible') state.fightsVisible = !!msg.payload.on;
        if (msg.payload.type === 'clearAllFights') {
          state.fights = [];
          state.current = 0;
          console.log('[admin-ws] All fights cleared');
        }
        if (msg.payload.type === 'setEventMeta') {
          if (msg.payload.name!=null) state.eventName = (msg.payload.name||'').toString().slice(0,120);
          if (msg.payload.font!=null) state.eventFont = (msg.payload.font||'bebas').toString().slice(0,40);
          if (msg.payload.color!=null) state.eventColor = (msg.payload.color||'').toString().slice(0,20);
          if (msg.payload.size!=null){
            const sz = Number(msg.payload.size);
            if (Number.isFinite(sz)) state.eventSize = Math.min(60, Math.max(6, Math.round(sz)));
          }
          if (msg.payload.image!=null) {
            let v = '';
            if (typeof msg.payload.image === 'string') v = msg.payload.image;
            else if (msg.payload.image && typeof msg.payload.image === 'object'){
              if (typeof msg.payload.image.src === 'string') v = msg.payload.image.src; else if (typeof msg.payload.image.v === 'string') v = msg.payload.image.v;
            }
            state.eventImage = v;
          }
          if (msg.payload.imageSize!=null){
            const isz = Number(msg.payload.imageSize);
            if (Number.isFinite(isz)) state.eventImageSize = Math.min(300, Math.max(40, Math.round(isz)));
          }
          if (msg.payload.info!=null){
            const info = (msg.payload.info||'').toString();
            state.eventInfo = info.slice(0,800);
            // Auto-show info when non-empty text is saved via WS-admin as well
            try{ if (state.eventInfo && state.eventInfo.trim()) state.infoVisible = true; }catch(_){ }
          }
          if (msg.payload.bgColor!=null){
            state.eventBgColor = (msg.payload.bgColor||'').toString().slice(0,20);
          }
          if (msg.payload.footnoteImage!=null){
            let fv = '';
            if (typeof msg.payload.footnoteImage === 'string') fv = msg.payload.footnoteImage;
            else if (msg.payload.footnoteImage && typeof msg.payload.footnoteImage === 'object'){
              if (typeof msg.payload.footnoteImage.src === 'string') fv = msg.payload.footnoteImage.src; else if (typeof msg.payload.footnoteImage.v === 'string') fv = msg.payload.footnoteImage.v;
            }
            state.eventFootnoteImage = fv;
            console.log('[meta] footnoteImage received (WS) length=', state.eventFootnoteImage.length);
          }
          console.log('[meta] setEventMeta WS:', {name:state.eventName,font:state.eventFont,color:state.eventColor,size:state.eventSize,image: !!state.eventImage});
        }
        if (msg.payload.type === 'setSocial'){
          const incoming = msg.payload.social && typeof msg.payload.social === 'object' ? msg.payload.social : {};
          function sanitize(entry){
            if (!entry || typeof entry !== 'object') return { enabled:false, value:'' };
            return { enabled: !!entry.enabled, value: (entry.value||'').toString().slice(0,180) };
          }
          state.social = {
            website: sanitize(incoming.website),
            facebook: sanitize(incoming.facebook),
            instagram: sanitize(incoming.instagram),
            additional: sanitize(incoming.additional)
          };
          console.log('[social] WS setSocial applied', state.social);
        }
        if (msg.payload.type === 'createFight') {
          // idempotency key
          const rid = msg.payload.rid || (msg.payload.data && msg.payload.data.rid);
          if (rid && processedCreateIds.has(rid)) return; // already applied
          const data = msg.payload.data || {};
          const a = (data.a||'').trim();
          const b = (data.b||'').trim();
          if (!a || !b) return; // ignore invalid
          const weight = (data.weight||'').trim();
          const klass = (data.klass||'').trim();
          const aGym = (data.aGym||'').trim();
          const bGym = (data.bGym||'').trim();
          const nextId = state.fights.reduce((m,f)=> Math.max(m, f.id||0), 0) + 1;
          const f = { id: nextId, a, b, weight, klass, aGym, bGym };
          if (!state.fights.some(x=> fightsEqual(x, f))){
            state.fights.push(f);
            state.fightsVisible = true; // make visible upon first addition
            state.standby = false;      // resume live display
          }
          if (rid){
            processedCreateIds.add(rid);
            if (processedCreateIds.size > MAX_CREATE_IDS){
              const first = processedCreateIds.values().next().value;
              if (first) processedCreateIds.delete(first);
            }
          }
        }
        if (msg.payload.type === 'deleteFight'){
          const idx = Number.isInteger(msg.payload.index) ? msg.payload.index : -1;
          if (idx>=0 && idx < state.fights.length){
            state.fights.splice(idx,1);
            if (state.current >= state.fights.length){ state.current = Math.max(0, state.fights.length-1); }
          }
        }
        // persist and broadcast-full-state after save
        await saveState();
      }
    }catch(e){/* ignore */}
  });
  ws.on('close', ()=>{
    try{
      if (ws._isAdmin){ ws._isAdmin = false; adminCount = Math.max(0, adminCount-1); }
      if (adminCount === 0){
        // enable standby when no admin clients remain
        state.standby = true;
        (async ()=>{ try{ await saveState(); }catch(e){} })();
      }
    }catch(e){ /* ignore */ }
  });
});

// health endpoint: number of clients, last broadcast id and ack counts
app.get('/health', (req, res)=>{
  const clients = wss.clients.size;
  const pending = lastBroadcastId ? (Array.from(broadcastAcks.values()).pop() || new Set()).size : 0;
  res.json({ ok: true, clients, lastBroadcastId, pendingAcks: pending });
});

// fingerprint endpoint to verify which server build is running
app.get('/whoami', async (req, res)=>{
  let dbConfigured = false;
  let dbError = null;
  if (pool){
    try {
      const result = await pool.query('SELECT 1');
      if (result && result.rowCount > 0) dbConfigured = true;
    } catch (err) {
      dbConfigured = false;
      dbError = err && err.message ? err.message : String(err);
    }
  }
  res.json({
    service: 'loyalty-fights',
    source: 'top-level/server.js',
    homePage: (process.env.HOME_PAGE||''),
    db: { configured: dbConfigured, hasPool: !!pool, error: dbError }
  });
});

// Start server
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = '0.0.0.0';

// process-level error handlers to improve log output in hosting environments
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err && err.stack ? err.stack : err);
  // allow the process to exit with failure so Render will mark deploy failed
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason && reason.stack ? reason.stack : reason);
  process.exit(1);
});

server.on('error', (err) => {
  console.error('HTTP server error:', err && err.stack ? err.stack : err);
  process.exit(1);
});

wss.on('error', (err) => {
  console.error('WebSocket server error:', err && err.stack ? err.stack : err);
});

server.listen(PORT, HOST, () => console.log('Server running on', PORT, 'host', HOST));
// show GitHub commit status at startup for clarity
if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPO){
  console.log('GitHub auto-commit enabled for', process.env.GITHUB_REPO);
} else {
  console.log('GitHub auto-commit not configured (set GITHUB_TOKEN and GITHUB_REPO to enable)');
}

// Final error handler to ensure JSON response instead of silent failure
app.use((err, req, res, next) => {
  console.error('[express-error]', err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  try { res.status(500).json({ error: err && err.message ? err.message : String(err) }); } catch(_) { try { res.end(); } catch(_){} }
});
