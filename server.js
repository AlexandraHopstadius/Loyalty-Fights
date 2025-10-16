const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const fs = require('fs');
const STATE_FILE = path.join(__dirname, 'fights.json');

// Simple in-memory state
const state = {
  current: 0,
  fights: [] // will be initialized from fights.json if present
};

// try to load initial fights from file
function loadState(){
  try{
    if (fs.existsSync(STATE_FILE)){
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const j = JSON.parse(raw);
      if (Array.isArray(j.fights)) state.fights = j.fights;
      if (typeof j.current === 'number') state.current = j.current;
      console.log('Loaded fights from', STATE_FILE);
    }
  }catch(e){ console.warn('Failed to load state file', e.message); }
}

function saveState(){
  try{
    fs.writeFileSync(STATE_FILE, JSON.stringify({ fights: state.fights, current: state.current }, null, 2), 'utf8');
  }catch(e){ console.warn('Failed to save state file', e.message); }
}

loadState();

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
app.post('/admin/action', (req, res) => {
  const token = req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  const msg = req.body;
  broadcast(msg);
  // update server state for current/winner messages
  if (msg.type === 'setCurrent') state.current = msg.index;
  if (msg.type === 'setWinner'){ const f = state.fights[msg.index]; if (f) f.winner = msg.side; }
  if (msg.type === 'clearWinner'){ const f = state.fights[msg.index]; if (f) delete f.winner; }
  // persist
  saveState();
  return res.json({ ok:true });
});

// give clients the current state
app.get('/state', (req,res)=> res.json(state));

function broadcast(obj){
  const s = JSON.stringify(obj);
  wss.clients.forEach(c=>{ if (c.readyState===WebSocket.OPEN) c.send(s); });
}

wss.on('connection', (ws, req)=>{
  // send current state on connect
  ws.send(JSON.stringify({ type:'state', state }));
  ws.on('message', (m)=>{
    try{ const msg = JSON.parse(m.toString());
      // allow admin via ws if token present in query
      if (msg && msg.type === 'admin' && msg.token === ADMIN_TOKEN){
        // forward admin command
        broadcast(msg.payload);
        if (msg.payload.type === 'setCurrent') state.current = msg.payload.index;
        if (msg.payload.type === 'setWinner'){ const f = state.fights[msg.payload.index]; if (f) f.winner = msg.payload.side; }
        if (msg.payload.type === 'clearWinner'){ const f = state.fights[msg.payload.index]; if (f) delete f.winner; }
        // persist
        saveState();
      }
    }catch(e){/* ignore */}
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log('Server running on', PORT));
