// Slider definitions and the step from slider values to pipeline parameters. `layer`: camera (a control on the camera)
// or reg (a value written to the ISP). Numbered in the order docs/color/pen-f/CREATIVE_PROCESSING_JOBS.md lists the units.
import { cfaIndex } from './png.js';

const S = (id, label, min, max, step, def, extra = {}) => ({ id, label, min, max, step, def, ...extra });
export const SECTORS = ['Yellow', 'Orange', 'Red', 'Rose', 'Magenta', 'Violet', 'Blue', 'Azure', 'Cyan', 'Teal', 'Green', 'Lime'];
const AXES = ['Red', 'Yellow', 'Green', 'Cyan', 'Blue', 'Magenta'];
export const MODES = [[11, 'COLOR'], [2, 'Natural'], [1, 'Vivid'], [3, 'Muted'], [4, 'Portrait'], [12, 'MONO']];

export const STAGES = [
  { id: 'levels', name: 'Black and white level', pixels: 'model', note: 'Standard normalisation. The camera front end is not separated in the research.',
    params: [{ id: 'cfa', label: 'CFA pattern', type: 'select', options: ['RGGB', 'BGGR', 'GRBG', 'GBRG'].map((x) => [x, x]), def: 'RGGB' }, S('black', 'Black level %', 0, 25, 0.01, 0), S('white', 'White level %', 50, 100, 0.01, 100)] },
  { id: 'wb', name: 'White balance and exposure', pixels: 'model', params: [S('r', 'Red gain', 0.25, 4, 0.01, 1), S('g', 'Green gain', 0.25, 4, 0.01, 1), S('b', 'Blue gain', 0.25, 4, 0.01, 1), S('ev', 'Exposure EV', -4, 4, 0.01, 0)] },
  { id: 'demosaic', name: 'Demosaic', pixels: 'model', note: 'The camera algorithm is unknown. These are public algorithms.',
    params: [{ id: 'method', label: 'Method', type: 'select', options: [['amaze', 'AMaZE'], ['mhc', 'Malvar-He-Cutler'], ['bilinear', 'Bilinear']], def: 'amaze' }] },
  { id: 'matrix', name: 'Colour matrix', pixels: 'model', note: 'Nine i16 values at YC+88 on the camera. Calibration arithmetic is not mapped, so these are yours to set.',
    params: ['RR', 'RG', 'RB', 'GR', 'GG', 'GB', 'BR', 'BG', 'BB'].map((n, i) => S('m' + i, n, -2, 3, 0.001, i % 4 === 0 ? 1 : 0)) },
  { id: 'sixaxis', name: 'Picture-mode colour character (six-axis)', native: true, pixels: 'model', note: 'The picture mode’s built-in colour character: six hue and six saturation coefficients the firmware writes when you select a mode (COLOR, Vivid, MONO…). You reach these only by choosing the mode — they are not an independent menu or register control, so the bench exposes the coefficients as free sliders for exploration. With firmware loaded in Camera-controls mode they show the mode’s real values. Axis order and the pixel formula are assumed.',
    params: [{ id: 'mode', label: 'Picture mode', type: 'select', options: MODES.map(([a, b]) => [String(a), b]), def: '11', layer: 'camera' },
      ...AXES.map((a, i) => S('s' + i, a + ' saturation', -40, 40, 1, 0, { layer: 'mode' })), ...AXES.map((a, i) => S('h' + i, a + ' hue', -20, 20, 1, 0, { layer: 'mode' }))] },
  { id: 'gamma', name: 'RGB gamma', pixels: 'model', note: 'The firmware has curve families at 604f6083. No call fixture exists for them yet.', params: [S('gamma', 'Gamma', 1, 3.2, 0.01, 2.2), S('contrast', 'Contrast', -5, 5, 0.1, 0)] },
  { id: 'chroma', name: 'Global chroma gain', pixels: 'model', params: [S('gain', 'Chroma gain', 0, 2.5, 0.01, 1), S('depth', 'Colour depth (deepen)', 0, 0.5, 0.01, 0.08)] },
  { id: 'hsl', name: 'Your colour profile (twelve-sector)', native: true, pixels: 'model', note: 'The Color Profile Control: per-sector saturation, hue and lightness you set yourself. On the stock PEN-F the camera menu reaches saturation only, at ±5; hue and lightness were opened up by the custom-firmware projects and live in the ISP registers. The bench allows ±7 on all three. In Camera-controls mode only saturation is editable (hue and lightness go flat, as on the stock camera); switch to ISP registers to adjust hue and lightness. Saturation goes through the firmware builder when loaded. The way sectors act on pixels is assumed.', params: [] },
  { id: 'tone', name: 'Luminance tone', native: true, pixels: 'model', note: 'With firmware loaded, this stage uses the 256-entry LUT the tone selector returns.',
    params: [S('shadows', 'Shadows', -7, 7, 1, 0), S('midtones', 'Midtones', -7, 7, 1, 0), S('highlights', 'Highlights', -7, 7, 1, 0)] },
  { id: 'tint', name: 'Chroma suppression and tint', native: true, pixels: 'model', params: [{ id: 'mono', label: 'Monochrome', type: 'check', def: false, layer: 'reg' }, S('cb', 'Tint Cb', -64, 64, 1, 0, { layer: 'reg' }), S('cr', 'Tint Cr', -64, 64, 1, 0, { layer: 'reg' })] },
  { id: 'chromaedge', name: 'Chroma edge (DemCFltr)', native: true, pixels: 'doc', note: 'Measured from the synthetic-chart ORF processed through OM Workspace. Across any bright-to-dark edge the chroma (Cb/Cr) is a soft low-pass step (sigma ~1.3, ~3.8px wide, no overshoot) while luma keeps its sharp unsharp halos. This chroma blur is the "thinning" mechanism: the colour fades a couple of pixels inside the edge on the darker side, and the luma dark undershoot (from sharpening) supplies the dark rim. Rebuilding the measured RGB from measured-luma + blurred-chroma matched to 2.7 counts/channel. FCS (edge-gated extra suppression) is left OFF — the camera writes its registers to 0 and the measurement needs no such term.',
    params: [S('blur', 'Chroma smoothing sigma', 0, 3, 0.05, 1.3, { layer: 'reg' }), S('shift', 'Edge thinning (bright push, px)', 0, 3, 0.05, 0.3, { layer: 'reg' }), S('fcslmt', 'YC1_FCSLMT (optional FCS limit)', 0, 1023, 1, 0, { layer: 'reg' }), S('fcsca1', 'YC1_FCSCA1 (edge gain)', 0, 63, 1, 16, { layer: 'reg', off: (v) => +v['chromaedge.fcslmt'] === 0 }), S('fcskrbg', 'YC1_FCSKRBG (strength)', 0, 255, 1, 200, { layer: 'reg', off: (v) => +v['chromaedge.fcslmt'] === 0 })] },
  { id: 'soften', name: 'Detail softening', pixels: 'model', note: 'Assumed stand-in for whatever removes the finest detail before sharpening in Olympus output (noise reduction or demosaic). The default width was fitted to PEN-F Workspace exports at Sharpness 0.',
    params: [S('sigma', 'Softening width', 0, 2, 0.05, 0.5)] },
  { id: 'sharpen', name: 'Sharpening', native: true, pixels: 'doc', note: 'Two paths. "Bench" uses the measured edge kernel with an edge-scale/brightness fit to Workspace exports. "Workspace shaper" replaces the gain/coring/limit stage with the one decoded verbatim from OM Workspace\'s OlyPomegranate.dll (sub_ed820): EDGE_STRENGTH, ESEL sign, ESVX/ESVY position gain, and the Edge-LUT (DER/KEG) shaping. At the camera\'s register values the two paths agree. The edge extractor itself is the measured 5x5, which is the validated net form of the real direction-adaptive 6-tap band-pass.',
    params: [{ id: 'path', label: 'Edge path', type: 'select', options: [['bench', 'Bench (measured fit)'], ['workspace', 'Workspace shaper (decoded ed820)']], def: 'workspace' },
      S('s', 'Sharpness', -2, 2, 1, 0, { layer: 'camera' }), S('sv', 'Sensitivity (raw Sv)', 1280, 3840, 1, 1280, { layer: 'camera' }), S('A', 'Coring A', 0, 255, 1, 8, { layer: 'reg' }), S('K', 'Gain K', 0, 512, 1, 34, { layer: 'reg' }), S('shift', 'Gain shift', 4, 10, 1, 6, { layer: 'reg' }), S('limPos', 'Positive limit', 0, 1023, 1, 144, { layer: 'reg' }), S('limNeg', 'Negative limit', 0, 1023, 1, 384, { layer: 'reg' }),
      S('scale', 'Edge scale', 0.5, 5, 0.05, 3, { off: (v) => v['sharpen.path'] === 'workspace' }), S('bright', 'Brightness gain', 0, 2, 0.05, 1, { off: (v) => v['sharpen.path'] === 'workspace' }),
      { id: 'kernel', label: 'Edge kernel', type: 'select', options: [['measured', 'Measured 5x5 (net)'], ['wstaps', 'Hardware taps [-1,-1,4,4,-1,-1]'], ['gaussian', 'Gaussian high-pass']], def: 'measured', off: (v) => v['sharpen.path'] === 'workspace' }, S('radius', 'Kernel radius', 0.4, 4, 0.05, 1, { off: (v) => v['sharpen.kernel'] !== 'gaussian' || v['sharpen.path'] === 'workspace' }),
      S('es', 'YC1_EDGE_STRENGTH', 0, 64, 1, 0, { layer: 'reg', off: (v) => v['sharpen.path'] !== 'workspace' }), { id: 'esel', label: 'YC1_ESEL (invert edge)', type: 'check', def: false, layer: 'reg', off: (v) => v['sharpen.path'] !== 'workspace' },
      S('esvx', 'YC1_ESVX gain', 0, 255, 1, 64, { layer: 'reg', off: (v) => v['sharpen.path'] !== 'workspace' }), S('esvy', 'YC1_ESVY gain', 0, 255, 1, 64, { layer: 'reg', off: (v) => v['sharpen.path'] !== 'workspace' }),
      S('der', 'YC1_DER (LUT high slope)', 0, 255, 1, 64, { layer: 'reg', off: (v) => v['sharpen.path'] !== 'workspace' }), S('keg', 'YC1_KEG (LUT low slope)', 0, 255, 1, 64, { layer: 'reg', off: (v) => v['sharpen.path'] !== 'workspace' })] },
  { id: 'grain', name: 'Creative grain', native: true, pixels: 'doc', note: 'Documented xorshift32 integer formula from the desktop code. Camera hardware may differ in seed and rounding.',
    params: [{ id: 'level', label: 'Grain', type: 'select', options: [['0', 'Off'], ['1', 'Low'], ['2', 'Medium'], ['3', 'High']], def: '0', layer: 'camera' }, S('gain', 'Gain', 0, 1023, 1, 0, { layer: 'reg' }), S('seed', 'Seed', 1, 65535, 1, 10)] },
  { id: 'shading', name: 'Creative shading', native: true, pixels: 'doc', note: 'Radial mask with the documented coordinate scaling. How the curve maps to radius is assumed. Highlight protection is the desktop prototype, not stock camera behaviour.',
    params: [S('step', 'Shading', -5, 5, 1, 0), S('word', 'Coordinate word', 650, 1024, 1, 1024, { layer: 'reg' }), S('protection', 'Highlight protection', 0, 1, 0.01, 0), S('midpoint', 'Protection midpoint', 0.5, 0.95, 0.01, 0.8)] },
];
export const defaults = () => {
  const v = {};
  for (const st of STAGES) { v[st.id + '.on'] = true; for (const q of st.params) v[st.id + '.' + q.id] = q.def; }
  SECTORS.forEach((_, i) => { v['hsl.h' + i] = 0; v['hsl.s' + i] = 0; v['hsl.l' + i] = 0; });
  return v;
};

