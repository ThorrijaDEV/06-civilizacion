'use strict';

const { FOREST, STONE } = require('./world.js');

const TECHS = ['fuego', 'choza', 'pozo', 'almacen', 'escritura'];

const COSTS = {
  fogon: { wood: 1, stone: 0 },
  choza: { wood: 4, stone: 0 },
  pozo: { wood: 2, stone: 3 },
  almacen: { wood: 5, stone: 0 },
  registro: { wood: 0, stone: 1 },
};

let ID = 1;

class Agent {
  constructor(civ, x, y, genes = {}) {
    this.id = ID++;
    this.civ = civ;
    this.x = x; this.y = y;
    this.age = 0;
    this.alive = true;
    this.born = civ.tick;
    this.band = null;
    this.g = {
      maxEnergy: genes.maxEnergy || 115,
      lifespan: genes.lifespan || 3200,
      memoryCap: genes.memoryCap || 7,
      aptitude: genes.aptitude || 1,
    };
    this.energy = this.g.maxEnergy * 0.85;
    this.skills = { recolectar: 1, construir: 1 };
    this.knowledge = { fuego: 0, choza: 0, pozo: 0, almacen: 0, escritura: 0 };
    if (genes.tech) for (const t of TECHS) this.knowledge[t] = genes.tech[t] || 0;
    this.inv = { food: 0, wood: 0, stone: 0 };
    this.memory = [];
    this.plan = null;
    this.lastWater = -50 - civ.rng() * 30;
    this.wander = null;
    this._lastWrite = -Infinity;
    this._lastRead = -Infinity;
  }

  isElder() { return this.age > this.g.lifespan * 0.7; }
  isMature() { return this.age > this.g.lifespan * 0.35; }
  hydrated() { return this.civ.tick - this.lastWater <= 90; }

  // ---------------- memoria episódica ----------------
  recall(kind) {
    let best = null, bestUse = -Infinity;
    for (const m of this.memory) {
      const score = m.used + (m.kind === kind ? 1 : 0) * 100;
      if (m.kind === kind && score > bestUse) { bestUse = score; best = m; }
    }
    return best;
  }

  remember(kind, x, y, extra = {}) {
    this.memory.push(Object.assign({ t: this.civ.tick, kind, x, y, used: 0 }, extra));
    if (this.memory.length > this.g.memoryCap) {
      this.memory.sort((a, b) => (a.used - b.used) || (a.t - b.t));
      this.memory.shift();
    }
  }

  forget(kind, x, y) {
    const i = this.memory.findIndex(m => m.kind === kind && m.x === x && m.y === y);
    if (i >= 0) this.memory.splice(i, 1);
  }

  // ---------------- comer / beber ----------------
  eat() {
    const q = this.civ.world.forage(this.x, this.y);
    if (q > 0.015) {
      this.remember('food', this.x, this.y, { q });
      this.energy = Math.min(this.g.maxEnergy, this.energy + 14 + q * 42);
      this.skills.recolectar = Math.min(5, this.skills.recolectar + 0.012);
      return true;
    }
    return false;
  }

  // ---------------- el turno ----------------
  act(civ) {
    const w = civ.world;
    this.age++;
    let cost = this.drain(civ);
    this._moved = false;

    this._seekWater(w, cost);
    this._build(w, civ);
    this._feed(w);
    this._storeSurplus();
    this._gather(civ, w);
    this._write(w, civ);
    this._learnFrom(civ);
    this._goHome(civ);

    if (this._moved) cost += 0.15;

    this._reproduce(civ);

    this._readRecords(w, civ);

    // el recuerdo que más usamos no se olvida
    if (this.memory[0]) this.memory[0].used += 1;

    // calma junto al fuego: la banda recupera fuerzas
    if (w.nearestArtifact(this.x, this.y, 'fogon', 1) || w.nearestArtifact(this.x, this.y, 'choza', 1)) {
      this.energy = Math.min(this.g.maxEnergy, this.energy + 0.18);
    }

    this.energy -= cost;
    if (this.energy <= 0) { this.alive = false; civ.events.push({ kind: 'muerte', who: this.id }); }
    else if (this.age >= this.g.lifespan) { this.alive = false; civ.events.push({ kind: 'muerte-natural', who: this.id }); }
  }

  drain(civ) {
    let mult = 1;
    const w = civ.world;
    if (w.night(civ.tick)) {
      const shelter = w.nearestArtifact(this.x, this.y, 'choza', 1) || w.nearestArtifact(this.x, this.y, 'fogon', 1);
      mult = shelter ? 0.35 : (this.knowledge.fuego >= 50 ? 1.3 : 2.0);
      if (shelter && shelter.type === 'fogon') this.knowledge.fuego = Math.min(100, this.knowledge.fuego + 0.02);
    }
    if (!this.hydrated()) mult *= 1.35;
    return 0.4 * mult;
  }

