/**
 * denelli-dungeon client — canvas renderer + input.
 * Connects to the same-WiFi host over WebSocket; if no host answers
 * (e.g. the static GitHub Pages demo), it runs a solo delve in-browser
 * using the exact same public/core.js rules.
 *
 * Copyright (c) 2026 shamil habeeb nelli (denelli). All rights reserved.
 */
(function () {
'use strict';

const C = window.DenelliCore;
const TILE_POTION = C.T.POTION, TILE_GOLD = C.T.GOLD, TILE_STAIRS = C.T.STAIRS, TILE_WALL = C.T.WALL,
      TILE_ROAD_MAIN = C.T.ROAD_MAIN, TILE_ROAD_SUB = C.T.ROAD_SUB;

const canvas = document.getElementById('denelli-arena');
const ctx = canvas.getContext('2d');
const el = (id) => document.getElementById(id);
const joinBox = el('nelli-join'), nameIn = el('nelli-name'), playBtn = el('nelli-play'),
      joinErr = el('nelli-join-err'), hud = el('nelli-hud'), feed = el('nelli-feed'),
      deathBox = el('nelli-death'), deathStats = el('nelli-death-stats'),
      respawnBtn = el('nelli-respawn'), stick = el('nelli-stick'), knob = el('nelli-knob'),
      shootBtn = el('nelli-shoot'), scopeBtn = el('nelli-scope'), scopeRet = el('nelli-scope-ret'), hpFill = el('nelli-hpfill'),
      killsEl = el('nelli-kills'), aliveEl = el('nelli-alive'), remainEl = el('nelli-remain'), downEl = el('nelli-down'),
      mapBtn = el('nelli-mapbtn'), setBtn = el('nelli-setbtn'), setPanel = el('nelli-settings'), opaIn = el('nelli-mapopa'),
      teamCard = el('nelli-teamcard'), tcCode = el('nelli-tc-code'), tcCopy = el('nelli-tc-copy'), tcX = el('nelli-tc-x'),
      setRoomRow = el('nelli-setroom-row'), setRoom = el('nelli-setroom'), setRoomCopy = el('nelli-setroom-copy'), bigmapCode = el('nelli-bigmap-code'),
      mmapCv = el('nelli-minimap'), bigmap = el('nelli-bigmap'), bigmapCv = el('nelli-bigmap-cv'),
      partyEl = el('nelli-party'), targetIn = el('nelli-target'),
      hostIn = el('nelli-host');

const roomIn = el('nelli-room');
const hostGoBtn = el('nelli-hostgo');
const sfx = (fn) => { try { if (window.NelliSfx && NelliSfx[fn]) NelliSfx[fn](); } catch (e) {} };
const soundBtns = [el('nelli-sound'), el('nelli-sound-hud')].filter(Boolean);
function paintSound() { const on = !window.NelliSfx || NelliSfx.isOn(); for (const b of soundBtns) b.textContent = on ? 'sound: on' : 'sound: off'; }
for (const b of soundBtns) b.addEventListener('click', () => { if (window.NelliSfx) { NelliSfx.set(!NelliSfx.isOn()); if (NelliSfx.isOn()) NelliSfx.unlock(); } paintSound(); });
paintSound();
/* the in-app WebSocket-server plugin exists only inside the Android app;
   in a plain browser the host button stays hidden */
const WSSERVER = (typeof Capacitor !== 'undefined' && Capacitor.Plugins && Capacitor.Plugins.WebsocketServer) || null;
hostGoBtn.classList.remove('nelli-hidden'); // in a browser, CREATE TEAM falls back to the computer host serving this page
/* players choose the max kill target on the join screen; 0 = no target */
function chosenTarget() { return Math.max(0, Math.min(999, Number(targetIn && targetIn.value) || 0)); }

let dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
}
resize();
addEventListener('resize', resize);

/* ---------------- session ---------------- */
const S = {
  mode: null,        // 'lan' | 'solo'
  ws: null,
  delve: null,       // solo-mode local game
  myId: null,
  state: null,
  slashFx: [],       // {x,y,until}
  muzzleFx: [],      // {x,y,f,until} gun flash at the barrel
  sparkFx: [],       // {x,y,until} bullet impact sparks
  joined: false,
  room: '',
};

function pushFeed(text) {
  const d = document.createElement('div');
  d.textContent = text;
  feed.appendChild(d);
  while (feed.children.length > 5) feed.removeChild(feed.firstChild);
  setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 4200);
}

function handleEvents(evs) {
  const now = performance.now();
  for (const e of evs || []) {
    if (e.k === 'shot') {
      const sp = locateEntity(e.id);
      if (sp) S.muzzleFx.push({ x: sp.x, y: sp.y, f: sp.f || [0, 1], until: now + 90 });
      sfx('shoot');
    } else if (e.k === 'shothit') {
      S.sparkFx.push({ x: e.x, y: e.y, until: now + 130 });
      sfx('hit');
    } else if (e.k === 'kill') { pushFeed(`${e.name} scored an elimination`); sfx('kill'); }
    else if (e.k === 'died') { pushFeed(`${e.name} was eliminated`); sfx('hurt'); }
    else if (e.k === 'hit' && e.id === S.myId) sfx('hurt');
    else if (e.k === 'join') pushFeed(`${e.name} joined the match`);
    else if (e.k === 'leave') pushFeed(`${e.name} left the match`);
    else if (e.k === 'descend') { sfx('stairs'); pushFeed(e.arena ? `${e.by} opened the way - squad enters the airport arena` : `${e.by} pushed ahead - squad moves to a new area`); }
    else if (e.k === 'respawn') pushFeed(`${e.name} is back in the fight`);
    else if (e.k === 'rebirth') { pushFeed(e.town ? `${e.name} reborn at ${e.town} police station` : `${e.name} reborn at the arena entry`); sfx('rebirth'); }
    else if (e.k === 'motm') pushFeed(`Man of the Match: ${e.name} - first to ${e.target} kills`);
    else if (e.k === 'place' && e.id === S.myId) pushFeed(`reached ${e.place}`);
    else if (e.k === 'heal' && e.id === S.myId) { pushFeed('medkit: +30 hp'); sfx('heal'); }
    else if (e.k === 'gold' && e.id === S.myId) { pushFeed('picked up supplies'); sfx('gold'); }
  }
}

function locateEntity(id) {
  if (!S.state) return null;
  if (S.state.you.id === id) return S.state.you;
  for (const o of S.state.others) if (o.id === id) return o;
  return null;
}

function applyState(st) {
  S.state = st;
  handleEvents(st.ev);
  if (st.you.dead && deathBox.classList.contains('nelli-hidden')) {
    deathStats.textContent = `${st.you.kills} kills`;
    deathBox.classList.remove('nelli-hidden');
  } else if (!st.you.dead) {
    deathBox.classList.add('nelli-hidden');
  }
}

/* ---------------- online mode: room server, code-only join ----------------
   The app ships with the room-server URL built in; nobody types an IP.
   A browser opened against a computer host keeps talking to that host. */
const SERVER_URL_DEFAULT = 'wss://nexora-rooms.onrender.com'; // live Render free instance (srv-dbvgm5ou01pc73dppe9g, Singapore)
function serverUrl() {
  try { const o = localStorage.getItem('nexora-server'); if (o) return o; } catch (e) {}
  if (!WSSERVER && /^https?:$/.test(location.protocol) && !/(^|\.)render\.com$/.test(location.hostname)) {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  }
  return SERVER_URL_DEFAULT;
}
function connectOnline(name, mode) { // mode: 'create' | 'join'
  const room = mode === 'join' ? (roomIn && roomIn.value || '').trim().toUpperCase() : '';
  if (mode === 'join' && room.length < 4) { joinErr.textContent = 'enter the 4-letter team code from your friend'; return; }
  joinBox.classList.remove('nelli-hidden');
  joinErr.textContent = 'connecting to game server…';
  const ws = new WebSocket(serverUrl());
  S.ws = ws;
  let welcomed = false, opened = false;
  const wakeTimer = setTimeout(() => {
    if (!welcomed) joinErr.textContent = 'game server is waking up - first start can take up to a minute…';
  }, 6000);
  const failTimer = setTimeout(() => {
    if (!welcomed) {
      try { ws.close(); } catch (e) {}
      joinErr.textContent = 'server unreachable - check internet and try again';
    }
  }, 75000);
  ws.onopen = () => {
    opened = true;
    joinErr.textContent = mode === 'create' ? 'creating team…' : `finding team ${room}…`;
    ws.send(JSON.stringify(mode === 'create'
      ? { t: 'create', name, target: chosenTarget() }
      : { t: 'join', name, target: chosenTarget(), room }));
  };
  ws.onmessage = (m) => {
    let msg;
    try { msg = JSON.parse(m.data); } catch (e) { return; }
    if (msg.t === 'welcome') {
      welcomed = true;
      clearTimeout(wakeTimer); clearTimeout(failTimer);
      S.room = msg.room || '';
      S.mode = 'online';
      S.myId = msg.id;
      startPlay(S.room ? `online team · code ${S.room}` : 'online team');
      if (S.room) { pushFeed(`team code ${S.room} - friends join with this code`); showTeamCard(S.room); }
    } else if (msg.t === 'error') {
      clearTimeout(wakeTimer); clearTimeout(failTimer);
      joinErr.textContent = msg.msg || 'could not join - try again';
      joinBox.classList.remove('nelli-hidden');
      try { ws.close(); } catch (e) {}
    } else if (msg.t === 'state') applyState(msg);
  };
  ws.onerror = () => {
    if (!welcomed) joinErr.textContent = opened
      ? 'connection error after reaching the server - try again'
      : 'cannot reach the game server - is the internet on?';
  };
  ws.onclose = () => {
    clearTimeout(wakeTimer); clearTimeout(failTimer);
    if (!welcomed) { joinBox.classList.remove('nelli-hidden'); return; }
    if (S.mode === 'online') {
      pushFeed('lost connection to the server');
      joinErr.textContent = 'server connection lost - rejoin with the same team code';
      joinBox.classList.remove('nelli-hidden');
      S.mode = null;
    }
  };
}

