'use strict';

(() => {
  const canvas = document.getElementById('mapa');
  const ctx = canvas.getContext('2d');
  const chart = document.getElementById('chart');
  const cctx = chart.getContext('2d');

  const ui = {
    pop: document.getElementById('m-pop'),
    know: document.getElementById('m-know'),
    build: document.getElementById('m-build'),
    rec: document.getElementById('m-rec'),
    birth: document.getElementById('m-birth'),
    death: document.getElementById('m-death'),
    band: document.getElementById('m-band'),
    epoch: document.getElementById('m-epoch'),
    records: document.getElementById('records'),
    events: document.getElementById('events'),
    seed: document.getElementById('seed'),
    reiniciar: document.getElementById('reiniciar'),
    play: document.getElementById('play'),
    ticks: document.getElementById('ticks'),
    vel: document.getElementById('vel'),
  };

  let state = null;        // último snapshot
  let world = null;        // malla: cached por semilla
  let corriendo = true;
  let timer = null;

  const COLORS = ['#7bdff2', '#ffb86b', '#a4ff7f', '#ff7ab6', '#d5a6ff', '#ffe27a', '#9be2a6'];
  const bandColor = id => COLORS[(id - 1) % COLORS.length];

  function scale() { return canvas.width / state.w; }

  function dibujarMundo() {
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const s = scale();
    // terreno desde la malla cacheadA
    if (world) {
      for (let y = 0; y < state.h; y++) {
        for (let x = 0; x < state.w; x++) {
          const t = world.tiles[y * state.w + x];
          let color = '#3a4232';
          if (t === 1) color = '#2e5a2e';
          else if (t === 2) color = '#2a4a6e';
          else if (t === 3) color = '#5a5d60';
          const b = world.berry[y * state.w + x];
          if (t !== 2 && b > 0.25) color = mix(color, '#7a4a2e', Math.min(0.9, b));
          ctx.fillStyle = color;
          ctx.fillRect(Math.round(x * s), Math.round(y * s), Math.ceil(s), Math.ceil(s));
        }
      }
    }
    // bandas: mancha del campamento
    for (const b of state.bands) {
      if (!b.camp) continue;
      ctx.fillStyle = bandColor(b.id);
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.arc(b.camp.x * s, b.camp.y * s, 5 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // artefactos
    for (const a of state.artifacts) {
      ctx.fillStyle = '#ff9b6a';
      ctx.beginPath();
      if (a.type === 'pozo') ctx.arc(a.x * s, a.y * s, 1.6 * s, 0, Math.PI * 2);
      else {
        ctx.fillRect(a.x * s - 1.4 * s, a.y * s - 1.4 * s, 2.8 * s, 2.8 * s);
      }
      ctx.fill();
    }
    // registros escritos
    for (const r of state.records) {
      ctx.fillStyle = '#e5c27c';
      ctx.save();
      ctx.translate(r.x * s, r.y * s);
      ctx.rotate(-0.4);
      ctx.fillRect(-1 * s, -0.7 * s, 2 * s, 1.4 * s);
      ctx.restore();
    }
    // agentes
    for (const a of state.agents) {
      ctx.fillStyle = a.band ? bandColor(a.band) : '#ffffff';
      ctx.fillRect((a.x - 0.4) * s, (a.y - 0.4) * s, 0.8 * s, 0.8 * s);
    }
  }

  function mix(a, b, t) {
    const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
    const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
    const m = pa.map((v, i2) => Math.round(v + (pb[i2] - v) * t));
    return '#' + m.map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function dibujarChart() {
    cctx.clearRect(0, 0, chart.width, chart.height);
    if (!state || !state.history.length) return;
    const h = state.history;
    const W = chart.width, H = chart.height, pad = 4;
    const series = [
      { key: 'pop', color: '#e6f0dc' },
      { key: 'knowledge', color: '#a9e08f' },
      { key: 'records', color: '#e5c27c' },
      { key: 'buildings', color: '#ff9b6a' },
    ];
    for (const sr of series) {
      let max = 1, min = 0;
      for (const p of h) { if (p[sr.key] > max) max = p[sr.key]; if (p[sr.key] < min) min = p[sr.key]; }
      if (max - min < 1) max = min + 1;
      cctx.strokeStyle = sr.color;
      cctx.lineWidth = 1.4;
      cctx.beginPath();
      h.forEach((p, i) => {
        const x = pad + (i / (h.length - 1)) * (W - 2 * pad);
        const y = H - pad - ((p[sr.key] - min) / (max - min)) * (H - 2 * pad);
        i === 0 ? cctx.moveTo(x, y) : cctx.lineTo(x, y);
      });
      cctx.stroke();
    }
  }

  function pintarPanel() {
    const s = state.summary;
    ui.pop.textContent = s.pop;
    ui.know.textContent = s.knowledge;
    ui.build.textContent = s.artifacts - s.records;
    ui.rec.textContent = s.records;
    ui.birth.textContent = s.births;
    ui.death.textContent = s.deaths;
    ui.band.textContent = s.bands;
    ui.epoch.textContent = s.epochs + (state.epoch ? ' (época ' + state.epoch + ')' : '');
  }

  function pintarListas() {
    if (state.records.length) {
      ui.records.innerHTML = state.records.slice().reverse().map(r => {
        const notas = (r.lessons || []).join(' · ');
        return '<li><b>(' + r.x + ',' + r.y + ')</b> ' + (r.envelope || 'losa de tierra') +
          (notas ? '<span class="muted"> — ' + notas + '</span>' : '') + '</li>';
      }).join('');
    }
    if (state.events.length) {
      ui.events.innerHTML = state.events.slice().reverse().map(e =>
        '<li><b>t' + e.tick + '</b> ' + (e.text || e.kind + ' · ' + (e.who || '') + (e.epoch ? ' (época ' + e.epoch + ')' : '')) + '</li>'
      ).join('');
    }
  }

  function render() {
    dibujarMundo();
    dibujarChart();
    pintarPanel();
    pintarListas();
  }

  async function get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  function cargarWorld(s) {
    // al cambiar de semilla el mundo es nuevo
    world = s.world || null;
  }

  async function tick() {
    if (!corriendo) return;
    const pasos = Math.min(2000, +(ui.ticks.value || 100));
    const s = await get('/api/avanzar?ticks=' + pasos);
    state = s;
    if (!world) cargarWorld(s); // servidor solo envía sed con world en estado/reiniciar
    render();
  }

  function crono() {
    clearInterval(timer);
    const rate = parseFloat(ui.vel.value) || 3;
    timer = setInterval(tick, 900 / rate);
  }

  ui.play.addEventListener('click', () => {
    corriendo = !corriendo;
    ui.play.textContent = corriendo ? '⏸ pausa' : '▶ play';
    if (corriendo) tick();
    crono();
  });
  ui.vel.addEventListener('change', crono);
  ui.ticks.addEventListener('change', crono);

  ui.reiniciar.addEventListener('click', async () => {
    const seed = Math.max(1, +(ui.seed.value || 7));
    const s = await get('/api/reiniciar?seed=' + seed);
    state = s;
    cargarWorld(s);
    render();
  });

  // la malla viaja solo con estado/reiniciar; el servidor la adjunta en esos casos
  async function inicial() {
    const s = await get('/api/estado');
    state = s;
    world = s.world;
    render();
    crono();
  }
  inicial();
})();