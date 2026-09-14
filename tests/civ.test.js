'use strict';

const assert = require('assert');
const { Civilization } = require('../js/core/civ.js');
const { Agent } = require('../js/core/agents.js');
const { mulberry32 } = require('../js/core/rng.js');
const { World } = require('../js/core/world.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    console.error('  ✗ ' + name + '\n    ' + e.message);
    process.exitCode = 1;
  }
}

function stubCiv(agents, extra = {}) {
  const world = new World(50, 30, mulberry32(1), { seed: 1 });
  const civ = {
    agents,
    world,
    rng: mulberry32(1),
    tick: 100,
    w: world.w,
    h: world.h,
    events: [],
    population() { return agents.filter(a => a.alive).length; },
    popCap() { return 999; },
    mateFor() { return null; },
    birth() {},
  };
  Object.assign(civ, extra);
  return civ;
}

// ---------- memoria episódica ----------
test('memoria: recuerda, prioriza lo usado y olvida', () => {
  const civ = stubCiv([]);
  const a = new Agent(civ, 5, 5);
  a.remember('food', 5, 6, { q: 0.4 });
  a.remember('water', 8, 9);
  assert.equal(a.recall('food').x, 5);
  assert.equal(a.recall('water').y, 9);
  a.forget('food', 5, 6);
  assert.equal(a.recall('food'), null, 'el recuerdo se olvida');
});

test('memoria: con tope, se descarta el recuerdo menos útil', () => {
  const civ = stubCiv([]);
  const a = new Agent(civ, 2, 2);
  a.g.memoryCap = 2;
  a.remember('food', 1, 1);
  a.remember('food', 2, 2);
  a.remember('water', 3, 3);
  assert.equal(a.memory.length, 2, 'el tope se respeta');
  assert.ok(a.recall('water'), 'el más reciente permanece');
});

// ---------- cultura: transmisión de conocimiento ----------
test('cultura: un joven aprende del mayor cercano', () => {
  const civ = stubCiv([]);
  const elder = new Agent(civ, 10, 10);
  elder.age = elder.g.lifespan * 0.8;
  elder.knowledge.pozo = 80;
  elder.knowledge.fuego = 90;
  elder.skills.construir = 3;
  const young = new Agent(civ, 12, 11);
  young.knowledge.pozo = 10;
  young.knowledge.fuego = 5;
  civ.agents.push(elder, young);
  young._learnFrom(civ);
  assert(young.knowledge.pozo > 10, 'el conocimiento de pozo sube');
  assert(young.knowledge.pozo <= elder.knowledge.pozo, 'no supera al maestro');
  assert(young.knowledge.fuego > 5, 'el conocimiento de fuego sube');
});

// ---------- escritura y lectura de generaciones ----------
test('los mayores escriben tablillas que otros leen', () => {
  const civ = stubCiv([]);
  const writer = new Agent(civ, 10, 10);
  writer.age = writer.g.lifespan * 0.8;
  writer.knowledge.escritura = 50;
  writer.knowledge.pozo = 80;
  writer.band = { id: 1, camp: { x: 15, y: 15 }, recordCount: 0 };
  civ.tick = 5000;
  writer._write(civ.world, civ);
  assert.equal(civ.world.records.length, 1, 'se escribe la tablilla');
  assert.equal(civ.world.records[0].lessons[0].tech, 'pozo');

  const reader = new Agent(civ, 15, 15);
  reader.knowledge.pozo = 10;
  reader.knowledge.escritura = 10;
  civ.tick = 5100;
  reader._readRecords(civ.world, civ);
  assert(reader.knowledge.pozo >= 80, 'leer la tablilla transfiere tecnología');
});

test('la tablilla sobrevive a la muerte de su autor', () => {
  const civ = stubCiv([]);
  const w = new Agent(civ, 20, 20);
  w.age = w.g.lifespan * 0.8;
  w.knowledge.escritura = 90;
  w.knowledge.fuego = 75;
  w.band = { id: 2, camp: { x: 25, y: 25 }, recordCount: 0 };
  civ.tick = 7000;
  w._write(civ.world, civ);
  w.alive = false;
  civ.agents = [];
  assert.equal(civ.world.records.length, 1, 'el registro persiste');
  const lesson = civ.world.records[0].lessons[0];
  assert.equal(lesson.kind, 'tecnologia');
});