/* ---------------- LAN mode ---------------- */
function connectLan(name) {
  // app mode: the join screen can carry a host address (the device running
  // server.js on the same WiFi). Empty = same origin as the page (browser play).
  const hostInput = (hostIn && hostIn.value || '').trim();
  const explicit = !!hostInput;
  const target = explicit
    ? `ws://${hostInput.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}${hostInput.includes(':') ? '' : ':8080'}`
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  const ws = new WebSocket(target);
  S.ws = ws;
  let welcomed = false;
  const failTimer = setTimeout(() => { if (!welcomed) { try { ws.close(); } catch (e) {} } }, 2500);

  const noHost = () => {
    clearTimeout(failTimer);
    if (explicit) {
      joinErr.textContent = `no host found at ${hostInput} - is server.js running there on the same WiFi?`;
      joinBox.classList.remove('nelli-hidden');
    } else startSolo(name);
  };

  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name, target: chosenTarget(), room: roomIn && roomIn.value || '' }));
  ws.onmessage = (m) => {
    let msg;
    try { msg = JSON.parse(m.data); } catch (e) { return; }
    if (msg.t === 'welcome') {
      welcomed = true;
      S.room = msg.room || '';
      if (!S.room && roomIn && roomIn.value.trim()) pushFeed('room codes need a computer host - joined the game directly');
      clearTimeout(failTimer);
      S.mode = 'lan';
      S.myId = msg.id;
      const fm = location.hash.match(/floor(\d+)/); // local test hook, needs server env opt-in
      if (fm) ws.send(JSON.stringify({ t: 'debug_floor', n: Number(fm[1]) }));
      const tp = location.hash.match(/tp(\d+)-(\d+)/); // same opt-in: teleport near (x, y)
      if (tp) ws.send(JSON.stringify({ t: 'debug_teleport', x: Number(tp[1]), y: Number(tp[2]) }));
      startPlay(explicit ? `LAN party · host ${hostInput}` : 'LAN party · same WiFi');
    } else if (msg.t === 'state') applyState(msg);
  };
  ws.onerror = () => { if (!welcomed) noHost(); };
  ws.onclose = () => {
    clearTimeout(failTimer);
    if (!welcomed) { noHost(); return; }
    if (S.mode === 'lan') {
      pushFeed('lost connection to the host');
      joinErr.textContent = 'host connection lost — re-enter to play solo or rejoin';
      joinBox.classList.remove('nelli-hidden');
      S.mode = null;
    }
  };
}

/* ---------------- solo mode (static hosting / no host found) ---------------- */
function startSolo(name) {
  const delve = new C.DenelliDelve((Date.now() ^ 0xd3e11) >>> 0);
  delve.targetKills = chosenTarget();
  S.delve = delve;
  const me = delve.addPlayer(name);
  S.myId = me.id;
  S.mode = 'solo';
  startPlay('solo match · no host found');
  setInterval(() => {
    delve.tick();
    const snap = delve.snapshotFor(me.id);
    if (snap) applyState(snap);
  }, 100);
}

/* ---------------- host mode: THIS phone runs the game ----------------
   The shared sim (core.js) hosts the delve in-page; the app's native
   WebSocket-server plugin accepts the other phones. One game per hosting
   phone (no room codes here - rooms live on the computer host). */
async function startHost(name) {
  if (!WSSERVER) return;
  const delve = new C.DenelliDelve((Date.now() ^ 0xd3e11) >>> 0);
  delve.targetKills = chosenTarget();
  S.delve = delve;
  const byUuid = new Map(); // connection uuid -> player id
  const byPid = new Map();  // player id -> connection uuid
  S.remotes = byUuid;
  const me = delve.addPlayer(name);
  S.myId = me.id;
  const wsend = (uuid, obj) => { WSSERVER.send({ uuid, message: JSON.stringify(obj) }).catch(() => {}); };

  WSSERVER.addListener('onMessage', (ev) => {
    if (ev.isBinary) return;
    let msg; try { msg = JSON.parse(ev.message); } catch (e) { return; }
    const pid = byUuid.get(ev.uuid);
    if (pid === undefined) {
      if (msg.t !== 'join') return;
      const tgt = Math.max(0, Math.min(999, Number(msg.target) || 0));
      if (tgt && !delve.motm) delve.targetKills = tgt; // first joiner with a target sets it
      const p = delve.addPlayer(msg.name);
      byUuid.set(ev.uuid, p.id); byPid.set(p.id, ev.uuid);
      wsend(ev.uuid, { t: 'welcome', id: p.id, floor: delve.floor, room: '',
        w: delve.map.w, h: delve.map.h, seed: (delve.seedBase + delve.floor * 7919) >>> 0 });
      return;
    }
    if (msg.t === 'dir') delve.setDir(pid, Number(msg.dx) || 0, Number(msg.dy) || 0);
    else if (msg.t === 'face') delve.face(pid, Number(msg.dx) || 0, Number(msg.dy) || 0);
    else if (msg.t === 'shoot') delve.shoot(pid);
    else if (msg.t === 'respawn') delve.respawn(pid);
  });
  WSSERVER.addListener('onClose', (ev) => {
    const pid = byUuid.get(ev.uuid);
    if (pid !== undefined) { delve.removePlayer(pid); byUuid.delete(ev.uuid); byPid.delete(pid); }
  });
  WSSERVER.addListener('onFailure', (ev) => {
    pushFeed('host server stopped: ' + (ev.reason || 'unknown'));
  });

  let info;
  try { info = await WSSERVER.start({ port: 8080, tcpNoDelay: true }); }
  catch (e) { joinErr.textContent = 'could not start hosting on this phone'; return; }
  let addr = '';
  try {
    const ifs = await WSSERVER.getInterfaces();
    const names = Object.keys(ifs);
    // prefer the WiFi/hotspot interface; a phone may also show a cellular IP
    const ordered = [...names.filter((k) => /^(wlan|ap|swlan|wifi)/i.test(k)), ...names.filter((k) => !/^(wlan|ap|swlan|wifi)/i.test(k))];
    for (const k of ordered) {
      const v4 = (ifs[k].ipv4Addresses || []).find((a) => !a.startsWith('127.'));
      if (v4) { addr = v4; break; }
    }
  } catch (e) {}
  S.mode = 'host';
  startPlay(addr ? `hosting · friends join ${addr}:${info.port}` : 'hosting on this phone');
  setInterval(() => {
    delve.tick();
    const evs = delve.drainEvents(); // one shared feed for everyone this round
    for (const [uuid, pid] of byUuid) {
      const snap = delve.snapshotFor(pid, evs);
      if (snap) wsend(uuid, snap);
    }
    const mine = delve.snapshotFor(me.id, evs);
    if (mine) applyState(mine);
  }, 100);
}
hostGoBtn.addEventListener('click', () => {
  const name = (nameIn.value || '').trim().slice(0, 14) || 'host';
  try { localStorage.setItem('denelli-name', name); } catch (e) {}
  sfx('unlock');
  if (location.protocol === 'file:') { startSolo(name); return; }
  connectOnline(name, 'create');
});

function startPlay(label) {
  joinBox.classList.add('nelli-hidden');
  hud.classList.remove('nelli-hidden');
  if (window.NelliFps) {
    NelliFps.onAds = (on) => {
      if (scopeRet) scopeRet.classList.toggle('nelli-hidden', !on);
      if (scopeBtn) scopeBtn.classList.toggle('nelli-on', on);
      const ch = el('nelli-crosshair'); if (ch) ch.classList.toggle('nelli-hidden', on);
    };
    NelliFps.init(document.body).then((ok) => {
      if (!ok) return;
      canvas.style.display = 'none';
      const ch = el('nelli-crosshair'); if (ch) ch.classList.remove('nelli-hidden');
      const st = S.state; if (st && st.you) NelliFps.setYawFromFace(st.you.f);
    });
  }
  if ('ontouchstart' in window) { stick.classList.remove('nelli-hidden'); shootBtn.classList.remove('nelli-hidden'); scopeBtn.classList.remove('nelli-hidden'); }
  const sh = el('nelli-sound-hud'); if (sh) sh.classList.remove('nelli-hidden');
  if (mmapCv) mmapCv.classList.remove('nelli-hidden');
  if (mapBtn) mapBtn.classList.remove('nelli-hidden');
  if (setBtn) setBtn.classList.remove('nelli-hidden');
  S.joined = true;
  pushFeed(label);
}

