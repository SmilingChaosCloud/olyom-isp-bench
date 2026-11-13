import { STAGES, SECTORS, defaults, resolve } from './params.js';
import { render, testScene, SIZE } from './pipeline.js';
import { decodePng, toMosaic, cfaIndex } from './png.js';
import { identify } from './firmware.js';
import { NativeIsp, hex } from './native.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const ORIGIN = { fw: 'Firmware', doc: 'Documented', model: 'Assumed', user: 'Yours' };

// Origin of a control by its layer: what can actually be reached on the camera.
const LAYER_ORIGIN = {
  camera: 'Reachable: camera menu setting.',
  reg: 'Reachable: ISP register the custom firmware writes.',
  both: 'Reachable: camera menu setting (also an ISP register).',
  mode: 'Determined by the picture mode: the firmware writes it, but it is not an independent control.',
  '': 'Not reachable: bench model (software stand-in or hardware-fixed).',
};
// One-line description per control (key = stage.param). Origin is appended from the layer.
const DESC = {
  'levels.cfa': 'Sensor Bayer colour-filter order. Fixed by the sensor hardware.',
  'levels.black': 'Black-level subtraction. Bench normalisation of the raw.',
  'levels.white': 'White-level scaling. Bench normalisation of the raw.',
  'wb.r': 'Red white-balance gain. Bench model — the camera WB path is not separated.',
  'wb.g': 'Green white-balance gain. Bench model.',
  'wb.b': 'Blue white-balance gain. Bench model.',
  'wb.ev': 'Exposure compensation. Bench model.',
  'demosaic.method': 'Demosaic algorithm (public stand-in). The camera’s real demosaic is fixed in hardware and unknown.',
  'matrix.m0': 'Colour-matrix coefficient. The camera has a 3×3 matrix but its calibration is not mapped — set by you.',
  'sixaxis.mode': 'Picture mode (COLOR, Vivid, MONO…). Selects which firmware colour table is used.',
  'sixaxis.s': 'Per-axis saturation of the picture mode’s built-in colour character. Mode-driven — not an independent control; the bench exposes it as a free slider.',
  'sixaxis.h': 'Per-axis hue of the picture mode’s built-in colour character. Mode-driven — not an independent control; the bench exposes it as a free slider.',
  'gamma.gamma': 'Tone / gamma curve. Bench model — the firmware curve families are not yet run.',
  'gamma.contrast': 'Contrast on the tone curve. Bench model.',
  'chroma.gain': 'Global chroma (saturation) gain. Bench model.',
  'chroma.depth': 'Colour deepen: holds the brightest channel and pushes the others down (richer, darker). Bench model, fitted to OEM colour depth.',
  'hsl.h': 'Per-sector hue shift. Opened up by the custom-firmware projects — editable in ISP-registers mode. Follows the documented slider table.',
  'hsl.s': 'Per-sector saturation (your colour profile). Reachable from the camera menu (±5) and the ISP registers; the bench allows ±7. Goes through the firmware builder when loaded.',
  'hsl.l': 'Per-sector lightness. Opened up by the custom-firmware projects — editable in ISP-registers mode. Follows the documented slider table.',
  'tone.shadows': 'Shadow tone shift. Uses the firmware tone LUT when loaded; the slider mapping is a bench model.',
  'tone.midtones': 'Midtone tone shift. Firmware LUT when loaded; slider mapping is a bench model.',
  'tone.highlights': 'Highlight tone shift. Firmware LUT when loaded; slider mapping is a bench model.',
  'tint.mono': 'Monochrome — zeroes chroma. ISP register.',
  'tint.cb': 'Monochrome tint, blue–yellow (Cb). ISP register.',
  'tint.cr': 'Monochrome tint, green–red (Cr). ISP register.',
  'chromaedge.blur': 'Chroma low-pass width (DemCFltr). Measured ~1.3 from the chart; the chroma filter lives in the demosaic hardware.',
  'chromaedge.shift': 'Edge thinning — bright pushes into the darker side. Bench model of the net thinning, not a single camera register.',
  'chromaedge.fcslmt': 'False-colour-suppression limit. Real ISP register (YC1_FCSLMT); the camera leaves it at 0.',
  'chromaedge.fcsca1': 'False-colour-suppression edge gain. Real ISP register (YC1_FCSCA1).',
  'chromaedge.fcskrbg': 'False-colour-suppression strength. Real ISP register (YC1_FCSKRBG).',
  'soften.sigma': 'Pre-sharpen detail softening. Bench stand-in for the camera’s noise reduction / demosaic detail loss.',
  'sharpen.path': 'Edge path: Bench (measured fit) or the decoded Workspace shaper. Bench model choice.',
  'sharpen.s': 'Sharpness setting (−2..+2). Camera menu setting; it picks the gain below.',
  'sharpen.sv': 'Sensitivity (raw Sv / ISO). Camera condition — the gain and coring depend on it.',
  'sharpen.A': 'Coring threshold — edges below it are ignored. ISP register (YC1_A).',
  'sharpen.K': 'Edge gain (KEDGE) — this is what makes the halos; 0 = none. ISP register.',
  'sharpen.shift': 'Gain shift (>>N). ISP register; firmware uses 6.',
  'sharpen.limPos': 'Positive (bright) overshoot limit (ECLP). ISP register.',
  'sharpen.limNeg': 'Negative (dark) undershoot limit (ECLN). ISP register.',
  'sharpen.scale': 'Edge scale (Bench path only). Bench fit, not a camera register.',
  'sharpen.bright': 'Brightness-dependent gain (Bench path only). Bench fit.',
  'sharpen.kernel': 'Edge-extraction filter. The real taps are fixed in hardware; “Measured 5×5” is their validated net form.',
  'sharpen.radius': 'Gaussian high-pass radius (Gaussian kernel only). Bench model.',
  'sharpen.es': 'EDGE_STRENGTH — scales the gain by a second signal. ISP register (Workspace path).',
  'sharpen.esel': 'Invert the edge sign (ESEL). ISP register.',
  'sharpen.esvx': 'Horizontal position gain (ESVX). ISP register.',
  'sharpen.esvy': 'Vertical position gain (ESVY). ISP register.',
  'sharpen.der': 'Edge-LUT high slope (DER). ISP register; mapping inferred.',
  'sharpen.keg': 'Edge-LUT low slope (KEG). ISP register; mapping inferred.',
  'grain.level': 'Creative grain level. Camera menu setting.',
  'grain.gain': 'Grain gain. ISP register / documented formula.',
  'grain.seed': 'Grain RNG seed. Bench model.',
  'shading.step': 'Creative shading amount. Bench model (documented desktop formula).',
  'shading.word': 'Coordinate scaling word. ISP register.',
  'shading.protection': 'Highlight protection. Desktop prototype, not stock camera behaviour.',
  'shading.midpoint': 'Protection midpoint. Bench model.',
};
// Look up a description, collapsing indexed keys (matrix.m3, sixaxis.s2, hsl.h5) to their family.
function descFor(key) {
  if (DESC[key]) return DESC[key];
  const fam = key.replace(/\d+$/, '');
  if (DESC[fam]) return DESC[fam];
  if (/^matrix\.m/.test(key)) return DESC['matrix.m0'];
  return '';
}

