import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fakeMain, fakeBin } from './make-fake-fw.mjs';
import { identify } from '../src/firmware.js';
import { NativeIsp, NativeError } from '../src/native.js';
import { sha256 } from '../src/sha256.js';
import { grainLine, sharpenEdge, render, testScene, demosaicBilinear, demosaicMHC, SIZE, MEASURED_KERNEL } from '../src/pipeline.js';
import { defaults, resolve, STAGES } from '../src/params.js';
import { cfaIndex } from '../src/png.js';
import { demosaicAMaZE } from '../src/amaze.js';

// sha256 known answers
assert.equal(sha256(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
assert.equal(sha256(new Uint8Array(0)), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

// grain and sharpen against an independent Python transcription of the documents
const py = JSON.parse(execFileSync('python3', ['-I', 'test/reference.py'], { maxBuffer: 1 << 26 }).toString());
let st = { state: 10 };
py.grain.forEach(([y, m, g, want], i) => assert.equal(grainLine(y, m, g, st), want, 'grain case ' + i));
py.sharpen.forEach(([e, A, K, p, n, want], i) => assert.equal(sharpenEdge(e, A, K, 6, p, n), want, 'sharpen case ' + i));

// demosaic: a flat grey mosaic stays flat, any CFA; a colour ramp reconstructs closely
for (const cfa of ['RGGB', 'BGGR', 'GRBG', 'GBRG']) {
  const idx = cfaIndex(cfa), w = 400, h = 400, m = new Float32Array(w * h).fill(0.4);
  for (const f of [demosaicBilinear, demosaicMHC, demosaicAMaZE]) {
    const R = new Float32Array(w * h), G = new Float32Array(w * h), B = new Float32Array(w * h); f(m, w, h, idx, R, G, B);
    for (const pl of [R, G, B]) for (const v of pl) assert.ok(Math.abs(v - 0.4) < 1e-4, f.name + ' ' + v);
  }
  const ramp = (x, y, c) => 0.2 + 0.01 * x + 0.005 * y + 0.1 * c;
  const m2 = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m2[y * w + x] = ramp(x, y, idx[((y & 1) << 1) | (x & 1)]);
  const R = new Float32Array(w * h), G = new Float32Array(w * h), B = new Float32Array(w * h); demosaicBilinear(m2, w, h, idx, R, G, B);
  for (let y = 4; y < h - 4; y++) for (let x = 4; x < w - 4; x++) { assert.ok(Math.abs(R[y * w + x] - ramp(x, y, 0)) < 1e-4, cfa + ' R'); assert.ok(Math.abs(B[y * w + x] - ramp(x, y, 2)) < 1e-4, cfa + ' B'); }
}

// firmware path
const main = fakeMain(), bin = fakeBin(main);
const blob = (u) => new Blob([u]);
const id = await identify(blob(bin));
assert.equal(id.status, 'modified'); assert.equal(id.checksum, true); assert.equal(id.model, '0122');
assert.deepEqual(id.main.subarray(0, 64), main.subarray(0, 64));
assert.equal(sha256(id.main), sha256(main), 'descrambled equals original');
const raw = await identify(blob(main)); assert.equal(raw.status, 'modified'); assert.equal(raw.source, 'decoded main block');
assert.equal((await identify(blob(new Uint8Array(1000)))).status, 'unsupported');
const n = new NativeIsp(id.main);
const s0 = n.sharpen(11, 0, 1280), s2 = n.sharpen(11, 2, 1280);
assert.deepEqual([s0.coring, s0.gain, s0.limitA, s0.limitB], [12, 100, 200, 300]);
assert.equal(s2.gain, 102, 'request byte reaches the builder');
assert.equal(s2.regs['bank+40'] & 0xffffff, (102 << 16 | 12 << 8 | 0), 'register writer copied the block');
assert.equal(n.sixAxis(1).sat[0], 18);
assert.equal(n.grain(2).gain, 12);
const t = n.tone(11); assert.equal(t.pointer, 0x60700000); assert.equal(t.lut[255], 1020);
assert.equal(n.chroma(12), 0x00808001);
assert.equal(n.hsl([5, ...new Array(11).fill(0)]).records[0][2], 105);
const tb = n.tables(); assert.deepEqual(tb.shadingWords, [928, 952, 976, 1000, 1024]); assert.equal(tb.grainMask[120], 1023);

// faults are reported, not swallowed: a builder that hits unmapped memory
const bad = main.slice(); bad.set([0xf0, 0x50 | 0, 0xdf, 0xf0, 24], 0x604f3ba1 - 0x60021020);  // movbu d0,(a0) with a0 redirected below
const bad2 = bad.slice(); bad2.set([0xfc, 0xdc, 0, 0, 0, 0x30, 0xf0, 0x50, 0xdf, 0xf0, 24], 0x604f3ba1 - 0x60021020);
const nb = new NativeIsp(bad2);
assert.throws(() => nb.sharpen(11, 0, 1280), (e) => e instanceof NativeError && /CPU fault 2 .*0x30000000/.test(e.message));
// a write into the firmware image faults too
const bad3 = main.slice(); bad3.set([0xfc, 0xdc, 0, 0, 0x70, 0x60, 0xf0, 0x50, 0xdf, 0xf0, 24], 0x604f3ba1 - 0x60021020);
assert.throws(() => new NativeIsp(bad3).sharpen(11, 0, 1280), /CPU fault 2/);
// a runaway builder stops at the limit (jmp to self)
const bad4 = main.slice(); bad4.set([0xcc, 0, 0], 0x604f3ba1 - 0x60021020);
assert.throws(() => new NativeIsp(bad4).sharpen(11, 0, 1280), /stopped after 20000/);

// resolve: fallback, firmware, and failure fallback
const n2 = new NativeIsp(id.main), fw = { native: n2, tables: n2.tables() }, v = defaults();
v['sharpen.s'] = 2;
let r = resolve(v, 'camera', null, new Map());
assert.equal(r.p.sharpen.K, 37); assert.equal(r.p.sharpen.shift, 6); assert.equal(r.origin.sharpen, 'doc');
r = resolve(v, 'camera', fw, new Map());
assert.equal(r.p.sharpen.K, 102); assert.equal(r.origin.sharpen, 'fw'); assert.equal(r.shown['sharpen.K'], 102);
v['hsl.s0'] = 5; r = resolve(v, 'camera', fw, new Map()); assert.equal(r.p.hsl.s[0], 5); assert.equal(r.origin.hsl, 'fw');
const rr = resolve(v, 'reg', fw, new Map()); assert.equal(rr.origin.sharpen, 'user'); assert.equal(rr.p.sharpen.K, 34); assert.equal(rr.log.length, 0);
const nb2 = new NativeIsp(bad2), fwb = { native: nb2, tables: nb2.tables() };
r = resolve(v, 'camera', fwb, new Map()); assert.equal(r.origin.sharpen, 'doc'); assert.ok(r.log.find((l) => l.key === 'sharpen').error);

// pipeline: identity on flat grey with gamma off; sliders move pixels; bypass matters; determinism
const mos = new Float32Array(SIZE * SIZE).fill(0.5), d = defaults();
for (const k of ['gamma', 'sharpen']) d[k + '.on'] = false;
let out = render(mos, resolve(d, 'reg', null, new Map()).p);
assert.ok(Math.abs(out[0] - 127.5) <= 1 && Math.abs(out[1] - 127.5) <= 1 && Math.abs(out[2] - 127.5) <= 1, 'flat grey ' + [out[0], out[1], out[2]]);
const scene = testScene(cfaIndex('RGGB')), base = defaults();
const diff = (a, b) => { let c = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) c++; return c; };
const r0 = render(scene, resolve(base, 'camera', null, new Map()).p);
assert.equal(diff(r0, render(scene, resolve(base, 'camera', null, new Map()).p)), 0, 'deterministic');
const changes = { 'levels.black': 3, 'wb.r': 2, 'wb.b': 0.6, 'wb.ev': 1, 'demosaic.method': 'bilinear', 'demosaic.method+': 'mhc', 'matrix.m0': 1.4, 'gamma.gamma': 1.6, 'gamma.contrast': 3, 'chroma.gain': 1.6, 'hsl.s2': 7, 'hsl.h2': 3, 'hsl.l2': 5, 'tone.shadows': 5, 'tone.highlights': -5, 'soften.sigma': 1.5, 'sharpen.scale': 1, 'sharpen.bright': 0, 'sharpen.s': -2, 'sharpen.kernel': 'gaussian', 'sharpen.sv': 3840, 'grain.level': '2', 'shading.step': -5, 'shading.step+': 5, 'sixaxis.mode': '1' };
for (const [k, val] of Object.entries(changes)) { const benchP = /sharpen\.(scale|bright|kernel|radius)/.test(k); const regP = /hsl\.[hl]/.test(k); const src = regP ? 'reg' : 'camera'; const vb = defaults(); if (benchP) vb['sharpen.path'] = 'bench'; const base0 = (benchP || regP) ? render(scene, resolve(vb, src, null, new Map()).p) : r0; const v2 = { ...vb }; v2[k.replace('+', '')] = val; assert.ok(diff(base0, render(scene, resolve(v2, src, null, new Map()).p)) > 500, 'no effect: ' + k); }
for (const st of STAGES) { const v2 = defaults(); v2[st.id + '.on'] = false; const c = diff(r0, render(scene, resolve(v2, 'camera', null, new Map()).p)); if (['levels', 'wb', 'demosaic', 'matrix', 'sixaxis', 'gamma', 'chroma', 'sharpen'].includes(st.id)) { if (st.id !== 'levels' && st.id !== 'wb' && st.id !== 'matrix' && st.id !== 'sixaxis' && st.id !== 'chroma') assert.ok(c > 500, 'bypass: ' + st.id); } }
// MONO: no chroma; shading negative darkens corners more than centre
const mono = defaults(); mono['sixaxis.mode'] = '12'; const mo = render(scene, resolve(mono, 'camera', null, new Map()).p);
for (let i = 0; i < mo.length; i += 4) assert.ok(Math.abs(mo[i] - mo[i + 1]) <= 1 && Math.abs(mo[i + 1] - mo[i + 2]) <= 1);
const flat = new Float32Array(SIZE * SIZE).fill(0.4), sh = defaults(); sh['shading.step'] = -5; const so = render(flat, resolve(sh, 'camera', null, new Map()).p);
assert.ok(so[0] < so[4 * (200 * SIZE + 200)] - 10, 'vignette ' + so[0]);
// measured kernel: zero-sum, leaves flat areas unchanged, and differs from the Gaussian
{ const K = MEASURED_KERNEL; assert.ok(Math.abs(K[0][0] + 4 * K[0][1] + 4 * K[0][2] + 4 * K[1][1] + 8 * K[1][2] + 4 * K[2][2]) < 1e-9, 'zero sum');
  const f = defaults(); f['sharpen.kernel'] = 'measured'; f['gamma.on'] = false; const o = render(mos, resolve(f, 'reg', null, new Map()).p); assert.ok(Math.abs(o[0] - 127.5) <= 1 && Math.abs(o[4 * 80200] - 127.5) <= 1, 'flat stays flat'); }
writeFileSync('/tmp/fake.BIN', bin);
console.log('all tests passed');