/* ---------------- input ---------------- */
function wsSend(obj) {
  if ((S.mode === 'lan' || S.mode === 'online') && S.ws && S.ws.readyState === 1) { S.ws.send(JSON.stringify(obj)); return true; }
  return false;
}
function sendDir(dx, dy) {
  curMoveDir = [dx, dy];
  if (wsSend({ t: 'dir', dx, dy })) return;
  if (S.mode === 'solo' || S.mode === 'host') S.delve.setDir(S.myId, dx, dy);
}
function sendShoot() {
  aimThen(() => {
    if (wsSend({ t: 'shoot' })) return;
    if (S.mode === 'solo' || S.mode === 'host') S.delve.shoot(S.myId);
  });
}
/* Aim: the server takes a {t:'face'} message that turns a player without
   moving them, so a stationary shooter shoots along the crosshair. */
let curMoveDir = null;
function rotateByYaw(dx, dy) {
  if (!window.NelliFps || !NelliFps.ready || (!dx && !dy)) return [dx, dy];
  const yaw = NelliFps.yaw;
  const fx = Math.sin(yaw), fy = -Math.cos(yaw);   // crosshair forward, map coords
  const rx = Math.cos(yaw), ry = Math.sin(yaw);    // strafe right
  const mx = fx * (-dy) + rx * dx;
  const my = fy * (-dy) + ry * dx;
  return Math.abs(mx) >= Math.abs(my) ? [Math.sign(mx) || 0, 0] : [0, Math.sign(my) || 0];
}
function aimThen(fn) {
  if (!window.NelliFps || !NelliFps.ready || (S.mode !== 'lan' && S.mode !== 'online')) { fn(); return; }
  if (curMoveDir && (curMoveDir[0] || curMoveDir[1])) { fn(); return; } // moving: facing already tracks travel
  const [ax, ay] = NelliFps.aimVec();
  if (!wsSend({ t: 'face', dx: ax, dy: ay })) { // solo/host: aim the local sim directly
    if ((S.mode === 'solo' || S.mode === 'host') && S.delve) S.delve.face(S.myId, ax, ay);
  }
  fn(); // face travels on the same socket ahead of the shot, so the server applies it first
}
function sendRespawn() {
  if (S.mode === 'lan' && S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify({ t: 'respawn' }));
  else if (S.mode === 'solo' || S.mode === 'host') S.delve.respawn(S.myId);
}

const keys = {};
const DIRS = { ArrowUp: [0, -1], w: [0, -1], W: [0, -1], ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
               ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0], ArrowRight: [1, 0], d: [1, 0], D: [1, 0] };
function keyDir() {
  for (const k of ['ArrowUp', 'w', 'W', 'ArrowDown', 's', 'S', 'ArrowLeft', 'a', 'A', 'ArrowRight', 'd', 'D']) {
    if (keys[k]) return DIRS[k];
  }
  return null;
}
addEventListener('keydown', (e) => {
  if (!S.joined) return;
  if (e.key === ' ') { e.preventDefault(); sendShoot(); return; }
  if (e.key === 'k' || e.key === 'K' || e.key === 'l' || e.key === 'L') { e.preventDefault(); sendShoot(); return; }
  if (DIRS[e.key] !== undefined) {
    e.preventDefault();
    keys[e.key] = true;
    const d = keyDir();
    if (d) { const r = rotateByYaw(d[0], d[1]); sendDir(r[0], r[1]); }
  }
});
addEventListener('keyup', (e) => {
  if (DIRS[e.key] === undefined) return;
  keys[e.key] = false;
  const d = keyDir();
  const r = d ? rotateByYaw(d[0], d[1]) : [0, 0];
  sendDir(r[0], r[1]);
});

/* touch joystick: dominant axis */
let stickTouch = null;
function stickVec(t, rect) {
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  const dx = t.clientX - cx, dy = t.clientY - cy;
  const mag = Math.hypot(dx, dy);
  const k = Math.min(mag, 34);
  knob.style.transform = `translate(${(mag ? dx / mag * k : 0)}px, ${(mag ? dy / mag * k : 0)}px)`;
  if (mag < 10) return [0, 0];
  return Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
}
stick.addEventListener('touchstart', (e) => {
  e.preventDefault();
  stickTouch = e.changedTouches[0].identifier;
  const v = stickVec(e.changedTouches[0], stick.getBoundingClientRect());
  const r = rotateByYaw(v[0], v[1]);
  sendDir(r[0], r[1]);
}, { passive: false });
stick.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) if (t.identifier === stickTouch) {
    const v = stickVec(t, stick.getBoundingClientRect());
    const r = rotateByYaw(v[0], v[1]);
    sendDir(r[0], r[1]);
  }
}, { passive: false });
const stickEnd = (e) => {
  for (const t of e.changedTouches) if (t.identifier === stickTouch) {
    stickTouch = null;
    knob.style.transform = 'translate(0px, 0px)';
    sendDir(0, 0);
  }
};
stick.addEventListener('touchend', stickEnd);
stick.addEventListener('touchcancel', stickEnd);
shootBtn.addEventListener('touchstart', (e) => { e.preventDefault(); sendShoot(); }, { passive: false });
shootBtn.addEventListener('mousedown', (e) => { e.preventDefault(); sendShoot(); });
const scopeSet = (on) => (e) => { e.preventDefault(); if (window.NelliFps && NelliFps.ready) NelliFps.setAds(on); };
scopeBtn.addEventListener('touchstart', scopeSet(true), { passive: false });
scopeBtn.addEventListener('touchend', scopeSet(false), { passive: false });
scopeBtn.addEventListener('touchcancel', scopeSet(false), { passive: false });
scopeBtn.addEventListener('mousedown', scopeSet(true));
scopeBtn.addEventListener('mouseup', scopeSet(false));

playBtn.addEventListener('click', () => {
  sfx('unlock');
  const name = (nameIn.value || '').trim() || 'player';
  try { localStorage.setItem('denelli-name', name); } catch (e) {}
  joinErr.textContent = '';
  if (location.protocol === 'file:') { startSolo(name); return; }
  connectOnline(name, 'join');
});
nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') playBtn.click(); });
respawnBtn.addEventListener('click', () => { deathBox.classList.add('nelli-hidden'); sendRespawn(); });
try { nameIn.value = localStorage.getItem('denelli-name') || ''; } catch (e) {}

/* ---------------- render: hand-drawn canvas sprites ---------------- */
const SPR = 32;
function spr(paint) {
  const c = document.createElement('canvas');
  c.width = SPR; c.height = SPR;
  paint(c.getContext('2d'));
  return c;
}
const hash2 = (x, y) => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 100;