const state = { v: defaults(), source: 'camera', mosaic: null, name: 'Built-in test scene', decoded: null, fw: null, fwInfo: null, cache: new Map(), controls: new Map(), lastOutput: null, msg: '' };

const inCtx = $('#in').getContext('2d'), outCtx = $('#out').getContext('2d');
function drawInput() {
  const d = new ImageData(SIZE, SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) { const v = Math.round(Math.min(1, Math.max(0, state.mosaic[i])) * 255); d.data[4 * i] = d.data[4 * i + 1] = d.data[4 * i + 2] = v; d.data[4 * i + 3] = 255; }
  inCtx.putImageData(d, 0, 0);
}
function useScene() { state.decoded = null; state.name = 'Built-in test scene'; state.mosaic = testScene(cfaIndex(state.v['levels.cfa'])); drawInput(); }

let queued = false;
function schedule() { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; run(); }); } }
function run() {
  const t0 = performance.now();
  const r = resolve(state.v, state.source, state.fw, state.cache);
  const t1 = performance.now();
  const out = render(state.mosaic, r.p);
  const t2 = performance.now();
  outCtx.putImageData(new ImageData(out, SIZE, SIZE), 0, 0);
  state.lastOutput = r;
  syncControls(r);
  drawStrip(r);
  drawLog(r);
  const insns = r.log.reduce((a, l) => a + l.calls.reduce((x, c) => x + c.insns, 0), 0);
  $('#timing').textContent = `Rendered in ${Math.round(t2 - t1)} ms` + (state.fw && state.source === 'camera' ? `, firmware builders ${(t1 - t0).toFixed(1)} ms, ${insns.toLocaleString('en')} MN103 instructions` : '');
  $('#inname').textContent = state.name;
}

