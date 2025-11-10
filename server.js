const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const fs = require('fs');
const STATE_FILE = path.join(__dirname, 'fights.json');
const { exec } = require('child_process');

// Simple in-memory state
const state = {
  current: 0,
  fights: [] // will be initialized from fights.json if present
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
  try{
    if (fs.existsSync(STATE_FILE)){
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const j = JSON.parse(raw);
      if (Array.isArray(j.fights)) state.fights = j.fights;
      if (typeof j.current === 'number') state.current = j.current;
      if (typeof j.standby === 'boolean') state.standby = j.standby;
  if (typeof j.infoVisible === 'boolean') state.infoVisible = j.infoVisible;
      console.log('Loaded fights from', STATE_FILE);
    }
  }catch(e){ console.warn('Failed to load state file', e.message); }
}

async function saveState(){
  try{
  fs.writeFileSync(STATE_FILE, JSON.stringify({ fights: state.fights, current: state.current, standby: !!state.standby, infoVisible: !!state.infoVisible }, null, 2), 'utf8');
    // attempt to push the updated state back to GitHub (optional)
    try{
      await commitStateToGitHub();
    }catch(err){
      // non-fatal: log and continue
      console.warn('GitHub commit failed:', err && err.message ? err.message : err);
      // Try pushing with local git as a fallback (uses your configured git credentials)
      try{
        await commitStateWithLocalGit();
      }catch(e){
        console.warn('Local git push also failed:', e && e.message ? e.message : e);
      }
    }

    // After persisting, broadcast the full state to all connected clients so viewers can update immediately
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

    const content = Buffer.from(JSON.stringify({ fights: state.fights, current: state.current }, null, 2)).toString('base64');
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

// simple token check for admin route (token in query string)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'letmein';

// endpoint for admin to post actions (ws handles broadcasts too)
app.use(express.json());
app.post('/admin/action', async (req, res) => {
  const token = req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  const msg = req.body;
  // broadcast the incoming command immediately (so connected admin clients see it)
  broadcast(msg);
  // update server state for current/winner messages
  if (msg.type === 'setCurrent') {
    state.current = msg.index;
    // Clearing standby when admin explicitly sets a live index makes the
    // now-strip reappear for viewers (admin expectation: selecting a live
    // match should resume live display).
    state.standby = false;
  }
  if (msg.type === 'setWinner'){ const f = state.fights[msg.index]; if (f) f.winner = msg.side; }
  if (msg.type === 'clearWinner'){ const f = state.fights[msg.index]; if (f) delete f.winner; }
  if (msg.type === 'setStandby') state.standby = !!msg.on;
  if (msg.type === 'setInfoVisible') state.infoVisible = !!msg.on;
  // persist and ensure the full state is broadcast after save
  await saveState();
  return res.json({ ok:true });
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
        if (msg.payload.type === 'clearWinner'){ const f = state.fights[msg.payload.index]; if (f) delete f.winner; }
        if (msg.payload.type === 'setStandby') state.standby = !!msg.payload.on;
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
app.get('/whoami', (req, res)=>{
  res.json({ service: 'loyalty-fights', source: 'top-level/server.js', homePage: (process.env.HOME_PAGE||'') });
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