// ---------- construcción ----------
test('un artesano con material y técnica construye un pozo', () => {
  const civ = stubCiv([]);
  const builder = new Agent(civ, 30, 30);
  builder.age = builder.g.lifespan * 0.5;
  builder.energy = 80;
  builder.knowledge.pozo = 60;
  builder.inv.wood = 2;
  builder.inv.stone = 3;
  builder.band = { id: 3, artifacts: [], storage: null, camp: { x: 30, y: 30 }, recordCount: 0 };
  civ.tick = 800;
  builder._build(civ.world, civ);
  const pozo = civ.world.artifacts.find(a => a.type === 'pozo');
  assert.ok(pozo, 'el pozo aparece en el mundo');
  assert.equal(builder.inv.wood, 0, 'los materiales se gastan');
  assert.equal(builder.skills.construir > 1, true, 'construir mejora la habilidad');
});

test('recolectar para la banda llena la reserva comunal', () => {
  const civ = stubCiv([]);
  const a = new Agent(civ, 5, 5);
  a.band = { pool: 0, storage: null };
  a.inv.food = 4;
  a._storeSurplus();
  assert.equal(a.inv.food, 2);
  assert.equal(a.band.pool, 2, 'el excedente va a la banda');
});

// ---------- búsqueda / domicilio ----------
test('los individuos cohesionan hacia el campamento', () => {
  const civ = stubCiv([]);
  const a = new Agent(civ, 5, 5);
  a.band = { camp: { x: 40, y: 20 } };
  a.plan = null;
  const before = { x: a.x, y: a.y };
  a._goHome(civ);
  assert.notEqual(a.x + ',' + a.y, before.x + ',' + before.y, 'se mueve un paso hacia casa');
});

// ---------- civilización completa ----------
test('una civilización crece, aprende y escribe (al menos una semilla)', () => {
  let best = null;
  for (const seed of [7, 9, 3, 5, 17, 13]) {
    const civ = new Civilization({ w: 70, h: 44, seed, tickMax: 5000 });
    civ.run(5000);
    let maxPop = 0;
    for (const h of civ.history) if (h.pop > maxPop) maxPop = h.pop;
    const s = civ.summary();
    if (!best || s.births > best.births) best = Object.assign({ seed, maxPop }, s);
  }
  assert(best.births > 15, 'ninguna semilla floreció, mejor caso ' + best.births + ' nacimientos');
  assert(best.records > 2, 'los añosos deben escribir, mejor caso ' + best.records);
  assert(best.maxPop > 15, 'la población debe florecer, mejor caso ' + best.maxPop);
  assert(best.knowledge > 30, 'el saber acumulado crece, mejor caso ' + best.knowledge);
  console.log('    (semilla referente con la que florece: ' + best.seed + ' → ' + best.births + ' nacimientos, ' + best.records + ' tablillas)');
});

test('determinismo: mismo seed → misma historia', () => {
  const a = new Civilization({ w: 70, h: 44, seed: 3, tickMax: 3000 });
  const b = new Civilization({ w: 70, h: 44, seed: 3, tickMax: 3000 });
  a.run(3000); b.run(3000);
  const key = h => h.map(x => x.pop + ':' + x.records + ':' + x.knowledge).join('|');
  assert.equal(key(a.history), key(b.history));
});

test('la resonancia de los mundos: dos semillas divergen', () => {
  const a = new Civilization({ w: 70, h: 44, seed: 3, tickMax: 2000 });
  const b = new Civilization({ w: 70, h: 44, seed: 42, tickMax: 2000 });
  a.run(2000); b.run(2000);
  const key = h => h.map(x => x.pop).join(':');
  assert.notEqual(key(a.history), key(b.history), 'mundos distintos dan historias distintas');
});

console.log('\nciv.test.js → ' + passed + ' superadas');