function originOf(st, r) { return r.origin[st.id] || 'user'; }
function drawStrip(r) {
  const strip = $('#strip');
  STAGES.forEach((st, i) => {
    const b = strip.children[i], on = state.v[st.id + '.on'], o = originOf(st, r);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.dataset.values = o; b.dataset.pixels = st.pixels;
    b.title = `${st.name}. Values: ${ORIGIN[o]}. Pixels: ${ORIGIN[st.pixels]}. Click to ${on ? 'bypass' : 'enable'}.`;
    const head = document.getElementById('h-' + st.id);
    head.querySelector('.values').textContent = 'Values: ' + ORIGIN[o]; head.querySelector('.values').dataset.o = o;
    head.querySelector('.pixels').textContent = 'Pixels: ' + ORIGIN[st.pixels]; head.querySelector('.pixels').dataset.o = st.pixels;
    head.parentElement.classList.toggle('off', !on);
  });
}
function syncControls(r) {
  for (const [key, c] of state.controls) {
    const eff = effLayer(c.layer), want = state.source === 'camera' ? 'camera' : 'reg';
    const layered = eff && eff !== 'both' && eff !== want;
    const value = layered && key in r.shown ? r.shown[key] : state.v[key];
    c.set(value); c.disable(!!layered || !!(c.when && c.when(state.v)));
  }
}
function drawLog(r) {
  const box = $('#log');
  box.replaceChildren();
  if (!state.fw || state.source !== 'camera') { box.append(el('p', '', state.fw ? 'Switch the parameter source to camera controls to run the firmware builders.' : 'Load firmware to see the values its builders produce.')); return; }
  const t = el('table'), hr = el('tr');
  ['Builder', 'Input', 'Instructions', 'Result'].forEach((x) => hr.append(el('th', '', x)));
  t.append(hr);
  for (const l of r.log) {
    const tr = el('tr', l.error ? 'bad' : '');
    tr.append(el('td', '', l.key), el('td', '', l.name), el('td', 'n', l.calls.reduce((a, c) => a + c.insns, 0).toLocaleString('en')));
    let res = l.error || '';
    if (!l.error && l.res !== undefined && l.res !== null) {
      const x = l.res;
      if (l.key === 'sharpen') res = `A ${x.coring}, K ${x.gain}, limits ${x.limitA} / ${x.limitB}, bank+40 ${hex(x.regs['bank+40'])}, bank+44 ${hex(x.regs['bank+44'])}`;
      else if (l.key === 'sixaxis') res = `S ${x.sat.join(' ')}, H ${x.hue.join(' ')}`;
      else if (l.key === 'tone') res = `LUT at ${hex(x.pointer)}, ends ${x.lut[255]}`;
      else if (l.key === 'tint') res = 'control ' + hex(x);
      else if (l.key === 'grain') res = `gain ${x.gain}, seed word ${hex(x.seed)}`;
      else if (l.key === 'hsl') res = `S coefficients ${x.co.join(' ')}`;
    }
    tr.append(el('td', 'r', res));
    t.append(tr);
  }
  const any = r.log.some((l) => l.error);
  $('#fwfail').hidden = !any;
  box.append(t);
}

