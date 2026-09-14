'use strict';

const assert = require('assert');
const { World, FOREST, WATER, STONE } = require('../js/core/world.js');
const { mulberry32 } = require('../js/core/rng.js');

function mkWorld(seed) {
  return new World(70, 44, mulberry32(seed), { seed });
}

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

test('el mundo no es un desierto: hay bosque, agua y piedra', () => {
  for (const seed of [1, 2, 3, 5, 7, 11]) {
    const w = mkWorld(seed);
    let f = 0, wa = 0, s = 0;
    for (let i = 0; i < w.n; i++) {
      if (w.tiles[i] === FOREST) f++;
      if (w.tiles[i] === WATER) wa++;
      if (w.tiles[i] === STONE) s++;
    }
    assert(f > 100, 'bosque escaso para ' + seed);
    assert(wa > 15, 'agua escasa para ' + seed);
    assert(s > 20, 'piedra escasa para ' + seed);
  }
});

test('coordenadas tóricas acotadas', () => {
  const w = mkWorld(1);
  assert.equal(w.idx(0, 0), 0);
  assert.equal(w.idx(w.w - 1, w.h - 1), w.n - 1);
  assert.equal(w.idx(w.w, 0), 0, 'wrap x');
  assert.equal(w.idx(0, w.h), 0, 'wrap y');
  assert.equal(w.idx(-1, 0), w.w - 1, 'wrap negativo x');
});

test('las coordenadas flotantes no corrompen el terreno', () => {
  const w = mkWorld(9);
  const before = w.tiles.slice();
  w._blob(3.7, 5.4, 3, FOREST);
  const after = w.tiles;
  let changed = 0;
  for (let i = 0; i < w.n; i++) if (before[i] !== after[i]) changed++;
  assert(changed > 0, 'un blob con centro decimal debe escribir celdas');
  for (let i = 0; i < w.n; i++) assert(after[i] >= 0 && after[i] <= 3, 'celda corrupta: ' + after[i]);
  assert.equal(after[0], w.tiles[0], 'idx no mueve del sitio');
});

test('recolectar consume y recupera poco a poco', () => {
  const w = mkWorld(4);
  let found = -1;
  for (let i = 0; i < w.n; i++) if (w.berry[i] > 0.5) { found = i; break; }
  assert(found >= 0, 'debe haber bayas');
  const x = found % w.w, y = (found / w.w) | 0;
  const before = w.berry[found];
  const got = w.forage(x, y);
  assert(got > 0, 'forage devuelve comida');
  assert(w.berry[found] < before, 'la baya se consume');
});

test('buscar con radio grande no explota en coste', () => {
  const w = mkWorld(6);
  const t0 = Date.now();
  const spot = w.nearestResource(35, 22, 'wood', 9999);
  const dt = Date.now() - t0;
  assert(dt < 100, 'búsqueda de mundo demasiado lenta: ' + dt + 'ms');
  assert(spot, 'debe encontrar madera en algún lado');
  assert(w.resourceAt(spot.x, spot.y, 'wood') > 0.05);
});

test('artefactos y registros indexados por celda', () => {
  const w = mkWorld(2);
  w.placeArtifact({ type: 'fogon', x: 3, y: 3 });
  w.placeArtifact({ type: 'registro', x: 4, y: 4, lessons: [{ kind: 'tecnologia', tech: 'pozo', nivel: 60 }] });
  assert.equal(w.artifacts.length, 2);
  assert.equal(w.records.length, 1);
  assert.equal(w.recordsHere(4, 4).length, 1);
  assert.equal(w.recordsHere(3, 3).length, 0);
  assert.ok(w.nearestArtifact(3, 3, 'fogon', 1));
});

console.log('\nworld.test.js → ' + passed + ' superadas');