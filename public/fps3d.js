/* NELLIWERSE first-person 3D view.
   Renders the authoritative server snapshot (same one the 2D view uses)
   as a first-person scene. Owns its own canvas; client.js calls
   NelliFps.render(state) instead of the 2D world draw when active. */
(function () {
  const TILE = 1.6, EYE = 1.55, WALLH = 3.6, MAXI = 40 * 40, MAXT = 260;
  let renderer = null, scene = null, cam = null, ready = false, failed = false, selfJt = 0;
  let shops = null, shotBlocked = false, shotBlockDist = 0;
  let walls = null, roads = null, dashes = null, ground = null, trunks = null, canopies = null;
  let shuttleLane = null, horizonGround=null, shuttleSurface=null, wires = null, roadsI = null;
  let roadsV = null, tanks = null, poles = null, lampHeads = null, sunLight = null, skyDome = null, sunSprite = null;
  const SUN_DIR = { x: -0.55, y: 0.46, z: 0.42 }; /* low warm dusk sun; long shadows, occluded by buildings */
  let othersGroup = null, mobGroup = null, projGroup = null, beaconGroup = null, medkitGroup=null;
  let busSm={x:null,y:null,a:0,tx:0,ty:0,tt:0,vx:0,vy:0};
  let medkitMat=null,medkitGeo=null,busGroup=null,projGeo=null,projMat=null;
  const tracerPool=[];
  let yaw = 0, pitch = 0, canvasEl = null, lean = 0;
  let freeLooking=false,freeYaw=0,freePitch=0,lastRideYaw=null;
  function setFreeLook(on){freeLooking=!!on;freeYaw=0;freePitch=0;}
  const STANCE_EYE_H = { stand: 1.55, crouch: 1.05, prone: 0.55 };
  const eyeH = (st) => STANCE_EYE_H[st] || 1.55;
  function setLean(l) { lean = Math.max(-1, Math.min(1, l | 0)); }
  let charTmpls = null; // {A: Object3D, B: Object3D} or null -> capsule fallback
  const avatars = new Map(); // player id -> { obj, lx, ly, phase }

  let gun = null, adsOn = false, adsT = 0, adsCb = null;
  /* gun viewmodel: original box-model rifle, gunmetal with one amber sight accent */
  const GUN_HIP = [0.23, -0.185, -0.42], GUN_ADS = [0, -0.128, -0.36];
  function buildGun(THREE) {
    const g=new THREE.Group(),parts=new Map();
    const metal=new THREE.MeshStandardMaterial({color:0x727c83,roughness:.52,metalness:.35,emissive:0x172127,emissiveIntensity:.4});
    const black=new THREE.MeshStandardMaterial({color:0x333d3c,roughness:.8,metalness:.1,emissive:0x101817,emissiveIntensity:.3});
    const edge=new THREE.MeshStandardMaterial({color:0x737b79,roughness:.4,metalness:.82});
    const rubber=new THREE.MeshStandardMaterial({color:0x272c28,roughness:.95,metalness:0});
    const skin=new THREE.MeshLambertMaterial({color:0xa47652});
    const add=(geometry,mat,x,y,z,rx=0,ry=0,rz=0)=>{const m=new THREE.Matrix4(),q=new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,rz));m.compose(new THREE.Vector3(x,y,z),q,new THREE.Vector3(1,1,1));geometry.applyMatrix4(m);if(!parts.has(mat))parts.set(mat,[]);parts.get(mat).push(geometry.toNonIndexed());geometry.dispose();};
    const box=(w,h,d,mat,x,y,z,rx=0,ry=0,rz=0)=>add(new THREE.BoxGeometry(w,h,d),mat,x,y,z,rx,ry,rz);
    const cyl=(r,rb,h,mat,x,y,z,rx=Math.PI/2)=>add(new THREE.CylinderGeometry(r,rb,h,12),mat,x,y,z,rx);
    // Original carbine silhouette: upper/lower receiver, vented handguard,
    // cylindrical barrel/muzzle, adjustable stock and separate controls.
    box(.085,.095,.31,metal,0,0,0);
    box(.072,.047,.22,black,0,-.061,.015);
    cyl(.036,.036,.29,metal,0,.032,-.015);
    box(.071,.07,.20,black,0,.002,-.255);
    for(let i=0;i<7;i++){
      box(.079,.008,.014,metal,0,.042,-.18-i*.024);
      box(.008,.012,.016,edge,.039,-.002,-.18-i*.024);
      box(.008,.012,.016,metal,-.039,-.002,-.18-i*.024);
    }
    cyl(.015,.018,.24,metal,0,.012,-.446);
    cyl(.022,.022,.062,black,0,.012,-.59);
    cyl(.023,.023,.009,edge,0,.012,-.617);
    cyl(.012,.012,.012,black,0,.012,-.625);
    box(.012,.047,.018,black,0,.052,-.44);
    box(.022,.012,.022,edge,0,.078,-.44);
    for(let i=0;i<12;i++)box(.058,.01,.009,black,0,.084,.116-i*.019);
    // Raised rear iron sight, with a clear central notch.
    box(.016,.039,.018,black,-.022,.105,.116);box(.016,.039,.018,black,.022,.105,.116);
    box(.058,.009,.018,black,0,.085,.116);
    box(.011,.035,.01,edge,0,.104,-.102);
    box(.028,.01,.025,black,0,.085,-.1);
    // Magazine curves forward slightly; panels give it weight without a box-only profile.
    box(.048,.11,.073,black,0,-.125,-.045,-.12);
    box(.048,.07,.078,metal,0,-.211,-.032,-.25);
    for(const x of [-.025,.025])for(let i=0;i<4;i++)box(.003,.145,.006,edge,x,-.163,-.06+i*.015,-.18);
    box(.054,.014,.082,rubber,0,-.245,-.024,-.25);
    // Pistol grip, open trigger-guard frame and small mechanical details.
    box(.049,.105,.052,rubber,0,-.139,.105,-.3);
    box(.052,.008,.085,black,0,-.109,.025);box(.009,.046,.009,black,0,-.088,-.015);
    box(.008,.035,.009,edge,0,-.083,.024,-.25);
    box(.009,.019,.057,edge,.046,.005,.026);box(.009,.022,.026,black,-.046,-.03,.05);
    cyl(.009,.009,.065,black,.067,-.015,.058,0);
    // Buffer tube and triangular adjustable stock, not a solid rectangular slab.
    cyl(.023,.023,.16,metal,0,.018,.237);
    box(.058,.046,.15,black,0,.01,.29);
    box(.052,.055,.075,black,0,-.013,.37);
    box(.048,.025,.105,black,0,-.052,.326,.34);
    box(.062,.133,.025,rubber,0,-.016,.413,-.1);
    // Original gloved hands and sleeves visible from the first-person view.
    const glove=new THREE.MeshLambertMaterial({color:0x555440});
    add(new THREE.SphereGeometry(.036,10,7),glove,.028,-.12,.1);
    add(new THREE.SphereGeometry(.034,10,7),glove,-.014,-.062,-.265);
    function sleeve(from,to){const a=new THREE.Vector3(...from),b=new THREE.Vector3(...to),dir=b.clone().sub(a),mid=a.clone().add(b).multiplyScalar(.5);const geom=new THREE.CylinderGeometry(.031,.052,dir.length(),10);geom.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize()));add(geom,glove,mid.x,mid.y,mid.z);}
    sleeve([.32,-.45,.41],[.028,-.12,.1]);sleeve([-.35,-.45,.23],[-.014,-.062,-.265]);
    // Merge by material so this detailed viewmodel remains a handful of draws.
    for(const [mat,list] of parts){const merged=new THREE.BufferGeometry();for(const key of ['position','normal','uv']){let count=0;for(const geom of list)count+=geom.attributes[key].array.length;const array=new Float32Array(count);let offset=0;for(const geom of list){array.set(geom.attributes[key].array,offset);offset+=geom.attributes[key].array.length;}merged.setAttribute(key,new THREE.BufferAttribute(array,key==='uv'?2:3));}for(const geom of list)geom.dispose();const mesh=new THREE.Mesh(merged,mat);g.add(mesh);}
    g.rotation.y=.05;g.scale.setScalar(.5);g.position.set(...GUN_HIP);return g;
  }
  function setAds(on) {
    on = !!on;
    if (on === adsOn) return;
    adsOn = on;
    if (adsCb) { try { adsCb(adsOn); } catch (e) {} }
  }

  function hash2(x, y) { let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967295; }

  async function init(mount) {
    if (ready || failed) return !failed;
    try {
      const THREE = await import('./three.module.js');
      window.__THREE = THREE;
      let savedQ = 'high'; try { savedQ = localStorage.getItem('nelli.quality') || 'high'; } catch (e) {}
      if (savedQ === 'low') { dprCap = QUALITY.low.dpr; atlasScale = QUALITY.low.atlas; autoQ = false; autoLevel = 'low'; qualityName = 'low'; } /* saved Low: no MSAA, half-size facade atlases from the start */
      renderer = new THREE.WebGLRenderer({ antialias: savedQ !== 'low', powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap)); /* cap DPR: full-res 3x screens are the main phone-lag source */
      if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
      if (THREE.ACESFilmicToneMapping !== undefined) { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.22; }
      renderer.shadowMap.enabled = true;
      if (THREE.PCFSoftShadowMap !== undefined) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      canvasEl = renderer.domElement;
      canvasEl.id = 'nelli-arena3d';
      mount.appendChild(canvasEl);
      /* drag to look: any pointer on the arena (joystick/buttons are separate DOM) */
      let lookId = null, lx = 0, ly = 0;
      canvasEl.addEventListener('pointerdown', (e) => {
        if (lookId !== null) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        lookId = e.pointerId; lx = e.clientX; ly = e.clientY;
        canvasEl.setPointerCapture(e.pointerId);
      });
      canvasEl.addEventListener('pointermove', (e) => {
        if (e.pointerId !== lookId) return;
        lookDelta(e.clientX - lx, e.clientY - ly);
        lx = e.clientX; ly = e.clientY;
      });
      const lookEnd = (e) => { if (e.pointerId === lookId) lookId = null; };
      canvasEl.addEventListener('pointerup', lookEnd);
      canvasEl.addEventListener('pointercancel', lookEnd);
      scene = new THREE.Scene();
      /* procedural dusk sky dome: slate zenith, warm amber-olive horizon, streak clouds.
         World-space (follows the player) so it pans correctly when turning; fog matches the horizon band */
      const skc = document.createElement('canvas'); skc.width = 1024; skc.height = 512;
      const skg = skc.getContext('2d');
      const grad = skg.createLinearGradient(0, 0, 0, 512);
      grad.addColorStop(0, '#537c99');
      grad.addColorStop(0.40, '#7a9eaf');
      grad.addColorStop(0.56, '#a4b7b8');
      grad.addColorStop(0.68, '#b3b6a6');
      grad.addColorStop(0.78, '#c1b79c');
      grad.addColorStop(0.85, '#b4aa92');
      grad.addColorStop(1, '#8e988a');
      skg.fillStyle = grad; skg.fillRect(0, 0, 1024, 512);
      let skseed = 7;
      const skrnd = () => (skseed = (skseed * 16807) % 2147483647) / 2147483647;
      for (let i=0;i<10;i++) {
        const cx=skrnd()*1024,cy=170+skrnd()*120,cw=25+skrnd()*50,ch=3+skrnd()*6;
        skg.save();skg.translate(cx,cy);skg.scale(cw,ch);const cloud=skg.createRadialGradient(0,0,.05,0,0,1);cloud.addColorStop(0,'rgba(245,245,231,.15)');cloud.addColorStop(1,'rgba(245,245,231,0)');skg.fillStyle=cloud;skg.fillRect(-1,-1,2,2);skg.restore();
      }
      const skTex = new THREE.CanvasTexture(skc);
      if (THREE.SRGBColorSpace) skTex.colorSpace = THREE.SRGBColorSpace;
      skyDome = new THREE.Mesh(new THREE.SphereGeometry(230, 24, 16),
        new THREE.MeshBasicMaterial({ map: skTex, side: THREE.BackSide, fog: false, depthWrite: false }));
      skyDome.renderOrder = -1;
      scene.add(skyDome);
      /* sun glow sprite: world-space, buildings occlude it */
      const sunc = document.createElement('canvas'); sunc.width = sunc.height = 128;
      const sug = sunc.getContext('2d');
      const sg2 = sug.createRadialGradient(64, 64, 4, 64, 64, 64);
      sg2.addColorStop(0, 'rgba(255,214,150,1)');
      sg2.addColorStop(0.3, 'rgba(255,160,70,0.6)');
      sg2.addColorStop(1, 'rgba(255,120,40,0)');
      sug.fillStyle = sg2; sug.fillRect(0, 0, 128, 128);
      const sunTex = new THREE.CanvasTexture(sunc);
      if (THREE.SRGBColorSpace) sunTex.colorSpace = THREE.SRGBColorSpace;
      sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
      sunSprite.scale.set(70, 70, 1);
      scene.add(sunSprite);
      scene.fog = new THREE.Fog(0x919e99, 18, 65);
      cam = new THREE.PerspectiveCamera(74, 1, 0.05, 90);
      scene.add(cam);
      gun = buildGun(THREE);
      cam.add(gun);
      /* right-mouse hold = aim down sight */
      canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
      canvasEl.addEventListener('pointerdown', (e) => { if (e.button === 2) setAds(true); });
      canvasEl.addEventListener('pointerup', (e) => { if (e.button === 2) setAds(false); });
      scene.add(new THREE.HemisphereLight(0xc2daea, 0x7d8062, 1.7));
      sunLight = new THREE.DirectionalLight(0xffe1b0, 2.0);
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(2048, 2048);
      sunLight.shadow.camera.left = -30; sunLight.shadow.camera.right = 30;
      sunLight.shadow.camera.top = 30; sunLight.shadow.camera.bottom = -30;
      sunLight.shadow.camera.near = 2; sunLight.shadow.camera.far = 160;
      sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.03;
      scene.add(sunLight); scene.add(sunLight.target);

      ground=new THREE.InstancedMesh(new THREE.BoxGeometry(TILE,.04,TILE),new THREE.MeshLambertMaterial({color:0xffffff}),MAXI);ground.frustumCulled=false;scene.add(ground);
      /* original procedural ground texture: olive grass, dry patches, dirt, blade speckles */
      const gc = document.createElement('canvas'); gc.width = gc.height = 512;
      const gg = gc.getContext('2d');
      gg.fillStyle = '#48563d'; gg.fillRect(0, 0, 512, 512);
      let gseed = 11;
      const grnd = () => (gseed = (gseed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 46; i++) { // large soft patches: dry grass + worn dirt
        const t = grnd();
        gg.fillStyle = t < 0.5 ? 'rgba(122,116,74,0.16)' : 'rgba(96,84,60,0.18)';
        gg.beginPath(); gg.arc(grnd() * 512, grnd() * 512, 24 + grnd() * 70, 0, 7); gg.fill();
      }
      for (let i = 0; i < 2400; i++) {
        const t = grnd();
        gg.fillStyle = t < 0.42 ? 'rgba(58,72,49,0.55)' : t < 0.78 ? 'rgba(88,104,68,0.5)' : 'rgba(114,106,74,0.4)';
        gg.beginPath(); gg.arc(grnd() * 512, grnd() * 512, 1 + grnd() * 3.4, 0, 7); gg.fill();
      }
      gg.strokeStyle = 'rgba(72,90,54,0.65)'; gg.lineWidth = 1;
      for (let i = 0; i < 900; i++) {
        const bx = grnd() * 512, by = grnd() * 512;
        gg.beginPath(); gg.moveTo(bx, by); gg.lineTo(bx + (grnd() - 0.5) * 3, by - 2 - grnd() * 3); gg.stroke();
      }
      for (let i = 0; i < 260; i++) { // small stones and gravel flecks
        const t = grnd();
        gg.fillStyle = t < 0.5 ? 'rgba(140,136,120,0.5)' : t < 0.8 ? 'rgba(70,66,56,0.5)' : 'rgba(100,96,80,0.55)';
        gg.fillRect(grnd() * 512, grnd() * 512, 1 + grnd() * 2, 1 + grnd() * 2);
      }
      const gtex = new THREE.CanvasTexture(gc);
      if (THREE.SRGBColorSpace) gtex.colorSpace = THREE.SRGBColorSpace;
      gtex.wrapS = gtex.wrapT = THREE.RepeatWrapping; gtex.repeat.set(.288, .288);
      ground.material.map = gtex;
      ground.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXI * 3), 3);
      ground.receiveShadow = true;horizonGround=new THREE.Mesh(new THREE.PlaneGeometry(500,500),new THREE.MeshLambertMaterial({map:gtex,depthWrite:false}));horizonGround.rotation.x=-Math.PI/2;horizonGround.renderOrder=-.5;scene.add(horizonGround);

      /* Original facade atlas. Four plaster/storefront treatments, baked
         balcony rails and rooftop surfaces. No external imagery or brands. */
      function facadeAtlas(shop, sc) {
        sc = sc || atlasScale;
        const c=document.createElement('canvas');c.width=3072*sc;c.height=1024*sc;
        const g=c.getContext('2d');g.scale(sc,sc);let seed=shop?289:113;
        const rnd=()=>((seed=(seed*16807)%2147483647)/2147483647);
        const shades=shop?['#d3c2a5','#bad0ca','#d2c6bc','#d3c9a7','#cbb49e','#aebfc6']:['#e6d8be','#c9d6cd','#d6c4b8','#dedccf','#e0c3ab','#c2cfcb'];
        for(let v=0;v<6;v++){
          const ox=v*512;
          // Atlas lower half in UV coordinates is the separate flat roof.
          g.fillStyle=['#8f9187','#9d9c8d','#96988a','#9e9d92','#93958b','#989a90'][v];g.fillRect(ox,512,512,512);
          for(let i=0;i<1800;i++){g.fillStyle=rnd()<.5?'#ffffff09':'#202d2610';g.fillRect(ox+rnd()*512,512+rnd()*512,1+rnd()*8,1+rnd()*8);}
          g.strokeStyle='#5c675c55';g.lineWidth=2;
          for(let j=0;j<4;j++){g.beginPath();g.moveTo(ox,512+j*130);g.lineTo(ox+512,512+j*130);g.stroke();}
          // roof weathering: patch stains, vent boxes with pale caps, parapet shade
          for(let i=0;i<10;i++){g.fillStyle=rnd()<.5?'rgba(40,44,38,0.16)':'rgba(120,118,104,0.14)';g.beginPath();g.arc(ox+rnd()*512,512+rnd()*512,14+rnd()*46,0,7);g.fill();}
          g.fillStyle='rgba(28,32,26,0.28)';g.fillRect(ox,512,512,14);
          for(let i=0;i<3;i++){const vx=ox+40+rnd()*400,vy=560+rnd()*380,vw=26+rnd()*40;
            g.fillStyle='#6e7268';g.fillRect(vx,vy,vw,vw*.7);g.fillStyle='#8f9187';g.fillRect(vx,vy,vw,6);}
          const gr=g.createLinearGradient(ox,0,ox+512,512);gr.addColorStop(0,shades[v]);gr.addColorStop(.6,shades[v]);gr.addColorStop(1,'#9e9d8c');g.fillStyle=gr;g.fillRect(ox,0,512,512);if(v===5){g.fillStyle='#8f5a44';g.fillRect(ox,300,512,212);g.fillStyle='#7a4c3a';g.fillRect(ox,300,512,10);}
          for(let i=0;i<4000;i++){g.fillStyle=rnd()<.5?'#ffffff0a':'#514c430b';g.fillRect(ox+rnd()*512,rnd()*512,1+rnd()*5,1+rnd()*3);}
          // Parapet and cast-shadow band, then concrete floor ledges.
          g.fillStyle='#c4c0ad';g.fillRect(ox,0,512,13);g.fillStyle='#454e3c50';g.fillRect(ox,13,512,9);
          for(let f=0;f<3;f++){
            const yy=34+f*124;
            g.fillStyle='#b0af9d';g.fillRect(ox,yy+103,512,8);g.fillStyle='#575c4a44';g.fillRect(ox,yy+111,512,5);
            for(let col=0;col<3;col++){
              const xx=ox+33+col*162,ww=v===1?105:v===4?120:88,hh=v===4?64:76;
              g.fillStyle='#4c534d';g.fillRect(xx-4,yy-4,ww+8,hh+8);
              const glass=g.createLinearGradient(xx,yy,xx+ww,yy+hh);glass.addColorStop(0,'#758b8d');glass.addColorStop(.28,'#4e6469');glass.addColorStop(.35,'#a7b5b2');glass.addColorStop(.4,'#34494c');glass.addColorStop(1,'#192e32');
              g.fillStyle=glass;g.fillRect(xx,yy,ww,hh);
              g.fillStyle='#d2d1bd';g.fillRect(xx+ww/2-2,yy,4,hh);g.fillRect(xx,yy+hh*.47,ww,3);
              g.fillStyle='#f1e9cb55';g.fillRect(xx+8,yy+4,ww*.18,hh-8);
              // a lit minority of windows: warm interior glow for dusk
              if(rnd()<0.24){const lit=g.createLinearGradient(xx,yy,xx,yy+hh);lit.addColorStop(0,'rgba(255,196,110,0.85)');lit.addColorStop(1,'rgba(212,140,60,0.75)');g.fillStyle=lit;g.fillRect(xx+2,yy+2,ww-4,hh-4);g.fillStyle='rgba(70,44,20,0.6)';g.fillRect(xx+ww/2-2,yy,4,hh);g.fillRect(xx,yy+hh*.47,ww,3);}
              // Ventilated shutters and projecting balcony silhouettes vary.
              if((v===2||v===5)&&col!==1){g.fillStyle='#789b8c';g.fillRect(xx,yy,ww*.45,hh);g.strokeStyle='#384f48';g.lineWidth=2;for(let l=8;l<hh;l+=7){g.beginPath();g.moveTo(xx+3,yy+l);g.lineTo(xx+ww*.45-3,yy+l);g.stroke();}}
              if(v===1||v===3){g.fillStyle='#e0dcc8';g.fillRect(xx-12,yy+hh-7,ww+24,18);g.fillStyle='#464e4180';g.fillRect(xx-12,yy+hh+11,ww+24,9);g.strokeStyle='#38473b';g.lineWidth=3;for(let l=0;l<7;l++){let bx=xx-8+l*(ww+16)/6;g.beginPath();g.moveTo(bx,yy+hh-26);g.lineTo(bx,yy+hh+3);g.stroke();}g.strokeRect(xx-10,yy+hh-26,ww+20,29);}
              if(f===1&&col===0){g.fillStyle='#d7d6ca';g.fillRect(xx+ww-9,yy+51,33,25);g.strokeStyle='#7a8076';g.lineWidth=2;g.beginPath();g.arc(xx+ww+7,yy+63,9,0,7);g.stroke();}
              g.fillStyle='#646d5030';for(let l=0;l<3;l++)g.fillRect(xx+l*30,yy+hh+21,7,7+rnd()*17);
              // monsoon streak: soft damp mark bleeding down from each sill
              g.fillStyle='rgba(48,54,46,0.09)';g.fillRect(xx+4,yy+hh+4,ww-8,26+rnd()*22);
              // occasional AC outdoor unit with fan ring (variant-driven spots)
              if((v===0&&f===2&&col===2)||(v===2&&f===0&&col===2)){g.fillStyle='#c9cbc0';g.fillRect(xx+ww-34,yy+hh-30,26,22);g.strokeStyle='#767b70';g.lineWidth=2;g.strokeRect(xx+ww-34,yy+hh-30,26,22);g.beginPath();g.arc(xx+ww-21,yy+hh-19,7,0,7);g.stroke();}
            }
          }
          if(shop){
            g.fillStyle=['#294c46','#4c4551','#6b4e3c','#374b5c','#5c4a68','#7a5a34'][v];g.fillRect(ox+3,365,506,40);
            g.fillStyle='#fff0c9';g.font='600 27px sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(['STORES','CAFE','MARKET','WORKSHOP','BAKERY','TEXTILES'][v],ox+256,385);
            const aw=['#ad6650','#577d6c','#bd9767','#5d7584','#7d6a9b','#a98a5a'][v];for(let col=0;col<16;col++){g.fillStyle=col%2?aw:'#d7d3bd';g.fillRect(ox+col*32,407,32,20);}g.fillStyle='#243b3290';g.fillRect(ox,427,512,8);
            for(let col=0;col<4;col++){
              const xx=ox+10+col*126;g.fillStyle='#293e3c';g.fillRect(xx,437,113,66);
              if(v===3){g.fillStyle='#8f9890';g.fillRect(xx+3,439,107,62);g.strokeStyle='#4f6158';for(let z=444;z<500;z+=6){g.beginPath();g.moveTo(xx+3,z);g.lineTo(xx+110,z);g.stroke();}}
              else {const glass=g.createLinearGradient(xx,437,xx,503);glass.addColorStop(0,'#7d9995');glass.addColorStop(.4,'#3b5b58');glass.addColorStop(1,'#172d2b');g.fillStyle=glass;g.fillRect(xx+3,440,107,60);g.fillStyle='#dec49180';g.fillRect(xx+10,448,23,43);g.fillStyle='#e8dfbf';g.fillRect(xx+90,466,3,12);}
            }
          }else{g.fillStyle='#a1a38f';g.fillRect(ox,406,512,106);g.fillStyle='#35483c';g.fillRect(ox+207,416,98,96);g.fillStyle='#809484';g.fillRect(ox+215,424,82,88);g.fillStyle='#293e35';g.fillRect(ox+250,424,3,88);g.fillStyle='#d1bf87';g.fillRect(ox+279,467,4,13);}
          // ground contact shading: damp/dirt rise at the wall foot
          const foot=g.createLinearGradient(0,452,0,512);foot.addColorStop(0,'rgba(34,40,32,0)');foot.addColorStop(1,'rgba(34,40,32,0.34)');g.fillStyle=foot;g.fillRect(ox,452,512,60);
          g.fillStyle='#53634b';g.fillRect(ox,506,512,6);
        }
        const t=new THREE.CanvasTexture(c);if(THREE.SRGBColorSpace)t.colorSpace=THREE.SRGBColorSpace;
        t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
        return t;
      }
      function atlasMaterial(shop){
        const mat=new THREE.MeshLambertMaterial({color:0xffffff,map:facadeAtlas(shop)});atlasMats.push([mat,shop]);
        mat.onBeforeCompile=sh=>{sh.vertexShader=sh.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>
          #ifdef USE_MAP
            float facadeVariant = floor(fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898,78.233))) * 43758.5453) * 6.0);
            vMapUv.x = (clamp(vMapUv.x,0.002,0.998) + facadeVariant) * 0.16667;
            vMapUv.y = clamp(vMapUv.y,0.002,0.998) * 0.5 + (abs(normal.y) > 0.5 ? 0.0 : 0.5);
          #endif`);};
        mat.customProgramCacheKey=()=>shop?'original-shop-atlas-v2':'original-home-atlas-v2';
        return mat;
      }
      atlasRebuild = (sc) => { if (sc === atlasScale) return; atlasScale = sc; for (const [m, shop] of atlasMats) { const old = m.map; m.map = facadeAtlas(shop, sc); m.needsUpdate = true; if (old) old.dispose(); } };
      walls = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE, WALLH, TILE),atlasMaterial(false), MAXI);
      shops = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE, WALLH, TILE),atlasMaterial(true), MAXI >> 2);
      /* asphalt v2: aggregate speckle, wheel-polish bands, painted edge lines.
         roadsV uses the same canvas rotated 90deg for north-south streets */
      const rc = document.createElement('canvas'); rc.width = rc.height = 128;
      const rg = rc.getContext('2d');
      rg.fillStyle = '#45454c'; rg.fillRect(0, 0, 128, 128);
      let rseed = 63;
      const rrnd = () => (rseed = (rseed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 900; i++) {
        const t = rrnd();
        rg.fillStyle = t < 0.5 ? 'rgba(20,20,24,0.35)' : 'rgba(150,150,158,0.16)';
        rg.fillRect(rrnd() * 128, rrnd() * 128, 1.4, 1.4);
      }
      rg.fillStyle = 'rgba(0,0,0,0.14)'; rg.fillRect(0, 44, 128, 16); rg.fillRect(0, 88, 128, 16); // wheel bands
      for (let i = 0; i < 5; i++) { // cracks/patches
        rg.strokeStyle = 'rgba(18,18,22,0.4)'; rg.lineWidth = 1;
        rg.beginPath(); let cx0 = rrnd() * 128, cy0 = rrnd() * 128;
        rg.moveTo(cx0, cy0);
        for (let k = 0; k < 4; k++) { cx0 += (rrnd() - 0.5) * 30; cy0 += (rrnd() - 0.5) * 30; rg.lineTo(cx0, cy0); }
        rg.stroke();
      }
      const unmarkedCanvas=document.createElement('canvas');unmarkedCanvas.width=unmarkedCanvas.height=128;unmarkedCanvas.getContext('2d').drawImage(rc,0,0);const unmarkedTex=new THREE.CanvasTexture(unmarkedCanvas);unmarkedTex.colorSpace=THREE.SRGBColorSpace;unmarkedTex.wrapS=unmarkedTex.wrapT=THREE.RepeatWrapping;
      shuttleLane=new THREE.InstancedMesh(new THREE.BoxGeometry(TILE,.07,TILE),new THREE.MeshLambertMaterial({map:unmarkedTex}),MAXI);shuttleLane.visible=false;
      /* shuttle highway gets its own isotropic asphalt: the world-flat uv repeat
         cannot follow the curves, so directional bands/lines would stripe across
         the road. Speckle and patch stains only; edge outlines carry the shape. */
      const hc = document.createElement('canvas'); hc.width = hc.height = 128;
      const hg = hc.getContext('2d');
      hg.fillStyle = '#4b4b51'; hg.fillRect(0, 0, 128, 128);
      let hseed = 97;
      const hrnd = () => (hseed = (hseed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 1000; i++) {
        const t = hrnd();
        hg.fillStyle = t < 0.5 ? 'rgba(24,24,28,0.32)' : 'rgba(158,158,164,0.15)';
        hg.fillRect(hrnd() * 128, hrnd() * 128, 1.4, 1.4);
      }
      for (let i = 0; i < 7; i++) { // soft patch repairs / oil stains, direction-free
        hg.fillStyle = hrnd() < 0.5 ? 'rgba(28,28,32,0.20)' : 'rgba(70,70,76,0.22)';
        hg.beginPath(); hg.arc(hrnd() * 128, hrnd() * 128, 6 + hrnd() * 18, 0, 7); hg.fill();
      }
      const htex = new THREE.CanvasTexture(hc);
      if (THREE.SRGBColorSpace) htex.colorSpace = THREE.SRGBColorSpace;
      htex.wrapS = htex.wrapT = THREE.RepeatWrapping;
      const roadData=window.NexoraShuttleRoad;if(roadData){const geo=new THREE.BufferGeometry(),positions=new Float32Array(roadData.triangles),uv=[];for(let i=0;i<positions.length;i+=3)uv.push(positions[i]/4.8,positions[i+2]/4.8);geo.setAttribute('position',new THREE.BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.computeVertexNormals();shuttleSurface=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({map:htex,side:THREE.DoubleSide}));shuttleSurface.receiveShadow=true;scene.add(shuttleSurface);
      const edgeVertices=[];for(const ring of roadData.edges)for(let i=1;i<ring.length;i++){const a=ring[i-1],b=ring[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),ox=-dz/len*.035,oz=dx/len*.035;for(const [x,z]of [[a[0]+ox,a[1]+oz],[b[0]+ox,b[1]+oz],[b[0]-ox,b[1]-oz],[a[0]+ox,a[1]+oz],[b[0]-ox,b[1]-oz],[a[0]-ox,a[1]-oz]])edgeVertices.push(x,.091,z);}const eg=new THREE.BufferGeometry();eg.setAttribute('position',new THREE.Float32BufferAttribute(edgeVertices,3));eg.computeVertexNormals();scene.add(new THREE.Mesh(eg,new THREE.MeshBasicMaterial({color:0xa6a18a,side:THREE.DoubleSide})));}

      rg.fillStyle = 'rgba(214,210,196,0.75)'; rg.fillRect(0, 3, 128, 3); rg.fillRect(0, 122, 128, 3); // edge lines
      const rtex = new THREE.CanvasTexture(rc);
      if (THREE.SRGBColorSpace) rtex.colorSpace = THREE.SRGBColorSpace;
      const rtexV = new THREE.CanvasTexture(rc);
      if (THREE.SRGBColorSpace) rtexV.colorSpace = THREE.SRGBColorSpace;
      rtexV.center.set(0.5, 0.5); rtexV.rotation = Math.PI / 2;
      roads = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE, 0.07, TILE),
        new THREE.MeshLambertMaterial({ color: 0xffffff, map: rtex }), MAXI);
      roadsV = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE, 0.07, TILE),
        new THREE.MeshLambertMaterial({ color: 0xffffff, map: rtexV }), MAXI);
      /* interior tiles of wide paved areas: edge lines only belong at real road
         edges; without this, plazas/junctions show a white ladder on every tile */
      roadsI = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE, 0.07, TILE),
        new THREE.MeshLambertMaterial({ color: 0xffffff, map: htex }), MAXI);
      roadsI.frustumCulled = false;
      roadsI.receiveShadow = true;
      dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.09, TILE * 0.45),
        new THREE.MeshBasicMaterial({ color: 0xd9b23a }), MAXI);
      /* rooftop water tanks: Kerala skyline signature, sit on the same per-block height as the walls */
      tanks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.55, 9),
        new THREE.MeshLambertMaterial({ color: 0x3d434c }), 400);
      /* streetlights along main roads: dark poles + warm emissive heads for dusk */
      poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.06, 3.0, 6),
        new THREE.MeshLambertMaterial({ color: 0x2f3339 }), 128);
      lampHeads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.30, 0.09, 0.13),
        new THREE.MeshBasicMaterial({ color: 0xffca6a }), 128);
      /* sagging service wires between same-side streetlight poles; one line
         batch, rebuilt with the static tiles. Kerala street signature. */
      wires = new THREE.LineSegments(new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: 0x14181a }));
      wires.frustumCulled = false;
      scene.add(wires);
      /* instanced tile meshes: frustumCulled must stay OFF - their bounding sphere is
         computed once from the first view window and goes stale as the player moves,
         which would cull every building/road at once */
      for (const im of [walls, shops, roads, roadsV, dashes, tanks, poles, lampHeads]) im.frustumCulled = false;
      walls.castShadow = true; walls.receiveShadow = true;
      shops.castShadow = true; shops.receiveShadow = true;
      roads.receiveShadow = true; roadsV.receiveShadow = true;
      tanks.castShadow = true; poles.castShadow = true;
      scene.add(walls); scene.add(shops); scene.add(roads); scene.add(roadsV); scene.add(roadsI); scene.add(dashes);
      scene.add(tanks); scene.add(poles); scene.add(lampHeads);
      /* low-poly trees: trunk + cone canopy, placed deterministically on open tiles in rebuild() */
      /* bark texture: near-white streak canvas so the trunk brown survives;
         vertical ridges catch the low sun instead of reading as flat poles */
      const bc = document.createElement('canvas'); bc.width = bc.height = 64;
      const bg2 = bc.getContext('2d');
      bg2.fillStyle = '#d8cfc4'; bg2.fillRect(0, 0, 64, 64);
      let bseed = 29;
      const brnd = () => (bseed = (bseed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 90; i++) {
        const t = brnd();
        bg2.strokeStyle = t < 0.5 ? 'rgba(88,74,58,0.55)' : 'rgba(150,138,120,0.5)';
        bg2.lineWidth = 1 + brnd() * 1.6;
        const bx = brnd() * 64;
        bg2.beginPath(); bg2.moveTo(bx, brnd() * 20); bg2.lineTo(bx + (brnd() - 0.5) * 5, 34 + brnd() * 30); bg2.stroke();
      }
      const btex = new THREE.CanvasTexture(bc);
      if (THREE.SRGBColorSpace) btex.colorSpace = THREE.SRGBColorSpace;
      trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.13, 1.0, 6),
        new THREE.MeshLambertMaterial({ color: 0x4a3a26, map: btex }), MAXT);
      /* leaf-cluster texture on the canopy blobs: white-based so the per-tree
         instance tint survives; blotches and gaps break the smooth-ball look */
      const lc = document.createElement('canvas'); lc.width = lc.height = 128;
      const lg = lc.getContext('2d');
      lg.fillStyle = '#e8ebe2'; lg.fillRect(0, 0, 128, 128);
      let lseed = 41;
      const lrnd = () => (lseed = (lseed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 420; i++) {
        const t = lrnd();
        lg.fillStyle = t < 0.38 ? 'rgba(96,112,84,0.55)' : t < 0.72 ? 'rgba(150,158,128,0.5)' : t < 0.9 ? 'rgba(196,200,176,0.55)' : 'rgba(52,60,44,0.7)';
        lg.beginPath(); lg.arc(lrnd() * 128, lrnd() * 128, 1.5 + lrnd() * 4.5, 0, 7); lg.fill();
      }
      const ltex = new THREE.CanvasTexture(lc);
      if (THREE.SRGBColorSpace) ltex.colorSpace = THREE.SRGBColorSpace;
      canopies = new THREE.InstancedMesh(new THREE.SphereGeometry(0.55, 11, 8),
        new THREE.MeshLambertMaterial({ color: 0xffffff, map: ltex }), MAXT * 3);
      canopies.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXT * 3), 3);
      trunks.frustumCulled = false; canopies.frustumCulled = false;
      trunks.castShadow = true; canopies.castShadow = true;
      scene.add(trunks); scene.add(canopies);
      walls.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXI * 3), 3);
      shops.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((MAXI >> 2) * 3), 3);

      othersGroup = new THREE.Group(); mobGroup = new THREE.Group();
      projGroup = new THREE.Group(); beaconGroup = new THREE.Group();
      scene.add(othersGroup, mobGroup, projGroup, beaconGroup);
      // stylized characters replace capsule placeholders; capsule fallback stays if load fails
      try {
        const { GLTFLoader } = await import('./GLTFLoader.js');
        const loader = new GLTFLoader();
        const [ga, gb, gap, gbp] = await Promise.all([
          new Promise((res, rej) => loader.load('./charA.glb', res, undefined, rej)),
          new Promise((res, rej) => loader.load('./charB.glb', res, undefined, rej)),
          new Promise((res, rej) => loader.load('./charA-prone.glb', res, undefined, rej)), // arms rotated forward in mesh: the model has no bones, so the prone pose is a separate mesh variant, not a joint pose
          new Promise((res, rej) => loader.load('./charB-prone.glb', res, undefined, rej)),
        ]);
        for (const g of [ga, gb, gap, gbp]) {
          g.scene.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
        }
        charTmpls = { A: ga.scene, B: gb.scene, AP: gap.scene, BP: gbp.scene };
        // pre-create the TPP self avatar + warm shaders/textures now, so the first
        // FPP->TPP switch mid-game does not clone 90k verts or compile on the spot
        ensureSelfAv();
        if (renderer.compile) renderer.compile(scene, cam);
        scene.traverse((o) => {
          if (o.isMesh && o.material && o.material.map && renderer.initTexture) renderer.initTexture(o.material.map);
        });
      } catch (ce) { charTmpls = null; console.log('char load failed, capsule fallback:', ce && ce.message); }
      ready = true;
      window.__fpsDebug = { scene: () => scene, othersGroup: () => othersGroup, avatars, tmpls: () => charTmpls, cam: () => cam, self: () => selfAv, tileAt: (x, z) => (dbgSt ? tileCodeAt(dbgSt, x, z) : -1), info: () => renderer.info.render };
    } catch (e) { failed = true; console.log('fps3d init failed:', e && e.message); }
    return ready;
  }

  /* quality presets: dpr cap is the dominant phone-perf lever; fog/cull distance second.
     low/med/high are render-cost targets, not device promises. */
  const QUALITY = {
    low:  { dpr: 0.8,  fogNear: 9,  fogFar: 38, camFar: 56, shadow: 0, atlas: 0.5 },
    med:  { dpr: 1.25, fogNear: 14, fogFar: 60, camFar: 90, shadow: 1024 },
    high: { dpr: 1.6,  fogNear: 16, fogFar: 75, camFar: 110, shadow: 2048 },
  };
  let dprCap = QUALITY.high.dpr, qualityName = 'high';
  let atlasScale = 1; const atlasMats = []; let atlasRebuild = null;
  let fpsFrames = 0, fpsLast = 0, fpsValue = 0;
  /* third/first person: camera boom + own avatar, client-side only (server sim unchanged) */
  let camMode = 'fpp', selfAv = null, selfLx = 0, selfLy = 0, selfPhase = 0, selfLastMovedAt=0, dbgSt = null;
  let selfAnim = null;
  /* 10Hz server snapshots stepped the camera; smooth them: remember the last state
     change to extrapolate by velocity, and ease position/eye/boom every frame. */
  let mvDx = 0, mvDy = 0, prX = null, prY = null;
  let smX = null, smY = null, eyeCur = null, boomCur = 0, lastRT = 0, dynDt = 0.016;
  let stX = null, stY = null, stT = 0, stVx = 0, stVy = 0, stIvl = 0.1;
  /* adaptive quality: starts on the default; steps down when measured fps stays low. It stops adapting as soon as anyone sets a quality
     other than the one it last chose (the settings selector), so an explicit choice always wins. Never steps back up (avoids flapping). */
  let autoQ = true, autoLevel = 'high', autoLow = 0, autoSince = 0, autoDrops = 0;
  const QORDER = ['high', 'med', 'low'];
  function autoQuality(nowMs) {
    if (!autoQ || !ready) return;
    if (!autoSince) autoSince = nowMs;
    if (nowMs - autoSince < 6000) return; /* ignore load and shader-compile stalls */
    if (fpsValue > 0 && fpsValue < 28) autoLow++; else autoLow = 0;
    if (autoLow >= 6) { /* ~3s sustained under 28fps */
      const i = QORDER.indexOf(qualityName);
      autoLow = 0;
      if (i >= 0 && i < QORDER.length - 1) { autoLevel = QORDER[i + 1]; autoDrops++; setQuality(autoLevel, true); autoSince = nowMs; }
    }
  }
  function setQuality(q, fromAuto) {
    const preset = QUALITY[q];
    if (!preset) return false;
    if (!fromAuto && q !== autoLevel) autoQ = false;
    qualityName = q; dprCap = preset.dpr;
    if (ready) {
      if (atlasRebuild) atlasRebuild(preset.atlas || 1);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
      scene.fog.near = preset.fogNear; scene.fog.far = preset.fogFar;
      cam.far = preset.camFar; cam.updateProjectionMatrix();
      const sm = preset.shadow | 0;
      renderer.shadowMap.enabled = sm > 0;
      if (sunLight) {
        sunLight.castShadow = sm > 0;
        if (sm > 0 && sunLight.shadow.mapSize.x !== sm) {
          sunLight.shadow.mapSize.set(sm, sm);
          if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; }
        }
      }
      scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); // shadow toggle needs recompile
      resize();
    }
    return true;
  }

  function resize() {
    if (!ready) return;
    const w = canvasEl.parentElement.clientWidth, h = canvasEl.parentElement.clientHeight;
    renderer.setSize(w, h, false);
    cam.aspect = w / h; cam.updateProjectionMatrix();
  }

  const _m4 = () => new window.__THREE.Matrix4();
  function rebuild(st) {
    const THREE = window.__THREE;
    const v = st.view;
    const vkey = v.x0 + ':' + v.y0 + ':' + (st.floor | 0);
    if (vkey === rebuild._key) { rebuildDynamic(st); return; } /* static instanced tiles only move with the view window */
    rebuild._key = vkey;
    let wi = 0, ri = 0, rvi = 0, rii = 0, di = 0, ti = 0, si = 0, ki = 0, pi = 0, sli=0, gi=0;
    const m = _m4(), c = new THREE.Color();
    const polePts = []; // wire anchors: pole tops, connected after the tile loop
    const rows = v.tiles;
    const codeAt = (x, y) => { // road-neighbour probe inside the view window; -1 outside
      if (y < 0 || y >= rows.length) return -1;
      const l = rows[y];
      if (x < 0 || x >= l.length) return -1;
      return l.charCodeAt(x) - 48;
    };
    for (let row = 0; row < v.tiles.length; row++) {
      const line = v.tiles[row];
      for (let col = 0; col < line.length; col++) {
        const code = line.charCodeAt(col) - 48;
        const gx = v.x0 + col, gy = v.y0 + row;
        m.makeTranslation(gx*TILE,-.04,gy*TILE);ground.setMatrixAt(gi,m);
        { // subtle per-tile ground tint breaks texture tiling at distance
          const tg = hash2(gx * 5 + 3, gy * 7 + 1);
          c.setHSL(0.16 + tg * 0.05, 0.08 + tg * 0.06, 0.86 + tg * 0.12);
          ground.setColorAt(gi, c);
        }
        gi++;
        if (code === 0 && wi < MAXI) { // building block, slight per-block tint + height variety
          const t = hash2(gx, gy);
          const hs = 0.75 + t * 0.9; // 0.75x-1.65x WALLH; bullets/camera stay below the lowest block
          m.makeScale(1, hs, 1);
          m.setPosition(gx * TILE, WALLH * hs / 2, gy * TILE);
          c.setHSL(0.11 + t * 0.03, 0.04 + t * 0.04, 0.77 + t * 0.14);
          const isShop = hash2(gy, gx) > 0.72 && si < (MAXI >> 2); // deterministic shopfront minority
          if (isShop) { shops.setMatrixAt(si, m); shops.setColorAt(si, c); si++; }
          else { walls.setMatrixAt(wi, m); walls.setColorAt(wi, c); wi++; }
          if (ki < 400 && hash2(gx + 91, gy + 57) < 0.38) { // rooftop water tank on the same block height
            const ts = 0.8 + hash2(gx + 17, gy + 31) * 0.5;
            m.makeScale(ts, ts, ts);
            m.setPosition(gx * TILE + (hash2(gx + 5, gy + 5) - 0.5) * 0.7,
              WALLH * hs + 0.27 * ts, gy * TILE + (hash2(gx + 6, gy + 6) - 0.5) * 0.7);
            tanks.setMatrixAt(ki, m); ki++;
          }
        } else if(v.lane?.[row]?.[col]==='1'&&sli<MAXI){m.makeTranslation(gx*TILE,.035,gy*TILE);shuttleLane.setMatrixAt(sli++,m);
        } else if ((code === 5 || code === 6) && (ri < MAXI || rvi < MAXI)) {
          // orientation from road neighbours: north-south streets get the rotated asphalt
          const lr = codeAt(col - 1, row) === 5 || codeAt(col - 1, row) === 6 || codeAt(col + 1, row) === 5 || codeAt(col + 1, row) === 6;
          const ud = codeAt(col, row - 1) === 5 || codeAt(col, row - 1) === 6 || codeAt(col, row + 1) === 5 || codeAt(col, row + 1) === 6;
          const vert = ud && !lr;
          // interior of a paved run: road on both across-neighbours
          const inner = vert
            ? (codeAt(col - 1, row) === 5 || codeAt(col - 1, row) === 6) && (codeAt(col + 1, row) === 5 || codeAt(col + 1, row) === 6)
            : (codeAt(col, row - 1) === 5 || codeAt(col, row - 1) === 6) && (codeAt(col, row + 1) === 5 || codeAt(col, row + 1) === 6);
          m.makeTranslation(gx * TILE, 0.035, gy * TILE);
          if (inner && rii < MAXI) { roadsI.setMatrixAt(rii, m); rii++; }
          else if (vert && rvi < MAXI) { roadsV.setMatrixAt(rvi, m); rvi++; }
          else if (!vert && ri < MAXI) { roads.setMatrixAt(ri, m); ri++; }
          // divider dashes only on the main road (matches the real-layout rule)
          if (code === 5 && di < MAXI && (gy % 2 === 0)) {
            m.makeTranslation(gx * TILE, 0.09, gy * TILE);
            dashes.setMatrixAt(di, m); di++;
          }
          // streetlights on main roads every few tiles, alternating sides
          if (code === 5 && pi < 128 && ((gx * 7 + gy * 13) % 4 === 0)) {
            const side = hash2(gx + 3, gy + 9) < 0.5 ? 1 : -1;
            let ox = 0, oz = 0, hx = 0, hz = 0;
            if (vert) { ox = side * (TILE / 2 - 0.14); hx = -side * 0.24; }
            else { oz = side * (TILE / 2 - 0.14); hz = -side * 0.24; }
            m.makeScale(1, 1, 1); m.makeTranslation(gx * TILE + ox, 1.5, gy * TILE + oz);
            poles.setMatrixAt(pi, m);
            m.makeTranslation(gx * TILE + ox + hx, 3.0, gy * TILE + oz + hz);
            lampHeads.setMatrixAt(pi, m);
            polePts.push({ x: gx * TILE + ox, z: gy * TILE + oz, key: vert ? gx : gy, along: vert ? gy : gx, side, vert });
            pi++;
          }
        } else if (code !== 5 && code !== 6 && code !== 0 && ti < MAXT && hash2(gx * 3 + 11, gy * 5 + 7) < 0.055) {
          // open ground: deterministic tree with per-tile jitter and tint
          const tj = hash2(gx + 40, gy + 40);
          const tx = gx * TILE + (hash2(gx + 7, gy + 13) - 0.5) * TILE * 0.55;
          const tz = gy * TILE + (hash2(gx + 13, gy + 7) - 0.5) * TILE * 0.55;
          const s = 0.8 + tj * 0.6;
          m.makeScale(s, s, s); m.setPosition(tx, 0.5 * s, tz);
          trunks.setMatrixAt(ti, m);
          /* broadleaf canopy: 3 flattened blobs - main crown, high crown, side lob */
          c.setHSL(0.24 + tj * 0.06, 0.30, 0.13 + tj * 0.045);
          m.makeScale(s * 1.15, s * 0.8, s * 1.15); m.setPosition(tx, 1.35 * s, tz);
          canopies.setMatrixAt(ti * 3, m); canopies.setColorAt(ti * 3, c);
          c.offsetHSL(0, 0, 0.025);
          m.makeScale(s * 0.8, s * 0.62, s * 0.8); m.setPosition(tx + 0.12 * s, 1.85 * s, tz - 0.06 * s);
          canopies.setMatrixAt(ti * 3 + 1, m); canopies.setColorAt(ti * 3 + 1, c);
          c.offsetHSL(0, 0, -0.04);
          m.makeScale(s * 0.7, s * 0.5, s * 0.7); m.setPosition(tx - 0.34 * s, 1.05 * s, tz + 0.18 * s);
          canopies.setMatrixAt(ti * 3 + 2, m); canopies.setColorAt(ti * 3 + 2, c);
          ti++;
        }
      }
    }
    ground.count=gi;ground.instanceMatrix.needsUpdate=true;if(ground.instanceColor)ground.instanceColor.needsUpdate=true;shuttleLane.count=sli;shuttleLane.instanceMatrix.needsUpdate=true;
    walls.count = wi; shops.count = si; roads.count = ri; roadsV.count = rvi; roadsI.count = rii; dashes.count = di;
    tanks.count = ki; poles.count = pi; lampHeads.count = pi;
    trunks.count = ti; canopies.count = ti * 3;
    { // connect same-side consecutive poles with two sagging wires per span
      const wpos = [];
      const groups = new Map();
      for (const p of polePts) {
        const k = p.vert + ':' + p.key + ':' + p.side;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(p);
      }
      for (const list of groups.values()) {
        list.sort((a, b) => a.along - b.along);
        for (let i = 1; i < list.length; i++) {
          const a = list[i - 1], b = list[i];
          const gap = b.along - a.along;
          if (gap < 1.5 || gap > 6) continue; // same road run only; skip cross-window leaps
          for (const w of [[0, 2.9], [0.09, 2.76]]) { // [perp offset, attach height]
            const ox = a.vert ? w[0] : 0, oz = a.vert ? 0 : w[0];
            const SEG = 6, SAG = 0.24;
            for (let sgm = 0; sgm < SEG; sgm++) {
              const t0 = sgm / SEG, t1 = (sgm + 1) / SEG;
              wpos.push(a.x + ox + (b.x - a.x) * t0, w[1] - SAG * 4 * t0 * (1 - t0), a.z + oz + (b.z - a.z) * t0,
                        a.x + ox + (b.x - a.x) * t1, w[1] - SAG * 4 * t1 * (1 - t1), a.z + oz + (b.z - a.z) * t1);
            }
          }
        }
      }
      wires.geometry.dispose();
      const wgeo = new THREE.BufferGeometry();
      wgeo.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
      wires.geometry = wgeo;
    }
    walls.instanceMatrix.needsUpdate = true;
    shops.instanceMatrix.needsUpdate = true;
    roads.instanceMatrix.needsUpdate = true;
    roadsV.instanceMatrix.needsUpdate = true;
    roadsI.instanceMatrix.needsUpdate = true;
    dashes.instanceMatrix.needsUpdate = true;
    tanks.instanceMatrix.needsUpdate = true;
    poles.instanceMatrix.needsUpdate = true;
    lampHeads.instanceMatrix.needsUpdate = true;
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
    if (shops.instanceColor) shops.instanceColor.needsUpdate = true;
    if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
    rebuildDynamic(st);
  }

  // per-frame movers only: players, mobs, tracers, beacons (static tiles rebuild on view change)
  function updateBus(st) {
    const T=window.__THREE,b=st.bus;
    if(!busGroup){busGroup=new T.Group();scene.add(busGroup);const red=new T.MeshLambertMaterial({color:0x94362e}),cream=new T.MeshLambertMaterial({color:0xe0d1a7}),dark=new T.MeshLambertMaterial({color:0x222b29}),glass=new T.MeshLambertMaterial({color:0x88adb0,transparent:true,opacity:.16,depthWrite:false});
      const part=(w,h,d,x,y,z,mat)=>{const m=new T.Mesh(new T.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;busGroup.add(m);};

      const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=64;const sc=shadowCanvas.getContext('2d'),sg=sc.createRadialGradient(32,32,3,32,32,32);sg.addColorStop(0,'rgba(0,0,0,.72)');sg.addColorStop(.45,'rgba(0,0,0,.48)');sg.addColorStop(1,'rgba(0,0,0,0)');sc.fillStyle=sg;sc.fillRect(0,0,64,64);const shadowMat=new T.MeshBasicMaterial({map:new T.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});const blob=(w,h,x,z)=>{const m=new T.Mesh(new T.PlaneGeometry(w,h),shadowMat);m.rotation.x=-Math.PI/2;m.position.set(x,.026,z);busGroup.add(m);};blob(3,6.5,0,0);for(const x of [-1.1,1.1])for(const z of [-2.05,2.05])blob(.95,1.1,x,z);
      part(2.05,.35,6.4,0,.62,0,dark);part(1.96,.1,6.2,0,.93,0,dark);part(2.15,.75,6.5,0,1.13,0,red);part(2.2,.22,6.6,0,2.83,0,cream);
      for(const x of [-1.04,1.04]){for(let z=-3.1;z<=3.2;z+=1.05)part(.09,1.0,.09,x,2.18,z,cream);part(.03,1,6.2,x,2.18,0,glass);}

      for(const z of [-3.23,3.23]){part(2.1,.12,.15,0,.78,z,cream);part(2.12,.12,.04,0,1.48,z,cream);for(const x of [-.75,.75])part(.34,.18,.08,x,1.18,z,new T.MeshBasicMaterial({color:z<0?0xf9e6b4:0xae3b26}));}
      part(2.1,.94,.04,0,2.18,3.2,glass);part(2.1,.94,.04,0,2.18,-3.2,glass);
      for(const x of [-1.1,1.1])for(const z of [-2.05,2.05]){const w=new T.Mesh(new T.CylinderGeometry(.44,.44,.19,16),dark);w.rotation.z=Math.PI/2;w.position.set(x,.44,z);busGroup.add(w);const hub=new T.Mesh(new T.CylinderGeometry(.19,.19,.205,12),cream);hub.rotation.z=Math.PI/2;hub.position.copy(w.position);busGroup.add(hub);}
      const seatMat=new T.MeshLambertMaterial({color:0x38504a}),railMat=new T.MeshLambertMaterial({color:0xa89f70});for(const x of [-.54,.54])for(let z=-1.7;z<=1.8;z+=.85){part(.7,.18,.6,x,1.22,z,seatMat);part(.7,.44,.13,x,1.47,z-.27,seatMat);part(.52,.10,.08,x,1.72,z-.27,railMat);}for(const x of [-.28,.28]){part(.035,.035,5.1,x,2.56,0,railMat);for(const z of [-2.4,2.4])part(.035,1.6,.035,x,1.75,z,railMat);}
      const c=document.createElement('canvas');c.width=1024;c.height=160;const ctx=c.getContext('2d');ctx.fillStyle='#1b2624';ctx.fillRect(0,0,1024,160);ctx.fillStyle='#fff0bb';ctx.textAlign='center';ctx.font='bold 56px sans-serif';ctx.fillText('KSRTC / GAME SHUTTLE',512,68);ctx.font='30px sans-serif';ctx.fillText('SIMULATED ROUTE / PLAYERS ONLY',512,121);const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;const mat=new T.MeshBasicMaterial({map:tex});for(const z of [-3.263,3.263]){const m=new T.Mesh(new T.PlaneGeometry(1.92,.3),mat);m.position.set(0,2.61,z);if(z<0)m.rotation.y=Math.PI;busGroup.add(m);}
    }
    if(!busGroup.userData.merged){
      const byMat=new Map();for(const mesh of [...busGroup.children]){mesh.updateMatrix();let geo=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();geo.applyMatrix4(mesh.matrix);if(!byMat.has(mesh.material))byMat.set(mesh.material,[]);byMat.get(mesh.material).push(geo);mesh.geometry.dispose();}
      busGroup.clear();for(const [mat,list]of byMat){const geo=new T.BufferGeometry();for(const name of ['position','normal','uv']){let size=0;for(const g of list)size+=g.attributes[name].array.length;const v=new Float32Array(size);let off=0;for(const g of list){v.set(g.attributes[name].array,off);off+=g.attributes[name].array.length;}geo.setAttribute(name,new T.BufferAttribute(v,name==='uv'?2:3));}for(const g of list)g.dispose();const mesh=new T.Mesh(geo,mat);mesh.castShadow=true;busGroup.add(mesh);}busGroup.userData.merged=true;
    }
    busGroup.visible=!!b;if(!b)return;
    { /* bus moves at a fixed speed on the server (10Hz steps): extrapolate along its heading and ease position and heading every frame */
      const nowT=performance.now(),bd=busSm;
      if(bd.x===null||Math.hypot(b.x-bd.tx,b.y-bd.ty)>3){bd.x=b.x;bd.y=b.y;bd.a=Math.atan2(b.dx,b.dy);bd.tx=b.x;bd.ty=b.y;bd.tt=nowT;bd.vx=bd.vy=0;}
      if(b.x!==bd.tx||b.y!==bd.ty){const dtt=Math.max(0.05,(nowT-bd.tt)/1000);let nvx=(b.x-bd.tx)/dtt,nvy=(b.y-bd.ty)/dtt;const sp=Math.hypot(nvx,nvy),mx=2.4;if(sp>mx){nvx*=mx/sp;nvy*=mx/sp;}bd.vx=bd.vx*0.35+nvx*0.65;bd.vy=bd.vy*0.35+nvy*0.65;bd.tx=b.x;bd.ty=b.y;bd.tt=nowT;}
      else if(nowT-bd.tt>180){bd.vx=bd.vy=0;}
      const age=Math.min(0.16,(nowT-bd.tt)/1000),k=Math.min(1,dynDt*14);
      bd.x+=(b.x+bd.vx*age-bd.x)*k;bd.y+=(b.y+bd.vy*age-bd.y)*k;
      const ta=Math.atan2(b.dx,b.dy);let da=Math.atan2(Math.sin(ta-bd.a),Math.cos(ta-bd.a));bd.a+=da*Math.min(1,dynDt*8);
      busGroup.position.set(bd.x*TILE,.085,bd.y*TILE);busGroup.rotation.y=bd.a;
    }
  }

  function updateHealthProps(st) {
    const T=window.__THREE;
    if(!medkitGroup){medkitGroup=new T.Group();scene.add(medkitGroup);medkitGeo=new T.BoxGeometry(.58,.36,.34);
      const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');x.fillStyle='#e8eadf';x.fillRect(0,0,128,128);x.fillStyle='#3e7152';x.fillRect(49,22,30,84);x.fillRect(22,49,84,30);const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;medkitMat=new T.MeshLambertMaterial({map:tex});}
    const key=(st.medkits||[]).map(k=>k.id+':'+k.x+','+k.y).join('|');
    if(key!==medkitGroup.userData.key){medkitGroup.clear();medkitGroup.userData.key=key;for(const k of st.medkits||[]){const box=new T.Mesh(medkitGeo,medkitMat);box.position.set(k.x*TILE,.22,k.y*TILE);box.castShadow=true;medkitGroup.add(box);}}

  }

  function rebuildDynamic(st) {
    updateHealthProps(st);updateBus(st);
    const THREE = window.__THREE;
    // other players: stylized characters (capsule fallback), NO floating names
    othersGroup.clear();
    const seenIds = new Set();
    for (const o of st.others || []) {
      seenIds.add(o.id);
      let av = avatars.get(o.id);
      if (!av) {
        let obj, av_anim = null;
        if (charTmpls) {
          const even = ((o.hu || 0) % 2 === 0);
          const anim = { uPhase: { value: 0 }, uMove: { value: 0 } };
          obj = makeCharGroup(even, anim);
          hueShift(obj, o.hu || 0);
          av_anim = anim;
        } else {
          obj = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.05, 4, 10),
            new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(((o.hu || 0) * 36 % 360) / 360, 0.5, 0.5) }));
          obj.position.y = 0.98; obj.castShadow = true;
          const wrap = new THREE.Group(); wrap.add(obj); obj = wrap;
        }
        av = { obj, anim: av_anim, lx: o.x, ly: o.y, phase: 0, jt: 0, sx: o.x * TILE, sy: o.y * TILE, mv: 0 };
        avatars.set(o.id, av);
      }
      const moved = Math.hypot(o.x - av.lx, o.y - av.ly);
      if(moved>.002)av.lastMovedAt=performance.now();

      av.lx = o.x; av.ly = o.y;
      const g = av.obj;
      /* snapshots step at 10Hz; ease each avatar toward the latest point instead */
      {
        const k = Math.min(1, dynDt * 14);
        const oldX=av.sx,oldY=av.sy,nowT=performance.now();
        if (av.tx === undefined) { av.tx = o.x; av.ty = o.y; av.tt = nowT; av.vx = av.vy = 0; }
        if (o.x !== av.tx || o.y !== av.ty) { /* new snapshot point: learn velocity so avatars glide through the 100ms gap instead of stepping */
          const dtt = Math.max(0.05, (nowT - av.tt) / 1000);
          if (Math.hypot(o.x - av.tx, o.y - av.ty) > 3) { av.vx = av.vy = 0; av.sx = o.x * TILE; av.sy = o.y * TILE; }
          else { let nvx = (o.x - av.tx) / dtt, nvy = (o.y - av.ty) / dtt; const sp = Math.hypot(nvx, nvy), mx = 4 / TILE; if (sp > mx) { nvx *= mx / sp; nvy *= mx / sp; } av.vx = av.vx * 0.35 + nvx * 0.65; av.vy = av.vy * 0.35 + nvy * 0.65; }
          av.tx = o.x; av.ty = o.y; av.tt = nowT;
        } else if (nowT - av.tt > 180) { av.vx = av.vy = 0; }
        const exAge = Math.min(0.16, (nowT - av.tt) / 1000);
        av.sx += ((o.x + av.vx * exAge) * TILE - av.sx) * k; av.sy += ((o.y + av.vy * exAge) * TILE - av.sy) * k;
        av.phase+=Math.min(.5,Math.hypot(av.sx-oldX,av.sy-oldY)/TILE)*9;
        av.mv += (((performance.now()-(av.lastMovedAt||0)<160) ? 1 : 0) - av.mv) * Math.min(1, dynDt * 10);
        if (av.anim) { av.anim.uPhase.value = av.phase; av.anim.uMove.value = o.riding?0:av.mv; }
      }
      if (o.j && !av.jt) av.jt = performance.now();
      if (!o.j) av.jt = 0;
      const je = av.jt ? Math.min((performance.now() - av.jt) / 600, 1) : 0;
      const joff = av.jt ? Math.sin(Math.PI * je) * 0.7 : 0;
      g.position.set(av.sx, 0, av.sy);
      if (o.riding && st.bus && busSm.x !== null) { /* rigid seat offset on the drawn bus, same smoothing as the bus model */
        const ex = o.x - st.bus.x, ey = o.y - st.bus.y, sa = Math.atan2(st.bus.dx, st.bus.dy);
        const l = ex * Math.sin(sa) + ey * Math.cos(sa), r = ex * Math.cos(sa) - ey * Math.sin(sa);
        av.sx = (busSm.x + l * Math.sin(busSm.a) + r * Math.cos(busSm.a)) * TILE; av.sy = (busSm.y + l * Math.cos(busSm.a) - r * Math.sin(busSm.a)) * TILE;
        g.position.set(av.sx, g.position.y, av.sy);
      }
      const fx = (o.f && o.f[0]) || 0, fy = (o.f && o.f[1]) || 0;
      if (fx || fy) g.rotation.y = Math.atan2(fx, fy);
      g.scale.set(1, 1, 1);
      showStance(g, o.riding?'crouch':o.st, !!o.dead);
      if (o.dead) {
        g.rotation.x = -Math.PI / 2;
        g.position.y = 0.15;
      } else if (o.st === 'prone') {
        g.rotation.x = 0; // the prone child carries its own flat rotation
        g.position.y = 0;
        g.rotation.z = 0;
      } else if (o.st === 'crouch') {
        g.rotation.x = 0;
        g.scale.set(1, 1, 1); // crouch is bent in the pose shader
        const bob = moved > 0.002 ? Math.abs(Math.sin(av.phase)) * 0.03 : 0;
        g.position.y = 0.03 + bob + joff;
        g.rotation.z = moved > 0.002 ? Math.sin(av.phase) * 0.04 : 0;
      } else {
        g.rotation.x = 0;
        const bob = moved > 0.002 ? Math.abs(Math.sin(av.phase)) * 0.05 : 0;
        g.position.y = 0.03 + bob + joff;
        g.rotation.z = moved > 0.002 ? Math.sin(av.phase) * 0.05 : 0;
      }
      if(o.riding){g.position.y=.9;g.rotation.x=0;g.rotation.z=0;}
      othersGroup.add(g);
    }
    for (const id of avatars.keys()) if (!seenIds.has(id)) avatars.delete(id);
    mobGroup.clear();
    for (const mb of st.mobs || []) {
      const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.5, 4, 8),
        new THREE.MeshLambertMaterial({ color: 0x7a2e2e }));
      cap.castShadow = true;
      cap.position.set(mb.x * TILE, 0.6, mb.y * TILE);
      mobGroup.add(cap);
    }
    if(!projGeo){projGeo=new THREE.SphereGeometry(.09,6,6);projMat=new THREE.MeshBasicMaterial({color:0xffd76a});}
    let pi=0;for(const pr of st.projs||[]){let dot=tracerPool[pi];if(!dot){dot=new THREE.Mesh(projGeo,projMat);tracerPool.push(dot);projGroup.add(dot);}dot.visible=true;dot.position.set(pr.x*TILE,pr.z!==undefined?pr.z:EYE-.1,pr.y*TILE);pi++;}
    for(;pi<tracerPool.length;pi++)tracerPool[pi].visible=false;

    // police stations: blue beacon columns (respawn points)
    const police=(st.labels||[]).filter(lb=>lb.kind==='police'),beaconKey=police.map(lb=>lb.x+','+lb.y).join('|');
    if(beaconGroup.userData.key!==beaconKey){
      for(const o of [...beaconGroup.children]){o.geometry.dispose();o.material.dispose();}beaconGroup.clear();beaconGroup.userData.key=beaconKey;
      for(const lb of police){const beam=new THREE.Mesh(new THREE.BoxGeometry(.5,7,.5),new THREE.MeshBasicMaterial({color:0x4d7dd6,transparent:true,opacity:.45}));beam.position.set(lb.x*TILE,3.5,lb.y*TILE);beaconGroup.add(beam);}
    }
  }


  let camPX = 0, camPY = 0;
  function predWalk(st, x, y) { /* same 4-corner rule as the server's canMove (radius .19); unknown/out-of-view tiles block prediction */
    const r = 0.19;
    for (const [dx, dy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
      const c = tileCodeAt(st, (x + dx) * TILE, (y + dy) * TILE);
      if (c <= 0) return false;
    }
    return true;
  }
  function setMoveInput(dx, dy) { mvDx = Number.isFinite(dx) ? dx : 0; mvDy = Number.isFinite(dy) ? dy : 0; }
  function tileCodeAt(st, wx, wz) {
    const v = st.view;
    if (!v || !v.tiles) return -1;
    const gx = Math.round(wx / TILE) - v.x0, gy = Math.round(wz / TILE) - v.y0;
    if (gy < 0 || gy >= v.tiles.length) return -1;
    const line = v.tiles[gy];
    if (gx < 0 || gx >= line.length) return -1;
    return line.charCodeAt(gx) - 48;
  }

  /* Procedural hip, knee and shoulder rotations for the original boneless model.
     Crouch bends the legs instead of scaling the whole body. */
  function addWalkAnim(root, anim) {
    anim.uCrouch = anim.uCrouch || { value: 0 };
    root.traverse((mm) => {
      if (!mm.isMesh || !mm.material) return;
      if (/human/i.test(mm.name) && !mm.geometry.getAttribute('poseArm')) {
        const geo=mm.geometry.clone(),pos=geo.attributes.position,n=pos.count,parent=new Int32Array(n),weld=new Map();for(let i=0;i<n;i++)parent[i]=i;
        const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
        const join=(a,b)=>{if(pos.getY(a)<1.14 && pos.getY(b)<1.14)parent[find(a)]=find(b);};
        for(let i=0;i<n;i++){if(pos.getY(i)>=1.14)continue;const k=[pos.getX(i),pos.getY(i),pos.getZ(i)].map(v=>Math.round(v*10000)).join(',');if(weld.has(k))join(i,weld.get(k));else weld.set(k,i);}
        const ix=geo.index;for(let i=0;i<(ix?ix.count:n);i+=3){const a=ix?ix.getX(i):i,b=ix?ix.getX(i+1):i+1,c=ix?ix.getX(i+2):i+2;join(a,b);join(b,c);join(c,a);}
        const arms=new Set();for(let i=0;i<n;i++)if(pos.getY(i)>1.07&&pos.getY(i)<1.14&&Math.abs(pos.getX(i))>.18)arms.add(find(i));
        const weights=new Float32Array(n);for(let i=0;i<n;i++)weights[i]=pos.getY(i)<1.14?(arms.has(find(i))?1:0):Math.max(0,Math.min(1,(Math.abs(pos.getX(i))-.15)/.06));
        geo.setAttribute('poseArm',new window.__THREE.BufferAttribute(weights,1));mm.geometry=geo;
      }
      mm.material = mm.material.clone();
      mm.material.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, anim);
        const skinMesh = /human/i.test(mm.name);
        const armWeight = skinMesh ? 'poseArm' : 'smoothstep(0.23,0.29,abs(position.x))*smoothstep(0.65,0.72,position.y)';
        sh.vertexShader = (skinMesh ? 'attribute float poseArm;\n' : '') + 'uniform float uPhase;\nuniform float uMove;\nuniform float uCrouch;\n' + sh.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            float side = transformed.x >= 0.0 ? 0.0 : 3.14159265;
            float stride = sin(uPhase + side) * uMove;
            float c = uCrouch;
            float armW = ${armWeight};
            vec3 original = transformed;
            if (transformed.y < 0.87) {
              float hip = -1.25 * c + stride * (0.55 - c * 0.30);
              float ph2 = uPhase + side; float knee = 2.25 * c + uMove * (0.62 * max(0.0, -cos(ph2 - 0.35)) + 0.16 * max(0.0, sin(ph2)) + 0.07) * (1.0 - c * 0.6);
              if(transformed.y < 0.105) {
                float ankle=-(hip+knee);vec2 v=transformed.yz-vec2(0.105,0.04);
                transformed.yz=mat2(cos(ankle),sin(ankle),-sin(ankle),cos(ankle))*v+vec2(0.105,0.04);
              }
              if (transformed.y < 0.44) {
                vec2 v = transformed.yz - vec2(0.44,0.03);
                transformed.yz = mat2(cos(knee),sin(knee),-sin(knee),cos(knee)) * v + vec2(0.44,0.03);
              }
              vec2 v = transformed.yz - vec2(0.87,0.03);
              transformed.yz = mat2(cos(hip),sin(hip),-sin(hip),cos(hip)) * v + vec2(0.87,0.03);
            }
            vec3 legPose = transformed;
            transformed = original;
            if (transformed.y < 1.43) {
              float swing = -stride * 0.55;
              vec2 v = transformed.yz - vec2(1.35,0.03);
              transformed.yz = mat2(cos(swing),sin(swing),-sin(swing),cos(swing)) * v + vec2(1.35,0.03);
            }
            { /* arm elbow flex: relaxed bend that deepens as the arm swings forward */
              float fwd = max(0.0, stride);
              float eb = uMove * (0.10 + 0.32 * fwd) * smoothstep(1.16, 1.00, transformed.y);
              if (armW > 0.0 && transformed.y < 1.16) {
                vec2 ev = transformed.yz - vec2(1.07, 0.03 + (-stride * 0.55) * 0.0);
                transformed.yz = mat2(cos(eb),sin(eb),-sin(eb),cos(eb)) * ev + vec2(1.07, 0.03);
              }
            }
            transformed = mix(legPose,transformed,armW);
            { /* pelvis bob (tallest when legs pass, lowest at heel strike), forward lean, shoulder twist against the hips */
              float up = smoothstep(0.15, 0.95, original.y) * (1.0 - c);
              transformed.y += uMove * (0.030 * cos(2.0 * uPhase) - 0.015) * up;
              float lean = uMove * 0.09 * (1.0 - c) * 1.0 * smoothstep(0.80, 0.95, original.y);
              vec2 lv = transformed.yz - vec2(0.87, 0.03);
              transformed.yz = mat2(cos(lean),sin(lean),-sin(lean),cos(lean)) * lv + vec2(0.87, 0.03);
              float tw = uMove * 0.13 * sin(uPhase) * 1.0 * smoothstep(0.87, 1.30, original.y) * (1.0 - c);
              transformed.xz = mat2(cos(tw),sin(tw),-sin(tw),cos(tw)) * transformed.xz;
            }
            transformed.y -= c * (0.43 * (1.0 - cos(1.25)) + 0.335 * (1.0 - cos(1.0)));
          }`);
      };
      mm.material.customProgramCacheKey = () => 'nexora-hinge-pose-v6-' + mm.name;
      mm.material.needsUpdate = true;
    });
  }

  // Local prototype: alternating elbow reach and low knee draw for moving prone.
  // Model coordinates remain upright here; the prone child rotates them flat.
  function addCrawlAnim(root,anim){
    root.traverse(mm=>{if(!mm.isMesh||!mm.material)return;mm.material=mm.material.clone();
      mm.material.onBeforeCompile=sh=>{Object.assign(sh.uniforms,anim);sh.vertexShader='uniform float uPhase;uniform float uMove;\n'+sh.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      float side=position.x>=0.0?0.0:3.14159265;
      float sxp=position.x>=0.0?1.0:-1.0;
      float armWt0=smoothstep(.11,.19,abs(position.x))*smoothstep(1.20,1.48,position.y);
      float headWt=(1.0-smoothstep(.13,.19,abs(position.x)))*smoothstep(1.52,1.60,position.y);
      { /* prone rest pose: head lifted, forearms folded in under the chin instead of both arms laid straight past the head */
        float ha=-0.5*headWt;vec2 hv=transformed.yz-vec2(1.5,0.03);transformed.yz=mat2(cos(ha),sin(ha),-sin(ha),cos(ha))*hv+vec2(1.5,0.03);
        float sa=-sxp*0.42*armWt0*smoothstep(1.38,1.50,position.y);vec2 sh0=vec2(sxp*0.18,1.40);
        vec2 sv=transformed.xy-sh0;transformed.xy=mat2(cos(sa),sin(sa),-sin(sa),cos(sa))*sv+sh0; /* upper arm out to the side */
        vec2 ep=vec2(sxp*0.22,1.62)-sh0;ep=mat2(cos(-sxp*0.42),sin(-sxp*0.42),-sin(-sxp*0.42),cos(-sxp*0.42))*ep+sh0;
        float eb=sxp*0.55*smoothstep(1.55,1.75,position.y)*armWt0;vec2 ev=transformed.xy-ep;transformed.xy=mat2(cos(eb),sin(eb),-sin(eb),cos(eb))*ev+ep;
      }
      float crawl=sin(uPhase*.65+side)*uMove;
      float leg=1.0-smoothstep(.72,.91,position.y);
      float foreleg=1.0-smoothstep(.40,.65,position.y);
      float arm=smoothstep(.11,.19,abs(position.x))*smoothstep(1.20,1.48,position.y);
      transformed.x+=crawl*(.085*leg+.035*arm);
      transformed.y+=crawl*(.08*leg+.085*arm);
      transformed.z-=max(0.0,crawl)*.075*foreleg;
      `);};mm.material.customProgramCacheKey=()=> 'nexora-crawl-local-v2';mm.material.needsUpdate=true;
    });
  }

  function hueShift(root, hu) {
    const shift = (((hu || 0) * 36) % 360) / 360 * 0.18 - 0.09;
    root.traverse((m) => {
      if (m.isMesh && /shirt|pants/.test(m.material && m.material.name || '')) {
        const hook=m.material.onBeforeCompile, key=m.material.customProgramCacheKey;
        m.material = m.material.clone();
        m.material.onBeforeCompile=hook; m.material.customProgramCacheKey=key;
        m.material.color.offsetHSL(shift, 0, 0);
      }
    });
  }

  /* one group with upright + prone children; visibility picks the stance.
     upright stance uses procedural hip/knee bending; prone retains its own mesh */
  function makeCharGroup(even, anim) {
    const THREE = window.__THREE;
    const up = (even ? charTmpls.A : charTmpls.B).clone(true);
    const pr = (even ? charTmpls.AP : charTmpls.BP).clone(true);
    pr.rotation.x = Math.PI / 2; // face-down, head toward facing; arms (mesh-rotated forward) lie flat ahead
    pr.position.y = 0.22;
    pr.visible = false;
    if (anim) {addWalkAnim(up, anim);addCrawlAnim(pr,anim);} // walk swing only on the upright stance
    const g = new THREE.Group();
    g.add(up); g.add(pr);
    g.userData.up = up; g.userData.pr = pr; g.userData.pose = anim;
    return g;
  }
  function showStance(g, st, dead) {
    if (!g.userData.up) return;
    if(g.userData.pose && g.userData.pose.uCrouch) g.userData.pose.uCrouch.value = st === 'crouch' ? 1 : 0;
    g.userData.up.visible = !dead && st !== 'prone';
    g.userData.pr.visible = !dead && st === 'prone';
  }

  function ensureSelfAv() {
    if (selfAv || !scene) return;
    const THREE = window.__THREE;
    if (charTmpls) {
      selfAnim = { uPhase: { value: 0 }, uMove: { value: 0 } };
      selfAv = makeCharGroup(true, selfAnim);
    } else {
      const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.05, 4, 10),
        new THREE.MeshLambertMaterial({ color: 0xc9a35a }));
      cap.position.y = 0.98; cap.castShadow = true;
      selfAv = new THREE.Group(); selfAv.add(cap);
    }
    selfAv.visible = false;
    scene.add(selfAv);
  }

  function setCamMode(m) {
    if (m !== 'fpp' && m !== 'tpp') return false;
    camMode = m;
    if (ready) {
      ensureSelfAv();
      if (selfAv) selfAv.visible = (m === 'tpp');
      if (gun) gun.visible = (m === 'fpp');
    }
    return true;
  }

  function render(st) {
    if (!ready || !st || !st.you) return;
    dbgSt = st;
    const nowMs = performance.now();
    const dt = lastRT ? Math.min(0.05, (nowMs - lastRT) / 1000) : 0.016;
    lastRT = nowMs;
    dynDt = dt; // rebuildDynamic runs via rebuild() below and shares this frame's dt
    resize();
    rebuild(st);
    const me = st.you;
    // Keep the passenger's chosen look angle relative to the turning vehicle.
    if(st.riding&&st.bus){const a=busSm.x!==null?Math.PI-busSm.a:Math.atan2(st.bus.dx,-st.bus.dy);yaw=lastRideYaw===null?a:yaw+Math.atan2(Math.sin(a-lastRideYaw),Math.cos(a-lastRideYaw));lastRideYaw=a;}else lastRideYaw=null;
    /* velocity extrapolation from the last snapshot change. Adaptive cadence:
       the measured snapshot interval (EMA) sets the extrapolation window and
       the silence timeout, and incoming velocity blends instead of replacing -
       snapshot jitter stops stepping the camera. Teleports still snap. */
    if (stX === null || me.x !== stX || me.y !== stY) {
      const dtt = stT ? Math.max(0.05, (nowMs - stT) / 1000) : 0.1;
      if (stX !== null) {
        let nvx = (me.x - stX) / dtt, nvy = (me.y - stY) / dtt;
        const speed = Math.hypot(nvx, nvy), maxSpeed = 4 / TILE;
        if (speed > maxSpeed) { nvx *= maxSpeed / speed; nvy *= maxSpeed / speed; }
        stVx = stVx * 0.35 + nvx * 0.65; stVy = stVy * 0.35 + nvy * 0.65;
        stIvl = stIvl * 0.8 + dtt * 0.2;
      }
      if (stX !== null && Math.hypot(me.x - stX, me.y - stY) > 3) {
        stVx = stVy = 0; smX = me.x * TILE; smY = me.y * TILE;
      }
      stX = me.x; stY = me.y; stT = nowMs;
    } else if (nowMs - stT > stIvl * 1800) { stVx = stVy = 0; }
    {
      const age = Math.min(Math.min(0.25, stIvl * 1.6), (nowMs - stT) / 1000);
      const tx = (me.x + stVx * age) * TILE, ty = (me.y + stVy * age) * TILE;
      if (smX === null) { smX = tx; smY = ty; }
      const k = Math.min(1, dt * 14);
      smX += (tx - smX) * k; smY += (ty - smY) * k;
    }
    /* own-player prediction (render only, server stays authoritative): input moves the view immediately at the same speed and
       collision rule as the server, instead of waiting a round trip plus a 10Hz tick. The lead is capped, and it eases back to the
       server-smoothed position when input stops, on a teleport, on death or while riding. */
    camPX = smX; camPY = smY;
    {
      const sx = smX / TILE, sy = smY / TILE;
      const held = (mvDx || mvDy) && !st.riding && !me.dead;
      if (prX === null || !held && Math.hypot(prX - sx, prY - sy) < 0.01 || Math.hypot(prX - sx, prY - sy) > 2.5 || st.riding || me.dead) { prX = sx; prY = sy; }
      if (held) {
        const len = Math.max(1, Math.hypot(mvDx, mvDy)), spd = ({ stand: 4, crouch: 2.3, prone: 1.2 }[me.st] || 4) / TILE;
        const nx = prX + mvDx / len * spd * dt, ny = prY + mvDy / len * spd * dt;
        if (predWalk(st, nx, prY)) prX = nx;
        if (predWalk(st, prX, ny)) prY = ny;
        const ex = prX - sx, ey = prY - sy, e = Math.hypot(ex, ey);
        if (e > 1.2) { prX = sx + ex / e * 1.2; prY = sy + ey / e * 1.2; }
      } else {
        const k = Math.min(1, dt * 9); prX += (sx - prX) * k; prY += (sy - prY) * k;
      }
      camPX = prX * TILE; camPY = prY * TILE;
    }
    /* passenger: the avatar is a rigid seat offset on the bus on the server. Place the camera from the bus as it is drawn (same smoothing),
       not from a second, differently filtered copy of the rider position, so the view cannot slide in and out of the bus. */
    if (st.riding && st.bus && busSm.x !== null && !me.dead) {
      const ex = me.x - st.bus.x, ey = me.y - st.bus.y, sa = Math.atan2(st.bus.dx, st.bus.dy);
      const l = ex * Math.sin(sa) + ey * Math.cos(sa), r = ex * Math.cos(sa) - ey * Math.sin(sa);
      camPX = (busSm.x + l * Math.sin(busSm.a) + r * Math.cos(busSm.a)) * TILE;
      camPY = (busSm.y + l * Math.cos(busSm.a) - r * Math.sin(busSm.a)) * TILE;
      smX = camPX; smY = camPY;
    }
    if (me.j && !selfJt) selfJt = performance.now();
    if (!me.j) selfJt = 0;
    const sje = selfJt ? Math.min((performance.now() - selfJt) / 600, 1) : 0;
    const sjoff = selfJt ? Math.sin(Math.PI * sje) * 0.7 : 0;

    /* dusk rig follows the player: sun shadow box, sky dome, sun glow */
    {
      const px = me.x * TILE, pz = me.y * TILE;
      sunLight.position.set(px + SUN_DIR.x * 70, SUN_DIR.y * 70, pz + SUN_DIR.z * 70);
      sunLight.target.position.set(px, 0, pz);
      const skyR = cam.far * 0.86, sunR = cam.far * 0.72; // keep inside the far plane at every quality
      skyDome.position.set(px, 0, pz);
      skyDome.scale.setScalar(skyR / 230);
      sunSprite.position.set(px + SUN_DIR.x * sunR, SUN_DIR.y * sunR, pz + SUN_DIR.z * sunR);
      sunSprite.scale.set(cam.far * 0.13, cam.far * 0.13, 1);
    }
    horizonGround.position.set(me.x*TILE,-.08,me.y*TILE);
    const eyeTgt = st.riding?1.15:eyeH(me.st);
    if (eyeCur === null) eyeCur = eyeTgt;
    eyeCur += (eyeTgt - eyeCur) * Math.min(1, dt * 10); // stance changes ease instead of snapping
    const eyeNow = eyeCur;
    cam.position.set(camPX, eyeNow + sjoff + (st.riding?.9:0), camPY);
    const at = adsOn ? 1 : 0;
    if (adsT !== at) {
      adsT += (at - adsT) * 0.35;
      if (Math.abs(at - adsT) < 0.02) adsT = at;
      cam.fov = 74 - 42 * adsT;
      cam.updateProjectionMatrix();
    }
    if (gun) {
      gun.position.set(
        GUN_HIP[0] + (GUN_ADS[0] - GUN_HIP[0]) * adsT,
        GUN_HIP[1] + (GUN_ADS[1] - GUN_HIP[1]) * adsT,
        GUN_HIP[2] + (GUN_ADS[2] - GUN_HIP[2]) * adsT);
      gun.visible = adsT < 0.92 && !freeLooking && !st.riding;
    }
    cam.rotation.set(0, 0, 0, 'YXZ');
    cam.rotation.y = -(yaw+freeYaw); // world z+ is map y+; matches aimVec so camera forward = (sin yaw, -cos yaw)
    cam.rotation.x = Math.max(-1.1,Math.min(1.1,pitch+freePitch));
    /* crosshair truth: would a bullet fired from the PLAYER (not the camera) along the exact
       aim vector reach out, or stop at a wall? Same grid rule the server uses. This is a
       client-side prediction of server LoS - it closes the TPP parallax gap by making the
       crosshair honest about blocked shots instead of implying a clear line. */
    {
      /* height-aware, mirrors the server sim exactly: eye height by stance + pitch slope;
         ground or a wall taller than the bullet at that point stops it */
      const adx = Math.sin(yaw), adz = -Math.cos(yaw);
      const slope = Math.tan(pitch);
      shotBlocked = false; shotBlockDist = 0;
      for (let t = 0.3; t <= 19.2; t += 0.25) { // bullet ttl 12 tiles = 19.2 world units
        const z = eyeNow + slope * t;
        if (z <= 0) { shotBlocked = true; shotBlockDist = t; break; } // ground
        const wx = me.x * TILE + adx * t, wz = me.y * TILE + adz * t;
        if (tileCodeAt(st, wx, wz) === 0) {
          const gx = Math.round(wx / TILE), gy = Math.round(wz / TILE);
          if (z < WALLH * (0.75 + hash2(gx, gy) * 0.9)) { shotBlocked = true; shotBlockDist = t; break; }
        }
      }
    }
    if (camMode === 'tpp' && selfAv) {
      // own avatar stands at the player, faces movement/aim yaw, walks with a real cycle
      const smoved = Math.min(.5,Math.hypot(camPX/TILE - selfLx, camPY/TILE - selfLy));
      if(smoved>.002)selfLastMovedAt=performance.now();
      selfPhase += smoved * 9; selfLx = camPX/TILE; selfLy = camPY/TILE;
      if (selfAnim) {
        selfAnim.uPhase.value = selfPhase;
        selfAnim.uMove.value += ((!st.riding&&performance.now()-selfLastMovedAt<160 ? 1 : 0) - selfAnim.uMove.value) * Math.min(1, dt * 10);
      }
      selfAv.position.set(camPX, 0.03 + sjoff + (smoved > 0.002 ? Math.abs(Math.sin(selfPhase)) * 0.05 : 0), smY);
      selfAv.rotation.y = Math.atan2(Math.sin(yaw), -Math.cos(yaw)); // same facing convention as other avatars: map forward (sin yaw, -cos yaw)
      selfAv.scale.set(1, 1, 1); selfAv.rotation.x = 0;
      showStance(selfAv, st.riding?'crouch':me.st, false);
      if(st.riding)selfAv.position.y=.9;
      if (me.st === 'prone') { selfAv.position.y = sjoff * 0.45; }
      // boom: pull camera back along its own -forward, clamp before walls, ease changes
      const THREE = window.__THREE;
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      let boom = 3.2 - 1.8 * adsT;
      for (let t = 0.4; t <= boom; t += 0.4) {
        if (tileCodeAt(st, camPX - dir.x * t, camPY - dir.z * t) === 0) { boom = Math.max(0.35, t - 0.45); break; }
      }
      boomCur += (boom - boomCur) * Math.min(1, dt * 7); // camera glides out/in on switch instead of snapping
      cam.position.set(
        camPX - dir.x * boomCur,
        Math.max(0.3, eyeNow + sjoff * 0.45 - dir.y * boomCur + 0.18 + (st.riding?.9:0)), // TPP camera follows the hop partially, so the avatar reads against the scene
        camPY - dir.z * boomCur);
      if (gun) gun.visible = false;
    } else if (selfAv) {
      selfAv.visible = false;
      boomCur += (0 - boomCur) * Math.min(1, dt * 7);
    }
    if (lean !== 0) {
      /* peek lean: camera slides sideways and rolls slightly. Camera only - the shot
         origin stays at the player (the crosshair truth above already reflects that),
         and the body is exactly as hittable as unleaned. No protection, no shot shift. */
      const rx = Math.cos(yaw), rz = Math.sin(yaw); // camera-right in map coords
      let off = 0.38 * lean;
      if (tileCodeAt(st, cam.position.x + rx * off, cam.position.z + rz * off) === 0) off = 0.1 * lean;
      cam.position.x += rx * off; cam.position.z += rz * off;
      cam.rotation.z = -0.10 * lean;
    }
    renderer.render(scene, cam);
    fpsFrames++;
    const fpsNow = performance.now();
    if (fpsNow - fpsLast >= 500) { fpsValue = Math.round(fpsFrames * 1000 / (fpsNow - fpsLast)); fpsFrames = 0; fpsLast = fpsNow; autoQuality(fpsNow); }
  }

  /* look-around: drag to turn. Returns aim as a dominant-axis [dx,dy] map vector. */
  function lookDelta(dxPx, dyPx) {
    if(freeLooking){freeYaw=Math.max(-Math.PI,Math.min(Math.PI,freeYaw+dxPx*.006));freePitch=Math.max(-.8,Math.min(.8,freePitch-dyPx*.004));return;}
    const s = 1 - 0.55 * adsT; // slower look while scoped
    yaw += dxPx * 0.0042 * s;
    pitch = Math.max(-0.9, Math.min(0.9, pitch - dyPx * 0.0032 * s));
  }
  function aimVec() {
    const fx = Math.sin(yaw), fy = -Math.cos(yaw);
    return Math.abs(fx) >= Math.abs(fy) ? [Math.sign(fx) || 1, 0] : [0, Math.sign(fy) || 1];
  }
  function setYawFromFace(f) {
    if (f && (f[0] || f[1])) yaw = Math.atan2(f[0], -f[1]);
  }

  window.NelliFps = {
    setFreeLook,
    get freeLooking(){return freeLooking;},
    get viewFace(){return [Math.sin(yaw+freeYaw),-Math.cos(yaw+freeYaw)];},
    init, render, lookDelta, aimVec, setYawFromFace, setAds, setQuality, setCamMode, setMoveInput,
    get ready() { return ready; },
    get yaw() { return yaw; },
    get pitch() { return pitch; },
    get ads() { return adsOn; },
    get fps() { return fpsValue; },
    get shotBlocked() { return shotBlocked; },
    get shotBlockDist() { return shotBlockDist; },
    get quality() { return qualityName; },
    get autoQuality() { return { on: autoQ, drops: autoDrops }; },
    get camMode() { return camMode; },
    set onAds(fn) { adsCb = fn; },
    setLean,
  };
})();