const DOC = {
  sixaxis: { 1: [18, 4, 24, 0, 8, 8, 0, 2, 4, -1, -6, 0], 3: [-22, 4, -16, 0, 4, -8, 3, 0, -3, 9, 8, 10], 4: [14, 0, 0, 5, 0, 0, -1, 0, 2, -2, 0, 0] },
  sharpLut: [64, 96, 128, 160, 208, 256, 256, 256, 256, 256, 256],
  // Measured from the PEN-F 3.1 YC builder in COLOR at sharpness 0, Sv 1280..3840 in steps of 128
  sharpK0: [37, 37, 37, 36, 34, 34, 33, 32, 31, 30, 28, 27, 25, 25, 25, 22, 18, 15, 12, 10, 6],
  sharpCoring: [7, 7, 7, 7, 8, 8, 8, 8, 9, 10, 12, 13, 14, 16, 18, 20, 23, 29, 35, 40, 60],
  grainGains: [110, 300, 600],
  shadingWords: [928, 952, 976, 1000, 1024],
};
const L_TABLE = [-300, -250, -200, -150, -100, -50, -25, 0, 25, 50, 100, 150, 200, 250, 300];
const FALLBACK_CURVE = Array.from({ length: 64 }, (_, i) => 1024 * (1 - (i / 63) ** 1.5));
const FALLBACK_MASK = Uint16Array.from({ length: 256 }, (_, i) => (i <= 36 ? 0 : i >= 120 ? 1023 : Math.round(((i - 36) / 84) * 1023)));

