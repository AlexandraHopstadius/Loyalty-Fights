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

  // Start in standby until we confirm a live connection
  try{ window.standby = true; }catch(e){ /* ignore */ }

  function safeApplyState(msg){
    // Support either: msg = {type:'state', state:{fights:[], current:0}, broadcastId}
    // or legacy: msg = { fights:[], current:0 }
    const payload = (msg && msg.state) ? msg.state : msg;
    if (!payload) return;

    try{
      // replace fights array while preserving reference if possible
      if (Array.isArray(payload.fights)){
        if (window._fights && Array.isArray(window._fights)){
          window._fights.length = 0;
          payload.fights.forEach(f=> window._fights.push(f));
        } else {
          // fall back to creating global _fights
          window._fights = payload.fights.slice();
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

      // call renderer helpers if available
      if (typeof renderList === 'function') try{ renderList(); }catch(e){}
      if (typeof updateNow === 'function') try{ updateNow(); }catch(e){}
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
        // other message types can be handled here if needed
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