const tileSprites = {
  floorA: spr((g) => {
    g.fillStyle = '#2b2148'; g.fillRect(0, 0, SPR, SPR);
    g.strokeStyle = 'rgba(10,6,20,.55)'; g.lineWidth = 2;
    g.strokeRect(1, 1, SPR - 2, SPR - 2);
    g.fillStyle = 'rgba(255,255,255,.05)';
    for (let i = 0; i < 7; i++) g.fillRect((i * 13 + 5) % 30, (i * 19 + 7) % 30, 2, 2);
    g.fillStyle = 'rgba(0,0,0,.18)';
    for (let i = 0; i < 5; i++) g.fillRect((i * 17 + 11) % 30, (i * 11 + 3) % 30, 2, 2);
  }),
  floorB: spr((g) => {
    g.fillStyle = '#261d40'; g.fillRect(0, 0, SPR, SPR);
    g.strokeStyle = 'rgba(10,6,20,.55)'; g.lineWidth = 2;
    g.strokeRect(1, 1, SPR - 2, SPR - 2);
    g.fillStyle = 'rgba(255,255,255,.04)';
    for (let i = 0; i < 6; i++) g.fillRect((i * 11 + 9) % 30, (i * 23 + 2) % 30, 2, 2);
    g.fillStyle = 'rgba(0,0,0,.2)';
    for (let i = 0; i < 6; i++) g.fillRect((i * 7 + 4) % 30, (i * 13 + 9) % 30, 2, 2);
  }),
  wall: spr((g) => {
    g.fillStyle = '#0e0a18'; g.fillRect(0, 0, SPR, SPR);
    g.fillStyle = '#1d1530';
    for (let r = 0; r < 4; r++) {
      const off = (r % 2) * 8;
      for (let b = -1; b < 3; b++) g.fillRect(b * 16 + off + 1, r * 8 + 1, 14, 6);
    }
    g.fillStyle = 'rgba(150,110,255,.16)'; g.fillRect(0, 0, SPR, 3);
  }),
  stairs: spr((g) => {
    g.fillStyle = '#120c22'; g.fillRect(0, 0, SPR, SPR);
    for (let s = 0; s < 4; s++) {
      g.fillStyle = `rgb(${70 - s * 12}, ${55 - s * 10}, ${110 - s * 18})`;
      g.fillRect(4 + s * 3, 5 + s * 6, SPR - 8 - s * 6, 5);
    }
    g.strokeStyle = 'rgba(183,155,255,.5)'; g.lineWidth = 2;
    g.strokeRect(2, 3, SPR - 4, SPR - 5);
  }),
  potion: spr((g) => {
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(16, 26, 8, 3, 0, 0, 7); g.fill();
    g.fillStyle = '#d8d4e8'; g.fillRect(13, 5, 6, 5);                 // neck
    g.fillStyle = '#8a5a3b'; g.fillRect(12, 3, 8, 3);                 // cork
    g.fillStyle = 'rgba(200,210,255,.35)';                             // glass
    g.beginPath(); g.arc(16, 18, 9, 0, 7); g.fill();
    g.fillStyle = '#ff4f7e';                                           // liquid
    g.beginPath(); g.arc(16, 20, 7, 0.15 * Math.PI, 0.85 * Math.PI); g.fill();
    g.fillRect(9, 18, 14, 7);
    g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(12, 12, 2, 5);   // shine
  }),
  gold: spr((g) => {
    const coin = (x, y) => {
      g.fillStyle = '#a87708'; g.beginPath(); g.arc(x, y, 5.5, 0, 7); g.fill();
      g.fillStyle = '#ffd24d'; g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.fill();
      g.fillStyle = '#fff0b0'; g.fillRect(x - 2, y - 2, 2, 2);
    };
    coin(12, 20); coin(20, 21); coin(16, 14);
  }),
  /* route-floor (highway) theme */
  terrain: spr((g) => {
    /* kerala green: layered grass and canopy shadows under the palms drawn per-tile */
    g.fillStyle = '#24401c'; g.fillRect(0, 0, SPR, SPR);
    g.fillStyle = 'rgba(38,66,26,.9)';
    for (let i = 0; i < 6; i++) g.fillRect((i * 11 + 3) % 29, (i * 17 + 5) % 29, 3, 3);
    g.fillStyle = 'rgba(84,128,58,.45)'; // sunlit grass patches
    for (let i = 0; i < 5; i++) g.fillRect((i * 13 + 9) % 27, (i * 7 + 11) % 27, 4, 4);
    g.fillStyle = 'rgba(20,34,14,.7)'; // deep canopy shadow
    for (let i = 0; i < 4; i++) g.fillRect((i * 19 + 6) % 26, (i * 23 + 2) % 26, 4, 4);
    g.fillStyle = 'rgba(122,84,50,.5)'; // red-earth patches
    for (let i = 0; i < 3; i++) g.fillRect((i * 17 + 4) % 28, (i * 11 + 14) % 28, 3, 2);
  }),
  asphalt: spr((g) => {
    /* weathered bitumen: warm dark grey so it stands apart from the dusty lots */
    g.fillStyle = '#57524a'; g.fillRect(0, 0, SPR, SPR);
    g.fillStyle = 'rgba(255,255,255,.06)';
    for (let i = 0; i < 6; i++) g.fillRect((i * 13 + 4) % 30, (i * 11 + 8) % 30, 2, 1);
    g.fillStyle = 'rgba(0,0,0,.22)';
    for (let i = 0; i < 5; i++) g.fillRect((i * 17 + 10) % 30, (i * 7 + 3) % 30, 2, 2);
  }),
  shoulder: spr((g) => {
    g.fillStyle = '#3b362d'; g.fillRect(0, 0, SPR, SPR); // gravel verge beside the highway
    g.fillStyle = 'rgba(255,255,255,.07)';
    for (let i = 0; i < 7; i++) g.fillRect((i * 9 + 5) % 29, (i * 14 + 3) % 29, 2, 2);
    g.fillStyle = 'rgba(0,0,0,.3)';
    for (let i = 0; i < 6; i++) g.fillRect((i * 15 + 8) % 29, (i * 10 + 6) % 29, 2, 2);
  }),
  shoulder: spr((g) => {
    g.fillStyle = '#5a4a34'; g.fillRect(0, 0, SPR, SPR); // dusty red-brown verge beside the highway
    g.fillStyle = 'rgba(255,255,255,.06)';
    for (let i = 0; i < 7; i++) g.fillRect((i * 9 + 5) % 29, (i * 14 + 3) % 29, 2, 2);
    g.fillStyle = 'rgba(0,0,0,.3)';
    for (let i = 0; i < 6; i++) g.fillRect((i * 15 + 8) % 29, (i * 10 + 6) % 29, 2, 2);
    g.fillStyle = 'rgba(96,124,60,.5)'; // grass creeping onto the verge
    for (let i = 0; i < 4; i++) g.fillRect((i * 21 + 2) % 28, (i * 8 + 12) % 28, 3, 3);
  }),
  paveA: spr((g) => {
    g.fillStyle = '#7d6f52'; g.fillRect(0, 0, SPR, SPR); // sun-baked town lot
    g.strokeStyle = 'rgba(40,32,20,.35)'; g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, SPR - 1, SPR - 1);
    g.fillStyle = 'rgba(255,255,255,.05)';
    for (let i = 0; i < 5; i++) g.fillRect((i * 11 + 6) % 30, (i * 19 + 4) % 30, 2, 2);
  }),
  paveB: spr((g) => {
    g.fillStyle = '#6f6248'; g.fillRect(0, 0, SPR, SPR);
    g.strokeStyle = 'rgba(40,32,20,.35)'; g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, SPR - 1, SPR - 1);
    g.fillStyle = 'rgba(0,0,0,.15)';
    for (let i = 0; i < 5; i++) g.fillRect((i * 7 + 9) % 30, (i * 13 + 2) % 30, 2, 2);
  }),
};

/* coconut palm canopy over terrain, world-hashed so it never tiles uniformly */
function drawPalmCluster(g, px, py, ts, wx, wy) {
  const h = hash2(wx, wy);
  if (h % 100 >= 62) return; // some tiles stay clear grass
  const n = 1 + (h >> 8) % 2;
  for (let i = 0; i < n; i++) {
    const hh = hash2(wx * 3 + i, wy * 5 + i);
    const cx = px + ts * (0.3 + (hh % 40) / 100), cy = py + ts * (0.3 + ((hh >> 6) % 40) / 100);
    const r = ts * 0.30;
    g.fillStyle = 'rgba(12,22,10,.55)';
    g.beginPath(); g.arc(cx + r * 0.25, cy + r * 0.3, r * 1.05, 0, 7); g.fill(); // canopy shadow
    g.fillStyle = '#1e3d16';
    for (let f = 0; f < 6; f++) {
      const a = (Math.PI * 2 * f) / 6 + (hh % 10) / 20;
      g.beginPath();
      g.ellipse(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.72, r * 0.34, a, 0, 7);
      g.fill();
    }
    g.fillStyle = '#2e5420'; // sunlit frond tops
    for (let f = 0; f < 3; f++) {
      const a = -0.6 + f * 1.5 + (hh % 7) / 25;
      g.beginPath();
      g.ellipse(cx + Math.cos(a) * r * 0.4, cy + Math.sin(a) * r * 0.4 - r * 0.1, r * 0.5, r * 0.22, a, 0, 7);
      g.fill();
    }
  }
}

/* roadside buildings as a roofscape, like the rooftops in the satellite reference:
   terracotta pitched roofs, weathered concrete flat roofs, packed along the road */
function drawFacade(g, px, py, ts, wx, wy) {
  const h = hash2(wx, wy);
  const pitched = h % 3 === 0; // one in three keeps a terracotta pitched roof
  g.fillStyle = 'rgba(0,0,0,.45)'; // drop shadow on the ground side
  g.fillRect(px + ts * 0.06, py + ts * 0.08, ts - 2, ts - 2);
  if (pitched) {
    const shade = ['#a2543a', '#96482f', '#8f5638'][h % 3];
    g.fillStyle = shade;
    g.fillRect(px + 1, py + 1, ts - 4, ts - 4);
    g.strokeStyle = 'rgba(60,24,12,.6)'; g.lineWidth = Math.max(1, ts * 0.04);
    g.beginPath(); g.moveTo(px + 2, py + ts / 2); g.lineTo(px + ts - 4, py + ts / 2); g.stroke(); // ridge
    g.strokeStyle = 'rgba(255,220,190,.18)';
    for (let i = 1; i < 4; i++) {
      g.beginPath(); g.moveTo(px + 2, py + (ts * i) / 4); g.lineTo(px + ts - 4, py + (ts * i) / 4); g.stroke();
    }
  } else {
    const conc = ['#9a9184', '#8d8a7c', '#a39a88', '#948a76'][h % 4];
    g.fillStyle = conc;
    g.fillRect(px + 1, py + 1, ts - 4, ts - 4);
    g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = Math.max(1, ts * 0.045);
    g.strokeRect(px + 1.5, py + 1.5, ts - 5, ts - 5); // parapet
    g.fillStyle = 'rgba(0,0,0,.28)';
    g.fillRect(px + ts * 0.2, py + ts * 0.2, ts * 0.3, ts * 0.3); // stair head / patching
    g.fillStyle = '#1c1e22';
    g.beginPath(); g.arc(px + ts * 0.7, py + ts * 0.68, ts * 0.09, 0, 7); g.fill(); // water tank
    g.fillStyle = 'rgba(255,255,255,.25)';
    g.fillRect(px + ts * 0.66, py + ts * 0.62, ts * 0.05, ts * 0.05);
  }
  if (h % 4 === 1) { // striped shop awning on some buildings
    for (let s = 0; s < 4; s++) {
      g.fillStyle = s % 2 ? '#c8452e' : '#e8e2d2';
      g.fillRect(px + 1 + (s * (ts - 4)) / 4, py + ts - ts * 0.16, (ts - 4) / 4, ts * 0.12);
    }
  }
}

