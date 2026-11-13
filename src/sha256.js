// Plain SHA-256. crypto.subtle is missing on some file:// and sandboxed origins, and firmware identity must not depend on it.
const K = new Uint32Array(64);
{ let n = 0; for (let c = 2; n < 64; c++) { let p = true; for (let d = 2; d * d <= c; d++) if (c % d === 0) { p = false; break; }
  if (p) { const r = Math.cbrt(c); K[n++] = Math.floor((r - Math.floor(r)) * 4294967296); } } }
export function sha256(u8) {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const len = u8.length, pad = new Uint8Array(((len + 9 + 63) & ~63) - len);
  pad[0] = 0x80;
  const hi = Math.floor(len / 536870912), lo = (len << 3) >>> 0, pn = pad.length;
  pad[pn - 8] = hi >>> 24; pad[pn - 7] = hi >>> 16; pad[pn - 6] = hi >>> 8; pad[pn - 5] = hi;
  pad[pn - 4] = lo >>> 24; pad[pn - 3] = lo >>> 16; pad[pn - 2] = lo >>> 8; pad[pn - 1] = lo;
  const total = len + pn, at = (i) => (i < len ? u8[i] : pad[i - len]);
  for (let off = 0; off < total; off += 64) {
    for (let t = 0; t < 16; t++) { const i = off + 4 * t; W[t] = ((at(i) << 24) | (at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3)) >>> 0; }
    for (let t = 16; t < 64; t++) {
      const a = W[t - 15], b = W[t - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[t] + W[t]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
}
