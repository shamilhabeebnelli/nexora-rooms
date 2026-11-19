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
      ready = true;
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

    // other players: plain capsules, NO floating names (identity stays hidden)
    othersGroup.clear();
    for (const o of st.others || []) {
      const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.05, 4, 10),
        new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(((o.hu || 0) * 36 % 360) / 360, 0.5, 0.5) }));
      cap.position.set(o.x * TILE, 0.98, o.y * TILE);
      othersGroup.add(cap);
    }
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
    cam.rotation.set(0, 0, 0, 'YXZ');
    cam.rotation.y = yaw + Math.PI; // world z+ is map y+
    cam.rotation.x = pitch;
    renderer.render(scene, cam);
  }

  /* look-around: drag to turn. Returns aim as a dominant-axis [dx,dy] map vector. */
  function lookDelta(dxPx, dyPx) {
    yaw += dxPx * 0.0042;
    pitch = Math.max(-0.9, Math.min(0.9, pitch - dyPx * 0.0032));
  }
  function aimVec() {
    const fx = Math.sin(yaw), fy = -Math.cos(yaw);
    return Math.abs(fx) >= Math.abs(fy) ? [Math.sign(fx) || 1, 0] : [0, Math.sign(fy) || 1];
  }
  function setYawFromFace(f) {
    if (f && (f[0] || f[1])) yaw = Math.atan2(f[0], -f[1]);
  }

  window.NelliFps = {
    init, render, lookDelta, aimVec, setYawFromFace,
    get ready() { return ready; },
    get yaw() { return yaw; },
  };
})();
