// PNG decoder that keeps 16-bit samples: a canvas would reduce them to 8 bits and apply colour management.
const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
async function inflate(u8) {
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export async function decodePng(u8) {
  if (!SIG.every((b, i) => u8[i] === b)) throw new Error('This file is not a PNG.');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.length);
  let p = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0, plte = null; const idat = [];
  while (p + 8 <= u8.length) {
    const n = dv.getUint32(p), t = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]), d = u8.subarray(p + 8, p + 8 + n);
    if (t === 'IHDR') { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); depth = u8[p + 16]; type = u8[p + 17]; interlace = u8[p + 20]; }
    else if (t === 'PLTE') plte = d; else if (t === 'IDAT') idat.push(d); else if (t === 'IEND') break;
    p += 12 + n;
  }
  if (interlace) throw new Error('Interlaced PNGs are not supported. Save the image without interlacing.');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!ch || !w || !h) throw new Error('This PNG has an unsupported colour type.');
  const size = idat.reduce((a, b) => a + b.length, 0), z = new Uint8Array(size);
  let at = 0; for (const c of idat) { z.set(c, at); at += c.length; }
  const raw = await inflate(z);
  const bpp = Math.max(1, (ch * depth) >> 3), stride = Math.ceil((w * ch * depth) / 8);
  if (raw.length < (stride + 1) * h) throw new Error('This PNG is truncated.');
  const row = new Uint8Array(stride), prev = new Uint8Array(stride);
  const out = new Float32Array(w * h * 3), scale = 1 / ((1 << depth) - 1);
  for (let y = 0, q = 0; y < h; y++) {
    const f = raw[q++];
    for (let x = 0; x < stride; x++) {
      const v = raw[q++], a = x >= bpp ? row[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let pr = 0;
      if (f === 1) pr = a; else if (f === 2) pr = b; else if (f === 3) pr = (a + b) >> 1;
      else if (f === 4) { const k = a + b - c, pa = Math.abs(k - a), pb = Math.abs(k - b), pc = Math.abs(k - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[x] = (v + pr) & 255;
    }
    const sample = (x, i) => {
      const n = x * ch + i;
      if (depth === 16) return (row[2 * n] << 8) | row[2 * n + 1];
      if (depth === 8) return row[n];
      const bit = n * depth; return (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    };
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      if (type === 3) { const k = sample(x, 0) * 3; out[o] = plte[k] / 255; out[o + 1] = plte[k + 1] / 255; out[o + 2] = plte[k + 2] / 255; }
      else if (ch <= 2) out[o] = out[o + 1] = out[o + 2] = sample(x, 0) * scale;
      else { out[o] = sample(x, 0) * scale; out[o + 1] = sample(x, 1) * scale; out[o + 2] = sample(x, 2) * scale; }
    }
    prev.set(row);
  }
  return { w, h, depth, rgb: out };
}

// The pipeline's 400x400 mosaic from a decoded PNG. Larger images are centre-cropped on even offsets so the CFA phase survives.
export function toMosaic(img, cfa, size = 400) {
  if (img.w < size || img.h < size) throw new Error(`This image is ${img.w}x${img.h}. Load one at least ${size}x${size} pixels.`);
  const ox = ((img.w - size) >> 2) << 1, oy = ((img.h - size) >> 2) << 1;
  let grey = true, sparse = 0;
  for (let i = 0; i < img.w * img.h; i++) {
    const r = img.rgb[3 * i], g = img.rgb[3 * i + 1], b = img.rgb[3 * i + 2];
    if (r !== g || g !== b) grey = false;
    if ((r > 0) + (g > 0) + (b > 0) <= 1) sparse++;
  }
  const kind = grey ? 'mono' : sparse >= 0.99 * img.w * img.h ? 'cfa-colour' : 'full-colour';
  const out = new Float32Array(size * size), idx = cfaIndex(cfa);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = ((y + oy) * img.w + x + ox) * 3, r = img.rgb[o], g = img.rgb[o + 1], b = img.rgb[o + 2];
    out[y * size + x] = kind === 'mono' ? r : kind === 'cfa-colour' ? Math.max(r, g, b) : img.rgb[o + idx[((y & 1) << 1) | (x & 1)]];
  }
  return { mosaic: out, kind, cropped: ox > 0 || oy > 0 };
}
export const cfaIndex = (c) => [...c].map((ch) => 'RGB'.indexOf(ch));
