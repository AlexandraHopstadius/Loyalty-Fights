const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000');
ws.on('open', ()=>{ console.log('ws open'); });
ws.on('message', (m)=>{ console.log('recv:', m.toString()); });
ws.on('error', (e)=>{ console.error('ws err', e); });
setTimeout(()=>{ console.log('closing'); ws.close(); process.exit(0); }, 10000);
