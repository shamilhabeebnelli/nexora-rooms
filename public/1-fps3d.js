/* NELLIWERSE first-person 3D view.
   Renders the authoritative server snapshot (same one the 2D view uses)
   as a first-person scene. Owns its own canvas; client.js calls
   NelliFps.render(state) instead of the 2D world draw when active. */
(function () {
  const TILE = 1.6, EYE = 1.55, WALLH = 3.6, MAXI = 40 * 40;
  let renderer = null, scene = null, cam = null, ready = false, failed = false;
  let walls = null, roads = null, dashes = null, ground = null;
  let othersGroup = null, mobGroup = null, projGroup = null, beaconGroup = null;
  let yaw = 0, pitch = 0, canvasEl = null;
  let charTmpls = null; // {A: Object3D, B: Object3D} or null -> capsule fallback
  const avatars = new Map(); // player id -> { obj, lx, ly, phase }

  let gun = null, adsOn = false, adsT = 0, adsCb = null;
  /* gun viewmodel: original box-model rifle, gunmetal with one amber sight accent */
  const GUN_HIP = [0.23, -0.185, -0.42], GUN_ADS = [0, -0.128, -0.36];
  function buildGun(THREE) {
    const g = new THREE.Group();
    const metal = new THREE.MeshLambertMaterial({ color: 0x474d55 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
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
      scene.background = new THREE.Color(0x232c3a);
      scene.fog = new THREE.Fog(0x232c3a, 14, 60);
      cam = new THREE.PerspectiveCamera(74, 1, 0.05, 90);
      scene.add(cam);
      gun = buildGun(THREE);
      cam.add(gun);
      /* right-mouse hold = aim down sight */
      canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
      canvasEl.addEventListener('pointerdown', (e) => { if (e.button === 2) setAds(true); });
      canvasEl.addEventListener('pointerup', (e) => { if (e.button === 2) setAds(false); });
      scene.add(new THREE.HemisphereLight(0xa8bcd8, 0x4a463c, 1.35));
      const sun = new THREE.DirectionalLight(0xffedd0, 1.35);
      sun.position.set(20, 34, 10); scene.add(sun);

      ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500),
        new THREE.MeshLambertMaterial({ color: 0x46553c }));
      ground.rotation.x = -Math.PI / 2; scene.add(ground);

      walls = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE, WALLH, TILE),
        new THREE.MeshLambertMaterial({ color: 0xffffff }), MAXI);
      roads = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE, 0.07, TILE),
        new THREE.MeshLambertMaterial({ color: 0x5a5a63 }), MAXI);
      dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.09, TILE * 0.45),
        new THREE.MeshBasicMaterial({ color: 0xd9b23a }), MAXI);
      scene.add(walls); scene.add(roads); scene.add(dashes);
      walls.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXI * 3), 3);

      othersGroup = new THREE.Group(); mobGroup = new THREE.Group();
      projGroup = new THREE.Group(); beaconGroup = new THREE.Group();
      scene.add(othersGroup, mobGroup, projGroup, beaconGroup);
      // stylized characters replace capsule placeholders; capsule fallback stays if load fails
      try {
        const { GLTFLoader } = await import('./GLTFLoader.js');
        const loader = new GLTFLoader();
        const [ga, gb] = await Promise.all([
          new Promise((res, rej) => loader.load('./charA.glb', res, undefined, rej)),
          new Promise((res, rej) => loader.load('./charB.glb', res, undefined, rej)),
        ]);
        for (const g of [ga, gb]) {
          g.scene.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; } });
        }
        charTmpls = { A: ga.scene, B: gb.scene };
      } catch (ce) { charTmpls = null; console.log('char load failed, capsule fallback:', ce && ce.message); }
      ready = true;
      window.__fpsDebug = { scene: () => scene, othersGroup: () => othersGroup, avatars, tmpls: () => charTmpls, cam: () => cam };
    } catch (e) { failed = true; console.log('fps3d init failed:', e && e.message); }
    return ready;
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
    let wi = 0, ri = 0, di = 0;
    const m = _m4(), c = new THREE.Color();
    for (let row = 0; row < v.tiles.length; row++) {
      const line = v.tiles[row];
      for (let col = 0; col < line.length; col++) {
        const code = line.charCodeAt(col) - 48;
        const gx = v.x0 + col, gy = v.y0 + row;
        if (code === 0 && wi < MAXI) { // building block, slight per-block tint
          m.makeTranslation(gx * TILE, WALLH / 2, gy * TILE);
          walls.setMatrixAt(wi, m);
          const t = hash2(gx, gy);
          c.setHSL(0.09 + t * 0.03, 0.14 + t * 0.1, 0.42 + t * 0.16);
          walls.setColorAt(wi, c);
          wi++;
        } else if ((code === 5 || code === 6) && ri < MAXI) {
          m.makeTranslation(gx * TILE, 0.035, gy * TILE);
          roads.setMatrixAt(ri, m); ri++;
          // divider dashes only on the main road (matches the real-layout rule)
          if (code === 5 && di < MAXI && (gy % 2 === 0)) {
            m.makeTranslation(gx * TILE, 0.09, gy * TILE);
            dashes.setMatrixAt(di, m); di++;
          }
        }
      }
    }
    walls.count = wi; roads.count = ri; dashes.count = di;
    walls.instanceMatrix.needsUpdate = true;
    roads.instanceMatrix.needsUpdate = true;
    dashes.instanceMatrix.needsUpdate = true;
    if (walls.instanceColor) walls.instanceColor.needsUpdate = true;

    // other players: stylized characters (capsule fallback), NO floating names
    othersGroup.clear();
    const seenIds = new Set();
    for (const o of st.others || []) {
      seenIds.add(o.id);
      let av = avatars.get(o.id);
      if (!av) {
        let obj;
        if (charTmpls) {
          const src = ((o.hu || 0) % 2 === 0) ? charTmpls.A : charTmpls.B;
          obj = src.clone(true);
          const shift = (((o.hu || 0) * 36) % 360) / 360 * 0.18 - 0.09;
          obj.traverse((m) => {
            if (m.isMesh && /shirt|pants/.test(m.material && m.material.name || '')) {
              m.material = m.material.clone();
              m.material.color.offsetHSL(shift, 0, 0);
            }
          });
        } else {
          obj = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.05, 4, 10),
            new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(((o.hu || 0) * 36 % 360) / 360, 0.5, 0.5) }));
          obj.position.y = 0.98;
          const wrap = new THREE.Group(); wrap.add(obj); obj = wrap;
        }
        av = { obj, lx: o.x, ly: o.y, phase: 0 };
        avatars.set(o.id, av);
      }
      const moved = Math.hypot(o.x - av.lx, o.y - av.ly);
      av.phase += moved * 9;
      av.lx = o.x; av.ly = o.y;
      const g = av.obj;
      g.position.set(o.x * TILE, 0, o.y * TILE);
      const fx = (o.f && o.f[0]) || 0, fy = (o.f && o.f[1]) || 0;
      if (fx || fy) g.rotation.y = Math.atan2(fx, fy);
      if (o.dead) {
        g.rotation.x = -Math.PI / 2;
        g.position.y = 0.15;
      } else {
        g.rotation.x = 0;
        const bob = moved > 0.002 ? Math.abs(Math.sin(av.phase)) * 0.05 : 0;
        g.position.y = 0.03 + bob;
        g.rotation.z = moved > 0.002 ? Math.sin(av.phase) * 0.05 : 0;
      }
      othersGroup.add(g);
    }
    for (const id of avatars.keys()) if (!seenIds.has(id)) avatars.delete(id);
    mobGroup.clear();
    for (const mb of st.mobs || []) {
      const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.5, 4, 8),
        new THREE.MeshLambertMaterial({ color: 0x7a2e2e }));
      cap.position.set(mb.x * TILE, 0.6, mb.y * TILE);
      mobGroup.add(cap);
    }
    projGroup.clear();
    for (const pr of st.projs || []) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xffd76a }));
      s.position.set(pr.x * TILE, EYE - 0.1, pr.y * TILE);
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

  function render(st) {
    if (!ready || !st || !st.you) return;
    resize();
    rebuild(st);
    const me = st.you;
    ground.position.set(me.x * TILE, 0, me.y * TILE);
    cam.position.set(me.x * TILE, EYE, me.y * TILE);
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
    cam.rotation.y = yaw + Math.PI; // world z+ is map y+
    cam.rotation.x = pitch;
    renderer.render(scene, cam);
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
    init, render, lookDelta, aimVec, setYawFromFace, setAds,
    get ready() { return ready; },
    get yaw() { return yaw; },
    get ads() { return adsOn; },
    set onAds(fn) { adsCb = fn; },
  };
})();