  _seekWater(w, cost) {
    if (this.hydrated() && this.drain(this.civ) < 2.4) return;
    if (this.plan && this.plan.kind === 'water') {
      const atWater = w.isWater(this.x, this.y) || !!w.nearestArtifact(this.x, this.y, 'pozo', 0);
      if (!atWater && !this.reached()) {
        this._moveToward(this.plan.x, this.plan.y);
        return;
      }
      this.lastWater = this.civ.tick;
      this.energy = Math.min(this.g.maxEnergy, this.energy + 4);
      this.remember('water', this.x, this.y);
      this.plan = null;
      return;
    }
    let target = null;
    const well = w.nearestArtifact(this.x, this.y, 'pozo', 999);
    const waterMem = this.recall('water');
    if (well) target = well;
    else if (waterMem && (w.isWater(waterMem.x, waterMem.y) || !!w.nearestArtifact(waterMem.x, waterMem.y, 'pozo', 0))) target = waterMem;
    else target = w.find(this.x, this.y, 999, (nx, ny) => w.isWater(nx, ny));
    if (!target) return;
    this.plan = { kind: 'water', x: target.x, y: target.y, t: this.civ.tick };
    if (this.inv.food > 2) this.inv.food -= 0.5; // caminar cuesta
    this._moveToward(target.x, target.y);
  }

  _feed(w) {
    const isFoodPlan = this.plan && this.plan.kind === 'food';

    // HAMBRE GRAVE: rompe cualquier plan
    if (isFoodPlan || this.energy < 36) {
      if (this.inv.food > 0) {
        const need = Math.min(this.inv.food, 2);
        this.inv.food -= need;
        this.energy = Math.min(this.g.maxEnergy, this.energy + need * 26);
        return;
      }
      if (this.band && this.band.pool > 0) {
        const need = Math.min(2, this.band.pool);
        this.band.pool -= need;
        this.inv.food += need;
        return;
      }
      if (isFoodPlan) {
        if (this.reached()) {
          if (!this.eat()) { this.forget('food', this.plan.x, this.plan.y); this.plan = null; }
          else this.plan = null;
        } else {
          this._moveToward(this.plan.x, this.plan.y);
        }
        return;
      }
      let target = null;
      const mem = this.recall('food');
      if (mem && w.resourceAt(mem.x, mem.y, 'berry') > 0.05) target = mem;
      else {
        if (mem) this.forget('food', mem.x, mem.y);
        target = w.nearestResource(this.x, this.y, 'berry', 14);
      }
      if (target) this.plan = { kind: 'food', x: target.x, y: target.y, t: this.civ.tick };
      else this._wander();
      return;
    }

    // Un plan en curso (material/water/home) se mantiene: se come al pasar
    if (this.plan && !isFoodPlan) return;

    // mordisco oportunista
    if (this.energy < 58 && w.resourceAt(this.x, this.y, 'berry') > 0.03) { this.eat(); return; }

    // leve hambre sin plan: buscar comida
    if (this.energy < 52) {
      let target = null;
      const mem = this.recall('food');
      if (mem && w.resourceAt(mem.x, mem.y, 'berry') > 0.05) target = mem;
      else {
        if (mem) this.forget('food', mem.x, mem.y);
        target = w.nearestResource(this.x, this.y, 'berry', 14);
      }
      if (target) this.plan = { kind: 'food', x: target.x, y: target.y, t: this.civ.tick };
      else this._wander();
      return;
    }

    // energía decente: recolectar de más para la banda (reserva de invierno)
    if (this.inv.food < 3 && this.energy < 72) {
      if (!this.plan || this.plan.kind !== 'recolectar') {
        const mem = this.recall('food');
        const target = (mem && w.resourceAt(mem.x, mem.y, 'berry') > 0.05)
          ? mem
          : w.nearestResource(this.x, this.y, 'berry', 12);
        if (target) this.plan = { kind: 'recolectar', x: target.x, y: target.y, t: this.civ.tick };
      }
      if (this.plan && this.plan.kind === 'recolectar') {
        if (this.reached()) {
          if (w.resourceAt(this.x, this.y, 'berry') > 0.03) {
            this.inv.food = Math.min(4, this.inv.food + w.forage(this.x, this.y));
            this.remember('food', this.x, this.y, { q: 0.3 });
          } else {
            this.forget('food', this.plan.x, this.plan.y);
            this.plan = null;
          }
        } else {
          this._moveToward(this.plan.x, this.plan.y);
        }
      }
    }
  }

