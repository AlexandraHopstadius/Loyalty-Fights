/* ws-client.js
   Lightweight WebSocket client for viewers.
   - Connects to the server WebSocket (uses window.SERVER_ORIGIN if set, otherwise page origin)
   - Listens for {type:'state', state, broadcastId} broadcasts
   - Applies state by replacing the in-page fights array (window._fights) and setting current
   - Calls renderList() and updateNow() when available
   - Sends {type:'ack', broadcastId} back to the server
   - Reconnects with backoff on disconnect
*/
(function(){
  const origin = window.SERVER_ORIGIN || window.location.origin;
  const wsUrl = origin.replace(/^http/, 'ws'); // http(s)://host -> ws(s)://host

  let ws = null;
  let backoff = 1000;
  const MAX_BACKOFF = 30000;
  let reconnectTimer = null;
  // Cache last known methods to survive state broadcasts that lack them
  const recentMethods = Object.create(null);

  // Start in standby until we confirm a live connection
  try{ window.standby = true; }catch(e){ /* ignore */ }

  // Small helper to prevent visible flicker: disable transitions while applying updates
  function beginDomUpdate(){ try{ document.body && document.body.classList.add('updating'); }catch(_){} }
  function endDomUpdate(){ try{ requestAnimationFrame(()=>{ document.body && document.body.classList.remove('updating'); }); }catch(_){} }

  function safeApplyState(msg){
    beginDomUpdate();
    // Support either: msg = {type:'state', state:{fights:[], current:0}, broadcastId}
    // or legacy: msg = { fights:[], current:0 }
    const payload = (msg && msg.state) ? msg.state : msg;
    if (!payload) return;

    try{
      // replace fights array while preserving reference if possible
      if (Array.isArray(payload.fights)){
        if (window._fights && Array.isArray(window._fights)){
          window._fights.length = 0;
          payload.fights.forEach((f, idx)=>{
            // Rehydrate method from recent cache if server state lacks it
            if (!f.method && recentMethods[idx]){
              try{ f.method = recentMethods[idx]; }catch(_){ }
            }
            window._fights.push(f);
          });
        } else {
          // fall back to creating global _fights
          window._fights = payload.fights.map((f, idx)=>{
            if (!f.method && recentMethods[idx]){
              try{ f.method = recentMethods[idx]; }catch(_){ }
            }
            return f;
          });
        }
      }
      // set current match index
      if (typeof payload.current === 'number'){
        try{ window.current = payload.current; }catch(e){ /* ignore */ }
      }
      // set standby flag (optional)
      if (typeof payload.standby === 'boolean'){
        try{ window.standby = !!payload.standby; }catch(e){ /* ignore */ }
      }
      // set infoVisible flag (optional)
      if (typeof payload.infoVisible === 'boolean'){
        try{ window.infoVisible = !!payload.infoVisible; }catch(e){ /* ignore */ }
      }
      if (typeof payload.fightsVisible === 'boolean'){
        try{ window.fightsVisible = !!payload.fightsVisible; }catch(e){}
      }
      // event metadata: name and font
      if (typeof payload.eventName === 'string'){
        try{ window.eventName = payload.eventName; }catch(e){}
      }
      if (typeof payload.eventFont === 'string'){
        try{ window.eventFont = payload.eventFont; }catch(e){}
      }
      if (typeof payload.eventColor === 'string'){
        try{ window.eventColor = payload.eventColor; }catch(e){}
      }
      if (typeof payload.eventImage === 'string'){
        try{ if (!/^\[object/i.test(payload.eventImage)) window.eventImage = payload.eventImage; }catch(e){}
      }
      if (typeof payload.eventImageSize === 'number'){
        try{ window.eventImageSize = payload.eventImageSize; }catch(e){}
      }
      if (typeof payload.eventInfo === 'string'){
        try{ window.eventInfo = payload.eventInfo; }catch(e){}
      }
      if (typeof payload.eventBgColor === 'string'){
        try{ window.eventBgColor = payload.eventBgColor; }catch(e){}
      }
      if (typeof payload.eventFootnoteImage === 'string'){
        try{
          if (!/^\[object/i.test(payload.eventFootnoteImage)) window.eventFootnoteImage = payload.eventFootnoteImage;
        }catch(e){}
      }
        if (typeof payload.eventSize === 'number'){
          try{ window.eventSize = payload.eventSize; }catch(e){}
        }
      // social object
      if (payload.social && typeof payload.social === 'object'){
        try{ window.social = payload.social; }catch(e){}
      }
      // apply event title live color/font immediately if element present
      try{
  const t = document.getElementById('eventTitle');
  const img = document.getElementById('eventImage');
  const infoEl = document.getElementById('eventInfoDisplay');
  const footEl = document.getElementById('footnoteImage');
        if (t){
          if (typeof window.eventName === 'string'){
            const nm = (window.eventName||'').trim();
            t.textContent = nm; // show exactly what admin set (blank if not set)
          }
          const font = (window.eventFont||'bebas').toLowerCase();
          document.body.classList.remove('font-bebas','font-anton','font-oswald','font-montserrat','font-poppins','font-playfair','font-impact');
          document.body.classList.add('font-'+(font||'bebas'));
          if (window.eventColor) t.style.color = window.eventColor;
            if (typeof window.eventSize === 'number') t.style.fontSize = (window.eventSize/10).toFixed(1)+'rem';
          // Show image and keep title visible if it has content
          if (img){
            if (window.eventImage){
              img.src = window.eventImage;
              if (typeof window.eventImageSize === 'number'){
                img.style.maxHeight = (window.eventImageSize/10).toFixed(1)+'rem';
              }
              img.style.display = 'block';
              const hasName = (t.textContent||'').trim().length > 0;
              t.style.display = hasName ? '' : 'none';
            }
            else { img.style.display = 'none'; t.style.display = ''; }
          }
          // footnote apply (string-only)
          if (footEl){
            if (typeof window.eventFootnoteImage === 'string' && window.eventFootnoteImage){ footEl.src = window.eventFootnoteImage; footEl.style.display='inline-block'; }
            else { footEl.src=''; footEl.style.display='none'; }
          }
        }
        // apply info text under title
        try{
          if (infoEl){
            const raw = (window.eventInfo||'').trim();
            if (raw){
              const safe = raw.replace(/[<>]/g,'');
              infoEl.innerHTML = safe.split(/\r?\n/).map(line=> `<div class="event-line">${line}</div>`).join('');
              infoEl.style.display='';
            } else { infoEl.innerHTML=''; infoEl.style.display='none'; }
          }
        }catch(e){}
        // apply background color
        try{
            // Apply base gradient or solid color (no overlay). If black, use softer gradient.
            const BASE_GRADIENT = "linear-gradient(to bottom, #22394f 0%, #1a2d41 28%, #142433 55%, #0d1a26 78%, #09131d 100%)";
            const SOFT_BLACK_GRADIENT = "linear-gradient(to bottom, #0f1822 0%, #0d141d 50%, #0b1119 100%)";
            function applyBgTint(hex){
              if(!hex){ document.body.style.background = BASE_GRADIENT; return; }
              const low = hex.toLowerCase();
              if (low==='#000000' || low==='#000'){ document.body.style.background = SOFT_BLACK_GRADIENT; return; }
              const m = hex.match(/^#?([0-9a-f]{6})$/i); if(!m){ document.body.style.background = BASE_GRADIENT; return; }
              document.body.style.background = '#' + m[1];
            }
            if (typeof window.eventBgColor === 'string'){
              applyBgTint(window.eventBgColor);
              try{ document.documentElement.style.setProperty('--bg', window.eventBgColor); }catch(_){ }
          }
        }catch(e){}
        // reflect fightsVisible change live
        try{
          const listWrap = document.getElementById('fightList');
          const sectionTitle = document.querySelector('.section-title');
          const showF = (window.fightsVisible!==false);
          if (listWrap) listWrap.style.display = showF? '' : 'none';
          if (sectionTitle) sectionTitle.style.display = showF? '' : 'none';
        }catch(e){}
      }catch(e){}

      // call renderer helpers if available
      if (typeof renderList === 'function') try{ renderList(); }catch(e){}
      if (typeof updateNow === 'function') try{ updateNow(); }catch(e){}
      if (typeof window.renderSocial === 'function') try{ window.renderSocial(); }catch(e){}
      endDomUpdate();
    }catch(e){ console.warn('ws-client: failed to apply state', e); }
  }

  function connect(){
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    ws = new WebSocket(wsUrl);

    ws.addEventListener('open', ()=>{
      console.log('ws-client: connected to', wsUrl);
      backoff = 1000; // reset backoff
      if (reconnectTimer){ clearTimeout(reconnectTimer); reconnectTimer = null; }
      // Clear local offline standby on successful connection; server may
      // immediately broadcast its authoritative standby flag which will
      // override this if needed.
      try{ window.standby = false; if (typeof updateNow === 'function') updateNow(); }catch(e){}
    });

    ws.addEventListener('message', (ev)=>{
      try{
        const msg = JSON.parse(ev.data);
        if (!msg) return;
        if (msg.type === 'state'){
          safeApplyState(msg);
          // ack the broadcast so server knows this client applied it
          if (typeof msg.broadcastId === 'number' && ws.readyState === WebSocket.OPEN){
            try{ ws.send(JSON.stringify({ type: 'ack', broadcastId: msg.broadcastId })); }catch(e){}
          }
          return;
        }
        if (msg.type === 'setFightsVisible') { window.fightsVisible = !!msg.on; }
        // Live-apply win method updates so viewer pill appears immediately
        if (msg.type === 'setWinMethod' && Array.isArray(window._fights)){
          try{ console.debug('[ws] setWinMethod', msg.index, msg.method); }catch(_){ }
          const i = Number.isInteger(msg.index) ? msg.index : -1;
          if (i>=0 && i < window._fights.length){
            const m = (msg.method||'').toString().trim();
            if (m) { window._fights[i].method = m; recentMethods[i] = m; }
            else { delete window._fights[i].method; delete recentMethods[i]; }
            if (typeof renderList === 'function') try{ renderList(); }catch(_){ }
          }
        }
        // If winner cleared, also drop method locally for consistency
        if (msg.type === 'clearWinner' && Array.isArray(window._fights)){
          const i = Number.isInteger(msg.index) ? msg.index : -1;
          if (i>=0 && i < window._fights.length){
            delete window._fights[i].method; delete recentMethods[i];
            if (typeof renderList === 'function') try{ renderList(); }catch(_){ }
          }
        }
  if (msg.type === 'setSocial' && msg.social && typeof msg.social === 'object'){ window.social = msg.social; if (typeof window.renderSocial === 'function') try{ window.renderSocial(); }catch(e){} }
        if (msg.type === 'setFightsVisible' || msg.type === 'setEventMeta'){
          try{
            const listWrap = document.getElementById('fightList');
            const sectionTitle = document.querySelector('.section-title');
            const showF = (window.fightsVisible!==false);
            if (listWrap) listWrap.style.display = showF? '' : 'none';
            if (sectionTitle) sectionTitle.style.display = showF? '' : 'none';
          }catch(e){}
        }
        // other message types can be handled here if needed
          // Live updates for individual event meta actions before full state save broadcast arrives
          if (msg.type === 'setEventName') { window.eventName = (msg.name||'').toString(); }
          if (msg.type === 'setEventFont') { window.eventFont = (msg.font||'bebas').toString(); }
          if (msg.type === 'setEventColor') { window.eventColor = (msg.color||'').toString(); }
          if (msg.type === 'setEventSize') { const sz = Number(msg.size); if (Number.isFinite(sz)) window.eventSize = Math.min(60, Math.max(20, Math.round(sz))); }
          if (/^setEvent(Name|Font|Color|Size|Meta)$/.test(msg.type)) {
            beginDomUpdate();
            try{
              const t = document.getElementById('eventTitle');
              const img = document.getElementById('eventImage');
              const infoEl = document.getElementById('eventInfoDisplay');
              const footEl = document.getElementById('footnoteImage');
              if (t){
                t.textContent = (window.eventName||'').trim();
                if (window.eventColor) t.style.color = window.eventColor;
                if (typeof window.eventSize === 'number') t.style.fontSize = (window.eventSize/10).toFixed(1)+'rem';
                const font = (window.eventFont||'bebas').toLowerCase();
                document.body.classList.remove('font-bebas','font-anton','font-oswald','font-montserrat','font-poppins','font-playfair','font-impact');
                document.body.classList.add('font-'+(font||'bebas'));
                if (img){
                  if (window.eventImage){
                    img.src = window.eventImage;
                    if (typeof window.eventImageSize === 'number'){
                      img.style.maxHeight = (window.eventImageSize/10).toFixed(1)+'rem';
                    }
                    img.style.display='block';
                    const hasName = (t.textContent||'').trim().length > 0;
                    t.style.display = hasName ? '' : 'none';
                  } else { img.style.display='none'; t.style.display=''; }
                }
                if (footEl){
                  if (window.eventFootnoteImage){ footEl.src = window.eventFootnoteImage; footEl.style.display='inline-block'; }
                  else { footEl.src=''; footEl.style.display='none'; }
                }
                if (infoEl){
                  const raw = (window.eventInfo||'').trim();
                  if (raw){
                    const safe = raw.replace(/[<>]/g,'');
                    infoEl.innerHTML = safe.split(/\r?\n/).map(line=> `<div class="event-line">${line}</div>`).join('');
                    infoEl.style.display='';
                  } else { infoEl.innerHTML=''; infoEl.style.display='none'; }
                }
                if (typeof window.eventBgColor === 'string' && window.eventBgColor && window.eventBgColor.toLowerCase() !== '#000000'){
                  applyBgTint(window.eventBgColor);
                  try{ document.documentElement.style.setProperty('--bg', window.eventBgColor); }catch(_){ }
                }
              }
            }catch(e){}
            endDomUpdate();
          }
          if (msg.type === 'setEventMeta') {
            beginDomUpdate();
            // apply fields from meta message directly
            if (msg.name!=null) window.eventName = (msg.name||'').toString();
            if (msg.font!=null) window.eventFont = (msg.font||'bebas').toString();
            if (msg.color!=null) window.eventColor = (msg.color||'').toString();
            if (msg.image!=null) {
              if (typeof msg.image === 'string') window.eventImage = msg.image; else if (msg.image && typeof msg.image === 'object') { if (typeof msg.image.src === 'string') window.eventImage = msg.image.src; else if (typeof msg.image.v === 'string') window.eventImage = msg.image.v; }
            }
            if (msg.imageSize!=null){ const isz = Number(msg.imageSize); if (Number.isFinite(isz)) window.eventImageSize = Math.min(300, Math.max(40, Math.round(isz))); }
            if (msg.size!=null){ const sz = Number(msg.size); if (Number.isFinite(sz)) window.eventSize = Math.min(60, Math.max(20, Math.round(sz))); }
            if (msg.info!=null){ window.eventInfo = (msg.info||'').toString(); }
            if (msg.bgColor!=null){ window.eventBgColor = (msg.bgColor||'').toString(); }
            if (msg.footnoteImage!=null){ if (typeof msg.footnoteImage === 'string') window.eventFootnoteImage = msg.footnoteImage; else if (msg.footnoteImage && typeof msg.footnoteImage === 'object'){ if (typeof msg.footnoteImage.src === 'string') window.eventFootnoteImage = msg.footnoteImage.src; else if (typeof msg.footnoteImage.v === 'string') window.eventFootnoteImage = msg.footnoteImage.v; } }
            try{
              const t = document.getElementById('eventTitle');
              const img = document.getElementById('eventImage');
              const infoEl = document.getElementById('eventInfoDisplay');
              const footEl = document.getElementById('footnoteImage');
              if (t){
                t.textContent = (window.eventName||'').trim();
                if (window.eventColor) t.style.color = window.eventColor;
                if (typeof window.eventSize === 'number') t.style.fontSize = (window.eventSize/10).toFixed(1)+'rem';
                const font = (window.eventFont||'bebas').toLowerCase();
                document.body.classList.remove('font-bebas','font-anton','font-oswald','font-montserrat','font-poppins','font-playfair','font-impact');
                document.body.classList.add('font-'+(font||'bebas'));
                console.log('[viewer] event meta applied', {name:window.eventName,font:window.eventFont,color:window.eventColor,size:window.eventSize});
                if (img){
                  if (window.eventImage){
                    img.src = window.eventImage;
                    if (typeof window.eventImageSize === 'number'){
                      img.style.maxHeight = (window.eventImageSize/10).toFixed(1)+'rem';
                    }
                    img.style.display='block';
                    const hasName = (t.textContent||'').trim().length > 0;
                    t.style.display = hasName ? '' : 'none';
                  } else { img.style.display='none'; t.style.display=''; }
                }
                if (footEl){
                  if (window.eventFootnoteImage){ footEl.src = window.eventFootnoteImage; footEl.style.display='inline-block'; }
                  else { footEl.src=''; footEl.style.display='none'; }
                }
                if (infoEl){
                  const raw = (window.eventInfo||'').trim();
                  if (raw){
                    const safe = raw.replace(/[<>]/g,'');
                    infoEl.innerHTML = safe.split(/\r?\n/).map(line=> `<div class="event-line">${line}</div>`).join('');
                    infoEl.style.display='';
                  } else { infoEl.innerHTML=''; infoEl.style.display='none'; }
                }
                if (typeof window.eventBgColor === 'string' && window.eventBgColor && window.eventBgColor.toLowerCase() !== '#000000'){
                  applyBgTint(window.eventBgColor);
                  try{ document.documentElement.style.setProperty('--bg', window.eventBgColor); }catch(_){ }
                }
              }
            }catch(e){}
            endDomUpdate();
          }
          if (msg.type === 'setSocial' && msg.social && typeof msg.social === 'object'){
            window.social = msg.social;
            if (typeof window.renderSocial === 'function'){
              try{ window.renderSocial(); }catch(e){}
            }
          }
      }catch(e){ /* ignore bad messages */ }
    });

    ws.addEventListener('close', (evt)=>{
      console.warn('ws-client: connection closed', evt && evt.code);
      // When the connection closes, enter standby so the UI hides live frames
      try{ window.standby = true; if (typeof updateNow === 'function') updateNow(); }catch(e){}
      scheduleReconnect();
    });

    ws.addEventListener('error', (err)=>{
      console.warn('ws-client: error', err && err.message);
      // Let close handler decide to reconnect
    });
  }

  function scheduleReconnect(){
    if (reconnectTimer) return;
    backoff = Math.min(MAX_BACKOFF, backoff * 1.8);
    console.log(`ws-client: reconnecting in ${Math.round(backoff/1000)}s`);
    reconnectTimer = setTimeout(()=>{ reconnectTimer = null; connect(); }, backoff);
  }

  // start after DOM ready so renderList/updateNow and window._fights exist
  if (document.readyState === 'complete' || document.readyState === 'interactive'){
    connect();
  } else {
    document.addEventListener('DOMContentLoaded', connect);
  }

  // expose for debugging
  window.__wsClient = { connect };
})();
