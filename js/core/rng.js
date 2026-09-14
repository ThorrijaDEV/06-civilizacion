'use strict';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AldeaRng = { mulberry32 };

if (typeof module !== 'undefined' && module.exports) module.exports = AldeaRng;
if (typeof window !== 'undefined') window.AldeaRng = AldeaRng;