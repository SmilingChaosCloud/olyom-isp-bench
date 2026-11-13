// Compares the JS port with the original C++ (scalar branch) compiled from the uploaded source. Needs /tmp/rtcheck/a.
import { writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { demosaicAMaZE } from '../src/amaze.js';
import { testScene, SIZE } from '../src/pipeline.js';
import { cfaIndex } from '../src/png.js';
const N = SIZE * SIZE;
function rng(seed) { let s = seed >>> 0; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const scenes = {
  chart: (c) => testScene(cfaIndex(c)),
  noisy: (c) => { const r = rng(5), m = testScene(cfaIndex(c)); for (let i = 0; i < N; i++) m[i] = Math.max(0, m[i] + (r() - 0.5) * 0.04); return m; },
  random: (_) => { const r = rng(99); return Float32Array.from({ length: N }, () => r()); },
  clipped: (c) => { const m = testScene(cfaIndex(c)); for (let i = 0; i < N; i++) m[i] = Math.min(1, m[i] * 3); return m; },
};
let worst = 0;
for (const [name, mk] of Object.entries(scenes)) for (const cfa of ['RGGB', 'BGGR', 'GRBG', 'GBRG']) for (const gain of [1, 1.6]) {
  const m = Float32Array.from(mk(cfa));
  writeFileSync('/tmp/rtcheck/in.bin', Buffer.from(m.buffer));
  execFileSync('/tmp/rtcheck/a', [cfa, '/tmp/rtcheck/in.bin', '/tmp/rtcheck/out.bin', String(gain)]);
  const b = readFileSync('/tmp/rtcheck/out.bin'), ref = new Float32Array(b.buffer, b.byteOffset, 3 * N);
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
  const t0 = performance.now(); demosaicAMaZE(m, SIZE, SIZE, cfaIndex(cfa), R, G, B, 1 / gain); const ms = performance.now() - t0;
  let max = 0, sum = 0, big = 0;
  [R, G, B].forEach((p, c) => { for (let i = 0; i < N; i++) { const d = Math.abs(p[i] - ref[c * N + i]); sum += d; if (d > max) max = d; if (d > 1 / 1024) big++; } });
  worst = Math.max(worst, max);
  console.log(name.padEnd(8), cfa, 'gain', gain, 'max diff', max.toExponential(2), 'mean', (sum / (3 * N)).toExponential(2), 'pixels >1/1024:', big, Math.round(ms) + 'ms');
}
console.log('worst', worst);
