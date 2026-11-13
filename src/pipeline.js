// The software ISP. Pure functions over typed arrays. Each stage's origin is recorded in params.js.
import { demosaicAMaZE } from './amaze.js';
export const SIZE = 400;
// Sharpening strength by local brightness (8-bit luma), relative to mid-grey. Measured from PEN-F OM Workspace exports:
// the size of one Sharpness step on dark edges, binned by brightness, divided by its value at 105-130.
export const BRIGHTNESS_GAIN = [[30, 0.916], [50, 0.957], [70, 0.926], [92, 0.98], [118, 1.0], [145, 1.144], [175, 1.154], [210, 1.274]];
function brightnessGain(y8) {
  const t = BRIGHTNESS_GAIN;
  if (y8 <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (y8 <= t[i][0]) { const [x0, a] = t[i - 1], [x1, b] = t[i]; return a + (b - a) * (y8 - x0) / (x1 - x0); }
  return t[t.length - 1][1];
}
// 5x5 edge kernel measured from PEN-F OM Workspace 2.5 exports at Sharpness -2 and -1, fitted on dark edges with mirror and
// diagonal symmetry assumed. Scaled to match a Gaussian high-pass (sigma 1.1) on the same data, then made exactly zero-sum.
// Index by [abs dy][abs dx].
export const MEASURED_KERNEL = [
  [0.8124, -0.0437, -0.0478],
  [-0.0437, -0.0813, -0.0073],
  [-0.0478, -0.0073, -0.0157],
];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function demosaicBilinear(m, w, h, idx, R, G, B) {
  const planes = [R, G, B];
  const at = (x, y) => m[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
  const site = (x, y) => idx[((y & 1) << 1) | (x & 1)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const here = site(x, y), i = y * w + x, v = m[i];
    const cross = (at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1)) / 4;
    const diag = (at(x - 1, y - 1) + at(x + 1, y - 1) + at(x - 1, y + 1) + at(x + 1, y + 1)) / 4;
    const horiz = (at(x - 1, y) + at(x + 1, y)) / 2, vert = (at(x, y - 1) + at(x, y + 1)) / 2;
    planes[here][i] = v;
    if (here === 1) {
      const hc = site(x + 1, y), vc = 2 - hc;
      planes[hc][i] = horiz; planes[vc][i] = vert;
    } else { planes[1][i] = cross; planes[2 - here][i] = diag; }
  }
}
// Malvar, He and Cutler 2004
export function demosaicMHC(m, w, h, idx, R, G, B) {
  const planes = [R, G, B];
  const at = (x, y) => m[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
  const site = (x, y) => idx[((y & 1) << 1) | (x & 1)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const here = site(x, y), i = y * w + x, c = m[i];
    const n2 = at(x, y - 2), s2 = at(x, y + 2), w2 = at(x - 2, y), e2 = at(x + 2, y);
    const n = at(x, y - 1), s = at(x, y + 1), we = at(x - 1, y), e = at(x + 1, y);
    const nw = at(x - 1, y - 1), ne = at(x + 1, y - 1), sw = at(x - 1, y + 1), se = at(x + 1, y + 1);
    planes[here][i] = c;
    if (here === 1) {
      const rowLike = (8 * (we + e) + 10 * c - 2 * (w2 + e2 + nw + ne + sw + se) + (n2 + s2)) / 16;
      const colLike = (8 * (n + s) + 10 * c - 2 * (n2 + s2 + nw + ne + sw + se) + (w2 + e2)) / 16;
      const hc = site(x + 1, y), vc = 2 - hc;
      planes[hc][i] = rowLike; planes[vc][i] = colLike;
    } else {
      planes[1][i] = (4 * c + 2 * (n + s + we + e) - (n2 + s2 + w2 + e2)) / 8;
      planes[2 - here][i] = (12 * c + 4 * (nw + ne + sw + se) - 3 * (n2 + s2 + w2 + e2)) / 16;
    }
  }
}

// xorshift32 grain, as docs/color/pen-f/GRAIN.md gives it. Y and M are 0..65535, Math.floor stands for the arithmetic shift.
export function grainLine(Y16, M, gain, st) {
  let s = st.state;
  s = (s ^ (s << 13)) >>> 0; s = (s ^ (s >>> 17)) >>> 0; s = (s ^ (s << 5)) >>> 0;
  st.state = s;
  const rnd = (s & 65535) - 32768, weight = (M + ((M >> 15) & 1)) >> 6;
  let noise = Math.floor((((gain * weight) >> 10) * rnd) / 1024);
  noise = clamp(noise, -6682, 65535);
  return clamp(Y16 + noise, 0, 65535);
}
// docs/color/pen-f/SHARPENING.md, simplified rule
export function sharpenEdge(edge, A, K, shift, limPos, limNeg) {
  if (edge >= 0) return Math.min((Math.max(0, edge - A) * K) >> shift, limPos, 1023);
  return -Math.min((Math.max(0, -edge - A) * K) >> shift, limNeg, 1023) | 0;
}

// Decoded verbatim from OlyPomegranate.dll sub_1800ed820 (the YC edge shaper).
// ws = { es, kedge, a, eclp, ecln, esel, esvx, esvy } are the YC1 registers.
// Returns the per-pixel gain that the shaper applies before coring/limiting.
export function wsGain(sig, ws) {
  // sig is the 0..1023 "second source" (CRDUC plane 4 in Workspace; here it
  // stands in for local brightness). At ES=0 the sig term drops out entirely.
  let g0 = (68 - ws.es + (((sig * ws.es) + 4) >> 3)) >> 3;
  if (g0 < 0) g0 = 0;
  g0 = (g0 * ws.kedge) >> 3;
  if (g0 > 255) g0 = 255;
  let g = ((g0 * ws.esvx * ws.esvy) + 2048) >> 12;   // two 0..255 position gains, /4096
  return g > 255 ? 255 : g;
}
// Decoded coring + limit + ESEL sign from the same function. Fixed >>6, as in firmware.
export function sharpenEdgeWS(edge, gain, ws) {
  const limPos = Math.min(ws.eclp, 1023), limNeg = Math.min(ws.ecln, 1023), A = ws.a;
  let out;
  if (edge >= 0) out = edge < A ? 0 : Math.min(((edge - A) * gain) >> 6, limPos, 1023);
  else out = -edge < A ? 0 : -Math.min(((-edge - A) * gain) >> 6, limNeg, 1023);
  return (ws.esel ? -out : out) | 0;   // ESEL!=0 flips the edge sign
}
// Decoded from sub_1800db8e0: 8-segment clamped piecewise-linear gain LUT,
// LUT[i] = min(1023, ((i-knee)*slope >> 9) + off). Here reduced to the two
// controls the firmware exposes by name (DER overall gain, KEG mid slope);
// the full register->knee mapping is set inside ReadReg and is not recovered,
// so the knee is a single inferred control. Identity when der==64 && keg==64.
export function edgeLut(der, keg) {
  const lut = new Int16Array(1024);
  const knee = 256, sLo = (keg / 64), sHi = (der / 64);
  for (let i = 0; i < 1024; i++) {
    const v = i < knee ? i * sLo : knee * sLo + (i - knee) * sHi;
    lut[i] = Math.min(1023, Math.max(0, Math.round(v)));
  }
  return lut;
}

function gaussian(src, w, h, sigma, tmp, out) {
  const r = Math.max(1, Math.ceil(sigma * 2.5)), k = new Float32Array(2 * r + 1);
  let sum = 0; for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let i = -r; i <= r; i++) v += k[i + r] * src[y * w + clamp(x + i, 0, w - 1)]; tmp[y * w + x] = v; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let i = -r; i <= r; i++) v += k[i + r] * tmp[clamp(y + i, 0, h - 1) * w + x]; out[y * w + x] = v; }
}
const CENTRES12 = Array.from({ length: 12 }, (_, i) => 171 - 30 * i);   // yellow first, then the wheel's order
const CENTRES6 = [111, 171, -129, -69, -9, 51];                          // R Y G C B M (order assumed)
function weights(deg, centres, span, out) {
  for (let i = 0; i < centres.length; i++) {
    let d = Math.abs(deg - centres[i]) % 360; if (d > 180) d = 360 - d;
    out[i] = d < span ? 1 - d / span : 0;
  }
}

