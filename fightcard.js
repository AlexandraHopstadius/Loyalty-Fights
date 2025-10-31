// Simple fight card controller (no backend)
// Guard: if this file is accidentally loaded by Node (server-side) we must not
// reference `window` or browser APIs. When running in Node, export a harmless
// empty module so require() won't crash the process.
const isBrowser = (typeof window !== 'undefined');
if (!isBrowser) {
  // export a stub for server-side environments
  try { module.exports = {}; } catch (e) { /* ignore */ }
  // stop executing client-only code
} else {
  const DEFAULT_FIGHTS = [
  {id:1, a:"Leon Ländin", b:"Axel Toll", weight:"44 kg", klass:"JR-D Herr"},
  {id:2, a:"Saga Lundström", b:"Sava Kader", weight:"51 kg", klass:"C Dam"},
  {id:3, a:"Elof Stålhane", b:"Baris Yildiz", weight:"67 kg", klass:"JR-D Herr"},
  {id:4, a:"Daniel Chikowski Bredenberg", b:"Texas Sjöden", weight:"71 kg", klass:"JR-C Herr"},
  {id:5, a:"Dennis Sjögren Reis", b:"Freddy Hellman", weight:"67 kg", klass:"C Herr"},
  {id:6, a:"Tora Grant", b:"Samina Burgaj", weight:"62 kg", klass:"C Dam"},
  {id:7, a:"Vilmer Albinsson", b:"Gustav Fernsund", weight:"67 kg", klass:"JR-C Herr"}
];

  // Initialize fights from the default set so the page always has content to render.
  let fights = DEFAULT_FIGHTS.slice();

// small map of fighter affiliations/gyms to show under names
const fighterAffils = {
  'Leon Ländin': 'Combat Academy',
  'Axel Toll': 'Loyalty Muay Thai',
  'Saga Lundström': 'Loyalty Muay Thai',
  'Sava Kader': 'Southside Muay Thai',
  'Elof Stålhane': 'South Side Muay Thai',
  'Baris Yildiz': 'South Side Muay Thai',
  'Daniel Chikowski Bredenberg': 'Salem Muay Thai',
  'Texas Sjöden': 'Loyalty Muay Thai',
  'Dennis Sjögren Reis': 'Kosta Kampsport IF',
  'Freddy Hellman': 'Southside Muay Thai',
  'Tora Grant': 'Loyalty Muay Thai',
  'Samina Burgaj': 'Southside Muay Thai',
  'Vilmer Albinsson': 'Loyalty Muay Thai',
  'Gustav Fernsund': 'Combat Academy'
};

// add mappings for newly added fighters
fighterAffils['Viktor Papay'] = 'Loyalty Muay Thai';
fighterAffils['Emil Söderlund'] = 'Salem Muay Thai';
fighterAffils['Erica Englin'] = 'Tullinge Muay Thai';
fighterAffils['Mandana Yousifi'] = 'Southside Muay Thai';
fighterAffils['William Nyberg'] = 'Tullinge Muay Thai';

// make `current` a global (attached to window) so other scripts can update it
// initialize from `window.current` when available, otherwise default to 0
var current = (typeof window.current === 'number') ? window.current : 0;
// ensure window.current is in sync so external scripts can read it
window.current = current;

function renderList(){
  const list = document.getElementById('fightList');
  list.innerHTML = '';
  fights.forEach((f, i)=>{
    const el = document.createElement('article');
    el.className='card fight-card';
    el.dataset.index = i;
    el.innerHTML = `
      <div class="match">
        ${f.klass ? `<div class="fight-klass">${f.klass}</div>` : ''}
  <div class="weight-label">${f.weight}</div>
  <div class="fight-row">
          <div class="fighter-box ${f.winner==='a' ? 'winner' : (f.winner==='draw' ? 'draw' : '')}" data-side="a">
            <div class="fighter-name">${f.a}</div>
            <div class="fighter-meta">${fighterAffils[f.a] || ''}</div>
          </div>
          <div class="vs-col"><span class="vs-label">vs</span>${f.winner==='draw' ? '<div class="vs-draw">draw</div>' : ''}</div>
          <div class="fighter-box ${f.winner==='b' ? 'winner' : (f.winner==='draw' ? 'draw' : '')}" data-side="b">
            <div class="fighter-name">${f.b}</div>
            <div class="fighter-meta">${fighterAffils[f.b] || ''}</div>
          </div>
        </div>
      </div>`;
    if (i===current) el.classList.add('live');
    list.appendChild(el);

    // no winner/loser controls — simplified card
  })
  updateNow();
}

// helper to set winner for a fight and re-render
function setWinner(matchIndex, side){
  if (matchIndex<0 || matchIndex>=fights.length) return;
  const f = fights[matchIndex];
  if (side!=='a' && side!=='b') return;
  f.winner = side;
  renderList();
}

// No demo winners by default — viewers should start with no winners.

function updateNow(){
  // Sync local `current` with `window.current` in case an external script (ws-client)
  // updated the global value. This ensures updateNow applies the live index sent
  // over WebSocket and that the "Nu:" label logic below uses the correct index.
  if (typeof window.current === 'number') current = window.current;

  const now = document.getElementById('nowDisplay');
  const f = fights[current];
  if (now && f) now.textContent = `${f.a} vs ${f.b} — ${f.weight}`;
  // highlight live
  // remove live/red-frame from all cards first
  document.querySelectorAll('.fight-card').forEach(el=>el.classList.remove('live','red-frame'));
  const live = document.querySelector(`.fight-card[data-index="${current}"]`);
  if (live) {
    live.classList.add('live','red-frame');
  }
  // ensure the now strip shows a red frame while a match is live
  const nowStrip = document.querySelector('.now-strip');
  if (nowStrip){
    // Show the "Nu:" label only for indexes 0–7 (user requested it disappear on index 8)
    const label = nowStrip.firstElementChild;
    if (label) label.style.display = (typeof current === 'number' && current >= 0 && current <= 7) ? '' : 'none';
    nowStrip.classList.add('red-frame');
  }
}

document.addEventListener('DOMContentLoaded', ()=>{
  const yearEl = document.getElementById('year'); if (yearEl) yearEl.textContent = new Date().getFullYear();
  renderList();

  // try to fetch server state (persisted) so viewer shows admin-updated fights/current immediately
  (async function(){
    try{
      const res = await fetch('/state');
      if (res.ok){ const j = await res.json(); if (j){
        if (Array.isArray(j.fights) && j.fights.length){
            // replace fights array while preserving reference
            fights.length = 0; j.fights.forEach(f=> fights.push(f));
          }
          // set current if provided, otherwise default to 0 so index 0 is live
          if (typeof j.current === 'number') current = j.current; else current = 0;
        renderList(); updateNow();
      }}
    }catch(e){ /* ignore */ }
  })();

  const nextBtn = document.getElementById('next'); if (nextBtn) nextBtn.addEventListener('click', ()=>{ current = Math.min(fights.length-1, current+1); updateNow(); });
  const prevBtn = document.getElementById('prev'); if (prevBtn) prevBtn.addEventListener('click', ()=>{ current = Math.max(0, current-1); updateNow(); });

  // Admin quick toggle: long-press admin to show simple input
  const adminToggle = document.getElementById('adminToggle');
  if (adminToggle) adminToggle.addEventListener('click', ()=>{
    const idx = prompt('Set live match index (1-'+fights.length+')', (current+1));
    if (!idx) return;
    const n = parseInt(idx,10)-1;
    if (Number.isInteger(n) && n>=0 && n<fights.length){ current = n; updateNow(); } else alert('Invalid index');
  });

  // QR button (safe: modal may have been removed)
  const qrBtn = document.getElementById('qrBtn');
  if (qrBtn){ qrBtn.addEventListener('click', ()=>{ alert('QR functionality is not available in this build.'); }); }

  // Upload XLSX/CSV
  const uploadBtn = document.getElementById('uploadBtn');
  const fileInput = document.getElementById('fileInput');
  if (uploadBtn && fileInput){
    uploadBtn.addEventListener('click', ()=> fileInput.click());
    fileInput.addEventListener('change', async (ev)=>{
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      const name = file.name.toLowerCase();
      try {
        const arrayBuffer = await file.arrayBuffer();
        let rows = [];
        if (name.endsWith('.csv')){
          const text = new TextDecoder('utf-8').decode(arrayBuffer);
          rows = csvToRows(text);
        } else {
          // try to use XLSX (SheetJS) if available
          if (window.XLSX){
            const wb = window.XLSX.read(arrayBuffer, {type:'array'});
            const first = wb.SheetNames[0];
            rows = window.XLSX.utils.sheet_to_json(wb.Sheets[first], {header:1});
          } else {
            alert('XLSX parsing requires the SheetJS library. Please include it or upload CSV.');
            return;
          }
        }

        // Expect rows like: [ ['A','B','Weight'], ... ] or headerless rows
        const parsed = rowsToFights(rows);
        if (parsed.length===0){ alert('No valid fights found in file'); return; }
        // replace fights
        fights.length = 0;
        parsed.forEach((f,i)=> fights.push({id:i+1, a:f.a, b:f.b, weight:f.weight||''}));
        current = 0;
        renderList();
      } catch (e){
        console.error(e);
        alert('Error reading file: '+e.message);
      } finally {
        fileInput.value = '';
      }
    });
  }

  function csvToRows(text){
    // very small CSV parser: split lines, split by comma, trim quotes
    const lines = text.split(/\r?\n/).filter(Boolean);
    return lines.map(line=> line.split(/,\s*/).map(cell=> cell.replace(/^"|"$/g,'').trim()));
  }

  function rowsToFights(rows){
    // try to detect header row
    if (!rows || rows.length===0) return [];
    let start = 0;
    // if first row contains non-names like 'A' or 'fighter' or 'name', treat as header
    const first = rows[0].map(c=> (c||'').toString().toLowerCase());
    if (first.some(c=> /name|fighter|a|b|weight|vs/.test(c))) start = 1;
    const out = [];
    for (let i=start;i<rows.length;i++){
      const r = rows[i];
      if (!r || r.length<2) continue;
      const a = (r[0]||'').toString().trim();
      const b = (r[1]||'').toString().trim();
      const weight = (r[2]||'').toString().trim();
      if (a || b) out.push({a,b,weight});
    }
    return out;
  }

});

// helper: add or remove red-frame on a fight card by fighter names
function highlightFightByNames(nameA, nameB, add = true){
  const cards = document.querySelectorAll('.fight-card');
  for (const c of cards){
    const a = c.querySelector('.fighter-box[data-side="a"] .fighter-name');
    const b = c.querySelector('.fighter-box[data-side="b"] .fighter-name');
    if (!a || !b) continue;
    const an = a.textContent.trim();
    const bn = b.textContent.trim();
    if ((an === nameA && bn === nameB) || (an === nameB && bn === nameA)){
      if (add) c.classList.add('red-frame'); else c.classList.remove('red-frame');
    }
  }
}

// No automatic highlights on load. Use highlightFightByNames(nameA,nameB,true/false) from the console to toggle.

// expose for console testing
window._fights = fights;

// Try to auto-load an Excel/CSV file placed in the site root named like 'loyalty fights 1'
;(async function tryAutoLoad(){
  const baseNames = [
    'loyalty fights 1.xlsx',
    'loyalty fights 1.xls',
    'loyalty fights 1.csv'
  ];
  for (const name of baseNames){
    try {
      const res = await fetch(encodeURI('./'+name));
      if (!res.ok) continue;
      const lower = name.toLowerCase();
      if (lower.endsWith('.csv')){
        const text = await res.text();
        const rows = csvToRows(text);
        const parsed = rowsToFights(rows);
        if (parsed.length) {
          fights.length = 0; parsed.forEach((f,i)=> fights.push({id:i+1,a:f.a,b:f.b,weight:f.weight||''}));
          current = 0; renderList();
          console.log('Loaded fights from', name);
          return;
        }
      } else {
        // binary
        const ab = await res.arrayBuffer();
        if (window.XLSX){
          const wb = window.XLSX.read(ab, {type:'array'});
          const first = wb.SheetNames[0];
          const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[first], {header:1});
          const parsed = rowsToFights(rows);
          if (parsed.length){
            fights.length = 0; parsed.forEach((f,i)=> fights.push({id:i+1,a:f.a,b:f.b,weight:f.weight||''}));
            current = 0; renderList();
            console.log('Loaded fights from', name);
            return;
          }
        } else {
          console.warn('SheetJS (XLSX) not available to parse', name);
        }
      }
    } catch (e){
      // ignore and try next
    }
  }
})();

} // end browser-only block
