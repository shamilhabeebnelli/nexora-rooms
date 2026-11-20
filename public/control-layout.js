/* Local, per-device control layout. Editing never sends gameplay input. */
(() => {
  'use strict';
  const controls = [
    ['nelli-stick','Movement'],['nelli-shoot','Fire'],['nelli-scope','Scope'],['nelli-jump','Jump'],
    ['nelli-crouch','Crouch'],['nelli-prone','Prone'],['nelli-peekl','Peek left'],['nelli-peekr','Peek right'],
    ['nelli-mapbtn','Map'],['nelli-cam','FPP / TPP'],['nelli-setbtn','Settings'],['nelli-sound-hud','Sound']
  ].map(([id,name]) => ({id,name,node:document.getElementById(id)})).filter(c => c.node);
  const key = 'nexora-controls-v1', panel = document.getElementById('nelli-settings');
  if (!panel) return;
  const edit = document.createElement('button'); edit.id='nelli-layout-edit'; edit.className='nelli-layout-button';
  edit.textContent='CUSTOMIZE BUTTONS'; panel.append(edit);
  const editor=document.createElement('section'); editor.id='nelli-layout-editor'; editor.hidden=true;
  editor.innerHTML=`<header><b>BUTTON LAYOUT</b><span>Drag a button or select it below</span></header>
    <label>Button <select id="nelli-layout-select" aria-label="Selected button"></select></label>
    <label>Size <input id="nelli-layout-size" aria-label="Button size" type="range" min="55" max="160" value="100"></label>
    <label>Opacity <input id="nelli-layout-opacity" aria-label="Button opacity" type="range" min="20" max="100" value="80"></label>
    <label>Rotation <input id="nelli-layout-angle" aria-label="Button rotation" type="range" min="-180" max="180" value="0"></label>
    <div><button id="nelli-layout-save">SAVE & LOCK</button><button id="nelli-layout-cancel">CANCEL</button><button id="nelli-layout-reset">RESET</button></div>
    <small id="nelli-layout-status">Saved on this device only. Gameplay buttons are paused while editing.</small>`;
  document.body.append(editor);
  const style=document.createElement('style'); style.textContent=`
    .nelli-layout-button { margin-top:10px; padding:9px; width:100%; background:#302f25; color:#f0e6cb; border:1px solid #9e8b5c; border-radius:5px; }
    #nelli-layout-editor { position:fixed; z-index:90; top:8px; left:50%; transform:translateX(-50%); width:min(320px,80vw); padding:10px; color:#eee5cc; background:rgba(15,19,16,.96); border:1px solid #baa267; border-radius:9px; font:12px system-ui; box-shadow:0 4px 20px #0008; max-height:82vh; overflow:auto; }
    #nelli-layout-editor[hidden] {display:none}
    #nelli-layout-editor header {display:flex;flex-direction:column;gap:3px;margin-bottom:8px}
    #nelli-layout-editor header span,#nelli-layout-editor small {color:#c0b8a4;font-size:10px}
    #nelli-layout-editor label {display:grid;grid-template-columns:64px 1fr;gap:5px;align-items:center;margin:4px 0}
    #nelli-layout-editor select {min-width:0;background:#292f27;color:#eee5cc;padding:5px;border:1px solid #6d725f;border-radius:4px}
    #nelli-layout-editor input {width:100%;min-width:0;accent-color:#d0b36a}
    #nelli-layout-editor button {font:10px system-ui;padding:8px 7px;margin:6px 3px 6px 0;color:#eee5cc;background:#353e31;border:1px solid #8c966e;border-radius:4px}
    .nelli-layout-editing [data-layout-control] {outline:1px dashed #f6dc82;cursor:move;touch-action:none!important;z-index:80!important;display:flex!important;visibility:visible!important}
    .nelli-layout-editing .nelli-layout-selected {outline:3px solid #f6dc82;box-shadow:0 0 12px #f6dc8266}
    @media(max-height:430px){#nelli-layout-editor{width:280px;padding:6px}#nelli-layout-editor label{margin:0}#nelli-layout-editor header{margin-bottom:2px}#nelli-layout-editor small{font-size:9px}}
  `;document.head.append(style);
  const $=id=>document.getElementById('nelli-layout-'+id), select=$('select');
  controls.forEach(c=>{c.node.dataset.layoutControl=c.id;select.add(new Option(c.name,c.id));});
  let saved={},draft={},editing=false,selected=controls[0],drag=null;
  const defaults=new Map();
  const copy=x=>JSON.parse(JSON.stringify(x));
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  try { const value=JSON.parse(localStorage.getItem(key)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))saved=value; } catch(e){}
  function captureDefaults() { controls.forEach(c=> {if(!defaults.has(c.id))defaults.set(c.id,c.node.getAttribute('style')||'');}); }
  function restore(c) {c.node.setAttribute('style',defaults.get(c.id)||'');}
  function apply(c, record) {
    restore(c);
    if(!record || ![record.x,record.y,record.size,record.opacity,record.angle].every(Number.isFinite))return;
    const n=c.node,base=n.getBoundingClientRect(),computed=getComputedStyle(n);
    const scale=clamp(record.size,55,160)/100;
    const w=Math.min(innerWidth-12,(base.width || parseFloat(computed.width) || 60)*scale),h=Math.min(innerHeight-12,(base.height || parseFloat(computed.height) || 60)*scale);
    // Include the rotated bounding box when clamping: never save an unreachable button.
    const a=clamp(record.angle,-180,180),rad=a*Math.PI/180;
    const rw=Math.abs(w*Math.cos(rad))+Math.abs(h*Math.sin(rad));
    const rh=Math.abs(w*Math.sin(rad))+Math.abs(h*Math.cos(rad));
    const x=clamp(record.x/100*innerWidth,rw/2+4,innerWidth-rw/2-4);
    const y=clamp(record.y/100*innerHeight,rh/2+4,innerHeight-rh/2-4);
    Object.assign(n.style,{left:x+'px',top:y+'px',right:'auto',bottom:'auto',margin:'0',width:w+'px',height:h+'px',opacity:String(clamp(record.opacity,20,100)/100),transform:`translate(-50%,-50%) rotate(${a}deg)`});
    record.x=x/innerWidth*100;record.y=y/innerHeight*100;
  }
  function paint() {controls.forEach(c=>apply(c,(editing?draft:saved)[c.id]));}
  function ensure(c) {
    if(!draft[c.id]) {const r=c.node.getBoundingClientRect();draft[c.id]={x:(r.x+r.width/2)/innerWidth*100,y:(r.y+r.height/2)/innerHeight*100,size:100,opacity:Math.round(Number(getComputedStyle(c.node).opacity)*100),angle:0};}
    return draft[c.id];
  }
  function choose(id) {
    selected=controls.find(c=>c.id===id)||controls[0];select.value=selected.id;
    controls.forEach(c=>c.node.classList.toggle('nelli-layout-selected',c===selected));
    const r=ensure(selected);$('size').value=r.size;$('opacity').value=r.opacity;$('angle').value=r.angle;
  }
  function stopMotion(){window.dispatchEvent(new Event('blur'));}
  edit.addEventListener('click',()=>{
    captureDefaults();stopMotion();draft=copy(saved);editing=true;panel.classList.add('nelli-hidden');
    document.body.classList.add('nelli-layout-editing');editor.hidden=false;paint();choose(select.value);
    $('status').textContent='Saved on this device only. Gameplay buttons are paused while editing.';
  });
  select.addEventListener('change',()=>choose(select.value));
  [['size','size'],['opacity','opacity'],['angle','angle']].forEach(([id,field])=>$ (id).addEventListener('input',()=>{const r=ensure(selected);r[field]=Number($(id).value);apply(selected,r);}));
  function finish(){drag=null;editing=false;editor.hidden=true;document.body.classList.remove('nelli-layout-editing');controls.forEach(c=>c.node.classList.remove('nelli-layout-selected'));stopMotion();paint();}
  $('save').addEventListener('click',()=>{
    try{localStorage.setItem(key,JSON.stringify(draft));saved=copy(draft);finish();}
    catch(e){$('status').textContent='Could not save on this device. Allow browser storage or tap Cancel.';}
  });
  $('cancel').addEventListener('click',finish);
  $('reset').addEventListener('click',()=>{draft={};paint();choose(select.value);$('status').textContent='Default layout restored in preview. Save & Lock to keep it, or Cancel.';});
  function controlTarget(t){return controls.find(c=>c.node===t||c.node.contains(t));}
  window.addEventListener('pointerdown',e=>{
    if(!editing)return;const c=controlTarget(e.target);if(!c)return;
    e.preventDefault();e.stopImmediatePropagation();choose(c.id);const r=ensure(c);
    drag={id:e.pointerId,c,startX:e.clientX,startY:e.clientY,x:r.x,y:r.y};
    c.node.setPointerCapture(e.pointerId);
  },true);
  window.addEventListener('pointermove',e=>{
    if(!editing||!drag||drag.id!==e.pointerId)return;e.preventDefault();e.stopImmediatePropagation();
    const r=ensure(drag.c);r.x=drag.x+(e.clientX-drag.startX)/innerWidth*100;r.y=drag.y+(e.clientY-drag.startY)/innerHeight*100;apply(drag.c,r);
  },true);
  for(const type of ['pointerup','pointercancel'])window.addEventListener(type,e=>{if(editing&&drag&&drag.id===e.pointerId){e.preventDefault();e.stopImmediatePropagation();drag=null;}},true);
  for(const type of ['touchstart','touchmove','touchend','touchcancel','mousedown','mouseup','click'])window.addEventListener(type,e=>{if(editing&&controlTarget(e.target)){e.preventDefault();e.stopImmediatePropagation();}},{capture:true,passive:false});
  window.addEventListener('keydown',e=>{if(editing){e.stopImmediatePropagation();}},true);
  window.addEventListener('resize',()=>{drag=null;paint();});
  captureDefaults();paint();
})();
