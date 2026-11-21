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

/* North-up map UI. Bundled OSM grid uses positive Y toward north.
 * Display-only: no changes to simulation, movement, teams or scores.
 * Original geometry remains an approximate 29.8m/tile blockout. */
(() => {
  'use strict';
  const map = window.KONDOTTY_MAP;
  if (!map || !map.grid || !map.rooms) return;
  const $ = id => document.getElementById(id);
  const oldMini = $('nelli-minimap'), mapButton = $('nelli-mapbtn');
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  const names = map.rooms.map(r => ({n:r.n,x:r.cx,y:r.cy}));
  const terrain = document.createElement('canvas');
  terrain.width=map.w;terrain.height=map.h;
  const tg=terrain.getContext('2d'), palette=['#7c7969','#394b37','#394b37','#394b37','#394b37','#c0b898','#979b8b'];
  for(let y=0;y<map.h;y++) for(let x=0;x<map.w;x++) {
    tg.fillStyle=palette[Number(map.grid[y][x])]||palette[1];
    tg.fillRect(x,map.h-1-y,1,1);
  }
  const style=document.createElement('style');
  style.textContent=`
    #nelli-minimap {visibility:hidden!important;pointer-events:none!important}
    #nx-mini {position:fixed;right:max(8px,env(safe-area-inset-right));top:max(8px,env(safe-area-inset-top));width:96px;height:112px;padding:0;z-index:31;border:1px solid #c8c5a380;border-radius:7px;overflow:hidden;background:#17231ee8;color:#fff5d8;touch-action:manipulation;font:10px system-ui;cursor:pointer}
    #nx-mini canvas {display:block;width:94px;height:94px}
    #nx-mini span {display:block;height:16px;line-height:16px;background:#17231e}
    #nx-place {position:fixed;right:112px;top:50px;max-width:min(220px,36vw);padding:6px 8px;z-index:29;background:#101b16dc;border:1px solid #b9b58a60;border-radius:5px;color:#f0ecd5;font:12px system-ui;text-align:right;pointer-events:none;line-height:1.35}
    #nx-place small {display:block;font-size:9px;color:#b9c8b6}
    #nx-mini[hidden],#nx-place[hidden],#nx-map[hidden] {display:none!important}
    #nx-map {position:fixed;inset:0;z-index:88;box-sizing:border-box;padding:10px max(12px,env(safe-area-inset-right)) 8px max(12px,env(safe-area-inset-left));background:#0b1715f7;color:#f1eedb;font:12px system-ui;display:flex;flex-direction:column;gap:7px}
    #nx-map header {display:flex;gap:12px;align-items:center;justify-content:space-between;min-height:36px;flex-shrink:0}
    #nx-map h2 {font:600 16px system-ui;margin:0;letter-spacing:1px}
    #nx-map-location {color:#c5cdbb;font-size:11px;margin-top:2px}
    #nx-map nav {display:flex;gap:5px;align-items:center;flex-shrink:0}
    #nx-map button {min-width:36px;min-height:36px;padding:5px 9px;border:1px solid #afb79280;background:#283d32;color:#f1eedb;border-radius:5px;font:12px system-ui;touch-action:manipulation;cursor:pointer}
    #nx-map button:focus-visible,#nx-mini:focus-visible {outline:3px solid #ffdf70;outline-offset:1px}
    #nx-map-stage {position:relative;flex:1;min-height:70px;overflow:hidden;border:1px solid #9cae8f80;border-radius:7px;background:#14241f}
    #nx-map-canvas {display:block;width:100%;height:100%;touch-action:none;cursor:grab}
    #nx-map-canvas:active {cursor:grabbing}
    #nx-map footer {font:10px/1.4 system-ui;color:#bac9b4;display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap}
    #nx-map footer a {color:#d3ddbc}
    #nx-map-help {position:absolute;left:10px;bottom:8px;color:#e1e5cf;background:#0c1914c9;padding:4px 6px;border-radius:3px;font-size:10px;pointer-events:none}
    @media(max-height:440px){#nx-map{padding-top:5px;gap:4px}#nx-map h2{font-size:13px}#nx-map header{min-height:34px}#nx-map footer{font-size:9px;gap:4px}#nx-map-location{font-size:10px}#nx-map button{min-height:34px;padding:4px 7px}}
  `;
  document.head.append(style);
  const mini=document.createElement('button');mini.id='nx-mini';mini.hidden=true;
  mini.setAttribute('aria-label','Expand location map');mini.title='Expand map';
  mini.innerHTML='<canvas width="188" height="188" aria-hidden="true"></canvas><span>EXPAND MAP &#x2922;</span>';
  const place=document.createElement('div');place.id='nx-place';place.hidden=true;
  const overlay=document.createElement('section');overlay.id='nx-map';overlay.hidden=true;
  overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','nx-map-title');
  overlay.innerHTML=`<header><div><h2 id="nx-map-title">KONDOTTY / AREA MAP</h2><div id="nx-map-location"></div></div><nav aria-label="Map controls"><button id="nx-map-out" aria-label="Zoom out">-</button><button id="nx-map-in" aria-label="Zoom in">+</button><button id="nx-map-you">YOU</button><button id="nx-map-fit">FIT</button><button id="nx-map-close" aria-label="Close map">CLOSE</button></nav></header><div id="nx-map-stage"><canvas id="nx-map-canvas" aria-label="North-up map showing place names and player positions"></canvas><div id="nx-map-help">Drag to pan / pinch or + - to zoom</div></div><footer><span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">Map data &copy; OpenStreetMap contributors / ODbL</a> / approximate game blockout, not Street View</span><span id="nx-map-status"></span></footer>`;
  document.body.append(mini,place,overlay);
  const cv=$('nx-map-canvas'), g=cv.getContext('2d'), mg=mini.querySelector('canvas').getContext('2d');
  let zoom=1,cx=map.w/2,cy=map.h/2,W=1,H=1,scale=1,restoreFocus=null;
  let lastState=null,lastPlace='',lastMarker='';
  const pointers=new Map();let pinch=null;
  function state(){const s=window.__nelliS;return s&&s.joined&&s.state&&s.state.you?s.state:null;}
  function nearest(you){let best=null;for(const n of names){const d=Math.hypot(n.x-you.x,n.y-you.y);if(!best||d<best.d)best={...n,d};}return best;}
  function where(you){const n=nearest(you);if(!n)return 'Kondotty area';return 'Near '+n.n;}
  function distance(d){const m=Math.round(d*map.cellM/50)*50;return m<1000?'~'+m+' m':'~'+(m/1000).toFixed(1)+' km';}
  function limits(){scale=Math.min(W/map.w,H/map.h)*zoom;cx=clamp(cx,0,map.w);cy=clamp(cy,0,map.h);}
  function point(x,y){return [W/2+(x-cx)*scale,H/2-(y-cy)*scale];}
  function resize(){const r=cv.parentElement.getBoundingClientRect();W=Math.max(1,r.width);H=Math.max(1,r.height);const d=Math.min(devicePixelRatio||1,2);cv.width=Math.round(W*d);cv.height=Math.round(H*d);g.setTransform(d,0,0,d,0,0);limits();draw();}
  function marker(ctx,x,y,face,color,size){ctx.save();ctx.translate(x,y);ctx.fillStyle=color;ctx.strokeStyle='#10251e';ctx.lineWidth=2;if(face){ctx.rotate(Math.atan2(face[0],face[1]));ctx.beginPath();ctx.moveTo(0,-size*1.6);ctx.lineTo(size,size);ctx.lineTo(0,size*.55);ctx.lineTo(-size,size);ctx.closePath();}else{ctx.beginPath();ctx.arc(0,0,size,0,Math.PI*2);}ctx.fill();ctx.stroke();ctx.restore();}
  function draw(){
    if(overlay.hidden)return;limits();g.clearRect(0,0,W,H);g.fillStyle='#14241f';g.fillRect(0,0,W,H);
    const [x,y]=point(0,map.h);g.imageSmoothingEnabled=false;g.drawImage(terrain,x,y,map.w*scale,map.h*scale);
    // Grid and scale refer to the bundled game coordinates, not a GPS reading.
    g.strokeStyle='#e8edce12';g.lineWidth=1;
    for(let t=0;t<=map.w;t+=32){const [px]=point(t,0);g.beginPath();g.moveTo(px,0);g.lineTo(px,H);g.stroke();}
    for(let t=0;t<=map.h;t+=32){const [,py]=point(0,t);g.beginPath();g.moveTo(0,py);g.lineTo(W,py);g.stroke();}
    const st=state(), you=st&&st.you, near=you&&nearest(you);
    const order=[...names].sort((a,b)=>{const rank=n=>near&&n.n===near.n?3:n.n==='Kondotty'?2:['Karipur','Kizhissery','Kottappuram'].includes(n.n)?1:0;return rank(b)-rank(a);});
    const used=[];g.font='600 12px system-ui';g.textAlign='center';g.textBaseline='middle';
    for(const n of order){const [px,py]=point(n.x,n.y);if(px<0||px>W||py<0||py>H)continue;
      g.fillStyle='#dbe8c6';g.beginPath();g.arc(px,py,2,0,7);g.fill();
      const tw=g.measureText(n.n).width+10;let box=null;
      for(const off of [-18,18,-35,35]){const b={x:px-tw/2,y:py+off-9,w:tw,h:18};if(b.x<3||b.x+b.w>W-3||b.y<3||b.y+b.h>H-3)continue;if(!used.some(a=>b.x<a.x+a.w+3&&b.x+b.w+3>a.x&&b.y<a.y+a.h+2&&b.y+b.h+2>a.y)){box=b;break;}}
      if(!box)continue;used.push(box);g.strokeStyle='#d1dcaf66';g.beginPath();g.moveTo(px,py);g.lineTo(px,box.y+9);g.stroke();g.fillStyle='#10251eea';g.fillRect(box.x,box.y,box.w,box.h);g.fillStyle=near&&near.n===n.n?'#ffe38b':'#edf2da';g.fillText(n.n,px,box.y+9);
    }
    if(st){for(const o of st.others||[]){const p=point(o.x,o.y);marker(g,...p,null,o.dead?'#84928d':'#8ed8ff',4);}marker(g,...point(you.x,you.y),you.f,'#ffdb64',6);}
    g.textAlign='left';g.textBaseline='alphabetic';g.fillStyle='#10251eea';g.fillRect(8,8,39,42);g.fillStyle='#eef2d5';g.font='bold 13px system-ui';g.fillText('N',22,24);g.beginPath();g.moveTo(27,29);g.lineTo(21,42);g.lineTo(33,42);g.closePath();g.fill();
    const meters=zoom<2?1000:zoom<4?500:200, len=meters/map.cellM*scale;
    g.strokeStyle='#edf2d5';g.lineWidth=2;g.beginPath();g.moveTo(W-18-len,H-27);g.lineTo(W-18,H-27);g.stroke();g.font='10px system-ui';g.textAlign='right';g.fillStyle='#edf2d5';g.fillText('~'+meters+' m',W-18,H-34);
    $('nx-map-status').textContent=zoom.toFixed(1)+'x / gold: you / blue: players';
  }
  function drawMini(st){
    const y=st.you,SZ=188,r=23,ss=SZ/(r*2);mg.clearRect(0,0,SZ,SZ);mg.fillStyle='#14241f';mg.fillRect(0,0,SZ,SZ);mg.imageSmoothingEnabled=false;
    mg.drawImage(terrain,(map.w/2-y.x)*ss+SZ/2-map.w*ss/2, (y.y-map.h)*ss+SZ/2,map.w*ss,map.h*ss);
    for(const o of st.others||[]){const px=SZ/2+(o.x-y.x)*ss,py=SZ/2-(o.y-y.y)*ss;if(px>4&&px<SZ-4&&py>4&&py<SZ-4)marker(mg,px,py,null,o.dead?'#84928d':'#8ed8ff',4);}
    marker(mg,SZ/2,SZ/2,y.f,'#ffdb64',8);mg.fillStyle='#10251eea';mg.fillRect(5,4,27,26);mg.fillStyle='#fff0c7';mg.font='bold 19px system-ui';mg.fillText('N',10,24);
  }
  function update(){const st=state();const visible=!!st&&!(oldMini&&oldMini.classList.contains('nelli-hidden'));mini.hidden=place.hidden=!visible;if(!visible){if(!overlay.hidden)close();return;}
    lastState=st;drawMini(st);const n=nearest(st.you),label=where(st.you),detail=n?distance(n.d)+' from named point / game position':'Game position';
    if(label+'|'+detail!==lastPlace){place.replaceChildren(document.createTextNode(label));const sub=document.createElement('small');sub.textContent=detail;place.append(sub);lastPlace=label+'|'+detail;}
    $('nx-map-location').textContent=label+(n?' / '+distance(n.d)+' from named point':'')+' / game position, not phone GPS';
    if(!overlay.hidden)draw();
  }
  function stopMotion(){window.dispatchEvent(new Event('blur'));}
  function open(){if(!state())return;restoreFocus=document.activeElement;overlay.hidden=false;stopMotion();resize();$('nx-map-close').focus({preventScroll:true});}
  function close(){overlay.hidden=true;pointers.clear();pinch=null;stopMotion();if(restoreFocus&&restoreFocus.isConnected)restoreFocus.focus({preventScroll:true});}
  function changeZoom(next){zoom=clamp(next,1,8);limits();draw();}
  function center(){const st=state();if(st){cx=st.you.x;cy=st.you.y;zoom=Math.max(zoom,3);}draw();}
  mini.addEventListener('click',open);
  if(mapButton)mapButton.addEventListener('click',e=>{if(document.body.classList.contains('nelli-layout-editing'))return;e.preventDefault();e.stopImmediatePropagation();overlay.hidden?open():close();},true);
  $('nx-map-close').addEventListener('click',close);$('nx-map-in').addEventListener('click',()=>changeZoom(zoom*1.5));$('nx-map-out').addEventListener('click',()=>changeZoom(zoom/1.5));$('nx-map-you').addEventListener('click',center);$('nx-map-fit').addEventListener('click',()=>{zoom=1;cx=map.w/2;cy=map.h/2;draw();});
  cv.addEventListener('wheel',e=>{e.preventDefault();changeZoom(zoom*(e.deltaY<0?1.15:1/1.15));},{passive:false});
  cv.addEventListener('pointerdown',e=>{e.preventDefault();cv.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2){const [a,b]=[...pointers.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y),z:zoom};}});
  cv.addEventListener('pointermove',e=>{const old=pointers.get(e.pointerId);if(!old)return;e.preventDefault();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2&&pinch){const [a,b]=[...pointers.values()];changeZoom(pinch.z*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinch.d));}else if(pointers.size===1){cx-=(e.clientX-old.x)/scale;cy+=(e.clientY-old.y)/scale;draw();}});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])cv.addEventListener(type,e=>{pointers.delete(e.pointerId);pinch=null;});
  window.addEventListener('keydown',e=>{if(overlay.hidden)return;e.stopImmediatePropagation();const buttons=[...overlay.querySelectorAll('button,a')];if(e.key==='Escape'){e.preventDefault();close();}else if(e.key==='Tab'){const i=buttons.indexOf(document.activeElement),n=e.shiftKey?(i<=0?buttons.length-1:i-1):(i+1)%buttons.length;e.preventDefault();buttons[n].focus();}else if(['+','=','-','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();if(e.key==='+'||e.key==='=')changeZoom(zoom*1.5);else if(e.key==='-')changeZoom(zoom/1.5);else {cx+=(e.key==='ArrowRight'?40:e.key==='ArrowLeft'?-40:0)/scale;cy+=(e.key==='ArrowUp'?40:e.key==='ArrowDown'?-40:0)/scale;draw();}}},true);
  window.addEventListener('resize',()=>{if(!overlay.hidden)resize();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&!overlay.hidden)close();});
  setInterval(update,200);update();
})();
/* Keep the existing saved map-transparency setting working for the new view. */
(() => {
  const slider=document.getElementById('nelli-mapopa');
  function sync(){if(!slider)return;const opacity=String(Math.max(.2,Math.min(1,Number(slider.value)/100)));for(const node of document.querySelectorAll('#nx-mini canvas,#nx-map-canvas'))node.style.opacity=opacity;}
  if(slider)slider.addEventListener('input',sync);sync();
})();
/* Pure display-state helper. No simulation writes or rendering assumptions.
 * Defaults: announce while approaching within ~360m of a named point;
 * hide within ~90m, then re-arm after leaving ~480m. All distances are
 * approximate and measured in the existing 29.8m game grid.
 */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.NexoraApproachLabels=factory();})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  function create(points,options){
    const o=Object.assign({showRadius:12,arrivalRadius:3,rearmRadius:16,approachDelta:.12},options||{});
    const memory=new Map();let active=null;
    return {
      update(x,y){
        if(!Number.isFinite(x)||!Number.isFinite(y)){active=null;return null;}
        const candidates=[];
        for(const p of points){
          const key=p.id||p.n,d=Math.hypot(p.x-x,p.y-y);
          let m=memory.get(key);
          if(!m){m={last:d,arrived:d<=o.arrivalRadius};memory.set(key,m);continue;}
          if(d>=o.rearmRadius)m.arrived=false;
          if(d<=o.arrivalRadius){m.arrived=true;if(active&&active.key===key)active=null;}
          const approaching=m.last-d>=o.approachDelta;
          if(!m.arrived&&d>o.arrivalRadius&&d<=o.showRadius&&approaching)candidates.push({key,n:p.n,x:p.x,y:p.y,d});
          if(active&&active.key===key){
            if(d>o.showRadius+1||d-m.last>o.approachDelta)active=null;
            else active={key,n:p.n,x:p.x,y:p.y,d};
          }
          // Retain a baseline through very slow movement so approach detection
          // does not depend on frame rate. Update it after a meaningful change.
          if(Math.abs(m.last-d)>=o.approachDelta)m.last=d;
        }
        if(!active&&candidates.length){candidates.sort((a,b)=>a.d-b.d);active=candidates[0];}
        return active&&Object.assign({},active);
      },
      reset(){memory.clear();active=null;}
    };
  }
  return {create};
});