  _storeSurplus() {
    if (this.inv.food > 2 && this.band) {
      const n = Math.min(this.inv.food - 1, 2);
      this.inv.food -= n;
      this.band.pool += n;
      if (this.band.storage && this.band.storage.food !== undefined) this.band.storage.food = this.band.pool;
    }
  }

  _wander() {
    if (this.wander && this.wander.t > this.civ.tick) return;
    this.wander = { t: this.civ.tick + 6, x: Math.floor(this.civ.rng() * this.civ.w), y: Math.floor(this.civ.rng() * this.civ.h) };
  }

  _build(w, civ) {
    if (this.energy <= 55 || !this.isMature() || !this.band) return;
    // urgencias vitales primero; el material en curso no se pisa
    if (this.plan && (this.plan.kind === 'food' || this.plan.kind === 'water')) return;
    if (this.plan && this.plan.kind === 'material') return;
    let build = null;
    const b = this.band;
    if (this.knowledge.almacen >= 15 && !b.storage) build = { type: 'almacen', cost: COSTS.almacen };
    else if (this.knowledge.fogon >= 20 && !w.nearestArtifact(this.x, this.y, 'fogon', 999)) build = { type: 'fogon', cost: COSTS.fogon };
    else if (this.knowledge.pozo >= 15 && !w.nearestArtifact(this.x, this.y, 'pozo', 999)) build = { type: 'pozo', cost: COSTS.pozo };
    else if (this.knowledge.choza >= 15 && !w.nearestArtifact(this.x, this.y, 'choza', 999)) build = { type: 'choza', cost: COSTS.choza };

    if (!build) return;
    const has = { wood: this.inv.wood >= build.cost.wood, stone: this.inv.stone >= build.cost.stone };
    if (has.wood && has.stone) {
      const pos = this._campSpot(w);
      w.placeArtifact({ type: build.type, x: pos.x, y: pos.y, band: b.id, tick: civ.tick, by: this.id });
      this.inv.wood -= build.cost.wood;
      this.inv.stone -= build.cost.stone;
      this.skills.construir = Math.min(5, this.skills.construir + 0.15);
      this.knowledge[build.type] = Math.min(100, this.knowledge[build.type] + (build.type === 'fogon' ? 2 : 1));
      this.remember('artefacto', pos.x, pos.y, { type: build.type });
      b.artifacts.push(build.type);
      if (build.type === 'almacen') b.storage = w.artifacts[w.artifacts.length - 1];
      civ.events.push({ kind: 'construir', who: this.id, what: build.type, x: pos.x, y: pos.y });
      this.plan = null;
    } else {
      const wantMat = has.wood ? 'stone' : 'wood';
      if (this.plan && this.plan.kind === 'material' && this.plan.mat === wantMat) return;
      const spot = w.nearestResource(this.x, this.y, wantMat, 999);
      if (spot) this.plan = { kind: 'material', mat: wantMat, x: spot.x, y: spot.y, t: civ.tick, need: build.cost };
    }
  }

  _campSpot(w) {
    if (this.band && this.band.camp) return this.band.camp;
    const seen = new Set();
    let x = this.x, y = this.y;
    for (let i = 0; i < 30; i++) {
      x = (x + ((this.civ.rng() * 6) | 0) - 3 + w.w) % w.w;
      y = (y + ((this.civ.rng() * 6) | 0) - 3 + w.h) % w.h;
      const k = y * w.w + x;
      if (!seen.has(k) && w.isLand(x, y) && !w.isForest(x, y)) { seen.add(k); break; }
      seen.add(k);
    }
    if (this.band) this.band.camp = { x, y };
    return { x, y };
  }

  _gather(civ, w) {
    if (!this.plan || this.plan.kind !== 'material') return;
    const k = this.plan.mat;
    if (this.inv.wood >= this.plan.need.wood && this.inv.stone >= this.plan.need.stone) {
      this.plan = null;
      return;
    }
    const here = k === 'wood' ? w.isForest(this.x, this.y) : w.isStone(this.x, this.y);
    if (here) {
      const got = w.harvest(this.x, this.y, k === 'wood' ? FOREST : STONE);
      if (k === 'wood') this.inv.wood += got; else this.inv.stone += got;
      this.remember('material', this.x, this.y, { mat: k });
      if (got < 0.02) this.forget('material', this.x, this.y);
    } else if (this.reached()) {
      this.forget('material', this.x, this.y);
      this.plan = null;
    } else {
      this._moveToward(this.plan.x, this.plan.y);
    }
  }