// The real hardware edge extractor, decoded from OlyPomegranate DemYEdge (sub_bc7b0):
// a separable 6-tap band-pass [-1,-1,4,4,-1,-1], applied H and V, direction-adaptive
// (the hardware picks the direction per pixel via DemHomo; here max magnitude approximates it).
// Writes blur = ten - edge, with WS_TAP_NORM set so the step overshoot matches the measured
// 5x5 (the net form of this same filter after the hardware's direction combine).
const WS_TAP_NORM = 0.060;   // calibrated to the measured kernel's rendered halo prominence (DC-corrected taps)
function wsTapsEdge(ten, w, h, blur) {
  const bpH = new Float32Array(w * h), bpV = new Float32Array(w * h);
  const at = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  // The raw taps [-1,-1,4,4,-1,-1] sum to +4 (DC gain), which the hardware cancels in its mixer
  // stages. Subtract (tapsum/ntaps) * window-sum so the edge is zero-sum (no flat-field brightening).
  const DC = 4 / 6;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = y * w;
    const bp = (c) => { const s0 = ten[r + at(c - 2, 0, w - 1)], s1 = ten[r + at(c - 1, 0, w - 1)], s2 = ten[r + at(c, 0, w - 1)], s3 = ten[r + at(c + 1, 0, w - 1)], s4 = ten[r + at(c + 2, 0, w - 1)], s5 = ten[r + at(c + 3, 0, w - 1)]; return 4 * (s2 + s3) - s0 - s1 - s4 - s5 - DC * (s0 + s1 + s2 + s3 + s4 + s5); };
    bpH[r + x] = 0.5 * (bp(x - 1) + bp(x));
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    const c = x;
    const bp = (q) => { const s0 = ten[at(q - 2, 0, h - 1) * w + c], s1 = ten[at(q - 1, 0, h - 1) * w + c], s2 = ten[at(q, 0, h - 1) * w + c], s3 = ten[at(q + 1, 0, h - 1) * w + c], s4 = ten[at(q + 2, 0, h - 1) * w + c], s5 = ten[at(q + 3, 0, h - 1) * w + c]; return 4 * (s2 + s3) - s0 - s1 - s4 - s5 - DC * (s0 + s1 + s2 + s3 + s4 + s5); };
    bpV[y * w + x] = 0.5 * (bp(y - 1) + bp(y));
  }
  for (let i = 0; i < w * h; i++) {
    const a = bpH[i], b = bpV[i];
    const e = (Math.abs(a) > Math.abs(b) ? a : b) * WS_TAP_NORM;   // direction-adaptive
    blur[i] = ten[i] - e;
  }
}

