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
  // Start with an empty fights array; will be populated from server (/state) or admin actions.
  let fights = [];

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
  'Dennis Sjögren Reis': 'Southside Muay Thai',
  'Freddy Hellman': 'Kosta Kampakademi IF',
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
  if (!fights.length){
    // mark container as empty for centered layout (vertical middle)
    try{ const fl = document.getElementById('fightList'); if(fl){ fl.classList.add('is-empty','empty-center'); } }catch(e){}
    const empty = document.createElement('div');
    empty.className = 'empty-placeholder';
    empty.innerHTML = 'Inga matcher ännu<br>Fghtcard skapas när admin lägger till matcher.';
    list.appendChild(empty);
    updateNow();
    return;
  }
  // remove empty marker when fights exist
  try{ const fl = document.getElementById('fightList'); if(fl){ fl.classList.remove('is-empty','empty-center'); } }catch(e){}
  // Apply compact class when single fight to shrink card height
  try{
    if (fights.length <= 1){ list.classList.add('compact'); } else { list.classList.remove('compact'); }
  }catch(e){ }
  fights.forEach((f, i)=>{
    const el = document.createElement('article');
    el.className='card fight-card';
    el.dataset.index = i;
    // compute winner/loser classes (robust: normalize stored value)
    const win = (f.winner || '').toString().toLowerCase().trim();
    let aClass = '';
    let bClass = '';
    if (win === 'a') { aClass = 'winner'; bClass = 'loser'; }
    else if (win === 'b') { bClass = 'winner'; aClass = 'loser'; }
    else if (win === 'draw') { aClass = 'draw'; bClass = 'draw'; }
    function methodLabel(code){
      const m = (code||'').toString().toLowerCase().trim();
      if (!m) return '';
      const map = { anon:'Anonymous', dec:'Decision', ko:'KO', tko:'TKO', dq:'DQ', wo:'Walkover', nc:'No Contest', rtd:'RTD' };
      const txt = map[m] || m.toUpperCase();
      return `\n        <div class="win-method">Win by ${txt}</div>`;
    }
    if (f && f.method) { try{ console.debug('[viewer] method present for card', i, f.method); }catch(_){}} 
    const methodHtml = (f && f.method) ? methodLabel(f.method) : '';
    el.innerHTML = `
      <div class="match">
        ${f.klass ? `<div class="fight-klass">${f.klass}</div>` : ''}
  <div class="weight-label">${f.weight}</div>
  <div class="fight-row">
          <div class="fighter-box ${aClass}" data-side="a">
            <div class="fighter-name">${f.a}</div>
            <div class="fighter-meta">${(f.aGym || fighterAffils[f.a] || '')}</div>
          </div>
          <div class="vs-col"><span class="vs-label">vs</span></div>
          <div class="fighter-box ${bClass}" data-side="b">
            <div class="fighter-name">${f.b}</div>
            <div class="fighter-meta">${(f.bGym || fighterAffils[f.b] || '')}</div>
          </div>
        </div>
        ${methodHtml || (f && f.winner === 'draw' ? '\n        <div class="win-method">Draw</div>' : '')}
      </div>`;
    if (i===current) {
      el.classList.add('live');
    }
    list.appendChild(el);

    // no winner/loser controls — simplified card
  })
  updateNow();
}