/* highway lane markings over asphalt */
function drawRoadMarks(g, px, py, ts, wx, wy, t, tileAt) {
  const open = (tt) => tt !== 0; // any walkable tile (out-of-window -1 counts open)
  const road = (tt) => tt === TILE_ROAD_MAIN || tt === TILE_ROAD_SUB;
  const L = tileAt(wx - 1, wy), R = tileAt(wx + 1, wy), U = tileAt(wx, wy - 1), D = tileAt(wx, wy + 1);
  const Lr = road(L), Rr = road(R), Ur = road(U), Dr = road(D);
  if (Lr && Rr && Ur && Dr) { // true crossing (band interior never has all four): swept apron
    g.fillStyle = 'rgba(112,106,94,.9)';
    g.fillRect(px, py, ts, ts);
    g.fillStyle = 'rgba(0,0,0,.15)';
    g.fillRect(px + ts * 0.3, py + ts * 0.3, ts * 0.4, ts * 0.4); // worn centre patch
    return;
  }
  /* band orientation: the main highway is two tiles wide, so a straight band tile
     still sees one road tile across the band; direction comes from the through-road */
  let horiz;
  if (Ur && Dr) horiz = false;       // through-road runs vertically
  else if (Lr && Rr) horiz = true;   // through-road runs horizontally
  else if (Ur || Dr) horiz = false;  // single-width vertical road
  else horiz = true;                 // single-width horizontal road
  const vert = !horiz;
  /* wheel-track darkening: two worn strips where traffic runs */
  g.fillStyle = 'rgba(0,0,0,.16)';
  if (horiz) { g.fillRect(px, py + ts * 0.22, ts, ts * 0.16); g.fillRect(px, py + ts * 0.62, ts, ts * 0.16); }
  else { g.fillRect(px + ts * 0.22, py, ts * 0.16, ts); g.fillRect(px + ts * 0.62, py, ts * 0.16, ts); }
  const lw = Math.max(1.5, ts * 0.05);
  const lwMain = Math.max(2, ts * 0.07);
  if (t === TILE_ROAD_MAIN) {
    g.fillStyle = 'rgba(235,238,240,.85)'; // solid white edge lines
    if (horiz) {
      if (U === 0) g.fillRect(px, py + ts * 0.05, ts, lwMain);
      if (D === 0) g.fillRect(px, py + ts * 0.9, ts, lwMain);
    } else {
      if (L === 0) g.fillRect(px + ts * 0.05, py, lwMain, ts);
      if (R === 0) g.fillRect(px + ts * 0.9, py, lwMain, ts);
    }
    g.fillStyle = '#f2c938'; // yellow centre dashes, on the band's centre seam
    if (horiz) {
      if (wx % 2 !== 0) return;
      const cy = road(D) ? py + ts - lwMain / 2 : road(U) ? py + lwMain / 2 : py + ts / 2;
      g.fillRect(px, cy - lwMain / 2, ts, lwMain);
    } else {
      if (wy % 2 !== 0) return;
      const cx = road(R) ? px + ts - lwMain / 2 : road(L) ? px + lwMain / 2 : px + ts / 2;
      g.fillRect(cx - lwMain / 2, py, lwMain, ts);
    }
  } else {
    g.fillStyle = 'rgba(230,233,236,.6)'; // sub road: thin white dashes
    if (horiz) {
      if (wx % 2 === 0) g.fillRect(px + ts * 0.15, py + ts / 2 - lw / 2, ts * 0.7, lw);
    } else if (wy % 2 === 0) {
      g.fillRect(px + ts / 2 - lw / 2, py + ts * 0.15, lw, ts * 0.7);
    }
  }
}

/* landmark exterior glyphs for the route floor */
function drawFlyoverGlyph(g, px, py, ts) {
  const dw = ts * 2.4, dh = ts * 0.5, bx = px - dw / 2 + ts / 2, by = py + ts * 0.65;
  g.fillStyle = '#565b66';
  g.fillRect(bx + ts * 0.12, by, ts * 0.2, ts * 0.7);
  g.fillRect(bx + dw - ts * 0.32, by, ts * 0.2, ts * 0.7);
  g.fillStyle = '#3c414c';
  g.beginPath();
  if (g.roundRect) g.roundRect(bx, by - dh, dw, dh, ts * 0.1); else g.rect(bx, by - dh, dw, dh);
  g.fill();
  g.strokeStyle = '#9aa2b0'; g.lineWidth = Math.max(1.5, ts * 0.045); g.stroke();
  g.fillStyle = '#e9c33c';
  for (let k = 0; k < 3; k++) g.fillRect(bx + dw * (0.1 + k * 0.33), by - dh / 2 - 1.5, dw * 0.18, 3);
}
function drawPoliceGlyph(g, px, py, ts) {
  const bw = ts * 1.8, bh = ts * 1.3, bx = px - bw / 2 + ts / 2, by = py - ts * 0.15;
  g.fillStyle = '#3d5a99'; g.fillRect(bx, by, bw, bh);
  g.fillStyle = '#dfe8ff'; g.fillRect(bx, by, bw, ts * 0.28); // sign band
  g.fillStyle = '#22355e';
  for (let i = 0; i < 3; i++) g.fillRect(bx + bw * (0.12 + i * 0.3), by + ts * 0.45, bw * 0.16, ts * 0.3);
  g.fillStyle = '#101c38'; g.fillRect(bx + bw * 0.42, by + bh - ts * 0.45, bw * 0.16, ts * 0.45); // door
}
function drawBuildingGlyph(g, px, py, ts, kind) {
  const bw = ts * 2.2, bh = ts * 1.5, bx = px - bw / 2 + ts / 2, by = py - ts * 0.2;
  g.fillStyle = kind === 'office' ? '#7d8a96' : '#96705e';
  g.fillRect(bx, by, bw, bh);
  g.fillStyle = 'rgba(0,0,0,.42)'; g.fillRect(bx, by, bw, ts * 0.3); // sign band
  g.fillStyle = 'rgba(255,244,200,.85)';
  for (let i = 0; i < 3; i++) g.fillRect(bx + bw * (0.12 + i * 0.3), by + ts * 0.5, bw * 0.16, ts * 0.35);
  g.fillStyle = 'rgba(20,16,30,.9)'; g.fillRect(bx + bw * 0.42, by + bh - ts * 0.5, bw * 0.16, ts * 0.5); // door
}

/* torch-lit darkness: persistent offscreen layer */
const darkLayer = document.createElement('canvas');
const darkCtx = darkLayer.getContext('2d');

function tileSize() {
  return Math.max(18, Math.min(44, Math.floor(Math.min(canvas.width, canvas.height) / (19 * dpr)) * dpr));
}

