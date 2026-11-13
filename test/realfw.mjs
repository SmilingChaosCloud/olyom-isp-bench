// Runs every builder against the real firmware and prints what they return.
import { readFileSync } from 'node:fs';
import { identify } from '../src/firmware.js';
import { NativeIsp } from '../src/native.js';
const buf = readFileSync(process.argv[2]);
const id = await identify(new Blob([buf]));
console.log('identify', id.status, id.source, 'model', id.model, 'checksum', id.checksum, id.sha, id.detail);
if (!id.main) process.exit(1);
const n = new NativeIsp(id.main);
const t = n.tables();
console.log('sharpLut', t.sharpLut.join(' ')); console.log('coring', t.coring.join(' ')); console.log('grainGains', t.grainGains.join(' '));
console.log('mask first nonzero', t.grainMask.findIndex((x) => x > 0), 'first 1023', t.grainMask.findIndex((x) => x === 1023), 'max', Math.max(...t.grainMask));
console.log('shadingWords', t.shadingWords.join(' ')); console.log('curve', t.shadingCurve.join(' '));
const tryit = (name, f) => { n.calls = []; try { const r = f(); console.log(name, JSON.stringify(r, (k, v) => (v instanceof Uint16Array ? `LUT[${v[0]},${v[1]},${v[64]},${v[128]},${v[192]},${v[255]}]` : v)), 'insns', n.calls.map((c) => c.insns).join('+')); return r; } catch (e) { console.log(name, 'FAILED', e.message); } };
for (const mode of [11, 12, 1, 2, 3, 4]) {
  tryit('sixaxis ' + mode, () => n.sixAxis(mode));
  tryit('tone ' + mode, () => n.tone(mode));
  tryit('chroma ' + mode, () => n.chroma(mode));
}
for (const mode of [11, 2]) for (const sv of [1280, 2560, 3840]) for (const s of [-2, -1, 0, 1, 2]) tryit(`sharpen m${mode} sv${sv} s${s}`, () => n.sharpen(mode, s, sv));
for (const l of [1, 2, 3]) tryit('grain ' + l, () => n.grain(l));
for (const s of [[5, ...Array(11).fill(0)], Array(12).fill(0), [7, ...Array(11).fill(0)], Array(12).fill(3)]) tryit('hsl ' + s.join(','), () => { const r = n.hsl(s); return { rec0: r.records[0], rec6: r.records[6], enable: r.enable }; });