// helper to set winner for a fight and re-render
function setWinner(matchIndex, side){
  if (matchIndex<0 || matchIndex>=fights.length) return;
  const f = fights[matchIndex];
  // normalize side value to be tolerant of 'A'/'B' or extra whitespace
  const s = (side || '').toString().toLowerCase().trim();
  if (s !== 'a' && s !== 'b') return;
  f.winner = s;
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
  // If the live index is exactly 8, hide the now-strip text (user request).
  if (now){
    if (f){
      if (current === 8) {
        now.textContent = '';
      } else {
        const w = (f.weight || '').toString().trim();
        const sep = w ? ' \u2014 ' : '';
        now.textContent = `${f.a} vs ${f.b}${sep}${w}`;
      }
    } else {
      // No active fight: keep Now text empty (no placeholder dash)
      now.textContent = '';
    }
  }
  // highlight live
  // remove live/red-frame from all cards first, then add back to the live card
  const isStandby = !!window.standby;
  // Reflect standby on the body element so CSS can suppress visual frames cleanly
  try{ document.body.classList.toggle('standby', isStandby); }catch(e){ /* ignore server-side or test env without body */ }
  document.querySelectorAll('.fight-card').forEach(el=>el.classList.remove('live','red-frame'));
  const live = document.querySelector(`.fight-card[data-index="${current}"]`);
  if (live && !isStandby) {
    live.classList.add('live','red-frame');
  }
  // Show/Hide event info based on window.infoVisible (default true)
  try{
    const infoEl = document.querySelector('.event-info');
    const visible = (typeof window.infoVisible === 'boolean') ? window.infoVisible : true;
    if (infoEl) infoEl.style.display = visible ? '' : 'none';
  }catch(e){ /* ignore in non-browser env */ }
  // Show/Hide fights list entirely if fightsVisible false
  try {
    const listWrap = document.getElementById('fightList');
    const sectionTitle = document.querySelector('.section-title');
    const show = (window.fightsVisible!==false);
    if (listWrap) listWrap.style.display = show ? '' : 'none';
    if (sectionTitle) sectionTitle.style.display = show ? '' : 'none';
  }catch(e){}
  // ensure the now strip shows a red frame while a match is live
  const nowStrip = document.querySelector('.now-strip');
  if (nowStrip){
    // If admin set standby, hide the whole now-strip (so the red box with "Nu:" and
    // the match text/weight do not appear) and ensure cards aren't highlighted.
    const label = nowStrip.firstElementChild;
    if (isStandby){
      nowStrip.style.display = 'none';
      nowStrip.classList.remove('red-frame');
    } else {
      nowStrip.style.display = '';
      if (label) label.style.display = (current === 8) ? 'none' : '';
      nowStrip.classList.add('red-frame');
    }
  }
}

