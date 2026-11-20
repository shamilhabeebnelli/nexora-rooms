/* NELLIWERSE first-person 3D view.
   Renders the authoritative server snapshot (same one the 2D view uses)
   as a first-person scene. Owns its own canvas; client.js calls
   NelliFps.render(state) instead of the 2D world draw when active. */
(function () {
  const TILE = 1.6, EYE = 1.55, WALLH = 3.6, MAXI = 40 * 40, MAXT = 260;
  let renderer = null, scene = null, cam = null, ready = false, failed = false, selfJt = 0;
  let shops = null, shotBlocked = false, shotBlockDist = 0;
  let walls = null, roads = null, dashes = null, ground = null, trunks = null, canopies = null;
  let roadsV = null, tanks = null, poles = null, lampHeads = null, sunLight = null, skyDome = null, sunSprite = null;
  const SUN_DIR = { x: -0.55, y: 0.17, z: 0.42 }; /* low warm dusk sun; long shadows, occluded by buildings */
  let othersGroup = null, mobGroup = null, projGroup = null, beaconGroup = null;
  let yaw = 0, pitch = 0, canvasEl = null, lean = 0;
  const STANCE_EYE_H = { stand: 1.55, crouch: 1.05, prone: 0.55 };
  const eyeH = (st) => STANCE_EYE_H[st] || 1.55;
  function setLean(l) { lean = Math.max(-1, Math.min(1, l | 0)); }
  let charTmpls = null; // {A: Object3D, B: Object3D} or null -> capsule fallback
  const avatars = new Map(); // player id -> { obj, lx, ly, phase }

  let gun = null, adsOn = false, adsT = 0, adsCb = null;
  /* gun viewmodel: original box-model rifle, gunmetal with one amber sight accent */
  const GUN_HIP = [0.23, -0.185, -0.42], GUN_ADS = [0, -0.128, -0.36];
  function buildGun(THREE) {
    const g = new THREE.Group();
    const metal = new THREE.MeshLambertMaterial({ color: 0x6a7280, emissive: 0x11141a });
    const dark = new THREE.MeshLambertMaterial({ color: 0x424854, emissive: 0x0c0e12 });
    const amber = new THREE.MeshLambertMaterial({ color: 0xd9a23a });
    const add = (w, h, d, mat, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z); g.add(m); return m;
    };
    add(0.07, 0.10, 0.40, metal, 0, 0, 0);            // receiver
    add(0.032, 0.032, 0.30, dark, 0, 0.012, -0.32);   // barrel
    add(0.05, 0.16, 0.07, dark, 0, -0.11, 0.06);      // magazine
    add(0.06, 0.07, 0.16, dark, 0, -0.02, 0.24);      // stock
    add(0.024, 0.034, 0.05, amber, 0, 0.066, -0.10);  // amber sight
    g.rotation.y = 0.05;
    g.scale.setScalar(0.5);
    g.position.set(GUN_HIP[0], GUN_HIP[1], GUN_HIP[2]);
    return g;
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
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
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
      grad.addColorStop(0, '#1c2436');
      grad.addColorStop(0.40, '#2e3850');
      grad.addColorStop(0.56, '#45485a');
      grad.addColorStop(0.68, '#7d5f3a');
      grad.addColorStop(0.78, '#9c6a32');
      grad.addColorStop(0.85, '#6b4e2e');
      grad.addColorStop(1, '#3a332a');
      skg.fillStyle = grad; skg.fillRect(0, 0, 1024, 512);
      let skseed = 7;
      const skrnd = () => (skseed = (skseed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 14; i++) { // thin dusk cloud streaks, warm-lit from below
        const cy = 180 + skrnd() * 150, cw = 40 + skrnd() * 110, ch = 2 + skrnd() * 4, cx0 = skrnd() * 1024;
        skg.fillStyle = 'rgba(30,34,46,0.35)';
        skg.beginPath(); skg.ellipse(cx0, cy, cw, ch, 0, 0, 7); skg.fill();
        skg.fillStyle = 'rgba(214,158,92,0.16)';
        skg.beginPath(); skg.ellipse(cx0, cy + ch * 0.7, cw * 0.9, ch * 0.5, 0, 0, 7); skg.fill();
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
      scene.fog = new THREE.Fog(0x4a4136, 14, 60);
      cam = new THREE.PerspectiveCamera(74, 1, 0.05, 90);
      scene.add(cam);
      gun = buildGun(THREE);
      cam.add(gun);
      /* right-mouse hold = aim down sight */
      canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
      canvasEl.addEventListener('pointerdown', (e) => { if (e.button === 2) setAds(true); });
      canvasEl.addEventListener('pointerup', (e) => { if (e.button === 2) setAds(false); });
      scene.add(new THREE.HemisphereLight(0x93a7c9, 0x5f5442, 1.0));
      sunLight = new THREE.DirectionalLight(0xffcb8f, 2.5);
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(2048, 2048);
      sunLight.shadow.camera.left = -30; sunLight.shadow.camera.right = 30;
      sunLight.shadow.camera.top = 30; sunLight.shadow.camera.bottom = -30;
      sunLight.shadow.camera.near = 2; sunLight.shadow.camera.far = 160;
      sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.03;
      scene.add(sunLight); scene.add(sunLight.target);

      ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500),
        new THREE.MeshLambertMaterial({ color: 0xffffff }));
      ground.rotation.x = -Math.PI / 2; scene.add(ground);
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
      const gtex = new THREE.CanvasTexture(gc);
      if (THREE.SRGBColorSpace) gtex.colorSpace = THREE.SRGBColorSpace;
      gtex.wrapS = gtex.wrapT = THREE.RepeatWrapping; gtex.repeat.set(90, 90);
      ground.material.map = gtex;
      ground.receiveShadow = true;

      /* original procedural facade v2: pale plaster, vertical shade gradient, framed windows
         with sills, some warm-lit, grime streaks, parapet cap */
      const fc = document.createElement('canvas'); fc.width = 128; fc.height = 256;
      const fg = fc.getContext('2d');
      const fgrad = fg.createLinearGradient(0, 0, 0, 256);
      fgrad.addColorStop(0, '#d9d2c5'); fgrad.addColorStop(0.75, '#c3bbae'); fgrad.addColorStop(1, '#a89e8e');
      fg.fillStyle = fgrad; fg.fillRect(0, 0, 128, 256);
      fg.fillStyle = '#8e8477'; fg.fillRect(0, 0, 128, 10); // parapet cap
      fg.fillStyle = 'rgba(0,0,0,0.22)'; fg.fillRect(0, 10, 128, 3);
      fg.fillStyle = 'rgba(96,86,72,0.5)'; fg.fillRect(0, 238, 128, 18); // plinth
      let fseed = 29;
      const frnd = () => (fseed = (fseed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 130; i++) { // plaster noise
        fg.fillStyle = frnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(70,60,48,0.06)';
        fg.beginPath(); fg.arc(frnd() * 128, frnd() * 256, 1 + frnd() * 4, 0, 7); fg.fill();
      }
      for (let wy = 0; wy < 5; wy++) for (let wx = 0; wx < 3; wx++) {
        const x0 = 14 + wx * 38, y0 = 26 + wy * 44, lit = frnd() < 0.22;
        fg.fillStyle = '#6e6558'; fg.fillRect(x0 - 2, y0 - 2, 28, 34); // frame
        const wgrad = fg.createLinearGradient(x0, y0, x0, y0 + 28);
        if (lit) { wgrad.addColorStop(0, '#f0c06a'); wgrad.addColorStop(1, '#c98f3e'); }
        else { wgrad.addColorStop(0, '#3a4152'); wgrad.addColorStop(1, '#232834'); }
        fg.fillStyle = wgrad; fg.fillRect(x0, y0, 24, 28);
        fg.fillStyle = 'rgba(255,255,255,0.12)'; fg.fillRect(x0 + 2, y0 + 2, 8, 24); // glass sheen
        fg.fillStyle = '#8e8477'; fg.fillRect(x0 - 3, y0 + 30, 30, 3); // sill
        fg.fillStyle = 'rgba(60,50,40,0.20)'; fg.fillRect(x0, y0 + 33, 24, 10 + frnd() * 8); // grime under sill
      }
      const ftex = new THREE.CanvasTexture(fc);
      if (THREE.SRGBColorSpace) ftex.colorSpace = THREE.SRGBColorSpace;
      /* shopfront variant v2: sign band, striped awning with scalloped edge, glass front, door */
      const sc = document.createElement('canvas'); sc.width = 128; sc.height = 256;
      const sg = sc.getContext('2d');
      const sgrad = sg.createLinearGradient(0, 0, 0, 256);
      sgrad.addColorStop(0, '#cfc6b8'); sgrad.addColorStop(1, '#a99f90');
      sg.fillStyle = sgrad; sg.fillRect(0, 0, 128, 256);
      sg.fillStyle = '#8e8477'; sg.fillRect(0, 0, 128, 10);
      sg.fillStyle = 'rgba(0,0,0,0.22)'; sg.fillRect(0, 10, 128, 3);
      let sseed = 47;
      const srnd = () => (sseed = (sseed * 16807) % 2147483647) / 2147483647;
      for (let wy = 0; wy < 3; wy++) for (let wx = 0; wx < 3; wx++) { // upper windows
        const x0 = 16 + wx * 38, y0 = 24 + wy * 30, lit = srnd() < 0.2;
        sg.fillStyle = '#6e6558'; sg.fillRect(x0 - 2, y0 - 2, 26, 24);
        sg.fillStyle = lit ? '#eec06a' : '#333a48'; sg.fillRect(x0, y0, 22, 20);
        sg.fillStyle = 'rgba(255,255,255,0.12)'; sg.fillRect(x0 + 2, y0 + 2, 7, 16);
      }
      sg.fillStyle = '#40372a'; sg.fillRect(0, 116, 128, 22); // sign band
      sg.fillStyle = '#d9b23a';
      for (let i = 0; i < 5; i++) sg.fillRect(12 + i * 23, 123, 14, 7); // abstract sign marks, no real text
      for (let i = 0; i < 8; i++) { // striped awning
        sg.fillStyle = i % 2 ? '#a8542c' : '#d8cdb4';
        sg.fillRect(i * 16, 142, 16, 20);
        sg.beginPath(); sg.arc(i * 16 + 8, 162, 8, 0, Math.PI); sg.fill();
      }
      sg.fillStyle = 'rgba(0,0,0,0.30)'; sg.fillRect(0, 168, 128, 4);
      const ggrad = sg.createLinearGradient(0, 176, 0, 248); // glass front: dusk reflection
      ggrad.addColorStop(0, '#5a6a80'); ggrad.addColorStop(0.5, '#39424f'); ggrad.addColorStop(1, '#232a33');
      sg.fillStyle = ggrad; sg.fillRect(8, 176, 112, 72);
      sg.fillStyle = 'rgba(214,158,92,0.30)'; sg.fillRect(14, 182, 40, 60); // warm interior glow
      sg.fillStyle = 'rgba(190,220,235,0.25)'; sg.fillRect(62, 182, 26, 60);
      sg.fillStyle = '#2b2f36'; sg.fillRect(96, 176, 4, 72); // door frame
      sg.fillStyle = 'rgba(96,86,72,0.5)'; sg.fillRect(0, 248, 128, 8);
      const stex = new THREE.CanvasTexture(sc);
      if (THREE.SRGBColorSpace) stex.colorSpace = THREE.SRGBColorSpace;
      walls = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE, WALLH, TILE),
        new THREE.MeshLambertMaterial({ color: 0xffffff, map: ftex }), MAXI);
      shops = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE, WALLH, TILE),
        new THREE.MeshLambertMaterial({ color: 0xffffff, map: stex }), MAXI >> 2);
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
      /* instanced tile meshes: frustumCulled must stay OFF - their bounding sphere is
         computed once from the first view window and goes stale as the player moves,
         which would cull every building/road at once */
      for (const im of [walls, shops, roads, roadsV, dashes, tanks, poles, lampHeads]) im.frustumCulled = false;
      walls.castShadow = true; walls.receiveShadow = true;
      shops.castShadow = true; shops.receiveShadow = true;
      roads.receiveShadow = true; roadsV.receiveShadow = true;
      tanks.castShadow = true; poles.castShadow = true;
      scene.add(walls); scene.add(shops); scene.add(roads); scene.add(roadsV); scene.add(dashes);
      scene.add(tanks); scene.add(poles); scene.add(lampHeads);
      /* low-poly trees: trunk + cone canopy, placed deterministically on open tiles in rebuild() */
      trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.13, 1.0, 6),
        new THREE.MeshLambertMaterial({ color: 0x4a3a26 }), MAXT);
      canopies = new THREE.InstancedMesh(new THREE.SphereGeometry(0.55, 7, 5),
        new THREE.MeshLambertMaterial({ color: 0xffffff }), MAXT * 3);
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
    low:  { dpr: 1.0,  fogNear: 10, fogFar: 45, camFar: 70, shadow: 0 },
    med:  { dpr: 1.25, fogNear: 14, fogFar: 60, camFar: 90, shadow: 1024 },
    high: { dpr: 1.6,  fogNear: 16, fogFar: 75, camFar: 110, shadow: 2048 },
  };
  let dprCap = QUALITY.high.dpr, qualityName = 'high';
  let fpsFrames = 0, fpsLast = 0, fpsValue = 0;
  /* third/first person: camera boom + own avatar, client-side only (server sim unchanged) */
  let camMode = 'fpp', selfAv = null, selfLx = 0, selfLy = 0, selfPhase = 0, dbgSt = null;
  let selfAnim = null;
  /* 10Hz server snapshots stepped the camera; smooth them: remember the last state
     change to extrapolate by velocity, and ease position/eye/boom every frame. */
  let smX = null, smY = null, eyeCur = null, boomCur = 0, lastRT = 0, dynDt = 0.016;
  let stX = null, stY = null, stT = 0, stVx = 0, stVy = 0;
  function setQuality(q) {
    const preset = QUALITY[q];
    if (!preset) return false;
    qualityName = q; dprCap = preset.dpr;
    if (ready) {
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
    let wi = 0, ri = 0, rvi = 0, di = 0, ti = 0, si = 0, ki = 0, pi = 0;
    const m = _m4(), c = new THREE.Color();
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
        if (code === 0 && wi < MAXI) { // building block, slight per-block tint + height variety
          const t = hash2(gx, gy);
          const hs = 0.75 + t * 0.9; // 0.75x-1.65x WALLH; bullets/camera stay below the lowest block
          m.makeScale(1, hs, 1);
          m.setPosition(gx * TILE, WALLH * hs / 2, gy * TILE);
          c.setHSL(0.09 + t * 0.03, 0.14 + t * 0.1, 0.42 + t * 0.16);
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
        } else if ((code === 5 || code === 6) && (ri < MAXI || rvi < MAXI)) {
          // orientation from road neighbours: north-south streets get the rotated asphalt
          const lr = codeAt(col - 1, row) === 5 || codeAt(col - 1, row) === 6 || codeAt(col + 1, row) === 5 || codeAt(col + 1, row) === 6;
          const ud = codeAt(col, row - 1) === 5 || codeAt(col, row - 1) === 6 || codeAt(col, row + 1) === 5 || codeAt(col, row + 1) === 6;
          const vert = ud && !lr;
          m.makeTranslation(gx * TILE, 0.035, gy * TILE);
          if (vert && rvi < MAXI) { roadsV.setMatrixAt(rvi, m); rvi++; }
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
    walls.count = wi; shops.count = si; roads.count = ri; roadsV.count = rvi; dashes.count = di;
    tanks.count = ki; poles.count = pi; lampHeads.count = pi;
    trunks.count = ti; canopies.count = ti * 3;
    walls.instanceMatrix.needsUpdate = true;
    shops.instanceMatrix.needsUpdate = true;
    roads.instanceMatrix.needsUpdate = true;
    roadsV.instanceMatrix.needsUpdate = true;
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
  function rebuildDynamic(st) {
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
      av.phase += moved * 9;
      av.lx = o.x; av.ly = o.y;
      const g = av.obj;
      /* snapshots step at 10Hz; ease each avatar toward the latest point instead */
      {
        const k = Math.min(1, dynDt * 12);
        av.sx += (o.x * TILE - av.sx) * k; av.sy += (o.y * TILE - av.sy) * k;
        av.mv += ((moved > 0.002 ? 1 : 0) - av.mv) * Math.min(1, dynDt * 10);
        if (av.anim) { av.anim.uPhase.value = av.phase; av.anim.uMove.value = av.mv; }
      }
      if (o.j && !av.jt) av.jt = performance.now();
      if (!o.j) av.jt = 0;
      const je = av.jt ? Math.min((performance.now() - av.jt) / 600, 1) : 0;
      const joff = av.jt ? Math.sin(Math.PI * je) * 0.7 : 0;
      g.position.set(av.sx, 0, av.sy);
      const fx = (o.f && o.f[0]) || 0, fy = (o.f && o.f[1]) || 0;
      if (fx || fy) g.rotation.y = Math.atan2(fx, fy);
      g.scale.set(1, 1, 1);
      showStance(g, o.st, !!o.dead);
      if (o.dead) {
        g.rotation.x = -Math.PI / 2;
        g.position.y = 0.15;
      } else if (o.st === 'prone') {
        g.rotation.x = 0; // the prone child carries its own flat rotation
        g.position.y = 0;
        g.rotation.z = 0;
      } else if (o.st === 'crouch') {
        g.rotation.x = 0;
        g.scale.set(1, 0.72, 1); // uniform squash (prior live behavior; mesh replacement parked)
        const bob = moved > 0.002 ? Math.abs(Math.sin(av.phase)) * 0.03 : 0;
        g.position.y = 0.03 + bob + joff;
        g.rotation.z = moved > 0.002 ? Math.sin(av.phase) * 0.04 : 0;
      } else {
        g.rotation.x = 0;
        const bob = moved > 0.002 ? Math.abs(Math.sin(av.phase)) * 0.05 : 0;
        g.position.y = 0.03 + bob + joff;
        g.rotation.z = moved > 0.002 ? Math.sin(av.phase) * 0.05 : 0;
      }
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
    projGroup.clear();
    for (const pr of st.projs || []) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xffd76a }));
      s.position.set(pr.x * TILE, pr.z !== undefined ? pr.z : EYE - 0.1, pr.y * TILE);
      projGroup.add(s);
    }
    // police stations: blue beacon columns (respawn points)
    beaconGroup.clear();
    for (const lb of st.labels || []) {
      if (lb.kind !== 'police') continue;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5),
        new THREE.MeshBasicMaterial({ color: 0x4d7dd6, transparent: true, opacity: 0.45 }));
      b.position.set(lb.x * TILE, 3.5, lb.y * TILE);
      beaconGroup.add(b);
    }
  }


  function tileCodeAt(st, wx, wz) {
    const v = st.view;
    if (!v || !v.tiles) return -1;
    const gx = Math.round(wx / TILE) - v.x0, gy = Math.round(wz / TILE) - v.y0;
    if (gy < 0 || gy >= v.tiles.length) return -1;
    const line = v.tiles[gy];
    if (gx < 0 || gx >= line.length) return -1;
    return line.charCodeAt(gx) - 48;
  }

  /* boneless-mesh walk cycle: per-avatar cloned materials get uPhase/uMove uniforms;
     legs and hanging arms swing along local z in the vertex shader. Honest procedural
     motion, not skinned animation - no joint claims. */
  function addWalkAnim(root, anim) {
    root.traverse((mm) => {
      if (!mm.isMesh || !mm.material) return;
      mm.material = mm.material.clone();
      mm.material.onBeforeCompile = (sh) => {
        sh.uniforms.uPhase = anim.uPhase;
        sh.uniforms.uMove = anim.uMove;
        sh.vertexShader = 'uniform float uPhase;\nuniform float uMove;\n' + sh.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n{' +
          ' float side = transformed.x >= 0.0 ? 0.0 : 3.14159;' +
          ' float legW = clamp((0.95 - transformed.y) / 0.95, 0.0, 1.0);' +
          ' float armM = (abs(transformed.x) > 0.2 && transformed.y > 0.85 && transformed.y < 1.6) ? 1.0 : 0.0;' +
          ' float armW = clamp((1.35 - transformed.y) / 0.5, 0.0, 1.0) * armM;' +
          ' transformed.z += uMove * (sin(uPhase + side) * legW * 0.34 + sin(uPhase + side + 3.14159) * armW * 0.26);' +
          ' transformed.z += uMove * 0.05 * transformed.y;' +
          '}');
      };
      mm.material.needsUpdate = true;
    });
  }

  function hueShift(root, hu) {
    const shift = (((hu || 0) * 36) % 360) / 360 * 0.18 - 0.09;
    root.traverse((m) => {
      if (m.isMesh && /shirt|pants/.test(m.material && m.material.name || '')) {
        m.material = m.material.clone();
        m.material.color.offsetHSL(shift, 0, 0);
      }
    });
  }

  /* one group with upright + prone children; visibility picks the stance.
     crouch stays the prior uniform squash: a visibly-sound knees-bent mesh
     replacement was attempted and rejected; do not re-add without parent pixel sign-off */
  function makeCharGroup(even, anim) {
    const THREE = window.__THREE;
    const up = (even ? charTmpls.A : charTmpls.B).clone(true);
    const pr = (even ? charTmpls.AP : charTmpls.BP).clone(true);
    pr.rotation.x = Math.PI / 2; // face-down, head toward facing; arms (mesh-rotated forward) lie flat ahead
    pr.position.y = 0.22;
    pr.visible = false;
    if (anim) addWalkAnim(up, anim); // walk swing only on the upright stance
    const g = new THREE.Group();
    g.add(up); g.add(pr);
    g.userData.up = up; g.userData.pr = pr;
    return g;
  }
  function showStance(g, st, dead) {
    if (!g.userData.up) return;
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
    /* velocity extrapolation from the last snapshot change, capped small */
    if (stX === null || me.x !== stX || me.y !== stY) {
      const dtt = stT ? Math.max(0.05, (nowMs - stT) / 1000) : 0.1;
      if (stX !== null) { stVx = (me.x - stX) / dtt; stVy = (me.y - stY) / dtt; }
      if (stX !== null && Math.hypot(me.x - stX, me.y - stY) > 3) {
        stVx = stVy = 0; smX = me.x * TILE; smY = me.y * TILE;
      }
      stX = me.x; stY = me.y; stT = nowMs;
    } else if (nowMs - stT > 160) { stVx = stVy = 0; }
    {
      const age = Math.min(0.12, (nowMs - stT) / 1000);
      const tx = (me.x + stVx * age) * TILE, ty = (me.y + stVy * age) * TILE;
      if (smX === null) { smX = tx; smY = ty; }
      const k = Math.min(1, dt * 14);
      smX += (tx - smX) * k; smY += (ty - smY) * k;
    }
    if (me.j && !selfJt) selfJt = performance.now();
    if (!me.j) selfJt = 0;
    const sje = selfJt ? Math.min((performance.now() - selfJt) / 600, 1) : 0;
    const sjoff = selfJt ? Math.sin(Math.PI * sje) * 0.7 : 0;
    ground.position.set(me.x * TILE, 0, me.y * TILE);
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
    const eyeTgt = eyeH(me.st);
    if (eyeCur === null) eyeCur = eyeTgt;
    eyeCur += (eyeTgt - eyeCur) * Math.min(1, dt * 10); // stance changes ease instead of snapping
    const eyeNow = eyeCur;
    cam.position.set(smX, eyeNow + sjoff, smY);
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
      gun.visible = adsT < 0.92;
    }
    cam.rotation.set(0, 0, 0, 'YXZ');
    cam.rotation.y = -yaw; // world z+ is map y+; matches aimVec so camera forward = (sin yaw, -cos yaw)
    cam.rotation.x = pitch;
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
      const smoved = Math.hypot(me.x - selfLx, me.y - selfLy);
      selfPhase += smoved * 9; selfLx = me.x; selfLy = me.y;
      if (selfAnim) {
        selfAnim.uPhase.value = selfPhase;
        selfAnim.uMove.value += ((smoved > 0.002 ? 1 : 0) - selfAnim.uMove.value) * Math.min(1, dt * 10);
      }
      selfAv.position.set(smX, 0.03 + sjoff + (smoved > 0.002 ? Math.abs(Math.sin(selfPhase)) * 0.05 : 0), smY);
      selfAv.rotation.y = Math.atan2(Math.sin(yaw), -Math.cos(yaw)); // same facing convention as other avatars: map forward (sin yaw, -cos yaw)
      selfAv.scale.set(1, 1, 1); selfAv.rotation.x = 0;
      showStance(selfAv, me.st, false);
      if (me.st === 'prone') { selfAv.position.y = sjoff * 0.45; }
      else if (me.st === 'crouch') selfAv.scale.set(1, 0.72, 1); // prior live squash
      // boom: pull camera back along its own -forward, clamp before walls, ease changes
      const THREE = window.__THREE;
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      let boom = 3.2 - 1.8 * adsT;
      for (let t = 0.4; t <= boom; t += 0.4) {
        if (tileCodeAt(st, smX - dir.x * t, smY - dir.z * t) === 0) { boom = Math.max(0.35, t - 0.45); break; }
      }
      boomCur += (boom - boomCur) * Math.min(1, dt * 7); // camera glides out/in on switch instead of snapping
      cam.position.set(
        smX - dir.x * boomCur,
        Math.max(0.3, eyeNow + sjoff * 0.45 - dir.y * boomCur + 0.18), // TPP camera follows the hop partially, so the avatar reads against the scene
        smY - dir.z * boomCur);
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
    if (fpsNow - fpsLast >= 500) { fpsValue = Math.round(fpsFrames * 1000 / (fpsNow - fpsLast)); fpsFrames = 0; fpsLast = fpsNow; }
  }

  /* look-around: drag to turn. Returns aim as a dominant-axis [dx,dy] map vector. */
  function lookDelta(dxPx, dyPx) {
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
    init, render, lookDelta, aimVec, setYawFromFace, setAds, setQuality, setCamMode,
    get ready() { return ready; },
    get yaw() { return yaw; },
    get pitch() { return pitch; },
    get ads() { return adsOn; },
    get fps() { return fpsValue; },
    get shotBlocked() { return shotBlocked; },
    get shotBlockDist() { return shotBlockDist; },
    get quality() { return qualityName; },
    get camMode() { return camMode; },
    set onAds(fn) { adsCb = fn; },
    setLean,
  };
})();
