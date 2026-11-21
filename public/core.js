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
  /* height-aware hit model (world units, 1 tile = 1.6): bullets fly at a real height
     from the shooter's eye with the shooter's pitch; targets have a profile height by
     stance; walls block only below their per-block height (the same deterministic
     heights the renderer draws). Stances are honest: no immunity, just a lower/slower
     profile that shots must actually be aimed at. Jump does NOT lift the hit profile. */
  const TILE_M = 1.6, WALLH_M = 3.6;
  const STANCE_EYE = { stand: 1.55, crouch: 1.05, prone: 0.55 };
  const STANCE_TOP = { stand: 1.8, crouch: 1.15, prone: 0.65 };
  const STANCE_SPEED = { stand: 4, crouch: 2.3, prone: 1.2 }; // metres/second at 10Hz
  function wallHash(x, y) { let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967295; }
  function wallHeightAt(gx, gy) { return WALLH_M * (0.75 + wallHash(gx, gy) * 0.9); }
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
    return { grid, w, h, rooms: data.rooms || [], landmarks: (data.landmarks||[]).map(p=>({...p})), police, spawn: data.spawn, kondotty: true };
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
      this.finished = 0;   // cumulative eliminations this match (survives auto-rebirth)
      this.motm = null;     // Man of the Match: first player to reach the target
      this.loadFloor(1);
    }

    loadFloor(f) {
      this.floor = f;
      // odd floors: his route map. even floors: the invented airport arena
      this.map = genKondotty() || genDungeon(this.seedBase, MAP_W, MAP_H);
      this.setupBus();
      this.mobs.clear();
      this.medkits=[];
      const kitAnchors=[...(this.map.police||[]),...(this.map.landmarks||[]).filter(l=>l.kind==='hospital')];
      for(const a of kitAnchors){let best=null;for(let r=0;r<=4&&!best;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const x=a.x+dx,y=a.y+dy,t=this.map.grid[y*this.map.w+x];if([T.FLOOR,T.ROAD_MAIN,T.ROAD_SUB].includes(t)&&(!best||dx*dx+dy*dy<best.d))best={x,y,d:dx*dx+dy*dy};}if(best)this.medkits.push({id:this.medkits.length,x:best.x,y:best.y,readyAt:0});}
      this.projs = []; // bullets die with the floor
      const rnd = nelliSeed((this.seedBase ^ (f * 31337)) >>> 0);
      const combat = this.map.arena ? 6 : 0; // arena floors run hotter
      const count = 0; // Only actual joined humans populate every game mode.
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
        p.x = spot.x; p.y = spot.y;p.riding=false;
      }
    }

    setupBus() {
      this.bus=null;if(!this.map.kondotty)return;
      const m=this.map,w=m.w,n=w*m.h,original=m.grid.slice(),rd=new Int16Array(n).fill(999),clear=new Float32Array(n).fill(999),queue=[];
      for(let k=0;k<n;k++)if([T.ROAD_MAIN,T.ROAD_SUB].includes(original[k])){rd[k]=0;queue.push(k);}
      for(let h=0;h<queue.length;h++){const k=queue[h];if(rd[k]>=4)continue;for(const v of [k-1,k+1,k-w,k+w])if(v>=0&&v<n&&rd[v]>rd[k]+1){rd[v]=rd[k]+1;queue.push(v);}}
      // Invented buildings stay intact. Reserve a full bus-length turning disc, not just its center cell.
      for(let y=0;y<m.h;y++)for(let x=0;x<w;x++)if(original[y*w+x]===T.WALL)for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++)if(x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<m.h){const k=(y+dy)*w+x+dx;clear[k]=Math.min(clear[k],Math.hypot(Math.max(0,Math.abs(dx)-.5),Math.max(0,Math.abs(dy)-.5)));}
      const allowed=k=>k>=0&&k<n&&rd[k]<=4&&clear[k]>3;
      let start=null,best=Infinity;for(let k=0;k<n;k++)if(allowed(k)){const d=(k%w-m.spawn.x)**2+(Math.floor(k/w)-m.spawn.y)**2;if(d<best){best=d;start=k;}}
      if(start===null)return;
      const component=[start],seen=new Set([start]);for(let h=0;h<component.length;h++)for(const v of [component[h]-1,component[h]+1,component[h]-w,component[h]+w])if(allowed(v)&&!seen.has(v)){seen.add(v);component.push(v);}
      const anchors=[{n:'Kondotty',x:m.spawn.x,y:m.spawn.y},...(m.landmarks||[]).filter(l=>l.kind==='hospital'||l.kind==='airport'),...(m.rooms||[]).filter(r=>r.n==='Karipur').map(r=>({n:r.n,x:r.cx,y:r.cy}))];
      const stops=anchors.map(a=>{let k=component[0],best=Infinity;for(const v of component){const dd=(v%w-a.x)**2+(Math.floor(v/w)-a.y)**2;if(dd<best){best=dd;k=v;}}return {k,n:a.n};});
      // Weighted A* favors the old road centerline. It detours only into nearby open terrain.
      const route=[],usedEdges=new Set();
      for(let s=0;s<stops.length;s++){
        const a=stops[s],end=stops[(s+1)%stops.length].k,heap=[],dist=new Map([[a.k,0]]),prev=new Map([[a.k,null]]);
        const push=o=>{heap.push(o);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p].f<=o.f)break;heap[i]=heap[p];i=p;}heap[i]=o;};
        const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].f<heap[c].f)c++;if(heap[c].f>=last.f)break;heap[i]=heap[c];i=c;}heap[i]=last;}return top;};
        const heuristic=k=>Math.abs(k%w-end%w)+Math.abs(Math.floor(k/w)-Math.floor(end/w));push({k:a.k,g:0,f:heuristic(a.k)});
        while(heap.length){const at=pop();if(at.g!==dist.get(at.k))continue;if(at.k===end)break;for(const v of [at.k-1,at.k+1,at.k-w,at.k+w])if(seen.has(v)){if(at.k===a.k&&route.length&&v===route[route.length-1].y*w+route[route.length-1].x)continue;if(s===stops.length-1&&v===end&&route.length>1&&at.k===route[1].y*w+route[1].x)continue;const edge=Math.min(at.k,v)+':'+Math.max(at.k,v);const g=at.g+1+rd[v]*1.5+(usedEdges.has(edge)?8:0);if(g<(dist.get(v)??Infinity)){dist.set(v,g);prev.set(v,at.k);push({k:v,g,f:g+heuristic(v)});}}}
        if(!prev.has(end))return;const leg=[];for(let k=end;k!==null;k=prev.get(k))leg.push({x:k%w,y:Math.floor(k/w)});leg.reverse();for(let j=1;j<leg.length;j++){const u=leg[j-1].y*w+leg[j-1].x,v=leg[j].y*w+leg[j].x;usedEdges.add(Math.min(u,v)+':'+Math.max(u,v));}leg[0].stop=a.n;route.push(...leg.slice(0,-1));
      }
      if(route.length<2)return;
      for(let pass=0;pass<6;pass++){const copy=route.map(p=>({...p}));for(let i=0;i<route.length;i++){const a=copy[(i-1+route.length)%route.length],b=copy[i],c=copy[(i+1)%route.length];route[i].x=(a.x+2*b.x+c.x)/4;route[i].y=(a.y+2*b.y+c.y)/4;}}
      // A Catmull-Rom centerline removes instantaneous 90-degree rotations. Dense samples also permit swept-footprint QA.
      const smooth=[];for(let i=0;i<route.length;i++){const p0=route[(i-1+route.length)%route.length],p1=route[i],p2=route[(i+1)%route.length],p3=route[(i+2)%route.length];for(let j=0;j<5;j++){const t=j/5,point={};for(const axis of ['x','y']){const a=p0[axis],b=p1[axis],c=p2[axis],d=p3[axis];point[axis]=.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t);}if(!j&&p1.stop)point.stop=p1.stop;smooth.push(point);}}
      // Fictional gameplay paving, never a surveyed street width. Keep every building tile untouched.
      m.shuttleMask=new Uint8Array(n);m.shuttlePaving=[];for(const p of smooth)for(let y=Math.floor(p.y-2.7);y<=Math.ceil(p.y+2.7);y++)for(let x=Math.floor(p.x-2.7);x<=Math.ceil(p.x+2.7);x++)if(x>=0&&x<w&&y>=0&&y<m.h&&Math.hypot(x-p.x,y-p.y)<=2.7&&original[y*w+x]!==T.WALL){const k=y*w+x;m.shuttleMask[k]=1;if(m.grid[k]!==T.ROAD_SUB){m.grid[k]=T.ROAD_SUB;m.shuttlePaving.push(k);}}
      const first=smooth[0],next=smooth[1],len=Math.hypot(next.x-first.x,next.y-first.y);
      this.bus={x:first.x,y:first.y,dx:(next.x-first.x)/len,dy:(next.y-first.y)/len,route:smooth,index:0,wait:80,stop:first.stop,riders:new Set()};
      this.bus.originalGrid=original;
    }
    boardBus(id) {
      const p=this.players.get(id),b=this.bus;if(!p||!b||p.hp<=0)return false;
      if(b.riders.has(id)){
        const start={x:Math.round(b.x),y:Math.round(b.y)},q=[{...start,d:0}],seen=new Set([start.x+','+start.y]);let spot=null;
        for(let h=0;h<q.length;h++){const at=q[h];const ex=at.x-b.x,ey=at.y-b.y,side=ex*b.dy-ey*b.dx,along=ex*b.dx+ey*b.dy;if((Math.abs(side)>1.05||Math.abs(along)>2.5)&&!this.playerAt(at.x,at.y,p)){spot=at;break;}if(at.d>=5)continue;for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const x=at.x+dx,y=at.y+dy,key=x+','+y;if(!seen.has(key)&&this.walkable(x,y)){seen.add(key);q.push({x,y,d:at.d+1});}}}
        if(!spot)return false;p.x=spot.x;p.y=spot.y;p.dir=null;b.riders.delete(id);p.riding=false;return true;
      }
      if(b.wait<=0||Math.hypot(p.x-b.x,p.y-b.y)>3||b.riders.size>=10)return false;
      b.riders.add(id);p.riding=true;p.dir=null;p.stance='stand';return true;
    }
    tickBus() {
      const b=this.bus;if(!b)return;
      for(const id of b.riders){const p=this.players.get(id);if(!p||p.hp<=0){b.riders.delete(id);if(p)p.riding=false;}}
      if(b.wait>0)b.wait--;else{const target=b.route[(b.index+1)%b.route.length],dx=target.x-b.x,dy=target.y-b.y,d=Math.hypot(dx,dy),step=.17;b.dx=dx/(d||1);b.dy=dy/(d||1);if(d<=step){b.x=target.x;b.y=target.y;b.index=(b.index+1)%b.route.length;if(target.stop){b.wait=80;b.stop=target.stop;}}else{b.x+=dx/d*step;b.y+=dy/d*step;}}
      let seat=0;for(const id of b.riders){const p=this.players.get(id),side=(seat%2?1:-1)*.3375,longitudinal=(Math.floor(seat/2)-2)*.53125;p.x=b.x+b.dy*side+b.dx*longitudinal;p.y=b.y-b.dx*side+b.dy*longitudinal;p.face=[b.dx,b.dy];p.dir=null;seat++;}
    }

    walkable(x, y) {
      x = Math.round(x); y = Math.round(y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) return false;
      return this.map.grid[y * this.map.w + x] !== T.WALL;
    }
    mobAt(x, y) { for (const m of this.mobs.values()) if (m.x === x && m.y === y) return m; return null; }
    playerAt(x, y, except) { for (const p of this.players.values()) if (p !== except && Math.hypot(p.x - x, p.y - y) < 0.55 && p.hp > 0) return p; return null; }
    canMove(p, x, y) {
      const r = 0.19;
      return [[-r,-r],[r,-r],[-r,r],[r,r]].every(([dx,dy]) => this.walkable(x+dx,y+dy)) &&
        !this.mobAt(Math.round(x), Math.round(y)) && !this.playerAt(x, y, p);
    }
    /* projectile hits use a radius: free-aim bullets travel through float positions, and 0.6
       covers tile-center crossings without hitting players a full tile off the path */
    playerHitAt(x, y, except, z) {
      for (const p of this.players.values()) {
        if (p === except || p.hp <= 0 || Math.hypot(p.x - x, p.y - y) >= 0.6) continue;
        if (z !== undefined && (z > (p.riding?2.25:(STANCE_TOP[p.stance] || 1.8)) || (p.riding&&z<.85))) continue; // over the profile - honest miss, not immunity
        return p;
      }
      return null;
    }
    mobHitAt(x, y, z) { for (const m of this.mobs.values()) if (Math.hypot(m.x - x, m.y - y) < 0.6 && (z === undefined || z <= 1.6)) return m; return null; }

    /* stance: lower profile = slower movement + a lower hit profile. Honest: shots
       aimed at the old head height pass over a crouched/prone target because the
       bullet has a real height, not because of any immunity. */
    setStance(id, st) {
      const p = this.players.get(id);
      if (!p || p.hp <= 0) return;
      if(p.riding)return;
      if (st === 'stand' || st === 'crouch' || st === 'prone') p.stance = st;
    }

    /* bounded jump: 0.6s visual arc + state flag, 1.2s cooldown, no effect while dead.
       The hit profile does NOT rise with the hop (STANCE_TOP only), so jump confers
       NO hit evasion - a flat shot still connects mid-air. */
    jump(id) {
      const p = this.players.get(id);
      if (!p || p.hp <= 0) return;
      if (p.jumpCd && p.jumpCd > this.tickCount) return;
      p.jumpUntil = this.tickCount + 6;
      p.jumpCd = this.tickCount + 12;
    }

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
        dir: null, dirTick: this.tickCount,
        face: spot.x === this.map.spawn.x && spot.y === this.map.spawn.y ? [0, -1] :
          (() => { const dx = this.map.spawn.x - spot.x, dy = this.map.spawn.y - spot.y;
            const n = Math.hypot(dx, dy); return [dx / n, dy / n]; })(),
        stance: 'stand',
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
      if (!p || p.hp <= 0) return;
      dx = Number.isFinite(dx) ? dx : 0; dy = Number.isFinite(dy) ? dy : 0;
      const len = Math.max(1, Math.hypot(dx, dy));
      dx /= len; dy /= len;
      p.dir = Math.hypot(dx, dy) > 0.01 ? { dx, dy } : null;
      p.dirTick = this.tickCount; // drop a held direction if input stops arriving
    }

    /* aim without moving: the shooter looks one way, walks another */
    face(id, dx, dy) {
      const p = this.players.get(id);
      if (!p) return;
      const len = Math.hypot(dx, dy);
      if (Number.isFinite(len) && len > 0.01) p.face = [dx / len, dy / len]; // exact free-aim vector; unit length keeps bullet speed constant
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
      x = Math.round(x); y = Math.round(y);
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
      p.dir = null;
      p.rebirthAt = 0;
      p.place = placeAt(this.map, p.x, p.y);
      this.events.push({ k: 'rebirth', id: p.id, name: p.name, town: st ? st.town : null });
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
       it hits a player, a monster, a wall, or its max range. PvP is ON:
       bullets damage other players (the requested friend shooter). */
    shoot(id, pitch) {
      const p = this.players.get(id);
      if(p?.riding)return false;
      if (!p || p.hp <= 0 || p.cd > 0) return false;
      p.cd = 6; // a shot recovers slower than a swing
      p.shots = (p.shots || 0) + 1;
      const [dx, dy] = p.face;
      const pc = Math.max(-0.9, Math.min(0.9, Number(pitch) || 0)); // same clamp as the client camera
      const jumping = p.jumpUntil && p.jumpUntil > this.tickCount;
      const z0 = (STANCE_EYE[p.stance] || 1.55) + (jumping ? 0.35 : 0); // shots leave from the real eye height
      this.projs.push({ id: this.nextProjId++, x: p.x, y: p.y, dx, dy, owner: id, ttl: 12,
        z: z0, dz: Math.tan(pc) * TILE_M /* 1 tile of travel per tick = 1.6 world units */ });
      this.events.push({ k: 'shot', id: p.id });
      return true;
    }

    tick() {
      this.tickCount++;
      this.tickBus();
      for (const p of this.players.values()) {
        if (p.hp <= 0) {
          if (p.rebirthAt && this.tickCount >= p.rebirthAt) this.rebirth(p);
          continue;
        }
        p.cd = Math.max(0, p.cd - 1);
        p.hurtCd = Math.max(0, p.hurtCd - 1);
        if (p.dir && this.tickCount - p.dirTick > 6) p.dir = null;
        if (p.dir && !p.riding) {
          const distance = (STANCE_SPEED[p.stance] || 4) / TILE_M / 10;
          const nx = p.x + p.dir.dx * distance, ny = p.y + p.dir.dy * distance;
          // Axis separation permits wall sliding without faster diagonal travel.
          if (this.canMove(p, nx, p.y)) p.x = nx;
          if (this.canMove(p, p.x, ny)) p.y = ny;
        }
        if(p.hp<p.maxHp)for(const kit of this.medkits||[]){if(this.tickCount>=kit.readyAt&&Math.hypot(p.x-kit.x,p.y-kit.y)<.75){p.hp=Math.min(p.maxHp,p.hp+30);kit.readyAt=this.tickCount+300;this.events.push({k:'heal',id:p.id});break;}}
        const tileIndex = Math.round(p.y) * this.map.w + Math.round(p.x);
        const t = this.map.grid[tileIndex];
        if (t === T.POTION) {
          p.hp = Math.min(p.maxHp, p.hp + 30);
          this.map.grid[tileIndex] = T.FLOOR;
          this.events.push({ k: 'heal', id: p.id });
        } else if (t === T.GOLD) {
          p.gold += 10 + this.floor * 2;
          this.map.grid[tileIndex] = T.FLOOR;
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
              this.finished += 1;
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
        if (pr.z === undefined) { pr.z = 1.55; pr.dz = 0; } // legacy flat bullets
        pr.z += pr.dz;
        if (pr.ttl <= 0 || pr.z <= 0) continue; // range or ground
        const bx = Math.round(pr.x), by = Math.round(pr.y);
        const bcode = (bx >= 0 && by >= 0 && bx < this.map.w && by < this.map.h) ? this.map.grid[by * this.map.w + bx] : T.WALL;
        if (bcode === T.WALL && pr.z < wallHeightAt(bx, by)) continue; // walls block below their real height; a rising shot can clear a low roofline
        const owner = this.players.get(pr.owner) || null;
        const hitP = this.playerHitAt(pr.x, pr.y, owner, pr.z);
        if (hitP) {
          if (owner) owner.shotHits = (owner.shotHits || 0) + 1;
          hitP.hp -= owner ? owner.dmg : 12;
          this.events.push({ k: 'shothit', x: pr.x, y: pr.y });
          if (hitP.hp <= 0) {
            hitP.deaths += 1;
            this.finished += 1;
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
        const hitM = this.mobHitAt(pr.x, pr.y, pr.z);
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
      const x0 = Math.max(0, Math.round(p.x) - r), x1 = Math.min(this.map.w - 1, Math.round(p.x) + r);
      const y0 = Math.max(0, Math.round(p.y) - r), y1 = Math.min(this.map.h - 1, Math.round(p.y) + r);
      const tiles = [];
      for (let y = y0; y <= y1; y++) {
        let row = '';
        for (let x = x0; x <= x1; x++) row += String.fromCharCode(48 + this.map.grid[y * this.map.w + x]);
        tiles.push(row);
      }
      const near = (e) => e.x >= x0 && e.x <= x1 && e.y >= y0 && e.y <= y1;
      const others = [];
      for (const q of this.players.values()) {
        // Room roster is independent of terrain culling; fog/walls still occlude models.
        if (q.id !== id) others.push({ id: q.id, n: q.name, x: q.x, y: q.y, hp: q.hp, mh: q.maxHp, hu: q.hue, dead: q.hp <= 0, f: q.face, j: q.jumpUntil > this.tickCount ? 1 : 0, st: q.stance, riding:!!q.riding });
      }
      const mobs = [];
      for (const m of this.mobs.values()) if (near(m)) mobs.push({ id: m.id, x: m.x, y: m.y, hp: m.hp, mh: m.maxHp });
      const projs = [];
      for (const pr of this.projs) if (near(pr)) projs.push({ x: pr.x, y: pr.y, dx: pr.dx, dy: pr.dy, z: pr.z });
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
        you: { id: p.id, x: p.x, y: p.y, hp: p.hp, mh: p.maxHp, gold: p.gold, kills: p.kills, deaths: p.deaths, hu: p.hue, dead: p.hp <= 0, f: p.face, j: p.jumpUntil > this.tickCount ? 1 : 0, st: p.stance, place: p.place || null, hits: p.hits || 0, swings: p.swings || 0, shots: p.shots || 0, shotHits: p.shotHits || 0 },
        view: { x0, y0, tiles, lane: tiles.map((line,row)=>Array.from(line,(_,col)=>this.map.shuttleMask?.[(y0+row)*this.map.w+x0+col]?'1':'0').join('')) },
        bus:this.bus?{x:this.bus.x,y:this.bus.y,dx:this.bus.dx,dy:this.bus.dy,wait:this.bus.wait,stop:this.bus.stop,riders:[...this.bus.riders],next:this.bus.route[(this.bus.index+1)%this.bus.route.length].stop||null}:null,
        riding:!!p.riding,
        medkits:(this.medkits||[]).filter(k=>near(k)&&this.tickCount>=k.readyAt).map(k=>({id:k.id,x:k.x,y:k.y})),
        others, mobs, projs, labels, ev: sharedEvents !== undefined ? sharedEvents : this.drainEvents(),
        party: this.players.size, alive: [...this.players.values()].filter((q) => q.hp > 0).length, finished: this.finished, motm: this.motm, target: this.targetKills,
      };
      return snap;
    }
  }

  return { nelliSeed, genDungeon, genAirportArena, placeAt, DenelliDelve, T, MAP_W, MAP_H, VIEW_RADIUS, MAIN_ROUTE, SUB_ROADS };
});