document.addEventListener('DOMContentLoaded', ()=>{
  const yearEl = document.getElementById('year'); if (yearEl) yearEl.textContent = new Date().getFullYear();
  renderList();
  // Base gradient used for viewer background
  const BASE_GRADIENT = "linear-gradient(to bottom, #22394f 0%, #1a2d41 28%, #142433 55%, #0d1a26 78%, #09131d 100%)";
  const SOFT_BLACK_GRADIENT = "linear-gradient(to bottom, #0f1822 0%, #0d141d 50%, #0b1119 100%)";
  function applyBgTint(hex){
    // No overlay: gradient by default; soft gradient when black; solid for other colors
    if (!hex || typeof hex !== 'string'){
      document.body.style.background = BASE_GRADIENT;
      return;
    }
    const low = hex.toLowerCase();
    if (low === '#000000' || low === '#000'){
      document.body.style.background = SOFT_BLACK_GRADIENT;
      return;
    }
    const m = hex.match(/^#?([0-9a-f]{6})$/i);
    if(!m){ document.body.style.background = BASE_GRADIENT; return; }
    const color = '#' + m[1];
    document.body.style.background = color;
  }
  // apply event name and font if provided by server
  try{
    const title = document.getElementById('eventTitle');
    const titleImg = document.getElementById('eventImage');
    if (title){
      const name = (window.eventName || '').trim();
      title.textContent = name;
      if (window.eventColor){ title.style.color = window.eventColor; }
      if (typeof window.eventSize === 'number'){
        title.style.fontSize = (window.eventSize/10).toFixed(1)+'rem';
      }
      console.log('[viewer] initial event title apply', {name, color: window.eventColor, size: window.eventSize, font: window.eventFont});
    }
    if (titleImg){
      if (window.eventImage){
        titleImg.src = window.eventImage;
        if (typeof window.eventImageSize === 'number'){
          titleImg.style.maxHeight = (window.eventImageSize/10).toFixed(1)+'rem';
        }
        titleImg.style.display='block';
        // Show title below image if it has content; hide only if empty
        if (title){
          const hasName = (title.textContent || '').trim().length > 0;
          title.style.display = hasName ? '' : 'none';
        }
      } else {
        titleImg.style.display='none';
        if (title) title.style.display='';
      }
    }
    // footnote image
    try{
      const footEl = document.getElementById('footnoteImage');
      if (footEl){
        if (typeof window.eventFootnoteImage === 'string' && window.eventFootnoteImage){
          footEl.src = window.eventFootnoteImage;
          footEl.style.display='inline-block';
        } else {
          footEl.src=''; footEl.style.display='none';
        }
      }
    }catch(e){}
    // apply info text
    try{
      if (typeof window.eventInfo === 'string'){
        const infoEl = document.getElementById('eventInfoDisplay');
        if (infoEl){
          const raw = window.eventInfo.trim();
          if (raw){
            const safe = raw.replace(/[<>]/g,'');
            infoEl.innerHTML = safe.split(/\r?\n/).map(line=> `<div class="event-line" style="font-family:'Bebas Neue',Arial,sans-serif;font-weight:900;letter-spacing:1.2px;font-size:1.22rem;">${line}</div>`).join('');
            infoEl.style.display = '';
          } else {
            infoEl.innerHTML=''; infoEl.style.display='none';
          }
        }
      }
    }catch(e){}
    const font = (window.eventFont || 'bebas').toLowerCase();
    document.body.classList.remove('font-bebas','font-anton','font-oswald','font-montserrat','font-poppins','font-playfair','font-impact');
    document.body.classList.add('font-'+(font||'bebas'));
    if (typeof window.eventBgColor === 'string'){
      applyBgTint(window.eventBgColor);
      try{ document.documentElement.style.setProperty('--bg', window.eventBgColor); }catch(e){}
    }
  }catch(e){}

  // try to fetch server state (persisted) so viewer shows admin-updated fights/current immediately
  (async function(){
    try{
      const res = await fetch('/state');
      if (res.ok){ const j = await res.json(); if (j){
        if (Array.isArray(j.fights)){
          fights.length = 0; j.fights.forEach(f=> fights.push(f));
        }
        if (typeof j.current === 'number') current = j.current; else current = 0;
        // sync fightsVisible from server state (viewer previously didn't update this on initial fetch)
        if (typeof j.fightsVisible === 'boolean') {
          window.fightsVisible = j.fightsVisible;
        }
        // event meta
        try{
          const title = document.getElementById('eventTitle');
          const titleImg = document.getElementById('eventImage');
          if (title){
            const name = (j.eventName||'').trim();
            title.textContent = name;
            if (j.eventColor){ title.style.color = j.eventColor; }
            if (typeof j.eventSize === 'number'){
              title.style.fontSize = (j.eventSize/10).toFixed(1)+'rem';
            }
            console.log('[viewer] /state event meta applied', {name, font: j.eventFont, color: j.eventColor, size: j.eventSize});
          }
          if (titleImg){
            if (j.eventImage){
              titleImg.src = j.eventImage; titleImg.style.display='block';
              if (title){
                const hasName = (title.textContent || '').trim().length > 0;
                title.style.display = hasName ? '' : 'none';
              }
            } else { titleImg.style.display='none'; if (title) title.style.display=''; }
          }
          if (titleImg && typeof j.eventImageSize === 'number'){
            titleImg.style.maxHeight = (j.eventImageSize/10).toFixed(1)+'rem';
          }
          // footnote image from state
          try{
            if (typeof j.eventFootnoteImage === 'string'){
              window.eventFootnoteImage = j.eventFootnoteImage;
              const footEl = document.getElementById('footnoteImage');
              if (footEl){
                if (j.eventFootnoteImage){ footEl.src = j.eventFootnoteImage; footEl.style.display='inline-block'; }
                else { footEl.src=''; footEl.style.display='none'; }
              }
            }
          }catch(e){}
          if (typeof j.eventInfo === 'string'){
            window.eventInfo = j.eventInfo;
            const infoEl = document.getElementById('eventInfoDisplay');
            if (infoEl){
              const raw = j.eventInfo.trim();
              if (raw){
                const safe = raw.replace(/[<>]/g,'');
                infoEl.innerHTML = safe.split(/\r?\n/).map(line=> `<div class="event-line">${line}</div>`).join('');
                infoEl.style.display='';
              } else { infoEl.innerHTML=''; infoEl.style.display='none'; }
            }
          }
          if (typeof j.eventBgColor === 'string' && j.eventBgColor){
            window.eventBgColor = j.eventBgColor;
            applyBgTint(j.eventBgColor);
            try{ document.documentElement.style.setProperty('--bg', j.eventBgColor); }catch(e){}
          }
          const font = (j.eventFont||'bebas').toLowerCase();
          document.body.classList.remove('font-bebas','font-anton','font-oswald','font-montserrat','font-poppins','font-playfair','font-impact');
          document.body.classList.add('font-'+(font||'bebas'));
        }catch(e){}
        renderList(); updateNow();
        try{ document.body.classList.remove('boot'); }catch(_){ }
        // apply social from initial fetch
        try{ if (j.social && typeof j.social === 'object'){ window.social = j.social; if (typeof renderSocial === 'function') renderSocial(); } }catch(e){}
      }}
    }catch(e){ /* ignore */ }
  })();

  function renderSocial(){
    const wrap = document.getElementById('socialBar');
    if (!wrap) return;
    const social = window.social && typeof window.social === 'object' ? window.social : null;
    wrap.innerHTML = '';
    if (!social) return;
    function makeRow(iconSvg, html){
      const div = document.createElement('div');
      div.className='social-row';
      div.innerHTML = iconSvg + html;
      wrap.appendChild(div);
    }
    // website
    if (social.website && social.website.enabled && social.website.value){
      let url = social.website.value.trim();
      if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
      const safeUrl = url.replace(/"/g,'');
      makeRow('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:.85"><circle cx="12" cy="12" r="10"></circle><path d="M2 12h20M12 2c2.5 3.5 2.5 16.5 0 20"></path></svg>', `<a href="${safeUrl}" target="_blank" rel="noopener">${social.website.value}</a>`);
    }
    // facebook
    if (social.facebook && social.facebook.enabled && social.facebook.value){
      let url = social.facebook.value.trim();
      // assume user enters full page URL; if not and it's a short name, build facebook.com/name
      if (url && !/^https?:\/\//i.test(url)) url = 'https://facebook.com/' + url.replace(/^\//,'');
      const safeUrl = url.replace(/"/g,'');
      makeRow('<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="opacity:.85"><path d="M22 12a10 10 0 1 0-11.5 9.9v-7h-2v-3h2v-2.3c0-2 1.2-3.1 3-3.1.9 0 1.8.16 1.8.16v2h-1c-1 0-1.3.62-1.3 1.25V12h2.3l-.37 3h-1.93v7A10 10 0 0 0 22 12"></path></svg>', `<a href="${safeUrl}" target="_blank" rel="noopener">Facebook</a>`);
    }
    // instagram
    if (social.instagram && social.instagram.enabled && social.instagram.value){
      const handle = social.instagram.value.trim().replace(/^@+/, '');
      const url = 'https://instagram.com/' + handle;
      makeRow('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:.85"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>', `<a href="${url}" target="_blank" rel="noopener">@${handle}</a>`);
    }
    // additional
    if (social.additional && social.additional.enabled && social.additional.value){
      const raw = social.additional.value.trim();
      let html = raw.replace(/[<>]/g,'');
      if (/^https?:\/\//i.test(raw)){
        const safe = raw.replace(/"/g,'');
        html = `<a href="${safe}" target="_blank" rel="noopener">${safe}</a>`;
      }
      makeRow('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:.85"><path d="M12 2l4 7h-8l4-7z"></path><circle cx="12" cy="14" r="4"></circle><path d="M12 18v4"></path></svg>', html);
    }
    if (!wrap.innerHTML.trim()){
      // nothing enabled – keep empty (could show placeholder later)
    }
  }
  // expose so ws-client can call after applying state
  window.renderSocial = renderSocial;

  // Fallback polling: if viewer is on a different origin and WebSocket didn't connect
  // ensure fights eventually appear. Poll /state every 6s until at least 1 fight is loaded.
  (function pollUntilFights(){
    let attempts = 0;
    const maxAttempts = 20; // ~2 minutes
    async function poll(){
      if (fights.length > 0) return; // already populated by ws or initial fetch
      attempts++;
      try{
        const r = await fetch('/state');
        if (r.ok){ const j = await r.json(); if (Array.isArray(j.fights) && j.fights.length){
          fights.length = 0; j.fights.forEach(f=> fights.push(f));
          if (typeof j.current === 'number') current = j.current;
          if (typeof j.fightsVisible === 'boolean') window.fightsVisible = j.fightsVisible;
          renderList(); updateNow();
          return; // stop polling once loaded
        }}
      }catch(_){ /* ignore */ }
      if (attempts < maxAttempts) setTimeout(poll, 6000);
    }
    setTimeout(poll, 6000);
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

// Auto-loading removed: viewer intentionally starts empty until admin creates fights.

} // end browser-only block