/* Approach-only original roadside signs. Static game props, not surveyed signs. */
(() => {
  'use strict';
  const map=window.KONDOTTY_MAP,helper=window.NexoraApproachLabels;
  if(!map||!helper)return;
  const logic=helper.create(map.rooms.map(r=>({n:r.n,x:r.cx,y:r.cy})));
  const style=document.createElement('style');style.textContent='#nx-place{display:none!important}';document.head.append(style);
  let group=null,current=null,lastRoom=null,lastId=null;
  function remove(){if(!group)return;group.removeFromParent();group.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){if(o.material.map)o.material.map.dispose();o.material.dispose();}});group=null;}
  function build(label,you){
    const THREE=window.__THREE,debug=window.__fpsDebug;if(!THREE||!debug||!window.NelliFps.ready)return;
    remove();
    const dx=label.x-you.x,dy=label.y-you.y,len=Math.max(.01,Math.hypot(dx,dy)),ux=dx/len,uy=dy/len;
    // Stand a little ahead and to the roadside of the approach path. Prefer
    // a walkable local road cell so the board is not buried inside a building.
    let anchor={x:you.x+ux*3+uy*1.4,y:you.y+uy*3-ux*1.4},best=Infinity;
    for(let y=Math.max(0,Math.floor(anchor.y)-3);y<=Math.min(map.h-1,Math.floor(anchor.y)+3);y++)for(let x=Math.max(0,Math.floor(anchor.x)-3);x<=Math.min(map.w-1,Math.floor(anchor.x)+3);x++){
      const code=Number(map.grid[y][x]);if(code!==5&&code!==6&&code!==1)continue;
      const dist=Math.hypot(x-you.x,y-you.y);if(dist<2||dist>7)continue;
      const ahead=(x-you.x)*ux+(y-you.y)*uy;if(ahead<1)continue;
      const rank=Math.hypot(x-anchor.x,y-anchor.y)+(code===1?0:.5);
      if(rank<best){best=rank;anchor={x:x+uy*.38,y:y-ux*.38};}
    }
    group=new THREE.Group();group.name='nexora-approach-sign';
    const art=document.createElement('canvas');art.width=1024;art.height=320;const g=art.getContext('2d');
    g.fillStyle='#15523b';g.fillRect(0,0,1024,320);g.strokeStyle='#f3f0d9';g.lineWidth=11;g.strokeRect(17,17,990,286);
    g.fillStyle='#f7f5e8';g.textAlign='center';g.textBaseline='middle';let size=100;do{g.font='600 '+size+'px sans-serif';if(g.measureText(label.n).width<870)break;size-=4;}while(size>38);g.fillText(label.n,512,125);
    g.font='42px sans-serif';g.fillText('AHEAD',512,242);
    const tex=new THREE.CanvasTexture(art);if(THREE.SRGBColorSpace)tex.colorSpace=THREE.SRGBColorSpace;
    const board=new THREE.Mesh(new THREE.BoxGeometry(3.8,1.2,.10),new THREE.MeshLambertMaterial({color:0x25483b}));board.position.y=2.2;group.add(board);
    const face=new THREE.Mesh(new THREE.PlaneGeometry(3.72,1.12),new THREE.MeshBasicMaterial({map:tex}));face.position.set(0,2.2,.056);group.add(face);
    for(const x of [-1.35,1.35]){const pole=new THREE.Mesh(new THREE.CylinderGeometry(.045,.055,2.2,6),new THREE.MeshLambertMaterial({color:0xb4b8ae}));pole.position.set(x,1.1,0);group.add(pole);}
    group.position.set(anchor.x*1.6,0,anchor.y*1.6);group.rotation.y=Math.atan2((you.x-anchor.x),(you.y-anchor.y));debug.scene().add(group);
  }
  setInterval(()=>{
    const s=window.__nelliS,st=s&&s.joined&&s.state,you=st&&st.you;
    if(!you){remove();current=null;logic.reset();return;}
    if(lastRoom!==s.room||lastId!==s.myId){logic.reset();remove();current=null;lastRoom=s.room;lastId=s.myId;}
    const label=logic.update(you.x,you.y);
    if(!label||you.dead){remove();current=null;return;}
    if(current!==label.key||!group){build(label,you);if(group)current=label.key;}
    if(group)group.visible=!document.hidden&&document.querySelector('#nx-map').hidden;
  },200);
})();