function drawFigure(g, px, py, ts, hue, face, dead, isYou) {
  const cx = px + ts / 2, base = py + ts * 0.86;
  const u = ts / 32; // sprite unit
  // shadow
  g.fillStyle = 'rgba(0,0,0,.4)';
  g.beginPath(); g.ellipse(cx, base, 10 * u, 3.5 * u, 0, 0, 7); g.fill();
  if (dead) {
    g.globalAlpha = 0.55;
    g.fillStyle = '#cfd6e4';
    g.beginPath();
    g.moveTo(cx - 8 * u, base);
    g.quadraticCurveTo(cx - 9 * u, py + 8 * u, cx, py + 7 * u);
    g.quadraticCurveTo(cx + 9 * u, py + 8 * u, cx + 8 * u, base);
    for (let i = 0; i < 3; i++) g.quadraticCurveTo(cx + (5 - i * 5.5) * u, base - 4 * u, cx + (2.5 - i * 5.5) * u, base);
    g.fill();
    g.strokeStyle = '#3a4152'; g.lineWidth = 1.6 * u;
    g.beginPath();
    g.moveTo(cx - 4 * u, py + 14 * u); g.lineTo(cx - 1 * u, py + 17 * u); g.moveTo(cx - 1 * u, py + 14 * u); g.lineTo(cx - 4 * u, py + 17 * u);
    g.moveTo(cx + 1 * u, py + 14 * u); g.lineTo(cx + 4 * u, py + 17 * u); g.moveTo(cx + 4 * u, py + 14 * u); g.lineTo(cx + 1 * u, py + 17 * u);
    g.stroke();
    g.globalAlpha = 1;
    return;
  }
  // cloak
  g.fillStyle = `hsl(${hue}, 62%, 46%)`;
  g.beginPath();
  g.moveTo(cx - 6 * u, py + 15 * u);
  g.lineTo(cx - 10 * u, base);
  g.lineTo(cx + 10 * u, base);
  g.lineTo(cx + 6 * u, py + 15 * u);
  g.closePath(); g.fill();
  g.fillStyle = `hsl(${hue}, 62%, 36%)`;
  g.fillRect(cx - 2 * u, py + 16 * u, 4 * u, base - py - 16 * u); // cloak fold
  // hood
  g.fillStyle = `hsl(${hue}, 65%, 55%)`;
  g.beginPath(); g.arc(cx, py + 11 * u, 7.5 * u, 0, 7); g.fill();
  g.fillStyle = `hsl(${hue}, 60%, 30%)`;
  g.beginPath(); g.arc(cx, py + 12.5 * u, 5.5 * u, 0, 7); g.fill();
  // face + eyes looking toward movement
  const fx = (face ? face[0] : 0) * 1.6 * u, fy = (face ? face[1] : 0) * 1.2 * u;
  g.fillStyle = '#e8b98a';
  g.beginPath(); g.arc(cx + fx * 0.6, py + 12.5 * u + fy * 0.6, 3.6 * u, 0, 7); g.fill();
  g.fillStyle = '#1a1026';
  g.beginPath(); g.arc(cx - 1.4 * u + fx, py + 12 * u + fy, 0.9 * u, 0, 7); g.fill();
  g.beginPath(); g.arc(cx + 1.4 * u + fx, py + 12 * u + fy, 0.9 * u, 0, 7); g.fill();
  // rifle held toward the facing direction
  const f0 = face || [0, 1];
  g.save();
  g.translate(cx + f0[0] * 4 * u, py + 19 * u + f0[1] * 3 * u);
  g.rotate(Math.atan2(f0[1], f0[0]));
  g.fillStyle = '#23232c'; // receiver
  g.fillRect(-2 * u, -1.7 * u, 12 * u, 3.4 * u);
  g.fillStyle = '#454552'; // barrel
  g.fillRect(8 * u, -0.9 * u, 7.5 * u, 1.8 * u);
  g.fillStyle = '#6b4f30'; // wooden stock + grip
  g.fillRect(-5.5 * u, -1.3 * u, 4 * u, 2.8 * u);
  g.fillRect(0.5 * u, 1.2 * u, 2.2 * u, 2.6 * u);
  g.restore();
  if (isYou) {
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = Math.max(1.5, ts * 0.05);
    g.beginPath(); g.arc(cx, py + ts * 0.45, ts * 0.46, 0, 7); g.stroke();
    g.lineWidth = 1;
  }
}

function drawSlime(g, px, py, ts, hpFrac) {
  const cx = px + ts / 2, base = py + ts * 0.84;
  const u = ts / 32;
  const squash = 1 + 0.06 * Math.sin(performance.now() / 220 + px);
  g.fillStyle = 'rgba(0,0,0,.4)';
  g.beginPath(); g.ellipse(cx, base + 1 * u, 10 * u, 3 * u, 0, 0, 7); g.fill();
  g.fillStyle = '#a32440';
  g.beginPath();
  g.moveTo(cx - 10 * u * squash, base);
  g.quadraticCurveTo(cx - 11 * u, py + 8 * u, cx, py + 7 * u);
  g.quadraticCurveTo(cx + 11 * u, py + 8 * u, cx + 10 * u * squash, base);
  g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,120,140,.35)';
  g.beginPath(); g.ellipse(cx - 3.5 * u, py + 12 * u, 3 * u, 2 * u, -0.5, 0, 7); g.fill();
  // eyes
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(cx - 3.4 * u, py + 16 * u, 2.2 * u, 0, 7); g.fill();
  g.beginPath(); g.arc(cx + 3.4 * u, py + 16 * u, 2.2 * u, 0, 7); g.fill();
  g.fillStyle = '#20050d';
  g.beginPath(); g.arc(cx - 3.4 * u, py + 16.6 * u, 1.1 * u, 0, 7); g.fill();
  g.beginPath(); g.arc(cx + 3.4 * u, py + 16.6 * u, 1.1 * u, 0, 7); g.fill();
  // frown
  g.strokeStyle = '#5d0f22'; g.lineWidth = 1.4 * u;
  g.beginPath(); g.arc(cx, py + 23 * u, 3 * u, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
  g.lineWidth = 1;
}

const hudCache = {};
function updateHud(st, you) {
  const hpFrac = Math.max(0, you.hp / you.mh);
  const hpw = `${Math.round(hpFrac * 100)}%`;
  if (hudCache.hp !== hpw) { hudCache.hp = hpw; hpFill.style.width = hpw; }
  const low = hpFrac <= 0.2;
  if (hudCache.low !== low) { hudCache.low = low; hpFill.classList.toggle('nelli-low', low); }
  const kt = `${you.kills} kills` + (you.shots ? ` · ${Math.round((100 * you.shotHits) / you.shots)}% acc` : '') + (st.motm ? ` · MoM: ${st.motm}` : st.target ? ` · target ${st.target}` : '');
  if (hudCache.kt !== kt) { hudCache.kt = kt; killsEl.textContent = kt; }
  const alive = (st.alive !== undefined) ? st.alive : (st.party || 1);
  if (hudCache.alive !== alive) { hudCache.alive = alive; aliveEl.textContent = alive; remainEl.textContent = alive; }
  const down = Math.max(0, (st.party || 1) - alive);
  if (hudCache.down !== down) { hudCache.down = down; downEl.textContent = down; }
}

/* lower-corner minimap: local surroundings from the state view window */
const mmctx = mmapCv ? mmapCv.getContext('2d') : null;
function drawMinimap(st, you) {
  if (!mmctx) return;
  const SZ = 132, v = st.view;
  if (!v || !v.tiles || !v.tiles.length) return;
  const rows = v.tiles.length, cols = v.tiles[0].length;
  const ts = SZ / Math.max(rows, cols);
  mmctx.clearRect(0, 0, SZ, SZ);
  for (let r = 0; r < rows; r++) {
    const row = v.tiles[r];
    for (let c = 0; c < row.length; c++) {
      const t = row.charCodeAt(c) - 48;
      mmctx.fillStyle = t === 0 ? '#7d766a' : t === 5 ? '#565b64' : t === 6 ? '#484d55' : '#33402a';
      mmctx.fillRect(c * ts, r * ts, ts + 0.5, ts + 0.5);
    }
  }
  for (const o of st.others || []) {
    mmctx.fillStyle = o.dead ? '#8b8b8b' : '#e8e2d2';
    mmctx.beginPath(); mmctx.arc((o.x - v.x0) * ts, (o.y - v.y0) * ts, 2.2, 0, 7); mmctx.fill();
  }
  const fx = (you.f && you.f[0]) || 0, fy = (you.f && you.f[1]) || 1;
  mmctx.save();
  mmctx.translate((you.x - v.x0) * ts, (you.y - v.y0) * ts);
  mmctx.rotate(Math.atan2(fx, -fy));
  mmctx.fillStyle = '#e8b23a';
  mmctx.beginPath(); mmctx.moveTo(0, -4.6); mmctx.lineTo(3.4, 3.6); mmctx.lineTo(-3.4, 3.6); mmctx.closePath(); mmctx.fill();
  mmctx.restore();
}

/* full-map overlay from the bundled Kondotty blockout data */
function renderBigmap() {
  const KM = window.KONDOTTY_MAP;
  if (!KM || !bigmapCv) return;
  const SZ = Math.min(Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.86), 560);
  bigmapCv.width = SZ; bigmapCv.height = SZ;
  const g = bigmapCv.getContext('2d');
  const ts = SZ / KM.w;
  for (let y = 0; y < KM.h; y++) {
    const row = KM.grid[y];
    for (let x = 0; x < KM.w; x++) {
      const t = row.charCodeAt(x) - 48;
      g.fillStyle = t === 0 ? '#7d766a' : t === 5 ? '#565b64' : t === 6 ? '#484d55' : '#33402a';
      g.fillRect(x * ts, y * ts, ts + 0.4, ts + 0.4);
    }
  }
  const st = S.state;
  if (st && st.you) {
    for (const o of st.others || []) {
      g.fillStyle = '#e8e2d2';
      g.beginPath(); g.arc(o.x * ts, o.y * ts, 2.6, 0, 7); g.fill();
    }
    g.fillStyle = '#e8b23a';
    g.beginPath(); g.arc(st.you.x * ts, st.you.y * ts, 3.6, 0, 7); g.fill();
    g.strokeStyle = '#14130c'; g.lineWidth = 1; g.stroke();
  }
}
if (mapBtn) mapBtn.addEventListener('click', () => {
  bigmap.classList.toggle('nelli-hidden');
  if (!bigmap.classList.contains('nelli-hidden')) renderBigmap();
});
if (bigmap) bigmap.addEventListener('click', () => bigmap.classList.add('nelli-hidden'));
if (setBtn) setBtn.addEventListener('click', () => setPanel.classList.toggle('nelli-hidden'));
/* team code: card after create/join, copyable, recoverable in settings + big map */
function copyTeamCode(btn) {
  const code = S.room;
  if (!code) return;
  const done = () => { const t = btn.textContent; btn.textContent = 'copied'; setTimeout(() => { btn.textContent = t; }, 1200); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(done).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { btn.textContent = code; }
      document.body.removeChild(ta);
    });
  } else {
    const ta = document.createElement('textarea');
    ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { btn.textContent = code; }
    document.body.removeChild(ta);
  }
}
function showTeamCard(code) {
  if (tcCode) tcCode.textContent = code;
  if (teamCard) teamCard.classList.remove('nelli-hidden');
  if (setRoomRow) setRoomRow.classList.remove('nelli-hidden');
  if (setRoom) setRoom.textContent = code;
  if (bigmapCode) bigmapCode.textContent = `team code ${code}`;
}
if (tcCopy) tcCopy.addEventListener('click', () => copyTeamCode(tcCopy));
if (setRoomCopy) setRoomCopy.addEventListener('click', () => copyTeamCode(setRoomCopy));
if (tcX) tcX.addEventListener('click', () => teamCard.classList.add('nelli-hidden'));
if (opaIn) opaIn.addEventListener('input', () => {
  const o = String(Number(opaIn.value) / 100);
  if (mmapCv) mmapCv.style.opacity = o;
  if (bigmapCv) bigmapCv.style.opacity = o;
});