function setValue(key, x) {
  state.v[key] = x;
  if (key === 'levels.cfa') { if (state.decoded) applyDecoded(); else useScene(); }
  schedule();
}
// Appends a row's reset button and links it to the row's read-only state.
function finishRow(row, key, q) {
  const b = el('button', 'reset1', '\u21ba'); b.type = 'button'; b.title = 'Reset to default'; b.setAttribute('aria-label', 'Reset ' + q.label);
  b.addEventListener('click', () => setValue(key, q.def));
  row.append(b);
  const c = state.controls.get(key), d = c.disable;
  c.when = q.off; c.disable = (off) => { d(off); b.disabled = off; };
  return row;
}
function fmt(x) { return String(x).replace('-', '\u2212'); }
// A control is reachable (blue dot) when a real camera menu or ISP register sets it. 'mode' (picture-mode
// driven) and the bench stand-ins are not independently reachable (pink dot).
const isReachable = (layer) => layer === 'camera' || layer === 'reg' || layer === 'both';
// Which global source a layer is editable under; 'mode' tracks 'reg' (free in ISP mode, shows firmware in camera mode).
const effLayer = (layer) => (layer === 'mode' ? 'reg' : layer);
function control(key, q) {
  const row = el('div', 'row'), id = 'c-' + key.replace('.', '-');
  row.dataset.key = key; row.dataset.layer = q.layer || '';
  const reach = isReachable(q.layer);
  const lab = el('label', 'plabel'); lab.htmlFor = id;
  lab.append(el('span', 'dot' + (reach ? ' reach' : '')), document.createTextNode(q.label));
  row.append(lab);
  const commit = (x) => setValue(key, x);
  if (q.type === 'select') {
    const s = el('select'); s.id = id;
    for (const [v, t] of q.options) { const o = el('option', '', t); o.value = v; s.append(o); }
    s.addEventListener('change', () => commit(s.value));
    row.append(s); row.classList.add('wide');
    state.controls.set(key, { layer: q.layer, set: (v) => { s.value = String(v); }, disable: (d) => { s.disabled = d; row.classList.toggle('ro', d); } });
    return finishRow(row, key, q);
  }
  if (q.type === 'check') {
    const c = el('input'); c.type = 'checkbox'; c.id = id;
    c.addEventListener('change', () => commit(c.checked));
    row.append(c); row.classList.add('wide');
    state.controls.set(key, { layer: q.layer, set: (v) => { c.checked = !!v; }, disable: (d) => { c.disabled = d; row.classList.toggle('ro', d); } });
    return finishRow(row, key, q);
  }
  const r = el('input'), n = el('input');
  r.type = 'range'; n.type = 'number';
  for (const e of [r, n]) { e.min = q.min; e.max = q.max; e.step = q.step; e.dataset.def = q.def; }
  r.id = id; r.setAttribute('aria-label', q.label); n.setAttribute('aria-label', q.label + ' value');
  const clampv = (x) => Math.min(q.max, Math.max(q.min, x));
  r.addEventListener('input', () => { n.value = r.value; commit(+r.value); });
  n.addEventListener('keydown', (ev) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
    ev.preventDefault();
    if (n.value === '') n.value = state.v[key];
    if (ev.key === 'ArrowUp') n.value = q.max; else if (ev.key === 'ArrowDown') n.value = q.min;
    else if (ev.key === 'ArrowRight') n.stepUp(); else if (ev.key === 'ArrowLeft') n.stepDown();
    else if (ev.key === 'Home') n.value = q.def; else n.value = snapMid();   // End
    const x = clampv(+n.value); n.value = x; r.value = x; commit(x);
  });
  n.addEventListener('input', () => { if (n.value !== '' && !isNaN(+n.value)) { const x = clampv(+n.value); r.value = x; commit(x); } });
  n.addEventListener('change', () => { n.value = state.v[key]; });
  r.addEventListener('pointerdown', () => r.focus());   // some browsers do not focus a slider on click
  const snapMid = () => { const m = (q.min + q.max) / 2; return clampv(+(Math.round((m - q.min) / q.step) * q.step + q.min).toFixed(6)); };
  r.addEventListener('keydown', (ev) => {
    let x;
    if (ev.key === 'ArrowUp') x = q.max;
    else if (ev.key === 'ArrowDown') x = q.min;
    else if (ev.key === 'Home') x = q.def;           // Home → default
    else if (ev.key === 'End') x = snapMid();        // End → middle of range
    else return;
    ev.preventDefault();
    r.value = x; n.value = x; commit(x);
  });
  r.addEventListener('dblclick', () => { n.value = q.def; r.value = q.def; commit(q.def); });
  row.append(r, n);
  state.controls.set(key, { layer: q.layer, set: (v) => { if (document.activeElement !== n) n.value = v; r.value = v; }, disable: (d) => { r.disabled = d; n.disabled = d; row.classList.toggle('ro', d); } });
  return finishRow(row, key, q);
}
function addFold(p, name) {
  const b = el('button', 'fold'); b.type = 'button';
  const show = (open) => { p.classList.toggle('collapsed', !open); b.textContent = open ? '\u2212' : '+'; b.setAttribute('aria-expanded', String(open)); b.setAttribute('aria-label', (open ? 'Collapse ' : 'Expand ') + name); b.title = open ? 'Collapse' : 'Expand'; };
  b.addEventListener('click', () => show(p.classList.contains('collapsed')));
  show(true);
  p.append(b);
}
function panel(st, i) {
  const p = el('section', 'panel');
  const head = el('header'); head.id = 'h-' + st.id;
  const cb = el('input'); cb.type = 'checkbox'; cb.id = 'on-' + st.id; cb.checked = true; cb.setAttribute('aria-label', 'Enable ' + st.name);
  cb.addEventListener('change', () => { state.v[st.id + '.on'] = cb.checked; schedule(); });
  state.controls.set(st.id + '.on', { set: (v) => { cb.checked = !!v; }, disable: () => {} });
  const title = el('label', 'title', `${i + 1}. ${st.name}`); title.htmlFor = cb.id;
  const tags = el('span', 'tags'); tags.append(el('span', 'tag values'), el('span', 'tag pixels'));
  const rs = el('button', 'resetp', 'Reset'); rs.type = 'button'; rs.title = 'Reset this panel\u2019s controls'; rs.setAttribute('aria-label', 'Reset ' + st.name);
  rs.addEventListener('click', () => {
    if (st.id === 'hsl') for (let k = 0; k < SECTORS.length; k++) for (const c of 'hsl') state.v[`hsl.${c}${k}`] = 0;
    for (const q of st.params) setValue(`${st.id}.${q.id}`, q.def);
    schedule();
  });
  head.append(cb, title, rs, tags);
  p.append(head);
  addFold(p, st.name);
  if (st.note) p.append(el('p', 'note', st.note));
  return p;
}
function buildPanels() {
  const before = $('#panels-a'), hsl = $('#panels-hsl'), after = $('#panels-b'), strip = $('#strip');
  STAGES.forEach((st, i) => {
    const b = el('button', 'stage', String(i + 1)); b.type = 'button'; b.setAttribute('aria-label', st.name);
    b.addEventListener('click', () => { state.v[st.id + '.on'] = !state.v[st.id + '.on']; schedule(); });
    strip.append(b);
    const p = panel(st, i);
    if (st.id === 'hsl') {
      const g = el('div', 'hslgrid');
      const cols = [['h', 'H', 'Hue', 'reg'], ['s', 'S', 'Saturation', 'both'], ['l', 'L', 'Lightness', 'reg']];
      // Two groups of six sectors so each wrapped column carries its own headings at any width.
      const groups = [[0, 6], [6, 12]];
      for (const [lo, hi] of groups) {
        const colBox = el('section', 'hslcol');
        const head = el('div', 'sector colheads');
        head.append(el('span', 'corner'));
        for (const [c, , name, layer] of cols) {
          const h = el('span', 'colhead plabel'); h.dataset.fam = 'hsl.' + c; h.dataset.layer = layer;
          h.append(el('span', 'dot' + (isReachable(layer) ? ' reach' : '')), document.createTextNode(name));
          head.append(h);
        }
        colBox.append(head);
        for (let k = lo; k < hi; k++) {
          const row = el('div', 'sector'); row.append(el('span', 'sname', SECTORS[k]));
          for (const [c, lab, , layer] of cols) row.append(control(`hsl.${c}${k}`, { label: lab, min: -7, max: 7, step: 1, def: 0, layer }));
          colBox.append(row);
        }
        g.append(colBox);
      }
      p.append(g); hsl.append(p);
    } else {
      for (const q of st.params) p.append(control(st.id + '.' + q.id, q));
      (i < STAGES.findIndex((s) => s.id === 'hsl') ? before : after).append(p);
    }
  });
}

