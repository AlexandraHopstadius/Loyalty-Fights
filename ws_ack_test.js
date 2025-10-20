const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:4000');
ws.on('open', ()=>{ console.log('open'); });
ws.on('message', (m)=>{
  console.log('recv', m.toString());
  try{
    const msg = JSON.parse(m.toString());
    if (msg.broadcastId){
      console.log('sending ack for', msg.broadcastId);
      ws.send(JSON.stringify({ type:'ack', broadcastId: msg.broadcastId }));
    }
  }catch(e){ }
});
setTimeout(()=>{ console.log('done'); ws.close(); process.exit(0); }, 8000);
