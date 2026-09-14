#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Civilization } = require('./js/core/civ.js');

const ROOT = __dirname;
const PORT = process.env.ALDEA_PORT || 4949;

let civ = new Civilization({ w: 70, h: 44, seed: 7, tickMax: 200000 });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function send(res, code, body, type) {
  res.writeHead(code, { 'content-type': type || 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}
function sendJson(res, obj) { send(res, 200, JSON.stringify(obj)); }
function sendError(res, code, msg) { send(res, code, JSON.stringify({ error: msg })); }

function parseQuery(url) {
  const q = (url.split('?')[1] || '');
  const out = {};
  for (const pair of q.split('&')) {
    if (!pair) continue;
    const [k, v] = pair.split('=');
    out[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }
  return out;
}

function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { sendError(res, 404, 'no encontrado'); return; }
    send(res, 200, data, MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
  });
}

// ---------------- la fotografía que ve el explorador ----------------
function snapshot(conMundo) {
  const base = {
    w: civ.w,
    h: civ.h,
    seed: civ.seed,
    tick: civ.tick,
    epoch: civ.epoch,
    summary: civ.summary(),
    history: civ.history.slice(-600),
    agents: civ.agents.map(a => ({
      id: a.id, x: a.x, y: a.y, energy: Math.round(a.energy),
      age: Math.round(a.age), plan: a.plan ? a.plan.kind : null,
      band: a.band ? a.band.id : null,
    })),
    bands: civ.bands.map(b => ({
      id: b.id, camp: b.camp, pool: b.pool,
      storage: !!b.storage, members: b.members.length,
    })),
    artifacts: civ.world.artifacts.map(a => ({ type: a.type, x: a.x, y: a.y })),
    records: civ.world.records.slice(-250).map(r => ({
      x: r.x, y: r.y, envelope: r.envelope,
      lessons: (r.lessons || []).slice(0, 6).map(l => l.kind === 'recurso' ? l.tag : (l.kind + ':' + l.tech + '→' + l.nivel)),
    })),
    events: civ.events.slice(-12),
  };
  if (conMundo) {
    base.world = {
      tiles: Array.from(civ.world.tiles),
      berry: Array.from(civ.world.berry),
    };
  }
  return base;
}

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];

  if (req.method === 'GET' && urlPath === '/') return serveStatic(res, path.join(ROOT, 'index.html'));
  if (req.method === 'GET' && urlPath === '/js/web.js') return serveStatic(res, path.join(ROOT, 'js', 'web.js'));

  if (req.method === 'GET' && urlPath === '/api/estado') {
    return sendJson(res, snapshot(true));
  }

  if (req.method === 'GET' && urlPath === '/api/avanzar') {
    const q = parseQuery(req.url);
    const ticks = Math.min(+(q.ticks || 100), 2000);
    civ.run(ticks);
    return sendJson(res, snapshot(false));
  }

  if (req.method === 'GET' && urlPath === '/api/reiniciar') {
    const q = parseQuery(req.url);
    const seed = +(q.seed || 7);
    civ = new Civilization({ w: 70, h: 44, seed, tickMax: 200000 });
    return sendJson(res, snapshot(true));
  }

  sendError(res, 404, 'ruta desconocida');
});

server.listen(PORT, () => {
  console.log('ALDEA — simulación de civilización artificial');
  console.log('   Semilla inicial: ' + civ.seed);
  console.log('   Abre:            http://localhost:' + PORT);
});