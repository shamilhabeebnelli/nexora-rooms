#!/usr/bin/env node
/**
 * denelli-dungeon :: same-WiFi multiplayer roguelike dungeon crawler
 *
 * One device on the WiFi is the host:  node server.js
 * Every other phone/laptop on the same WiFi opens the printed address.
 * No installs, no internet, no accounts.
 *
 * Zero-dependency: HTTP static server + WebSocket (RFC 6455) on Node
 * built-ins only. All game rules live in public/core.js (shared with the
 * browser solo-delve mode).
 *
 * Copyright (c) 2026 shamil habeeb nelli (denelli). All rights reserved.
 * Copying or reusing this code without permission is strictly prohibited.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { DenelliDelve } = require('./public/core.js');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const TICK_MS = 100;   // 10 Hz simulation
const SNAP_MS = 100;   // 10 Hz snapshots

/* rooms: friends join the same game with a short room code; no code
   lands in the shared main hall. An empty custom room closes itself. */
const rooms = new Map(); // code -> { code, delve, clients }
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no look-alikes
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
}
function cleanCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}
function roomFor(code) {
  code = cleanCode(code);
  let r = rooms.get(code);
  if (!r) {
    r = { code, delve: new DenelliDelve(((Date.now() ^ 0x5eed) + rooms.size * 7919) >>> 0), clients: new Map() };
    rooms.set(code, r);
  }
  return r;
}

/* ---------------- WebSocket (RFC 6455, minimal) ---------------- */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function wsAccept(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}
function wsEncode(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}
class NelliSocket {
  constructor(sock) {
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.onmessage = null;
    this.onclose = null;
    this.alive = true;
    sock.on('data', (d) => this._data(d));
    const bye = () => this._dead();
    sock.on('close', bye); sock.on('error', bye); sock.on('end', bye);
  }
  _dead() {
    if (!this.alive) return;
    this.alive = false;
    if (this.onclose) this.onclose();
  }
  _data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      const maskOff = off;
      if (masked) off += 4;
      if (this.buf.length < off + len) return;
      let payload = this.buf.slice(off, off + len);
      if (masked) {
        const mask = this.buf.slice(maskOff, maskOff + 4);
        const un = Buffer.alloc(len);
        for (let i = 0; i < len; i++) un[i] = payload[i] ^ mask[i & 3];
        payload = un;
      }
      this.buf = this.buf.slice(off + len);
      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this.sock.write(Buffer.from([0x8a, 0x00])); continue; } // ping -> pong
      if (op === 0x1 || op === 0x0) {
        this.frags.push(payload);
        if (fin) {
          const whole = Buffer.concat(this.frags).toString('utf8');
          this.frags = [];
          if (this.onmessage) { try { this.onmessage(whole); } catch (e) { /* ignore bad client message */ } }
        }
      }
    }
  }
  send(str) {
    if (!this.alive) return;
    try { this.sock.write(wsEncode(str)); } catch (e) { this._dead(); }
  }
  close() { try { this.sock.destroy(); } catch (e) {} this._dead(); }
}

/* ---------------- HTTP static ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

/* ---------------- wiring ---------------- */
server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return; }
  sock.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${wsAccept(key)}\r\n\r\n`
  );
  sock.setNoDelay(true);
  const ws = new NelliSocket(sock);
  let me = null, room = null;

  ws.onmessage = (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!me) {
      if (msg.t === 'create') {
        // online flow: server picks the code, creator joins as first player
        room = roomFor(newCode());
      } else if (msg.t === 'join') {
        const code = cleanCode(msg.room);
        if (code && !rooms.has(code)) { // do not silently open a fresh empty room
          ws.send(JSON.stringify({ t: 'error', code: 'no_room', msg: 'no team found with that code - check the code and try again' }));
          return;
        }
        room = roomFor(code);
      } else return;
      const dv = room.delve;
      const tgt = Math.max(0, Math.min(999, Number(msg.target) || 0));
      if (tgt && !dv.motm) dv.targetKills = tgt; // players choose the kill target; locked once MoM is crowned
      me = dv.addPlayer(msg.name);
      room.clients.set(me.id, ws);
      ws.send(JSON.stringify({
        t: 'welcome', id: me.id, floor: dv.floor, room: room.code,
        w: dv.map.w, h: dv.map.h, seed: (dv.seedBase + dv.floor * 7919) >>> 0,
      }));
      return;
    }
    const dv = room.delve;
    if (msg.t === 'dir') dv.setDir(me.id, Number(msg.dx) || 0, Number(msg.dy) || 0);
    else if (msg.t === 'face') dv.face(me.id, Number(msg.dx) || 0, Number(msg.dy) || 0);
    else if (msg.t === 'shoot') dv.shoot(me.id);
    else if (msg.t === 'respawn') dv.respawn(me.id);
    else if (msg.t === 'debug_floor' && process.env.DENELLI_TEST_HOOK === '1') dv.loadFloor(Math.max(1, Number(msg.n) || 1));
    else if (msg.t === 'debug_teleport' && process.env.DENELLI_TEST_HOOK === '1' && me) dv.teleport(me.id, Number(msg.x) || 0, Number(msg.y) || 0);
  };
  ws.onclose = () => {
    if (me && room) { room.delve.removePlayer(me.id); room.clients.delete(me.id); }
  };
});

setInterval(() => { for (const r of rooms.values()) r.delve.tick(); }, TICK_MS);
setInterval(() => {
  for (const [code, r] of rooms) {
    if (r.clients.size === 0) {
      r.delve.drainEvents();
      if (code !== '' && r.delve.players.size === 0) rooms.delete(code); // empty custom rooms close
      continue;
    }
    const evs = r.delve.drainEvents(); // same feed for every player in the room
    for (const [id, ws] of r.clients) {
      const snap = r.delve.snapshotFor(id, evs);
      if (snap) ws.send(JSON.stringify(snap));
    }
  }
}, SNAP_MS);

server.listen(PORT, '0.0.0.0', () => {
  const addrs = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) addrs.push(n.address);
    }
  }
  console.log(`denelli-dungeon host up on port ${PORT}`);
  console.log('players on the same WiFi open:');
  for (const a of addrs) console.log(`  http://${a}:${PORT}/`);
  console.log(`  (this device) http://localhost:${PORT}/`);
});