export function render(mosaic, p) {
  const w = SIZE, h = SIZE, n = w * h, on = p.on;
  const m = new Float32Array(n), idx = p.cfaIdx;
  const rng = p.levels.white - p.levels.black, ev = Math.pow(2, p.wb.ev), gains = [p.wb.r, p.wb.g, p.wb.b];
  for (let i = 0; i < n; i++) {
    let v = mosaic[i];
    if (on.levels) v = (v - p.levels.black) / (rng > 1e-4 ? rng : 1e-4);
    m[i] = v;
  }
  if (on.wb) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] *= gains[idx[((y & 1) << 1) | (x & 1)]] * ev;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  if (!on.demosaic) { R.set(m); G.set(m); B.set(m); }
  else if (p.demosaic.method === 'amaze') demosaicAMaZE(m, w, h, idx, R, G, B, on.wb ? Math.min(...gains) * ev : 1);   // lowest level at which a channel clips
  else (p.demosaic.method === 'mhc' ? demosaicMHC : demosaicBilinear)(m, w, h, idx, R, G, B);
  if (on.matrix) { const a = p.matrix; for (let i = 0; i < n; i++) { const r = R[i], g = G[i], b = B[i]; R[i] = a[0] * r + a[1] * g + a[2] * b; G[i] = a[3] * r + a[4] * g + a[5] * b; B[i] = a[6] * r + a[7] * g + a[8] * b; } }
  const toY = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  if (on.sixaxis && (p.sixaxis.sat.some(Boolean) || p.sixaxis.hue.some(Boolean))) {
    const wt = new Float32Array(6);
    for (let i = 0; i < n; i++) {
      const r = R[i], g = G[i], b = B[i], y = toY(r, g, b); let cb = (b - y) * 0.564, cr = (r - y) * 0.713;
      if (cb === 0 && cr === 0) continue;
      weights((Math.atan2(cr, cb) * 180) / Math.PI, CENTRES6, 60, wt);
      let s = 0, t = 0; for (let k = 0; k < 6; k++) { s += wt[k] * p.sixaxis.sat[k]; t += wt[k] * p.sixaxis.hue[k]; }
      const gain = 1 + s / 100, rot = (t * Math.PI) / 180, co = Math.cos(rot) * gain, si = Math.sin(rot) * gain;
      const cb2 = co * cb - si * cr, cr2 = si * cb + co * cr;
      R[i] = y + 1.402 * cr2; G[i] = y - 0.344 * cb2 - 0.714 * cr2; B[i] = y + 1.772 * cb2;
    }
  }
  if (on.gamma) {
    const inv = 1 / p.gamma.gamma, a = (p.gamma.contrast / 5) * 0.12, tp = Math.PI * 2;
    const curve = new Float32Array(4097);
    for (let i = 0; i <= 4096; i++) { const v = Math.pow(i / 4096, inv); curve[i] = v - a * Math.sin(tp * v); }
    const f = (v) => { if (v <= 0) return 0; if (v >= 1) return 1; const q = v * 4096, k = q | 0; return curve[k] + (curve[k + 1] - curve[k]) * (q - k); };
    for (let i = 0; i < n; i++) { R[i] = f(R[i]); G[i] = f(G[i]); B[i] = f(B[i]); }
  } else for (let i = 0; i < n; i++) { R[i] = clamp(R[i], 0, 1); G[i] = clamp(G[i], 0, 1); B[i] = clamp(B[i], 0, 1); }
  // Colour depth (deepen): hold the dominant channel and push the others down -> richer + darker
  // colour (not grey). Measured: bench reds/blues render less saturated than OEM; this closes it.
  if (on.chroma && p.chroma.depth > 0) {
    const d = p.chroma.depth;
    for (let i = 0; i < n; i++) {
      const r = R[i], g = G[i], b = B[i], mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      R[i] = clamp(mx - (mx - r) * (1 + d), 0, 1); G[i] = clamp(mx - (mx - g) * (1 + d), 0, 1); B[i] = clamp(mx - (mx - b) * (1 + d), 0, 1);
    }
  }
  const Y = new Float32Array(n), Cb = new Float32Array(n), Cr = new Float32Array(n);
  for (let i = 0; i < n; i++) { const y = toY(R[i], G[i], B[i]); Y[i] = y; Cb[i] = (B[i] - y) * 0.564; Cr[i] = (R[i] - y) * 0.713; }
  if (on.chroma) for (let i = 0; i < n; i++) { Cb[i] *= p.chroma.gain; Cr[i] *= p.chroma.gain; }
  // Chroma edge handling. Measured from the synthetic-chart ORF processed through OM Workspace:
  // across a red/white edge the chroma (Cb/Cr) is a SOFT low-pass step (sigma ~1.3, ~3.8px wide,
  // NO overshoot) while luma stays sharp with its unsharp halos. That chroma blur is the whole
  // mechanism (DemCFltr) -- the red colour fades ~3px inside the edge (inward thinning) and the
  // luma dark undershoot supplies the dark rim. Reconstructing the measured RGB from (measured
  // luma + blurred chroma) matched to 2.7 counts/channel. FCS is a separate edge-gated suppression
  // the camera leaves OFF (registers = 0); kept here as an off-by-default extra.
  if (on.chromaedge) {
    const ce = p.chromaedge;
    if (ce.blur > 0) {
      const tmp = new Float32Array(n), ob = new Float32Array(n);
      gaussian(Cb, w, h, ce.blur, tmp, ob); Cb.set(ob);
      gaussian(Cr, w, h, ce.blur, tmp, ob); Cr.set(ob);
    }
    if (ce.shift > 0) {
      // "Bright pushes into dark" edge thinning. At luma edges, pull the LUMA toward the brighter
      // side by up to `shift` px (brighten only, never darken). This erodes dark/colour features
      // toward the bright background, so thin red lines and the like thin and brighten toward white
      // (not grey) -- the OEM look. Chroma is left to the blur above.
      const yN = Y.slice(), sh = ce.shift;
      const samp = (buf, fx, fy) => {
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const xa = clamp(x0, 0, w - 1), xb = clamp(x0 + 1, 0, w - 1), ya = clamp(y0, 0, h - 1), yb = clamp(y0 + 1, 0, h - 1);
        const a = buf[ya * w + xa] * (1 - tx) + buf[ya * w + xb] * tx;
        const b = buf[yb * w + xa] * (1 - tx) + buf[yb * w + xb] * tx;
        return a * (1 - ty) + b * ty;
      };
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const gx = yN[i + (x < w - 1 ? 1 : 0)] - yN[i - (x > 0 ? 1 : 0)];
        const gy = yN[i + (y < h - 1 ? w : 0)] - yN[i - (y > 0 ? w : 0)];
        const mag = Math.hypot(gx, gy);
        if (mag < 0.004) continue;
        const bright = samp(yN, x + sh * gx / mag, y + sh * gy / mag);   // luma toward the brighter side
        if (bright > Y[i]) Y[i] = bright;                                 // brighten only
      }
    }
    if (ce.fcslmt > 0) {   // optional edge-gated chroma suppression (toward neutral, constant luma)
      const ten = new Float32Array(n), tmp = new Float32Array(n), blur = new Float32Array(n);
      for (let i = 0; i < n; i++) ten[i] = clamp(Y[i], 0, 1) * 1023;
      gaussian(ten, w, h, 1, tmp, blur);
      for (let i = 0; i < n; i++) {
        let supp = (Math.abs(ten[i] - blur[i]) * ce.fcsca1) >> 4;
        if (supp > ce.fcslmt) supp = ce.fcslmt;
        let f = 1 - (supp * ce.fcskrbg) / 65536;
        if (f < 0) f = 0; if (f >= 1) continue;
        Cb[i] *= f; Cr[i] *= f;
      }
    }
  }
  if (on.hsl && p.hsl.active) {
    const wt = new Float32Array(12), H = p.hsl.h, S = p.hsl.s, L = p.hsl.l;
    for (let i = 0; i < n; i++) {
      const cb = Cb[i], cr = Cr[i], c2 = cb * cb + cr * cr;
      if (c2 < 1e-8) continue;
      weights((Math.atan2(cr, cb) * 180) / Math.PI, CENTRES12, 30, wt);
      let a = 0, s = 0, l = 0; for (let k = 0; k < 12; k++) { a += wt[k] * H[k]; s += wt[k] * S[k]; l += wt[k] * L[k]; }
      const gain = Math.max(0, 1 + s / 450), rot = ((a / 1000) * 3 * Math.PI) / 180, co = Math.cos(rot) * gain, si = Math.sin(rot) * gain;
      Cb[i] = co * cb - si * cr; Cr[i] = si * cb + co * cr;
      Y[i] += (l / 2500) * Math.min(1, Math.sqrt(c2) * 4);
    }
  }
  if (on.tone) {
    const t = p.tone, lut = t.lut;
    for (let i = 0; i < n; i++) {
      let y = clamp(Y[i], 0, 1);
      if (lut) { const q = y * 255, k = Math.min(254, q | 0); y = lut[k] + (lut[k + 1] - lut[k]) * (q - k); }
      const sh = (1 - y) * (1 - y), hi = y * y, mid = 4 * y * (1 - y);
      Y[i] = y + 0.02 * (t.shadows * sh * (1 - y) + t.midtones * mid * 0.5 + t.highlights * hi * y);
    }
  }
  if (on.tint) {
    const t = p.tint, cb = t.cb / 256, cr = t.cr / 256;
    if (t.mono) for (let i = 0; i < n; i++) { Cb[i] = cb; Cr[i] = cr; }
    else if (cb || cr) for (let i = 0; i < n; i++) { Cb[i] += cb; Cr[i] += cr; }
  }
  if (on.soften && p.soften.sigma > 0) {
    const a = Float32Array.from(Y), tmp = new Float32Array(n);
    gaussian(a, w, h, p.soften.sigma, tmp, Y);
  }
  if (on.sharpen) {
    const s = p.sharpen, ten = new Float32Array(n), tmp = new Float32Array(n), blur = new Float32Array(n), local = new Float32Array(n);
    for (let i = 0; i < n; i++) ten[i] = clamp(Y[i], 0, 1) * 1023;
    const wsPath = s.path === 'workspace';
    if (s.bright > 0 || wsPath) gaussian(ten, w, h, 4, tmp, local);   // local brightness = ES second-source stand-in
    if (s.kernel === 'wstaps' && !wsPath) {
      wsTapsEdge(ten, w, h, blur);
    } else if (s.kernel === 'measured' || wsPath) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let e = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) e += MEASURED_KERNEL[Math.abs(dy)][Math.abs(dx)] * ten[clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)];
        blur[y * w + x] = ten[y * w + x] - e;   // so the edge below is ten - blur = e
      }
    } else gaussian(ten, w, h, s.radius, tmp, blur);
    if (wsPath) {
      // Decoded Workspace shaper: measured edge -> optional Edge LUT -> ed820 gain/coring/limit.
      const ws = s.ws, lut = (ws.der !== 64 || ws.keg !== 64) ? edgeLut(ws.der, ws.keg) : null;
      // The measured kernel is the net 5x5; the real path runs the raw 6-tap band-pass
      // then normalises before the shaper. That normalisation (a mixer >>N) isn't
      // recovered from static disassembly, so WS_NORM carries the validated edge scale
      // and ES/ESV modulate on top of it.
      const WS_NORM = 3;
      for (let i = 0; i < n; i++) {
        let edge = Math.round((ten[i] - blur[i]) * WS_NORM);
        if (lut) { const a = Math.abs(edge); edge = Math.sign(edge) * lut[Math.min(1023, a)]; }
        const gain = wsGain(clamp(local[i] / 16, 0, 64), ws);   // local brightness scaled into the sig range
        Y[i] = clamp(ten[i] + sharpenEdgeWS(edge, gain, ws), 0, 1023) / 1023;
      }
    } else {
      for (let i = 0; i < n; i++) {
        const g = s.bright > 0 ? 1 + s.bright * (brightnessGain(local[i] / 4.012) - 1) : 1;
        Y[i] = clamp(ten[i] + sharpenEdge(Math.round((ten[i] - blur[i]) * s.scale * g), s.A, s.K, s.shift, s.limPos, s.limNeg), 0, 1023) / 1023;
      }
    }
  }
  if (on.grain && p.grain.gain > 0) {
    const g = p.grain, st = { state: g.seed >>> 0 || 1 };
    for (let i = 0; i < n; i++) {
      const y = Math.round(clamp(Y[i], 0, 1) * 65535);
      Y[i] = grainLine(y, g.mask[y >> 8] << 6, g.gain, st) / 65535;
    }
  }
  if (on.shading && p.shading.step !== 0) {
    const s = p.shading, c = s.curve, q = Math.floor(1048576 / s.word), scale = 1024 / q, top = c[0] || 1;
    const white = s.step > 0, prot = s.protection, mid = s.midpoint, kk = (mid / (1 - mid)) ** 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, nx = ((2 * x + 1) / w - 1) * scale, ny = ((2 * y + 1) / h - 1) * scale;
      const r2 = Math.min(1, (nx * nx + ny * ny) / 2) * (c.length - 1), k = Math.min(c.length - 2, r2 | 0);
      let g = clamp((c[k] + (c[k + 1] - c[k]) * (r2 - k)) / top, 0, 1);
      const yy = clamp(Y[i], 0, 1);
      if (prot > 0 && !white) { const hh = (prot * yy * yy) / (yy * yy + kk * (1 - yy) * (1 - yy) || 1); g += (1 - g) * hh; }
      Y[i] = white ? g * yy + (1 - g) : g * yy;
      Cb[i] *= g; Cr[i] *= g;
    }
  }
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const y = Y[i], cb = Cb[i], cr = Cr[i], o = 4 * i;
    out[o] = 255 * (y + 1.402 * cr); out[o + 1] = 255 * (y - 0.344 * cb - 0.714 * cr); out[o + 2] = 255 * (y + 1.772 * cb); out[o + 3] = 255;
  }
  return out;
}

