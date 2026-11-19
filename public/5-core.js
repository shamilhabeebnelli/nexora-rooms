/**
 * denelli-dungeon core — shared game logic (no I/O).
 * Used by server.js (Node host) and by the browser solo-delve mode,
 * so both run the exact same map generator and rules.
 *
 * The dungeon is a schematic game map of the Manjeri -> Kozhikode route
 * with junction sub-roads. Place names are the owner's own spellings.
 * It is NOT a navigation-accurate road map.
 *
 * Copyright (c) 2026 shamil habeeb nelli (denelli). All rights reserved.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DenelliCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- seeded RNG ---------------- */
  function nelliSeed(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- tiles + map size ---------------- */
  const T = { WALL: 0, FLOOR: 1, STAIRS: 2, POTION: 3, GOLD: 4, ROAD_MAIN: 5, ROAD_SUB: 6 };
  const MAP_W = 84, MAP_H = 70;
  const VIEW_RADIUS = 14;

  /* ---------------- the route (schematic game map, owner's spellings) ---------------- */
  // main chain, in order; positions are room centers on the tile grid
  const MAIN_ROUTE = [
    { n: 'Manjeri', x: 8, y: 20 },
    { n: 'pullara', x: 17, y: 20 },
    { n: 'valluvamburam', x: 26, y: 20 },
    { n: 'mongam', x: 35, y: 20 },
    { n: 'kondotty', x: 44, y: 20, junction: true },
    { n: 'pulikkal', x: 44, y: 29 },
    { n: 'ramanattukara', x: 44, y: 38, junction: true },
    { n: 'feroke', x: 53, y: 38 },
    { n: 'meenchantha', x: 62, y: 38 },
    { n: 'kallayi', x: 71, y: 38 },
    { n: 'kozhikkode beach', x: 71, y: 47 },
  ];
  // junction sub-roads, branching off their junction room
  const SUB_ROADS = [
    { from: 'kondotty', rooms: [{ n: 'tharayittal', x: 53, y: 20 }, { n: 'kakad', x: 62, y: 20 }] },
    { from: 'kondotty', rooms: [{ n: 'kizhisseri', x: 44, y: 11 }, { n: 'areekode', x: 35, y: 11 }] },
    { from: 'ramanattukara', rooms: [{ n: 'chekembra', x: 44, y: 47 }, { n: 'thalapapra', x: 44, y: 56 }] },
    { from: 'ramanattukara', rooms: [{ n: 'azhinjilam', x: 35, y: 38 }, { n: 'feroke college', x: 26, y: 38 }, { n: 'thondayad', x: 17, y: 38 }] },
  ];

  /* ---------------- map generation ---------------- */
  /* ---------------- real street map: Kondotty 5km radius ----------------
     Precomputed offline from OpenStreetMap data (ODbL) into kondotty-map.js.
     Schematic game map - not for navigation. Single persistent town map:
     no floors, no stairs, no loot scatter. */
  function genKondotty() {
    let data = null;
    if (typeof module !== 'undefined' && module.exports) {
      try { data = require('./kondotty-map.js'); } catch (e) { data = null; }
    }
    if (!data && typeof self !== 'undefined' && self.KONDOTTY_MAP) data = self.KONDOTTY_MAP;
    if (!data && typeof window !== 'undefined' && window.KONDOTTY_MAP) data = window.KONDOTTY_MAP;
    if (!data) {
      try { console.warn('NELLIWERSE: kondotty-map.js MISSING - falling back to the old schematic map. Do not ship this build.'); } catch (e) {}
      return null; // dev fallback only; never deliver without the real Kondotty map
    }
    const w = data.w, h = data.h;
    const grid = new Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = data.grid[y];
      for (let x = 0; x < w; x++) grid[y * w + x] = row.charCodeAt(x) - 48;
    }
    const police = (data.police || []).map((p) => ({ n: p.n, town: p.n, x: p.x, y: p.y, kind: 'police' }));
    return { grid, w, h, rooms: data.rooms || [], landmarks: [], police, spawn: data.spawn, kondotty: true };
  }

  function genDungeon(seed, w, h) {
    w = w || MAP_W; h = h || MAP_H;
    const rnd = nelliSeed(seed);
    const grid = new Uint8Array(w * h);
    const rooms = [];
    const jit = () => Math.floor(rnd() * 3) - 1; // +-1 jitter, same seed => same map

    const carveRoom = (def, main) => {
      const rw = (main ? 8 : 6) + jit();
      const rh = (main ? 8 : 6) + jit();
      const cx = def.x + jit(), cy = def.y + jit();
      const x = Math.max(1, Math.min(w - rw - 1, cx - (rw >> 1)));
      const y = Math.max(1, Math.min(h - rh - 1, cy - (rh >> 1)));
      for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) grid[yy * w + xx] = T.FLOOR;
      const room = { n: def.n, x, y, w: rw, h: rh, cx: x + (rw >> 1), cy: y + (rh >> 1), main: !!main, junction: !!def.junction };
      rooms.push(room);
      return room;
    };

    const digRoad = (a, b, wide) => {
      // L-shaped road between two points; the main route is a 2-wide
      // carriageway in BOTH directions and runs straight through town
      // floors, so the highway reads as one continuous band. A main road
      // upgrades a sub road where they cross, never the reverse.
      const mark = (xx, yy, wideNow) => {
        const i = yy * w + xx;
        if (grid[i] === T.WALL || grid[i] === T.FLOOR) grid[i] = wideNow ? T.ROAD_MAIN : T.ROAD_SUB;
        else if (grid[i] === T.ROAD_SUB && wideNow) grid[i] = T.ROAD_MAIN;
      };
      const carveH = (xx, yy) => { mark(xx, yy, wide); if (wide && yy + 1 < h - 1) mark(xx, yy + 1, true); };
      const carveV = (xx, yy) => { mark(xx, yy, wide); if (wide && xx + 1 < w - 1) mark(xx + 1, yy, true); };
      const xFirst = rnd() < 0.5;
      const hSeg = (x0, x1, yy) => { for (let xx = Math.min(x0, x1); xx <= Math.max(x0, x1); xx++) carveH(xx, yy); };
      const vSeg = (y0, y1, xx) => { for (let yy = Math.min(y0, y1); yy <= Math.max(y0, y1); yy++) carveV(xx, yy); };
      if (xFirst) { hSeg(a.cx, b.cx, a.cy); vSeg(a.cy, b.cy, b.cx); }
      else { vSeg(a.cy, b.cy, a.cx); hSeg(a.cx, b.cx, b.cy); }
    };

    // main route chain (wide roads)
    const mainRooms = MAIN_ROUTE.map((d) => carveRoom(d, true));
    for (let i = 1; i < mainRooms.length; i++) digRoad(mainRooms[i - 1], mainRooms[i], true);

    // junction sub-roads (narrow)
    for (const sr of SUB_ROADS) {
      const from = mainRooms.find((r) => r.n === sr.from);
      let prev = from;
      for (const d of sr.rooms) {
        const room = carveRoom(d, false);
        digRoad(prev, room, false);
        prev = room;
      }
    }

    // valluvamburam fork: main road heads back toward Manjeri, this stub
    // heads off toward the Malappuram side
    const vkm = mainRooms.find((r) => r.n === 'valluvamburam');
    vkm.junction = true;
    const mpm = carveRoom({ n: 'malappuram side', x: 26, y: 11 }, false);
    digRoad(vkm, mpm, false);

    // exterior-inspired landmarks: open named halls, no interior detail
    const thon = rooms.find((r) => r.n === 'thondayad');
    const mall = carveRoom({ n: 'HiLITE Mall', x: 12, y: 45 }, false);
    digRoad(thon, mall, false);
    const kallayi = mainRooms.find((r) => r.n === 'kallayi');
    const cyber = carveRoom({ n: 'Cyberpark', x: 60, y: 47 }, false);
    digRoad(kallayi, cyber, false);

    // signposted structures / crossings: label + small wall-block marker,
    // placed clear of roads. Showroom stays a generic label (brand open).
    const landmarks = [
      { n: 'municipal office', kind: 'office', x: 49, y: 24 },
      { n: 'showroom', kind: 'showroom', x: 39, y: 25 },
      { n: 'ramanattukara flyover', kind: 'flyover', x: 50, y: 33 },
      { n: 'thondayad flyover', kind: 'flyover', x: 17, y: 33 },
    ];
    for (const lm of landmarks) {
      if (lm.kind === 'office' || lm.kind === 'showroom') {
        for (let k = 0; k < 3; k++) if (grid[(lm.y + 1) * w + lm.x + k] !== T.STAIRS) grid[(lm.y + 1) * w + lm.x + k] = T.WALL;
      }
    }

    // fictional police stations: one per main town, placed off the
    // carriageway. Rebirth landmarks only - exterior signboard, no interior.
    const police = [];
    for (const r of mainRooms) {
      let spot = null;
      for (let yy = r.y + r.h - 1; yy >= r.y && !spot; yy--) {
        for (let xx = r.x + r.w - 1; xx >= r.x && !spot; xx--) {
          if (grid[yy * w + xx] === T.FLOOR) spot = { x: xx, y: yy };
        }
      }
      if (spot) police.push({ n: `${r.n} police`, town: r.n, x: spot.x, y: spot.y, kind: 'police' });
    }

    // stairs down at the end of the route: kozhikkode beach
    const beach = rooms.find((r) => r.n === 'kozhikkode beach');
    grid[beach.cy * w + beach.cx] = T.STAIRS;

    // scatter potions/gold inside named places (not on open roads)
    for (const r of rooms) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if (grid[y * w + x] !== T.FLOOR) continue;
          const roll = rnd();
          if (roll < 0.02) grid[y * w + x] = T.POTION;
          else if (roll < 0.06) grid[y * w + x] = T.GOLD;
        }
      }
    }

    const spawnRoom = rooms.find((r) => r.n === 'Manjeri');
    for (const ps of police) grid[ps.y * w + ps.x] = T.FLOOR; // no loot hidden under a station
    return { grid, w, h, rooms, landmarks, police, spawn: { x: spawnRoom.cx, y: spawnRoom.cy } };
  }

  function placeAt(map, x, y) {
    for (const r of map.rooms) {
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r.n;
    }
    return null;
  }

  /* ---------------- invented airport combat arena ----------------
     Fictional airport-themed floor with an invented layout and invented
     area names only. No real airport interior, security layout,
     checkpoints, routes or navigation detail. */
  function genAirportArena(seed, w, h) {
    w = w || MAP_W; h = h || MAP_H;
    const rnd = nelliSeed(seed);
    const grid = new Uint8Array(w * h);
    const rooms = [];
    const jit = () => Math.floor(rnd() * 3) - 1;

    const carve = (n, x, y, rw, rh, main) => {
      rw += jit(); rh += jit();
      x = Math.max(1, Math.min(w - rw - 1, x));
      y = Math.max(1, Math.min(h - rh - 1, y));
      for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) grid[yy * w + xx] = T.FLOOR;
      const room = { n, x, y, w: rw, h: rh, cx: x + (rw >> 1), cy: y + (rh >> 1), main: !!main, junction: false };
      rooms.push(room);
      return room;
    };
    const digRoad = (a, b) => {
      const carveT = (xx, yy) => { grid[yy * w + xx] = T.FLOOR; if (yy + 1 < h - 1) grid[(yy + 1) * w + xx] = T.FLOOR; };
      const hSeg = (x0, x1, yy) => { for (let xx = Math.min(x0, x1); xx <= Math.max(x0, x1); xx++) carveT(xx, yy); };
      const vSeg = (y0, y1, xx) => { for (let yy = Math.min(y0, y1); yy <= Math.max(y0, y1); yy++) carveT(xx, yy); };
      if (rnd() < 0.5) { hSeg(a.cx, b.cx, a.cy); vSeg(a.cy, b.cy, b.cx); }
      else { vSeg(a.cy, b.cy, a.cx); hSeg(a.cx, b.cx, b.cy); }
    };

    // invented layout: a terminal hall with counter cover, gates wing,
    // hangar, runway strip and a small tower. All fictional.
    const terminal = carve('denelli terminal', 16, 10, 34, 16, true);
    // counter blocks inside the hall as combat cover (fictional counters)
    for (let i = 0; i < 5; i++) {
      const bx = terminal.x + 5 + i * 6, by = terminal.y + 5 + (i % 2) * 5;
      for (let k = 0; k < 3; k++) grid[by * w + bx + k] = T.WALL;
    }
    const gates = [];
    for (let i = 0; i < 3; i++) gates.push(carve(`gate n${i + 1}`, 18 + i * 11, 34, 8, 8));
    const hangar = carve('hangar', 6, 46, 16, 12);
    const runway = carve('runway', 54, 30, 26, 5, true);
    const tower = carve('tower', 58, 10, 7, 7);

    for (const g2 of gates) digRoad(terminal, g2);
    digRoad(terminal, hangar);
    digRoad(terminal, runway);
    digRoad(terminal, tower);
    digRoad(gates[1], hangar);

    // plane silhouettes parked on the runway (wall blocks = cover)
    grid[(runway.y + 1) * w + runway.x + 7] = T.WALL;
    grid[(runway.y + 1) * w + runway.x + 8] = T.WALL;
    grid[(runway.y + 2) * w + runway.x + 17] = T.WALL;
    grid[(runway.y + 2) * w + runway.x + 18] = T.WALL;

    grid[tower.cy * w + tower.cx] = T.STAIRS;

    for (const r of rooms) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if (grid[y * w + x] !== T.FLOOR) continue;
          const roll = rnd();
          if (roll < 0.015) grid[y * w + x] = T.POTION;
          else if (roll < 0.05) grid[y * w + x] = T.GOLD;
        }
      }
    }
    const spawn = { x: terminal.x + 2, y: terminal.cy };
    return { grid, w, h, rooms, spawn, arena: true };
  }

  /* ---------------- the delve (game state + rules) ---------------- */
  class DenelliDelve {
    constructor(seedBase) {
      this.floor = 1;
      this.seedBase = (seedBase >>> 0) || 1;
      this.players = new Map();
      this.mobs = new Map();
      this.projs = []; // bullets in flight
      this.nextProjId = 1;
      this.nextId = 1;
      this.events = [];
      this.tickCount = 0;
      this.targetKills = 0; // players choose a max kill target; 0 = no target
      this.motm = null;     // Man of the Match: first player to reach the target
      this.loadFloor(1);
    }

    loadFloor(f) {
      this.floor = f;
      // odd floors: his route map. even floors: the invented airport arena
      this.map = genKondotty() || genDungeon(this.seedBase, MAP_W, MAP_H);
      this.mobs.clear();
      this.projs = []; // bullets die with the floor
      const rnd = nelliSeed((this.seedBase ^ (f * 31337)) >>> 0);
      const combat = this.map.arena ? 6 : 0; // arena floors run hotter
      const count = this.map.kondotty ? 0 : Math.min(8 + f * 2 + combat, 20);
      let placed = 0, guard = 0;
      while (placed < count && guard++ < 4000) {
        const x = 1 + Math.floor(rnd() * (this.map.w - 2));
        const y = 1 + Math.floor(rnd() * (this.map.h - 2));
        const d = Math.abs(x - this.map.spawn.x) + Math.abs(y - this.map.spawn.y);
        if (d > 34) continue;
        const tt = this.map.grid[y * this.map.w + x];
        const open = tt === T.FLOOR || tt === T.ROAD_MAIN || tt === T.ROAD_SUB;
        if (!open || d < 8) continue;
        const id = this.nextId++;
        this.mobs.set(id, { id, x, y, hp: 20 + f * 8, maxHp: 20 + f * 8, dmg: 4 + f * 2, cd: 0 });
        placed++;
      }
      for (const p of this.players.values()) {
        const spot = this.freeSpotNear(this.map.spawn.x, this.map.spawn.y);
        p.x = spot.x; p.y = spot.y;
      }
    }

    walkable(x, y) {
      if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) return false;
      return this.map.grid[y * this.map.w + x] !== T.WALL;
    }
    mobAt(x, y) { for (const m of this.mobs.values()) if (m.x === x && m.y === y) return m; return null; }
    playerAt(x, y, except) { for (const p of this.players.values()) if (p !== except && p.x === x && p.y === y && p.hp > 0) return p; return null; }

    /* test hook only (server gates it behind DENELLI_TEST_HOOK): move a player near (x, y) */
    teleport(id, x, y) {
      const p = this.players.get(id);
      if (!p) return;
      const s = this.freeSpotNear(Math.round(x), Math.round(y));
      p.x = s.x; p.y = s.y;
      p.place = placeAt(this.map, p.x, p.y);
    }

    /* nearest free walkable tile, ring search outward from (cx, cy) */
    freeSpotNear(cx, cy) {
      for (let r = 0; r < 14; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = cx + dx, y = cy + dy;
            if (this.walkable(x, y) && !this.mobAt(x, y) && !this.playerAt(x, y, null)) return { x, y };
          }
        }
      }
      return { x: cx, y: cy };
    }

    addPlayer(name) {
      const id = this.nextId++;
      const spot = this.freeSpotNear(this.map.spawn.x, this.map.spawn.y);
      const p = {
        id, name: String(name || 'delver').slice(0, 14) || 'delver',
        x: spot.x, y: spot.y,
        hp: 100, maxHp: 100, dmg: 12,
        gold: 0, kills: 0, deaths: 0, hits: 0, swings: 0, shots: 0, shotHits: 0, rebirthAt: 0,
        cd: 0, hurtCd: 0,
        dir: null, face: [0, 1],
        hue: (id * 67) % 360,
      };
      this.players.set(id, p);
      this.events.push({ k: 'join', name: p.name });
      return p;
    }
    removePlayer(id) {
      const p = this.players.get(id);
      if (p) { this.players.delete(id); this.events.push({ k: 'leave', name: p.name }); }
    }
    setDir(id, dx, dy) {
      const p = this.players.get(id);
      if (!p) return;
      dx = Math.sign(dx) || 0; dy = Math.sign(dy) || 0;
      p.dir = (dx || dy) ? { dx, dy } : null;
      if (dx || dy) p.face = [dx, dy];
    }

    /* aim without moving: the shooter looks one way, walks another */
    face(id, dx, dy) {
      const p = this.players.get(id);
      if (!p) return;
      dx = Math.sign(dx) || 0; dy = Math.sign(dy) || 0;
      if (dx || dy) p.face = [dx, dy];
    }
    respawn(id) {
      const p = this.players.get(id);
      if (!p || p.hp > 0) return;
      this.rebirth(p);
    }

    /* nearest police station by reachable-path distance: BFS over
       walkable tiles from the death spot, first station reached wins.
       Straight-line distance can pick a station walled off from you. */
    nearestPolice(x, y) {
      const stations = this.map.police || [];
      if (!stations.length) return null;
      const W5 = this.map.w, H5 = this.map.h;
      const byIdx = new Map(stations.map((ps) => [ps.y * W5 + ps.x, ps]));
      const start = y * W5 + x;
      if (byIdx.has(start)) return byIdx.get(start);
      const seen = new Uint8Array(W5 * H5);
      seen[start] = 1;
      const q = [start];
      for (let qi = 0; qi < q.length; qi++) {
        const cx = q[qi] % W5, cy = (q[qi] / W5) | 0;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const nx = cx + dx, ny = cy + dy;
          if (!this.walkable(nx, ny)) continue;
          const ni = ny * W5 + nx;
          if (seen[ni]) continue;
          if (byIdx.has(ni)) return byIdx.get(ni);
          seen[ni] = 1; q.push(ni);
        }
      }
      return null;
    }

    /* killed players rebirth at the nearest town police station (route
       floors); on the arena floor, where no town exists, at the arena
       entry. The delve, the floor and the other players carry on.
       No extra penalties: gold/kills are kept. */
    rebirth(p) {
      const st = this.nearestPolice(p.x, p.y);
      const at = st || this.map.spawn;
      const s = this.freeSpotNear(at.x, at.y);
      p.x = s.x; p.y = s.y;
      p.hp = p.maxHp;
      p.rebirthAt = 0;
      p.place = placeAt(this.map, p.x, p.y);
      this.events.push({ k: 'rebirth', id: p.id, name: p.name, town: st ? st.town : null });
    }

    attack(id) {
      const p = this.players.get(id);
      if (!p || p.hp <= 0 || p.cd > 0) return false;
      p.cd = 4;
      p.swings = (p.swings || 0) + 1; // melee swings - melee only, no shooting in the game yet
      const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      const f = p.face;
      const order = [f, ...dirs.filter(d => !(d[0] === f[0] && d[1] === f[1]))];
      for (const [dx, dy] of order) {
        const m = this.mobAt(p.x + dx, p.y + dy);
        if (m) {
          p.hits = (p.hits || 0) + 1;
          m.hp -= p.dmg;
          this.events.push({ k: 'slash', id: p.id });
          if (m.hp <= 0) this.killMob(p, m);
          return true;
        }
      }
      this.events.push({ k: 'slash', id: p.id });
      return true;
    }

    killMob(p, m) {
      this.mobs.delete(m.id);
      p.kills += 1; p.gold += 5;
      this.events.push({ k: 'kill', id: p.id, name: p.name });
      if (this.targetKills && !this.motm && p.kills >= this.targetKills) {
        this.motm = p.name; // first to the target; ties cannot pass a crowned winner
        this.events.push({ k: 'motm', name: p.name, target: this.targetKills });
      }
    }

    /* real gunfire: a bullet leaves in the facing direction and flies until
       it hits a monster, a wall, or its max range. Bullets pass through
       players - the PvP/co-op target choice is still his open question,
       so friendly fire stays OFF until he settles it. */
    shoot(id) {
      const p = this.players.get(id);
      if (!p || p.hp <= 0 || p.cd > 0) return false;
      p.cd = 6; // a shot recovers slower than a swing
      p.shots = (p.shots || 0) + 1;
      const [dx, dy] = p.face;
      this.projs.push({ id: this.nextProjId++, x: p.x, y: p.y, dx, dy, owner: id, ttl: 12 });
      this.events.push({ k: 'shot', id: p.id });
      return true;
    }

    tick() {
      this.tickCount++;
      for (const p of this.players.values()) {
        if (p.hp <= 0) {
          if (p.rebirthAt && this.tickCount >= p.rebirthAt) this.rebirth(p);
          continue;
        }
        p.cd = Math.max(0, p.cd - 1);
        p.hurtCd = Math.max(0, p.hurtCd - 1);
        if (p.dir && this.tickCount % 2 === 0) {
          const nx = p.x + p.dir.dx, ny = p.y + p.dir.dy;
          if (this.walkable(nx, ny) && !this.mobAt(nx, ny) && !this.playerAt(nx, ny, p)) { p.x = nx; p.y = ny; }
        }
        const t = this.map.grid[p.y * this.map.w + p.x];
        if (t === T.POTION) {
          p.hp = Math.min(p.maxHp, p.hp + 30);
          this.map.grid[p.y * this.map.w + p.x] = T.FLOOR;
          this.events.push({ k: 'heal', id: p.id });
        } else if (t === T.GOLD) {
          p.gold += 10 + this.floor * 2;
          this.map.grid[p.y * this.map.w + p.x] = T.FLOOR;
          this.events.push({ k: 'gold', id: p.id });
        } else if (t === T.STAIRS) {
          this.events.push({ k: 'descend', floor: this.floor + 1, by: p.name, arena: (this.floor + 1) % 2 === 0 });
          this.loadFloor(this.floor + 1);
          return;
        }
        const place = placeAt(this.map, p.x, p.y);
        if (place !== p.place) { p.place = place; if (place) this.events.push({ k: 'place', id: p.id, place }); }
      }
      for (const m of this.mobs.values()) {
        m.cd = Math.max(0, m.cd - 1);
        let best = null, bd = 1e9;
        for (const p of this.players.values()) {
          if (p.hp <= 0) continue;
          const d = Math.abs(p.x - m.x) + Math.abs(p.y - m.y);
          if (d < bd) { bd = d; best = p; }
        }
        if (!best) continue;
        if (bd === 1) {
          if (m.cd === 0) {
            m.cd = 8;
            best.hp -= m.dmg;
            this.events.push({ k: 'hit', id: best.id, hp: best.hp, by: 'mob' });
            if (best.hp <= 0) {
              best.deaths += 1;
              best.rebirthAt = this.tickCount + 8; // rebirth at the nearest town police station
              this.events.push({ k: 'died', id: best.id, name: best.name });
            }
          }
        } else if (bd <= 9 && this.tickCount % 3 === 0) {
          const dx = Math.sign(best.x - m.x), dy = Math.sign(best.y - m.y);
          const opts = Math.abs(best.x - m.x) >= Math.abs(best.y - m.y)
            ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]];
          for (const [ox, oy] of opts) {
            if (!ox && !oy) continue;
            const nx = m.x + ox, ny = m.y + oy;
            if (this.walkable(nx, ny) && !this.mobAt(nx, ny) && !this.playerAt(nx, ny, null)) { m.x = nx; m.y = ny; break; }
          }
        }
      }

      /* bullets: 1 tile per tick in a straight line; a bullet ends at a
         wall, at max range, on a monster, or on another player.
         This is a friend shootout: bullets DO hit other players (PvP on).
         Kills credit the shooter toward the match target (MoM = first to
         it); dead players rebirth at the nearest police station. */
      const flying = [];
      for (const pr of this.projs) {
        pr.x += pr.dx; pr.y += pr.dy; pr.ttl -= 1;
        if (pr.ttl <= 0 || !this.walkable(pr.x, pr.y)) continue;
        const owner = this.players.get(pr.owner) || null;
        const hitP = this.playerAt(pr.x, pr.y, owner);
        if (hitP) {
          if (owner) owner.shotHits = (owner.shotHits || 0) + 1;
          hitP.hp -= owner ? owner.dmg : 12;
          this.events.push({ k: 'shothit', x: pr.x, y: pr.y });
          if (hitP.hp <= 0) {
            hitP.deaths += 1;
            hitP.rebirthAt = this.tickCount + 8; // rebirth at the nearest police station
            this.events.push({ k: 'died', id: hitP.id, name: hitP.name });
            if (owner) {
              owner.kills += 1;
              this.events.push({ k: 'kill', id: owner.id, name: owner.name });
              if (this.targetKills && !this.motm && owner.kills >= this.targetKills) {
                this.motm = owner.name; // first to the target; ties cannot pass a crowned winner
                this.events.push({ k: 'motm', name: owner.name, target: this.targetKills });
              }
            }
          }
          continue;
        }
        const hitM = this.mobAt(pr.x, pr.y);
        if (hitM) {
          hitM.hp -= owner ? owner.dmg : 12;
          if (owner) owner.shotHits = (owner.shotHits || 0) + 1;
          this.events.push({ k: 'shothit', x: pr.x, y: pr.y });
          if (hitM.hp <= 0) { if (owner) this.killMob(owner, hitM); else this.mobs.delete(hitM.id); }
          continue;
        }
        flying.push(pr);
      }
      this.projs = flying;
    }

    drainEvents() { return this.events.splice(0, this.events.length); }

    /* local view for one player (what a client needs to render).
       Multiplayer hosts pass one shared drained event list so every
       player gets the same feed; solo mode drains internally. */
    snapshotFor(id, sharedEvents) {
      const p = this.players.get(id);
      if (!p) return null;
      const r = VIEW_RADIUS;
      const x0 = Math.max(0, p.x - r), x1 = Math.min(this.map.w - 1, p.x + r);
      const y0 = Math.max(0, p.y - r), y1 = Math.min(this.map.h - 1, p.y + r);
      const tiles = [];
      for (let y = y0; y <= y1; y++) {
        let row = '';
        for (let x = x0; x <= x1; x++) row += String.fromCharCode(48 + this.map.grid[y * this.map.w + x]);
        tiles.push(row);
      }
      const near = (e) => e.x >= x0 && e.x <= x1 && e.y >= y0 && e.y <= y1;
      const others = [];
      for (const q of this.players.values()) {
        if (q.id !== id && near(q)) others.push({ id: q.id, n: q.name, x: q.x, y: q.y, hp: q.hp, mh: q.maxHp, hu: q.hue, dead: q.hp <= 0, f: q.face });
      }
      const mobs = [];
      for (const m of this.mobs.values()) if (near(m)) mobs.push({ id: m.id, x: m.x, y: m.y, hp: m.hp, mh: m.maxHp });
      const projs = [];
      for (const pr of this.projs) if (near(pr)) projs.push({ x: pr.x, y: pr.y, dx: pr.dx, dy: pr.dy });
      const labels = [];
      for (const rm of this.map.rooms) {
        if (rm.cx >= x0 - 6 && rm.cx <= x1 + 6 && rm.cy >= y0 - 3 && rm.cy <= y1 + 3) {
          labels.push({ n: rm.n, x: rm.cx, y: rm.y, main: rm.main, junction: !!rm.junction });
        }
      }
      for (const lm of this.map.landmarks || []) {
        if (lm.x >= x0 - 6 && lm.x <= x1 + 6 && lm.y >= y0 - 3 && lm.y <= y1 + 3) {
          labels.push({ n: lm.n, x: lm.x, y: lm.y, main: false, junction: false, kind: lm.kind });
        }
      }
      for (const ps of this.map.police || []) {
        if (ps.x >= x0 - 6 && ps.x <= x1 + 6 && ps.y >= y0 - 3 && ps.y <= y1 + 3) {
          labels.push({ n: ps.n, x: ps.x, y: ps.y, main: false, junction: false, kind: 'police' });
        }
      }
      const snap = {
        t: 'state', tick: this.tickCount, floor: this.floor,
        you: { id: p.id, x: p.x, y: p.y, hp: p.hp, mh: p.maxHp, gold: p.gold, kills: p.kills, deaths: p.deaths, hu: p.hue, dead: p.hp <= 0, f: p.face, place: p.place || null, hits: p.hits || 0, swings: p.swings || 0, shots: p.shots || 0, shotHits: p.shotHits || 0 },
        view: { x0, y0, tiles },
        others, mobs, projs, labels, ev: sharedEvents !== undefined ? sharedEvents : this.drainEvents(),
        party: this.players.size, motm: this.motm, target: this.targetKills,
      };
      return snap;
    }
  }

  return { nelliSeed, genDungeon, genAirportArena, placeAt, DenelliDelve, T, MAP_W, MAP_H, VIEW_RADIUS, MAIN_ROUTE, SUB_ROADS };
});