let mmFrame = 0;
function draw() {
  requestAnimationFrame(draw);
  const st = S.state;
  if (!st) return;
  const you = st.you;
  updateHud(st, you);
  if (window.NelliFps && NelliFps.ready) {
    if (++mmFrame % 12 === 0) drawMinimap(st, you); // minimap at ~5Hz while the 3D view is up
    NelliFps.render(st);
    return;
  }
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = '#070510';
  ctx.fillRect(0, 0, w, h);
  drawMinimap(st, you);

  const ts = tileSize();
  const ox = w / 2 - (you.x * ts + ts / 2), oy = h / 2 - (you.y * ts + ts / 2);

  const routeFloor = st.floor % 2 === 1;
  const vx0 = st.view.x0, vy0 = st.view.y0;
  const tileAt = (wx, wy) => {
    const rr = wy - vy0, cc = wx - vx0;
    if (rr < 0 || cc < 0 || rr >= st.view.tiles.length || cc >= st.view.tiles[rr].length) return -1;
    return st.view.tiles[rr].charCodeAt(cc) - 48;
  };
  for (let r = 0; r < st.view.tiles.length; r++) {
    const row = st.view.tiles[r];
    for (let c = 0; c < row.length; c++) {
      const t = row.charCodeAt(c) - 48;
      const wx = vx0 + c, wy = vy0 + r;
      const px = ox + wx * ts, py = oy + wy * ts;
      if (px < -ts || py < -ts || px > w || py > h) continue;
      let img;
      if (t === TILE_WALL) {
        if (!routeFloor) img = tileSprites.wall;
        else if (tileAt(wx - 1, wy) === 1 || tileAt(wx + 1, wy) === 1 || tileAt(wx, wy - 1) === 1 || tileAt(wx, wy + 1) === 1) img = null; // facade below
        else if (tileAt(wx - 1, wy) === TILE_ROAD_MAIN || tileAt(wx + 1, wy) === TILE_ROAD_MAIN || tileAt(wx, wy - 1) === TILE_ROAD_MAIN || tileAt(wx, wy + 1) === TILE_ROAD_MAIN ||
                 tileAt(wx - 1, wy) === TILE_ROAD_SUB || tileAt(wx + 1, wy) === TILE_ROAD_SUB || tileAt(wx, wy - 1) === TILE_ROAD_SUB || tileAt(wx, wy + 1) === TILE_ROAD_SUB) img = tileSprites.shoulder;
        else img = tileSprites.terrain;
      }
      else if (t === TILE_ROAD_MAIN || t === TILE_ROAD_SUB) img = tileSprites.asphalt;
      else if (routeFloor) img = hash2(wx, wy) < 50 ? tileSprites.paveA : tileSprites.paveB;
      else img = hash2(wx, wy) < 50 ? tileSprites.floorA : tileSprites.floorB;
      ctx.imageSmoothingEnabled = false;
      if (img) ctx.drawImage(img, px, py, ts, ts);
      if (routeFloor && t === TILE_WALL &&
          (tileAt(wx - 1, wy) === 1 || tileAt(wx + 1, wy) === 1 || tileAt(wx, wy - 1) === 1 || tileAt(wx, wy + 1) === 1)) {
        ctx.drawImage(tileSprites.terrain, px, py, ts, ts);
        drawFacade(ctx, px, py, ts, wx, wy);
      }
      if (routeFloor && t === TILE_WALL && img === tileSprites.terrain) drawPalmCluster(ctx, px, py, ts, wx, wy);
      if (routeFloor && (t === TILE_ROAD_MAIN || t === TILE_ROAD_SUB)) drawRoadMarks(ctx, px, py, ts, wx, wy, t, tileAt);
      if (t === TILE_STAIRS) ctx.drawImage(tileSprites.stairs, px, py, ts, ts);
      else if (t === TILE_POTION) ctx.drawImage(tileSprites.potion, px, py, ts, ts);
      else if (t === TILE_GOLD) ctx.drawImage(tileSprites.gold, px, py, ts, ts);
    }
  }

  /* sprites */
  for (const m of st.mobs) drawSlime(ctx, ox + m.x * ts, oy + m.y * ts, ts, m.hp / m.mh);
  for (const o of st.others) drawFigure(ctx, ox + o.x * ts, oy + o.y * ts, ts, o.hu, o.f, o.dead, false);
  drawFigure(ctx, ox + you.x * ts, oy + you.y * ts, ts, you.hu, you.f, you.dead, true);

  /* torch-lit darkness with light pools at each living player.
     Route floors run a lighter "daylight" veil; the arena keeps the dark. */
  if (darkLayer.width !== w || darkLayer.height !== h) { darkLayer.width = w; darkLayer.height = h; }
  darkCtx.globalCompositeOperation = 'source-over';
  darkCtx.clearRect(0, 0, w, h);
  darkCtx.fillStyle = routeFloor ? 'rgba(8,10,18,.22)' : 'rgba(5,3,12,.58)';
  darkCtx.fillRect(0, 0, w, h);
  darkCtx.globalCompositeOperation = 'destination-out';
  const now = performance.now();
  const lights = [[you.x, you.y, you.dead ? 0.35 : 1]];
  for (const o of st.others) lights.push([o.x, o.y, o.dead ? 0.35 : 0.8]);
  for (const [lx, ly, strength] of lights) {
    const flick = 1 + 0.045 * Math.sin(now / 95 + lx * 3 + ly);
    const rad = ts * (routeFloor ? 10 : 7.5) * flick;
    const gx = ox + lx * ts + ts / 2, gy = oy + ly * ts + ts / 2;
    const grad = darkCtx.createRadialGradient(gx, gy, rad * 0.15, gx, gy, rad);
    grad.addColorStop(0, `rgba(0,0,0,${0.9 * strength})`);
    grad.addColorStop(0.65, `rgba(0,0,0,${0.45 * strength})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    darkCtx.fillStyle = grad;
    darkCtx.beginPath(); darkCtx.arc(gx, gy, rad, 0, 7); darkCtx.fill();
  }
  ctx.drawImage(darkLayer, 0, 0);

  /* place-name signboards above the darkness so the route stays readable */
  ctx.textAlign = 'center';
  /* collision-avoiding signboards: junctions/main towns claim space first,
     others shift up/down until their box no longer overlaps a placed one */
  const placed = [];
  const ordered = [...(st.labels || [])].sort((a, b) =>
    (b.junction - a.junction) || ((b.main ? 1 : 0) - (a.main ? 1 : 0)));
  for (const lb of ordered) {
    const ax = ox + lb.x * ts, ay = oy + lb.y * ts;
    const lx = ax + ts / 2, baseLy = ay - ts * 0.22;
    if (lx < -60 || lx > w + 60 || baseLy < -40 || baseLy > h + 40) continue;
    if (routeFloor && lb.kind === 'flyover') drawFlyoverGlyph(ctx, ax, ay, ts);
    if (routeFloor && (lb.kind === 'office' || lb.kind === 'showroom')) drawBuildingGlyph(ctx, ax, ay, ts, lb.kind);
    if (routeFloor && lb.kind === 'police') drawPoliceGlyph(ctx, ax, ay, ts);
    ctx.font = `${lb.main ? 'bold ' : ''}${Math.max(10, ts * (lb.main ? 0.42 : 0.34))}px monospace`;
    const label = lb.junction ? `* ${lb.n} *` : lb.n;
    const tw = ctx.measureText(label).width;
    const boxH = Math.max(13, ts * 0.5), boxT = Math.max(10, ts * 0.4), boxW = tw + 10;
    let ly = baseLy, found = false;
    for (const off of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
      const cy0 = baseLy + off * (boxH + 2);
      const cand = { x0: lx - boxW / 2, y0: cy0 - boxT, x1: lx + boxW / 2, y1: cy0 - boxT + boxH };
      if (!placed.some((r) => cand.x0 < r.x1 && cand.x1 > r.x0 && cand.y0 < r.y1 && cand.y1 > r.y0)) {
        ly = cy0; placed.push(cand); found = true; break;
      }
    }
    if (!found) continue; // no free slot nearby: skip rather than overlap
    if (ly !== baseLy) { // thin leader line from shifted board to its spot
      ctx.strokeStyle = 'rgba(200,190,230,.45)';
      ctx.beginPath(); ctx.moveTo(lx, ly + 2); ctx.lineTo(lx, baseLy - boxT + boxH); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(8,5,16,.72)';
    ctx.fillRect(lx - tw / 2 - 5, ly - boxT, boxW, boxH);
    ctx.strokeStyle = lb.junction ? 'rgba(255,210,77,.75)' : 'rgba(150,110,255,.5)';
    ctx.strokeRect(lx - tw / 2 - 5, ly - boxT, boxW, boxH);
    ctx.fillStyle = lb.main ? '#ffd24d' : '#c9bdf0';
    ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
    ctx.fillText(label, lx, ly);
    ctx.shadowBlur = 0;
  }

  /* labels, hp bars, slash fx above the darkness for readability */
  const drawHp = (px, py, frac, color) => {
    ctx.fillStyle = 'rgba(0,0,0,.65)';
    ctx.fillRect(px + ts * 0.1, py - ts * 0.2, ts * 0.8, Math.max(2, ts * 0.09));
    ctx.fillStyle = color;
    ctx.fillRect(px + ts * 0.1, py - ts * 0.2, ts * 0.8 * Math.max(0, frac), Math.max(2, ts * 0.09));
  };
  /* bullets in flight: glowing tracer streaks with a hot head */
  for (const pr of st.projs || []) {
    const hx = ox + pr.x * ts + ts / 2, hy = oy + pr.y * ts + ts / 2;
    const bx = hx - (pr.dx || 0) * ts * 0.95, by = hy - (pr.dy || 0) * ts * 0.95;
    const tgrad = ctx.createLinearGradient(bx, by, hx, hy);
    tgrad.addColorStop(0, 'rgba(255,176,64,0)');
    tgrad.addColorStop(1, 'rgba(255,230,120,.95)');
    ctx.strokeStyle = tgrad; ctx.lineWidth = Math.max(2, ts * 0.12); ctx.lineCap = 'round';
    ctx.shadowColor = '#ffb340'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.shadowBlur = 0; ctx.lineWidth = 1;
    ctx.fillStyle = '#fff3c0';
    ctx.beginPath(); ctx.arc(hx, hy, Math.max(1.6, ts * 0.09), 0, 7); ctx.fill();
  }
  /* muzzle flash: an eight-point star burst at the barrel tip */
  S.muzzleFx = S.muzzleFx.filter((f) => f.until > now);
  for (const f of S.muzzleFx) {
    const dir = f.f || [0, 1];
    const bx = ox + f.x * ts + ts / 2 + dir[0] * ts * 0.62;
    const by = oy + f.y * ts + ts * 0.42 + dir[1] * ts * 0.62;
    const life = (f.until - now) / 90;
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(Math.atan2(dir[1], dir[0]));
    ctx.fillStyle = `rgba(255,225,140,${0.95 * Math.max(0, life)})`;
    ctx.shadowColor = '#ffcf5e'; ctx.shadowBlur = 14;
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const r = (i % 2 === 0 ? ts * 0.36 : ts * 0.12) * (0.7 + 0.5 * life);
      const a = (Math.PI / 8) * i;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.shadowBlur = 0;
  }
  /* impact sparks: short radiating lines where a bullet lands */
  S.sparkFx = S.sparkFx.filter((f) => f.until > now);
  for (const f of S.sparkFx) {
    const sx = ox + f.x * ts + ts / 2, sy = oy + f.y * ts + ts / 2;
    const life = Math.max(0, (f.until - now) / 130);
    ctx.strokeStyle = `rgba(255,200,90,${0.9 * life})`;
    ctx.lineWidth = Math.max(1.5, ts * 0.07);
    for (let i = 0; i < 6; i++) {
      const a = i * 1.047 + f.x * 0.7;
      const r0 = ts * 0.1, r1 = ts * (0.16 + 0.32 * (1 - life));
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(a) * r0, sy + Math.sin(a) * r0);
      ctx.lineTo(sx + Math.cos(a) * r1, sy + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
  }
  for (const m of st.mobs) drawHp(ox + m.x * ts, oy + m.y * ts, m.hp / m.mh, '#ff5f6d');
  for (const o of st.others) {
    const px = ox + o.x * ts, py = oy + o.y * ts;
    drawHp(px, py, o.hp / o.mh, '#7ce495');
    ctx.fillStyle = '#f0e9ff';
    ctx.font = `${Math.max(9, ts * 0.3)}px monospace`;
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
    ctx.fillText(o.n, px + ts / 2, py - ts * 0.28);
    ctx.shadowBlur = 0;
  }
  S.slashFx = S.slashFx.filter((f) => f.until > now);
  for (const f of S.slashFx) {
    const px = ox + f.x * ts, py = oy + f.y * ts;
    ctx.strokeStyle = 'rgba(255,240,200,.95)';
    ctx.lineWidth = Math.max(2, ts * 0.09);
    ctx.beginPath();
    ctx.arc(px + ts / 2, py + ts / 2, ts * 0.7, -0.6, 0.9);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

}

/* ---------------- overview sample-map mode (#map / #map2) ---------------- */
function overviewMode() {
  joinBox.classList.add('nelli-hidden');
  const floorNum = Number((location.hash.match(/map(\d+)/) || [0, 1])[1]) || 1;
  const delve = new C.DenelliDelve(7);
  if (floorNum > 1) delve.loadFloor(floorNum);
  const map = delve.map;
  const KIND_COLOR = { office: '#7cc7e8', showroom: '#f2a2c0', flyover: '#c8d2e0' };
  const render = () => {
    const vw = innerWidth * dpr, vh = innerHeight * dpr;
    const header = 34 * dpr;
    let ts = Math.floor(Math.min(vw / map.w, (vh - header) / map.h));
    if (ts < 8 * dpr) {
      // narrow screen: render big and let the page scroll instead of cramping
      ts = Math.ceil(8 * dpr);
      document.body.style.overflow = 'auto';
      canvas.style.position = 'static';
      canvas.width = map.w * ts + 16 * dpr;
      canvas.height = header + map.h * ts + 30 * dpr;
    } else {
      canvas.width = vw; canvas.height = vh;
    }
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = '#070510';
    ctx.fillRect(0, 0, w, h);
    const ox = Math.floor((w - map.w * ts) / 2), oy = Math.floor(header + (h - header - map.h * ts) / 2);
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const t = map.grid[y * map.w + x];
        const ovRoute = floorNum % 2 === 1;
        let img;
        if (t === TILE_WALL) img = ovRoute ? tileSprites.terrain : tileSprites.wall;
        else if (t === TILE_ROAD_MAIN || t === TILE_ROAD_SUB) img = tileSprites.asphalt;
        else if (ovRoute) img = hash2(x, y) < 50 ? tileSprites.paveA : tileSprites.paveB;
        else img = hash2(x, y) < 50 ? tileSprites.floorA : tileSprites.floorB;
        ctx.drawImage(img, ox + x * ts, oy + y * ts, ts, ts);
        if (t === TILE_STAIRS) ctx.drawImage(tileSprites.stairs, ox + x * ts, oy + y * ts, ts, ts);
        else if (t === TILE_POTION) ctx.drawImage(tileSprites.potion, ox + x * ts, oy + y * ts, ts, ts);
        else if (t === TILE_GOLD) ctx.drawImage(tileSprites.gold, ox + x * ts, oy + y * ts, ts, ts);
      }
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#b79bff';
    ctx.font = `bold ${15 * dpr}px monospace`;
    ctx.fillText(floorNum > 1 ? 'nexora - airport arena (fictional)' : 'nexora - route map', w / 2, 18 * dpr);
    ctx.fillStyle = '#7a7098';
    ctx.font = `${9 * dpr}px monospace`;
    ctx.fillText('schematic game map, not for navigation', w / 2, 29 * dpr);
    const plaque = (n, x, y, color, bold) => {
      const lx = ox + x * ts + ts / 2, ly = oy + y * ts - 2 * dpr;
      ctx.font = `${bold ? 'bold ' : ''}${Math.max(8, 6.5 * dpr)}px monospace`;
      const tw = ctx.measureText(n).width;
      ctx.fillStyle = 'rgba(8,5,16,.78)';
      ctx.fillRect(lx - tw / 2 - 3 * dpr, ly - 8 * dpr, tw + 6 * dpr, 10 * dpr);
      ctx.fillStyle = color;
      ctx.fillText(n, lx, ly);
    };
    for (const r of map.rooms) plaque(r.junction ? `* ${r.n} *` : r.n, r.cx, r.y, r.main ? '#ffd24d' : '#c9bdf0', r.main);
    for (const lm of map.landmarks || []) plaque(lm.n, lm.x, lm.y, KIND_COLOR[lm.kind] || '#e0d7f5', false);
  };
  render();
  addEventListener('resize', render);
}

if (/map/.test(location.hash)) { overviewMode(); return; }
requestAnimationFrame(draw);

})();