// fw: { native, tables } or null. Each firmware call is cached by its inputs and a failure falls back to documented values.
export function resolve(v, source, fw, cache) {
  const log = [], origin = {}, shown = {};
  const useFw = fw && source === 'camera';
  const runFw = (key, name, fn) => {
    if (!useFw) return null;
    const k = key + ':' + name;
    if (!cache.has(k)) {
      const n = fw.native; n.calls = [];
      let res = null, error = null;
      try { res = fn(n); } catch (e) { error = e.message; }
      cache.set(k, { res, error, calls: n.calls.slice() });
    }
    const c = cache.get(k);
    log.push({ key, name, calls: c.calls, error: c.error, res: c.res });
    return c.res;
  };
  const originOf = (ok) => (source === 'reg' ? 'user' : ok ? 'fw' : 'doc');
  const mode = +v['sixaxis.mode'];
  const p = { on: {} };
  for (const st of STAGES) p.on[st.id] = !!v[st.id + '.on'];
  p.cfaIdx = cfaIndex(v['levels.cfa']);
  p.levels = { black: v['levels.black'] / 100, white: v['levels.white'] / 100 };
  p.wb = { r: v['wb.r'], g: v['wb.g'], b: v['wb.b'], ev: v['wb.ev'] };
  p.demosaic = { method: v['demosaic.method'] };
  p.matrix = Array.from({ length: 9 }, (_, i) => v['matrix.m' + i]);
  p.gamma = { gamma: v['gamma.gamma'], contrast: v['gamma.contrast'] };
  p.chroma = { gain: v['chroma.gain'], depth: v['chroma.depth'] };

  if (source === 'camera') {
    const r = runFw('sixaxis', 'mode ' + mode, (n) => n.sixAxis(mode));
    const a = r ? [...r.sat, ...r.hue] : DOC.sixaxis[mode] || new Array(12).fill(0);
    origin.sixaxis = originOf(!!r);
    p.sixaxis = { sat: a.slice(0, 6), hue: a.slice(6) };
    a.slice(0, 6).forEach((x, i) => { shown['sixaxis.s' + i] = x; });
    a.slice(6).forEach((x, i) => { shown['sixaxis.h' + i] = x; });
  } else {
    origin.sixaxis = 'user';
    p.sixaxis = { sat: [0, 1, 2, 3, 4, 5].map((i) => v['sixaxis.s' + i]), hue: [0, 1, 2, 3, 4, 5].map((i) => v['sixaxis.h' + i]) };
  }

  // Saturation coefficients: the firmware returns one record per sector. The word that moves against a zero run is the S coefficient.
  const sat = SECTORS.map((_, i) => v['hsl.s' + i]), rec = (i) => (i % 2) * 6 + (i >> 1);
  let sCo = sat.map((x) => x * 45), sOk = false;
  if (sat.some(Boolean) && source === 'camera') {
    const r = runFw('hsl', sat.join(','), (n) => {
      const zero = n.hsl(new Array(12).fill(0)), now = n.hsl(sat), out = new Array(12).fill(0);
      let found = false;
      sat.forEach((s, i) => { if (s) { const w = now.records[rec(i)], z = zero.records[rec(i)], k = w.findIndex((x, j) => x !== z[j]); if (k >= 0) { out[i] = w[k] - z[k]; found = true; } } });
      return found ? { co: out, enable: now.enable } : null;
    });
    if (r) { sCo = r.co; sOk = true; }
  }
  origin.hsl = source === 'reg' ? 'user' : sOk ? 'fw' : 'doc';
  // Hue and lightness are only reachable through the ISP registers (custom firmware). In Camera-controls
  // mode the stock camera can touch saturation only, so h/l go flat there even if the sliders hold values.
  const regMode = source !== 'camera';
  p.hsl = { h: SECTORS.map((_, i) => regMode ? -1000 * v['hsl.h' + i] : 0), s: sCo, l: SECTORS.map((_, i) => L_TABLE[(regMode ? v['hsl.l' + i] : 0) + 7]) };
  p.hsl.active = p.hsl.h.some(Boolean) || p.hsl.s.some(Boolean) || p.hsl.l.some(Boolean);

  let lut = null;
  if (source === 'camera') {
    const r = runFw('tone', 'mode ' + mode, (n) => n.tone(mode));
    if (r) {
      const top = r.lut[255]; let mono = top > 0;
      for (let i = 1; i < 256 && mono; i++) if (r.lut[i] < r.lut[i - 1]) mono = false;
      if (mono) lut = Float32Array.from(r.lut, (x) => x / top);
      else log.push({ key: 'tone', name: 'LUT rejected', calls: [], error: 'The returned table is not monotonic, so it was not applied.' });
    }
  }
  origin.tone = lut ? 'fw' : 'user';
  p.tone = { shadows: v['tone.shadows'], midtones: v['tone.midtones'], highlights: v['tone.highlights'], lut };

  if (source === 'camera') {
    const word = runFw('tint', 'mode ' + mode, (n) => n.chroma(mode));
    if (word !== null) { const mono = (word & 1) === 1; p.tint = { mono, cb: mono ? ((word >> 16) & 255) - 128 : 0, cr: mono ? ((word >> 8) & 255) - 128 : 0 }; }
    else p.tint = { mono: mode === 12, cb: 0, cr: 0 };
    origin.tint = originOf(word !== null);
    shown['tint.mono'] = p.tint.mono; shown['tint.cb'] = p.tint.cb; shown['tint.cr'] = p.tint.cr;
  } else { origin.tint = 'user'; p.tint = { mono: v['tint.mono'], cb: v['tint.cb'], cr: v['tint.cr'] }; }

  const sh = { radius: v['sharpen.radius'], kernel: v['sharpen.kernel'], scale: v['sharpen.scale'], bright: v['sharpen.bright'], path: v['sharpen.path'],
    ws: { es: v['sharpen.es'], esel: v['sharpen.esel'] ? 1 : 0, esvx: v['sharpen.esvx'], esvy: v['sharpen.esvy'], der: v['sharpen.der'], keg: v['sharpen.keg'] } };
  p.soften = { sigma: v['soften.sigma'] };
  p.chromaedge = { blur: v['chromaedge.blur'], shift: v['chromaedge.shift'], fcslmt: v['chromaedge.fcslmt'], fcsca1: v['chromaedge.fcsca1'], fcskrbg: v['chromaedge.fcskrbg'] };
  origin.chromaedge = source === 'reg' ? 'user' : 'doc';
  if (source === 'camera') {
    const s = v['sharpen.s'], sv = v['sharpen.sv'];
    const r = runFw('sharpen', `mode ${mode} s ${s} sv ${sv}`, (n) => n.sharpen(mode, s, sv));
    const at = Math.min(20, Math.floor((sv - 1280) / 128));
    if (r) Object.assign(sh, { A: r.coring, K: r.gain, limPos: r.limitA, limNeg: r.limitB });
    else Object.assign(sh, { A: DOC.sharpCoring[at], K: (DOC.sharpK0[at] * DOC.sharpLut[Math.max(0, Math.min(10, 5 + s))]) >> 8, limPos: 144, limNeg: 384 });
    sh.shift = 6;
    origin.sharpen = originOf(!!r);
    for (const k of ['A', 'K', 'shift', 'limPos', 'limNeg']) shown['sharpen.' + k] = sh[k];
  } else { origin.sharpen = 'user'; for (const k of ['A', 'K', 'shift', 'limPos', 'limNeg']) sh[k] = v['sharpen.' + k]; }
  // The decoded Workspace shaper (KEDGE, coring A, ECLP/ECLN) mirrors the resolved
  // sharpening registers so the two paths agree at the camera's values.
  sh.ws.kedge = sh.K; sh.ws.a = sh.A; sh.ws.eclp = sh.limPos; sh.ws.ecln = sh.limNeg;
  p.sharpen = sh;

  const gr = { seed: v['grain.seed'], mask: fw ? fw.tables.grainMask : FALLBACK_MASK };
  if (source === 'camera') {
    const level = +v['grain.level'];
    const r = level ? runFw('grain', 'level ' + level, (n) => n.grain(level)) : null;
    const t = fw ? fw.tables : DOC;
    gr.gain = level === 0 ? 0 : r ? r.gain : t.grainGains[level - 1];
    origin.grain = originOf(level === 0 ? !!fw : !!r);
    shown['grain.gain'] = gr.gain;
  } else { origin.grain = 'user'; gr.gain = v['grain.gain']; }
  p.grain = gr;

  const step = v['shading.step'], words = fw ? fw.tables.shadingWords : DOC.shadingWords;
  const word = source === 'camera' ? (step ? words[Math.abs(step) - 1] : 1024) : v['shading.word'];
  if (source === 'camera') shown['shading.word'] = word;
  p.shading = { step, word, curve: fw ? fw.tables.shadingCurve : FALLBACK_CURVE, protection: v['shading.protection'], midpoint: v['shading.midpoint'] };
  origin.shading = source === 'reg' ? 'user' : fw ? 'fw' : 'model';   // the 64-entry curve is only known from firmware

  return { p, log, origin, shown };
}