// A synthetic scene for first launch: colour patches, gradients and resolution wedges, mosaiced.
export function testScene(cfaIdx) {
  const w = SIZE, h = SIZE, out = new Float32Array(w * h);
  const patches = [[.45,.32,.25],[.8,.55,.45],[.28,.38,.6],[.25,.34,.18],[.45,.45,.72],[.35,.75,.65],[.85,.45,.1],[.2,.25,.7],[.8,.28,.32],[.3,.15,.4],[.6,.75,.15],[.9,.62,.08],[.1,.15,.55],[.2,.55,.25],[.7,.13,.13],[.92,.8,.05],[.75,.25,.6],[0,.5,.68],[.95,.95,.92],[.6,.6,.6],[.35,.35,.35],[.19,.19,.19],[.09,.09,.09],[.03,.03,.03]];
  const lin = (v) => v * v;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c;
    if (y < 200) { const col = Math.min(5, x / 66.67 | 0), row = Math.min(3, y / 50 | 0), inset = x % 66.67 > 4 && y % 50 > 4; const q = patches[row * 6 + col]; c = inset ? q.map(lin) : [.01, .01, .01]; }
    else if (y < 260) { const t = x / 399; c = [t * t, t * t, t * t]; }
    else if (y < 330) { const f = 0.02 + (x / 399) * 0.45, v = 0.5 + 0.5 * Math.sin(2 * Math.PI * f * x); c = [v * .7, v * .7, v * .7]; }
    else { const dx = x - 200, dy = y - 365, r = Math.sqrt(dx * dx + 4 * dy * dy), v = r < 170 ? (0.5 + 0.5 * Math.cos(r * r * 0.004)) * .8 : .15; c = [v, v * .85, v * .6]; }
    out[y * w + x] = c[cfaIdx[((y & 1) << 1) | (x & 1)]];
  }
  return out;
}