async function applyDecoded() {
  const m = toMosaic(state.decoded, state.v['levels.cfa']);
  state.mosaic = m.mosaic; drawInput();
  const notes = [];
  if (m.kind === 'full-colour') notes.push('This PNG is full colour, so it was re-mosaiced using the CFA pattern. Colours are display-encoded, not raw.');
  if (m.cropped) notes.push(`Centre-cropped from ${state.decoded.w}x${state.decoded.h} to ${SIZE}x${SIZE}.`);
  notes.push(state.decoded.depth + '-bit samples.');
  say(notes.join(' '));
}
function say(t, bad) { const s = $('#msg'); s.textContent = t; s.classList.toggle('bad', !!bad); }
async function loadImage(f) {
  try {
    const d = await decodePng(new Uint8Array(await f.arrayBuffer()));
    toMosaic(d, state.v['levels.cfa']);   // refuse an unusable image before it replaces the current one
    state.decoded = d; state.name = f.name; await applyDecoded(); schedule();
  } catch (e) { say(`${f.name}: ${e.message}`, true); }
}
function setFwChip(kind, text) { const c = $('#fw'); c.dataset.kind = kind; c.textContent = text; }
async function loadFirmware(f) {
  setFwChip('busy', 'Reading ' + f.name);
  $('#fwfail').hidden = true;
  await new Promise((r) => setTimeout(r, 30));
  try {
    const info = await identify(f);
    state.fwInfo = info; state.cache.clear();
    if (info.status === 'unsupported') { state.fw = null; setFwChip('none', 'Firmware not usable'); say(info.detail, true); schedule(); return; }
    const native = new NativeIsp(info.main);
    state.fw = { native, tables: native.tables() };
    setFwChip(info.status, info.detail);
    const warn = info.checksum === false ? ' The container checksum does not add up, which is expected for a patched file.' : '';
    say(`${f.name} loaded from ${info.source}.${warn}`);
    schedule();
  } catch (e) { state.fw = null; setFwChip('none', 'Firmware failed to load'); say(`${f.name}: ${e.message}`, true); schedule(); }
}
async function save(filename, data, fallback) {
  const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
  if (dl) { try { await dl.save({ filename, data }); say('Saved ' + filename); } catch (e) { say(e.code === 'declined' ? 'Save cancelled.' : `Could not save ${filename}: ${e.message}`, e.code !== 'declined'); } return; }
  const a = el('a'); a.href = URL.createObjectURL(data); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); say('Saved ' + filename);
}
function bindFile(btn, input, fn) { $(btn).addEventListener('click', () => $(input).click()); $(input).addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) fn(f); }); }

