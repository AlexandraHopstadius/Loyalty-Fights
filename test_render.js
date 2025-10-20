// headless test to verify fightcard rendering using jsdom
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

(async function(){
  const root = path.resolve(__dirname);
  const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
  // load fightcard.js text so we can inject it
  const fc = fs.readFileSync(path.join(root,'fightcard.js'),'utf8');
  // load fights.json
  const state = JSON.parse(fs.readFileSync(path.join(root,'fights.json'),'utf8'));

  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable' });
  const { window } = dom;

  console.log('Has fightList before script?', !!dom.window.document.getElementById('fightList'));

  // stub fetch to return the local fights.json when /state requested
  window.fetch = async function(url){
    if (url.endsWith('/state') || url === '/state'){
      return { ok:true, json: async()=> state, text: async()=> JSON.stringify(state), status:200 };
    }
    // fallback to real fetch if available
    throw new Error('Unexpected fetch '+url);
  };

  // make minimal elements expected by fightcard.js
  // ensure fightList exists (it is in index.html already)
  // inject fightcard.js into the window context
  const scriptEl = dom.window.document.createElement('script');
  scriptEl.textContent = fc;
  dom.window.document.body.appendChild(scriptEl);

  console.log('Script injected. Has fightList after script?', !!dom.window.document.getElementById('fightList'));

  // If DOMContentLoaded already fired before our script was added, dispatch it so
  // the fightcard.js listener will run. Then wait a short time for async tasks.
  try{
    const ev = new dom.window.Event('DOMContentLoaded', { bubbles: true, cancelable: false });
    dom.window.document.dispatchEvent(ev);
  }catch(e){}
  // Collect runtime errors that might have happened inside JSDOM
  const errors = [];
  dom.window.addEventListener('error', (e)=>{ errors.push(e.error ? e.error.toString() : (e.message||String(e))); });

  await new Promise(r=> setTimeout(r, 200));

  // Dump body length and any errors for debugging
  console.log('BODY_LENGTH', dom.window.document.body.innerHTML.length);
  if (errors.length) console.log('DOM_ERRORS', errors);
  // Inspect global symbols created by fightcard.js
  console.log('window._fights type:', typeof dom.window._fights);
  console.log('window._fights length:', dom.window._fights ? dom.window._fights.length : 'no');
  console.log('renderList type:', typeof dom.window.renderList);
  console.log('updateNow type:', typeof dom.window.updateNow);

  const cards = dom.window.document.querySelectorAll('.fight-card');
  console.log('Rendered cards:', cards.length);
  const fightList = dom.window.document.getElementById('fightList');
  if (fightList) console.log('fightList.innerHTML length:', fightList.innerHTML.length, 'snippet:', fightList.innerHTML.slice(0,200));
  // Print first card HTML snippet
  if (cards.length>0) console.log('First card html snippet:', cards[0].innerHTML.slice(0,200));

  // show current value
  console.log('window.current =', dom.window.current);

})();
