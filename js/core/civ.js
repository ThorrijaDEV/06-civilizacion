'use strict';

const { World } = require('./world.js');
const { mulberry32 } = require('./rng.js');
const { Agent, TECHS } = require('./agents.js');

const BASELINE_TECH = { fuego: 30, choza: 20, pozo: 12, almacen: 15, escritura: 40 };

let BAND_ID = 1;

class Civilization {
  constructor(opts = {}) {
    this.w = opts.w || 70;
    this.h = opts.h || 44;
    this.seed = opts.seed || 1;
    this.rng = mulberry32(this.seed);
    this.world = new World(this.w, this.h, this.rng, { seed: this.seed });
    this.tick = 0;
    this.tickMax = opts.tickMax || 12000;
    this.popTarget = opts.popTarget || 26;
    this.agents = [];
    this.bands = [];
    this.events = [];
    this.history = [];
    this.epochs = [];
    this.epoch = 0;
    this.founders = [];

    assert(!Number.isNaN(this.w));

    this._found(opts.nFounders || 8);
    this._recluster();
    this.events.push({ kind: 'estado', tick: 0, text: 'aldea fundada · ' + this.agents.length + ' individuos' });
  }

  // ---------------- fundación / nacimientos ----------------
  _found(n) {
    // asentamiento fundado cerca de un manantial
    let lake = -1;
    for (let tries = 0; tries < 200; tries++) {
      const c = Math.floor(this.rng() * this.world.n);
      if (this.world.tiles[c] === 2) { lake = c; break; }
    }
    const lx = lake % this.w, ly = (lake / this.w) | 0;
    for (let k = 0; k < n; k++) {
      const ox = lx + Math.floor((this.rng() - 0.5) * 10);
      const oy = ly + Math.floor((this.rng() - 0.5) * 10);
      const cx = ((ox % this.w) + this.w) % this.w;
      const cy = ((oy % this.h) + this.h) % this.h;
      if (this.world.isWater(cx, cy)) { this._spawnNear(lake, 4); continue; }
      const a = new Agent(this, cx, cy);
      for (const t of TECHS) a.knowledge[t] = BASELINE_TECH[t] || 0;
      this.agents.push(a);
      this.founders.push(a.id);
    }
  }

  _spawnNear(lakeIdx, radius) {
    const w = this.world;
    const lx = lakeIdx % this.w, ly = (lakeIdx / this.w) | 0;
    for (let tries = 0; tries < 20; tries++) {
      const ox = ((lx + Math.floor((this.rng() - 0.5) * radius * 2)) % this.w + this.w) % this.w;
      const oy = ((ly + Math.floor((this.rng() - 0.5) * radius * 2)) % this.h + this.h) % this.h;
      if (w.isLand(ox, oy) || w.isForest(ox, oy)) {
        const a = new Agent(this, ox, oy);
        for (const t of TECHS) a.knowledge[t] = BASELINE_TECH[t] || 0;
        this.agents.push(a);
        this.founders.push(a.id);
        return;
      }
    }
  }

  population() {
    let n = 0;
    for (const a of this.agents) if (a.alive) n++;
    return n;
  }

  popCap() {
    let berries = 0;
    for (let i = 0; i < this.world.n; i++) {
      if (this.world.tiles[i] !== 2) berries += this.world.berry[i];
    }
    return Math.max(this.popTarget, berries * 12);
  }

  avgKnowledge() {
    let s = 0, n = 0;
    for (const a of this.agents) {
      if (!a.alive) continue;
      for (const t of TECHS) s += a.knowledge[t];
      n += TECHS.length;
    }
    return n ? s / n : 0;
  }

  mateFor(a) {
    let best = null;
    for (const other of this.agents) {
      if (other === a || !other.alive || !other.isMature()) continue;
      if (other.energy < other.g.maxEnergy * 0.5) continue;
      const d = Math.abs(((other.x - a.x) % this.w + this.w) % this.w) + Math.abs(((other.y - a.y) % this.h + this.h) % this.h);
      if (d <= 5) { best = other; break; }
    }
    return best;
  }

  birth(a, b) {
    const genes = {
      maxEnergy: (a.g.maxEnergy + b.g.maxEnergy) / 2 + (this.rng() - 0.5) * 20,
      lifespan: (a.g.lifespan + b.g.lifespan) / 2 + (this.rng() - 0.5) * 300,
      memoryCap: Math.max(4, Math.min(12, Math.round((a.g.memoryCap + b.g.memoryCap) / 2 + (this.rng() - 0.5) * 3))),
      aptitude: Math.max(0.4, Math.min(2.2, (a.g.aptitude + b.g.aptitude) / 2 + (this.rng() - 0.5) * 0.6)),
    };
    genes.maxEnergy = Math.round(genes.maxEnergy);
    genes.lifespan = Math.round(genes.lifespan);
    const tech = {};
    for (const t of TECHS) tech[t] = Math.round((a.knowledge[t] + b.knowledge[t]) * 0.7);
    const c = new Agent(this, a.x, a.y, Object.assign(genes, { tech }));
    c.band = a.band;
    c.energy = 55;
    this.agents.push(c);
    this.events.push({ kind: 'nacimiento', who: c.id, parent: a.id + ',' + b.id });
  }