// Popup with a control's range and default, for sliders and number fields. Disabled inputs pass the pointer through to their row.
function setupTip() {
  const tip = $('#tip');
  let current = null;
  const hide = () => { current = null; tip.hidden = true; };
  // Range/default popup, for sliders and number fields (above/below the control).
  const showRange = (e) => {
    if (e === current) return; current = e;
    tip.className = 'range'; tip.textContent = `Min ${fmt(e.min)}   Max ${fmt(e.max)}   Default ${fmt(e.dataset.def)}`;
    tip.hidden = false;
    const r = e.getBoundingClientRect(), t = tip.getBoundingClientRect();
    tip.style.left = Math.max(4, Math.min(innerWidth - t.width - 4, r.left + r.width / 2 - t.width / 2)) + 'px';
    tip.style.top = (r.top - t.height - 6 < 4 ? r.bottom + 6 : r.top - t.height - 6) + 'px';
  };
  // Description + reachability popup, for sub-parameter headings (to the left of the label).
  const showDesc = (lab) => {
    if (lab === current) return;
    let key, layer;
    if (lab.dataset && lab.dataset.fam) { key = lab.dataset.fam; layer = lab.dataset.layer || ''; }   // column heading
    else { const row = lab.closest('.row'); if (!row || row.closest('.hslgrid')) { hide(); return; } key = row.dataset.key; layer = row.dataset.layer || ''; }
    const desc = key ? descFor(key) : '';
    if (!desc) { hide(); return; }
    current = lab;
    const reach = isReachable(layer);
    tip.className = 'desc'; tip.textContent = '';
    tip.append(document.createTextNode(desc), '\n', el('span', reach ? 'o-yes' : 'o-no', LAYER_ORIGIN[layer]));
    tip.hidden = false;
    const r = lab.getBoundingClientRect(), t = tip.getBoundingClientRect();
    tip.style.left = Math.max(4, r.left - t.width - 8) + 'px';
    tip.style.top = Math.max(4, Math.min(innerHeight - t.height - 4, r.top + r.height / 2 - t.height / 2)) + 'px';
  };
  const isField = (e) => e && e.matches && e.matches('.row input[type=range], .row input[type=number]');
  const labelOf = (e) => e && e.closest && e.closest('.plabel');
  document.addEventListener('mousemove', (ev) => {
    if (isField(ev.target)) { showRange(ev.target); return; }
    const lab = labelOf(ev.target);
    if (lab) { showDesc(lab); return; }
    if (current && !isField(document.activeElement)) hide();
  });
  document.addEventListener('focusin', (ev) => { if (isField(ev.target)) showRange(ev.target); });
  document.addEventListener('focusout', hide);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hide(); });
}
// Click either image to zoom both by 2x around that point (nearest-neighbour, cropped to the frame). Click again to return.
function setupZoom() {
  const frames = [...document.querySelectorAll('.frame')];
  let zoomed = false;
  const apply = (srcX, srcY) => {
    for (const f of frames) {
      const c = f.querySelector('canvas');
      c.style.width = c.style.height = zoomed ? '200%' : '100%';
      c.style.left = zoomed ? `${-srcX / 2}%` : '0';
      c.style.top = zoomed ? `${-srcY / 2}%` : '0';
      f.classList.toggle('zoomed', zoomed);
    }
    for (const z of document.querySelectorAll('.zoomlabel')) z.textContent = zoomed ? '2\u00d7' : '';
  };
  const toggle = (fx, fy) => {
    zoomed = !zoomed;
    const crop = (v) => Math.round(Math.max(0, Math.min(SIZE / 2, v * SIZE - SIZE / 4)));   // integer source pixels, kept inside the image
    apply(crop(fx), crop(fy));
  };
  for (const f of frames) {
    f.addEventListener('click', (ev) => { const r = f.getBoundingClientRect(); toggle((ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height); });
    f.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(0.5, 0.5); }
      else if (ev.key === 'Escape' && zoomed) { zoomed = false; apply(0, 0); }
    });
  }
}
function init() {
  buildPanels();
  setupZoom();
  setupTip();
  addFold($('#captures'), 'Firmware captures');
  useScene();
  bindFile('#loadimg', '#fileimg', loadImage);
  bindFile('#loadfw', '#filefw', loadFirmware);
  bindFile('#loadset', '#fileset', async (f) => {
    try { const j = JSON.parse(await f.text()); if (!j.values) throw new Error('No settings in this file.'); Object.assign(state.v, j.values); if (j.source) setSource(j.source); if (state.decoded) await applyDecoded(); else useScene(); schedule(); say('Loaded settings from ' + f.name); }
    catch (e) { say(`${f.name}: ${e.message}`, true); }
  });
  $('#resetimg').addEventListener('click', () => { useScene(); schedule(); say('Built-in test scene restored.'); });
  $('#saveout').addEventListener('click', () => $('#out').toBlob((b) => save('isp-output.png', b)));
  $('#saveset').addEventListener('click', () => save('isp-settings.json', new Blob([JSON.stringify({ source: state.source, values: state.v }, null, 1)], { type: 'application/json' })));
  $('#reset').addEventListener('click', () => { state.v = defaults(); if (state.decoded) applyDecoded(); else useScene(); schedule(); say('All sliders reset.'); });
  for (const b of document.querySelectorAll('#source button')) b.addEventListener('click', () => setSource(b.dataset.v));
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) (/\.png$/i.test(f.name) ? loadImage : loadFirmware)(f); });
  setSource('camera');
  run();
}
function setSource(s) { state.source = s; for (const b of document.querySelectorAll('#source button')) b.setAttribute('aria-pressed', b.dataset.v === s ? 'true' : 'false'); schedule(); }
init();
window.__isp = state;