  _write(w, civ) {
    if (!this.isElder() || this.knowledge.escritura < 15 || this.energy <= 45 || this.plan) return;
    if (civ.tick - this._lastWrite < 400) return;
    const b = this.band;
    if (!b || (b.recordCount || 0) >= 5) return;
    const lesson = this._lessonForRecord(w);
    if (!lesson) return;
    const camp = b.camp || { x: this.x, y: this.y };
    const offset = (b.recordCount || 0) % 5;
    const dx = [0, 1, -1, 0, 0][offset], dy = [0, 0, 0, 1, -1][offset];
    const px = (camp.x + dx + w.w) % w.w, py = (camp.y + dy + w.h) % w.h;
    w.placeArtifact({ type: 'registro', x: px, y: py, band: b.id, tick: civ.tick, by: this.id, lessons: [lesson] });
    this.knowledge.escritura = Math.min(100, this.knowledge.escritura + 2);
    this._lastWrite = civ.tick;
    b.recordCount = (b.recordCount || 0) + 1;
    civ.events.push({ kind: 'escribir', who: this.id, x: px, y: py, lesson });
  }

  _lessonForRecord(w) {
    const mem = this.recall('food') || this.recall('water');
    if (mem) {
      const ok = mem.kind === 'water'
        ? (w.isWater(mem.x, mem.y) || !!w.nearestArtifact(mem.x, mem.y, 'pozo', 0))
        : w.resourceAt(mem.x, mem.y, 'berry') > 0.02;
      if (ok) return { kind: 'recurso', recurso: mem.kind, x: mem.x, y: mem.y };
    }
    const known = TECHS.filter(t => this.knowledge[t] >= 30);
    if (known.length) return { kind: 'tecnologia', tech: known[0], nivel: Math.round(this.knowledge[known[0]]) };
    return null;
  }

  _learnFrom(civ) {
    let gains = false;
    for (const other of civ.agents) {
      if (other === this || !other.alive || !other.isElder()) continue;
      const d = this._distTo(other.x, other.y);
      if (d > 7) continue;
      for (const t of TECHS) {
        if (other.knowledge[t] >= 15 && other.knowledge[t] > this.knowledge[t]) {
          const gain = this.g.aptitude * 0.8 * (0.2 + other.skills.construir * 0.15);
          this.knowledge[t] = Math.min(other.knowledge[t], this.knowledge[t] + gain);
          gains = true;
        }
      }
      if (gains) return;
    }
  }

  _reproduce(civ) {
    if (this.energy <= this.g.maxEnergy * 0.5 || !this.isMature()) return;
    if (this.plan && this.plan.kind !== 'recolectar') return;
    if (civ.population() >= civ.popCap()) return;
    const mate = civ.mateFor(this);
    if (!mate) return;
    mate.energy -= this.g.maxEnergy * 0.3;
    this.energy -= this.g.maxEnergy * 0.3;
    civ.birth(this, mate);
  }

  _readRecords(w, civ) {
    if (civ.tick - this._lastRead < 60) return;
    const here = w.recordsHere(this.x, this.y);
    if (!here.length) return;
    this._lastRead = civ.tick;
    for (const rec of here) {
      for (const l of rec.lessons) {
        if (l.kind === 'recurso') this.remember(l.recurso === 'food' ? 'food' : 'water', l.x, l.y, { q: 0.3, fromRecord: true });
        else if (l.kind === 'tecnologia' && this.knowledge[l.tech] < l.nivel) this.knowledge[l.tech] = l.nivel;
      }
    }
    this.knowledge.escritura = Math.min(100, this.knowledge.escritura + 0.5);
  }

  _distTo(x, y) {
    const w = this.civ.world;
    const dx = Math.abs(((x - this.x) % w.w + w.w) % w.w);
    const dy = Math.abs(((y - this.y) % w.h + w.h) % w.h);
    return Math.min(dx, w.w - dx) + Math.min(dy, w.h - dy);
  }

  _goHome(civ) {
    // cohesión social: sin ninguna urgencia, volver al campamento
    if (this.plan || !this.band || !this.band.camp) return;
    const d = this._distTo(this.band.camp.x, this.band.camp.y);
    if (d > 3) this._moveToward(this.band.camp.x, this.band.camp.y);
  }

  reached() {
    return this.plan && this.plan.x === this.x && this.plan.y === this.y;
  }

  _moveToward(tx, ty) {
    const w = this.civ.world;
    let dx = ((tx - this.x) % w.w + w.w) % w.w;
    if (dx > w.w / 2) dx -= w.w;
    let dy = ((ty - this.y) % w.h + w.h) % w.h;
    if (dy > w.h / 2) dy -= w.h;
    if (Math.abs(dx) > Math.abs(dy)) this.x = (this.x + Math.sign(dx) + w.w) % w.w;
    else if (dy !== 0) this.y = (this.y + Math.sign(dy) + w.h) % w.h;
    else if (dx !== 0) this.x = (this.x + Math.sign(dx) + w.w) % w.w;
    if (dx !== 0 || dy !== 0) this._moved = true;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Agent, TECHS, COSTS };
}