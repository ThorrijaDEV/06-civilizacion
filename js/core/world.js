'use strict';

const LAND = 0, FOREST = 1, WATER = 2, STONE = 3;

class World {
  constructor(w, h, rng, opts = {}) {
    this.w = w; this.h = h; this.rng = rng;
    this.seed = opts.seed || 1;
    this.n = w * h;
    this.tiles = new Uint8Array(this.n);
    this.berry = new Float32Array(this.n);
    this.wood = new Float32Array(this.n);
    this.stone = new Float32Array(this.n);
    this.artifacts = [];
    this.records = [];
    this.recordsAt = new Map();
    this.tick = 0;
    this.DAY = 48;
    this.SEASON = 900;
    this._gen(opts);
  }

  idx(x, y) { return ((Math.floor(y) + this.h) % this.h) * this.w + ((Math.floor(x) + this.w) % this.w); }
  isWater(x, y) { return this.tiles[this.idx(x, y)] === WATER; }
  isForest(x, y) { return this.tiles[this.idx(x, y)] === FOREST; }
  isStone(x, y) { return this.tiles[this.idx(x, y)] === STONE; }
  isLand(x, y) { return this.tiles[this.idx(x, y)] === LAND; }

  _blob(cx, cy, radius, tile) {
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (Math.hypot(x - cx, y - cy) <= radius && this.rng() < 0.92) {
          this.tiles[this.idx(x, y)] = tile;
        }
      }
    }
  }

  _gen() {
    // llanuras por defecto
    const forests = 16, lakes = 5, stones = 10;
    for (let i = 0; i < forests; i++) {
      this._blob(3 + this.rng() * (this.w - 6), 3 + this.rng() * (this.h - 6), 2 + this.rng() * 3, FOREST);
    }
    for (let i = 0; i < lakes; i++) {
      this._blob(3 + this.rng() * (this.w - 6), 3 + this.rng() * (this.h - 6), 1 + this.rng() * 2, WATER);
    }
    for (let i = 0; i < stones; i++) {
      this._blob(3 + this.rng() * (this.w - 6), 3 + this.rng() * (this.h - 6), 1 + this.rng() * 1, STONE);
    }
    for (let i = 0; i < this.n; i++) {
      if (this.tiles[i] !== WATER) {
        this.berry[i] = 0.4 + this.rng() * 0.6;
      }
      if (this.tiles[i] === FOREST) this.wood[i] = 0.6 + this.rng() * 0.4;
      if (this.tiles[i] === STONE) this.stone[i] = 0.5 + this.rng() * 0.5;
    }
  }

  night(tick) {
    const t = tick % this.DAY;
    return t > this.DAY * 2 / 3;
  }

  season(tick) {
    // 0..1, alto en verano (crece la comida), bajo en invierno
    return 0.45 + 0.55 * Math.sin((tick % this.SEASON) / this.SEASON * Math.PI * 2);
  }

  regrow(tick) {
    this.tick = tick;
    const s = this.season(tick);
    for (let i = 0; i < this.n; i++) {
      if (this.tiles[i] === WATER) continue;
      if (this.berry[i] < 1) this.berry[i] = Math.min(1, this.berry[i] + 0.0016 * (0.3 + s));
      if (this.tiles[i] === FOREST && this.wood[i] < 1) this.wood[i] = Math.min(1, this.wood[i] + 0.0003);
      if (this.tiles[i] === STONE && this.stone[i] < 1) this.stone[i] = Math.min(1, this.stone[i] + 0.00015);
    }
  }

  forage(x, y) {
    const i = this.idx(x, y);
    const q = this.berry[i];
    if (q < 0.02) return 0;
    const got = Math.min(q, 0.18 + this.rng() * 0.12);
    this.berry[i] = Math.max(0, q - got);
    return got;
  }

  harvest(x, y, tileKind) {
    const i = this.idx(x, y);
    const arr = tileKind === FOREST ? this.wood : this.stone;
    let a = arr[i];
    if (a < 0.02) return 0;
    const got = Math.min(a, 0.18 + this.rng() * 0.12);
    arr[i] = Math.max(0, a - got);
    return got;
  }

  resourceAt(x, y, kind) {
    if (kind === 'berry') return this.berry[this.idx(x, y)];
    if (kind === 'wood') return this.wood[this.idx(x, y)];
    if (kind === 'stone') return this.stone[this.idx(x, y)];
    return 0;
  }

  // búsqueda en espiral determinista dentro de un radio (acotado al mundo)
  find(x, y, radius, predicate) {
    const rx = Math.min(radius, Math.floor(this.w / 2));
    const ry = Math.min(radius, Math.floor(this.h / 2));
    let best = null, bestD = Infinity;
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        const nx = ((x + dx) % this.w + this.w) % this.w;
        const ny = ((y + dy) % this.h + this.h) % this.h;
        if (predicate(nx, ny)) {
          const d = Math.abs(dx) + Math.abs(dy);
          if (d < bestD) { bestD = d; best = { x: nx, y: ny }; }
        }
      }
    }
    return best;
  }

  nearestResource(x, y, kind, radius) {
    return this.find(x, y, radius, (nx, ny) => this.resourceAt(nx, ny, kind) > 0.05);
  }

  waterNear(x, y, radius) {
    return this.find(x, y, radius, (nx, ny) => this.isWater(nx, ny));
  }

  placeArtifact(a) {
    this.artifacts.push(a);
    if (a.type === 'registro') {
      this.records.push(a);
      const key = this.idx(a.x, a.y);
      const list = this.recordsAt.get(key);
      if (list) list.push(a); else this.recordsAt.set(key, [a]);
    }
  }

  recordsHere(x, y) {
    return this.recordsAt.get(this.idx(x, y)) || [];
  }

  nearestArtifact(x, y, type, radius) {
    let best = null, bestD = Infinity;
    for (const a of this.artifacts) {
      if (a.type !== type) continue;
      const dx = Math.abs(((a.x - x) % this.w + this.w) % this.w);
      const dy = Math.abs(((a.y - y) % this.h + this.h) % this.h);
      const d = Math.min(dx, this.w - dx) + Math.min(dy, this.h - dy);
      if (d < bestD) { bestD = d; best = a; }
    }
    return bestD <= radius ? best : null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { World, LAND, FOREST, WATER, STONE };
}