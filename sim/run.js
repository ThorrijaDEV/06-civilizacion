#!/usr/bin/env node
'use strict';

const { Civilization } = require('../js/core/civ.js');

const seed = +(process.argv[2] || process.env.SEED || 7);
const ticks = +(process.argv[3] || process.env.TICKS || 12000);
const every = +(process.argv[4] || process.env.EVERY || 200);

const civ = new Civilization({ w: 70, h: 44, seed, tickMax: ticks });
civ.run(ticks);

const labels = ['t', 'pop', 'E', 'conoc', 'artf', 'regis', 'pool'];
console.log('\n== ALDEA · semente ' + seed + ' ==');
console.log(labels.join('\t'));
for (const row of civ.history) {
  if (row.t % every === 0) {
    console.log([row.t, row.pop, row.energy.toFixed(0), row.knowledge, row.buildings, row.records, row.stored].join('\t'));
  }
}
const s = civ.summary();
console.log('\n' + JSON.stringify(s, null, 2));

// picos y valles de población
let maxPop = 0, minPop = Infinity;
for (const row of civ.history) { if (row.pop > maxPop) maxPop = row.pop; if (row.pop < minPop) minPop = row.pop; }
console.log('población máx ' + maxPop + ' · mín ' + minPop);
if (civ.epochs.length) console.log('épocas: ' + civ.epochs.length + ' (¿memoria escrita la trajo de vuelta?)');

// determinismo
const a = new Civilization({ w: 70, h: 44, seed: 3, tickMax: 4000 });
const b = new Civilization({ w: 70, h: 44, seed: 3, tickMax: 4000 });
a.run(4000); b.run(4000);
const same = a.history.map(h => h.pop).join() === b.history.map(h => h.pop).join()
  && a.history.map(h => h.records).join() === b.history.map(h => h.records).join();
console.log('\ndeterminismo (mismo seed, 4000 ticks): ' + (same ? 'OK' : '¡FALLA!'));