  // ---------------- bandas ----------------
  _recluster() {
    const alive = this.agents.filter(a => a.alive);
    // union-find sobre vecindad
    const parent = {};
    const find = x => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    for (const a of alive) parent[a.id] = a.id;
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const u = alive[i], v = alive[j];
        const d = Math.abs(((u.x - v.x) % this.w + this.w) % this.w) + Math.abs(((u.y - v.y) % this.h + this.h) % this.h);
        if (d <= 10 && find(u.id) !== find(v.id)) parent[find(u.id)] = find(v.id);
      }
    }
    const groups = {};
    for (const a of alive) {
      const r = find(a.id);
      (groups[r] = groups[r] || []).push(a);
    }
    const oldBands = this.bands;
    this.bands = [];
    for (const r of Object.keys(groups)) {
      const members = groups[r];
      let band = oldBands.find(b => b.members.some(m => members.includes(m)));
      if (!band) {
        band = {
          id: BAND_ID++,
          pool: 0,
          artifacts: [],
          storage: null,
          camp: null,
          recordCount: 0,
          members: [],
        };
        this.events.push({ kind: 'banda', tick: this.tick, n: members.length });
      }
      band.members = members;
      if (!band.camp) {
        let sx = 0, sy = 0;
        for (const m of members) { sx += m.x; sy += m.y; }
        band.camp = { x: Math.round(sx / members.length) % this.w, y: Math.round(sy / members.length) % this.h };
      }
      this.bands.push(band);
    }
    const byId = {};
    for (const b of this.bands) for (const m of b.members) byId[m.id] = b;
    for (const a of alive) a.band = byId[a.id] || null;
  }

  // ---------------- el ciclo ----------------
  _step() {
    this.world.regrow(this.tick);
    for (const a of this.agents) {
      if (a.alive) a.act(this);
    }
    // muertes
    this.agents = this.agents.filter(a => a.alive);
    for (const b of this.bands) b.members = b.members.filter(m => m.alive);

    if (this.tick % 120 === 0) this._recluster();

    // población extinta → nueva época con fundadores
    if (this.agents.length === 0) {
      this.epochs.push({ epoch: ++this.epoch, endedAt: this.tick, records: this.world.records.length });
      this.events.push({ kind: 'epoca', epoch: this.epoch, tick: this.tick });
      this._found(6);
      this._recluster();
    }

    // las tablillas más antiguas se erosionan: la memoria escrita decae
    const MAX_RECORDS = 1200;
    while (this.world.records.length > MAX_RECORDS) {
      const oldest = this.world.records[0];
      this.world.records.splice(0, 1);
      const ai = this.world.artifacts.indexOf(oldest);
      if (ai >= 0) this.world.artifacts.splice(ai, 1);
      const key = this.world.idx(oldest.x, oldest.y);
      const list = this.world.recordsAt.get(key);
      if (list) {
        const li = list.indexOf(oldest);
        if (li >= 0) list.splice(li, 1);
        if (!list.length) this.world.recordsAt.delete(key);
      }
    }

    // muestreo periódico para la gráfica
    if (this.tick % 40 === 0) {
      let energy = 0, n = 0;
      for (const a of this.agents) { energy += a.energy; n++; }
      let stored = 0, buildings = 0;
      for (const b of this.bands) stored += b.pool;
      for (const a of this.world.artifacts) if (a.type !== 'registro') buildings++;
      this.history.push({
        t: this.tick,
        pop: this.agents.length,
        energy: n ? energy / n : 0,
        knowledge: Math.round(this.avgKnowledge()),
        buildings,
        records: this.world.records.length,
        stored: Math.round(stored),
      });
    }

    this.tick++;
  }

  run(ticks) {
    const end = this.tick + (ticks || (this.tickMax - this.tick));
    while (this.tick < end) this._step();
    return this;
  }

  summary() {
    let births = 0, deaths = 0;
    for (const e of this.events) {
      if (e.kind === 'nacimiento') births++;
      if (e.kind === 'muerte' || e.kind === 'muerte-natural') deaths++;
    }
    return {
      tick: this.tick,
      pop: this.agents.length,
      births,
      deaths,
      bands: this.bands.length,
      artifacts: this.world.artifacts.length,
      records: this.world.records.length,
      epochs: this.epochs.length,
      knowledge: Math.round(this.avgKnowledge()),
      events: this.events.length,
    };
  }
}

function assert(cond) { if (!cond) throw new Error('assertion failed'); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Civilization, BASELINE_TECH };
}