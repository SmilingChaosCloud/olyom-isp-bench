// Runs the firmware's own ISP parameter builders on om-emu's MN103 core. Same contract as oly_fw_analysis's ProbeState:
// only explicitly mapped regions exist, the image is read-only, and any other access is a fault that gets reported.
import { Fault, initMemory, addRegion, K_RAM, K_ROM, U8, DRAM_OFF } from '../vendor/om-emu/mem.mjs';
import { R, S, PC, SP, PSW, D0, A0, MDR, FAULT, step, resetCpu } from '../vendor/om-emu/cpu.mjs';
import { PENF } from './firmware.js';

const CALLER = 0x18000000, STACK = 0x18010000, SP0 = 0x18018000, RESULT = 0x18020000;
const C = 0x19000000, Q = 0x19001000, O = 0x19003000, YC = O + 0x20c, M = 0x19007000;
const HSL_OUT = 0x19100000, HSL_SAT = 0x19200000, ICM = 0x17a8;
const BANK0 = 0x9e001800;
const DREG = { d0: D0, d1: D0 + 1, d2: D0 + 2, d3: D0 + 3, a0: A0, a1: A0 + 1, a2: A0 + 2, a3: A0 + 3 };
const hex = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');

export class NativeError extends Error {}

export class NativeIsp {
  constructor(image) {
    this.image = image;
    initMemory(128 << 20);
    this.next = DRAM_OFF;
    this.regions = {};
    this.map('main', PENF.base, image.length, K_ROM); U8.set(image, this.regions.main.off);
    this.map('caller', CALLER, 16);
    this.map('stack', STACK, 0x10000);
    this.map('result', RESULT, 16);
    this.map('context', C, 192);
    this.map('request', Q, 1132);
    this.map('configuration', O, 8192);
    this.map('seed_sample', M, 2);
    this.map('hsl_output', HSL_OUT, 5212);
    this.map('hsl_saturation', HSL_SAT, 12);
    this.map('yc_bank', BANK0, 0x1000);
    const seed = this.map('alt_seed_counter', 0x61c63108, 4);
    addRegion({ name: 'alt_seed_counter_uncached', base: 0xa1c63108, size: 4, kind: K_RAM, off: seed.off });
    this.calls = [];
  }
  map(name, base, size, kind = K_RAM) {
    const off = ((this.next + 0xffff) & ~0xffff) + (base & 0xffff);
    this.next = off + size;
    return (this.regions[name] = addRegion({ name, base, size, kind, off }));
  }
  offset(name, a = this.regions[name].base) { return this.regions[name].off + (a - this.regions[name].base); }
  zero(...names) { for (const n of names) { const r = this.regions[n]; U8.fill(0, r.off, r.off + r.size); } }
  u8(a) { return U8[this.at(a)]; }
  at(a) { for (const r of Object.values(this.regions)) if (a >= r.base && a < r.end) return r.off + (a - r.base); throw new NativeError(`harness read of unmapped ${hex(a)}`); }
  bytes(a, n) { const o = this.at(a); return U8.slice(o, o + n); }
  put(a, ...vals) { const o = this.at(a); vals.forEach((v, i) => { U8[o + i] = v & 255; }); }
  p16(a, v) { this.put(a, v, v >> 8); }
  p32(a, v) { this.put(a, v, v >> 8, v >> 16, v >>> 24); }
  g16(a) { const o = this.at(a); return U8[o] | (U8[o + 1] << 8); }
  g32(a) { const o = this.at(a); return (U8[o] | (U8[o + 1] << 8) | (U8[o + 2] << 16) | (U8[o + 3] << 24)) >>> 0; }

  call(name, target, mask, frame, regs, limit = 20000) {
    const rel = (target - CALLER) | 0;
    this.put(CALLER, 0xdd, rel, rel >> 8, rel >> 16, rel >>> 24, mask, frame, 0xcb);
    resetCpu(limit);
    R[SP] = SP0; R[PC] = CALLER; R[PSW] = 0;
    for (const [k, v] of Object.entries(regs)) R[DREG[k]] = v | 0;
    const stop = (CALLER + 7) | 0;
    let n = 0;
    try {
      for (; R[PC] !== stop; n++) {
        if (n >= limit) throw new NativeError(`stopped after ${limit} instructions at pc ${hex(R[PC])}`);
        step();
      }
    } catch (e) {
      if (e instanceof Fault) throw new NativeError(`${name}: CPU fault ${e.code} at pc ${hex(R[PC])}, address ${hex(e.addr)}`);
      if (e instanceof NativeError) throw new NativeError(`${name}: ${e.message}`);
      throw e;
    }
    if ((R[SP] | 0) !== SP0) throw new NativeError(`${name}: stack not balanced on return (sp ${hex(R[SP])})`);
    this.calls.push({ name, target, insns: n });
    return n;
  }

  // The grain probe's fixture: context, request, zeroed configuration block
  fixture(mode, stage) {
    this.zero('context', 'request', 'configuration', 'seed_sample', 'alt_seed_counter');
    this.p32(C + 4, Q); this.p32(C + 8, O); this.p32(C + 12, YC);
    this.p32(C + 48, mode); this.p32(C + 56, 0xffffffff);
    this.p16(Q + 10, mode); this.p16(Q + 12, stage); this.p16(Q + 28, 0x200);
  }

  // 604f3ba1 YC packing, then 604b5006 register upload. Block +13 coring, +14 gain, +16 and +18 the two limits.
  sharpen(mode, sharpness, sv, stage = 0) {
    this.fixture(mode, stage);
    this.p16(Q + 0x40e, sv); this.put(Q + 0x422, sharpness);
    this.call('YC packing 604f3ba1', 0x604f3ba1, 0xf0, 24, { a0: C });
    const block = this.bytes(YC, 0x500);
    U8.fill(0xa5, this.regions.yc_bank.off, this.regions.yc_bank.off + 0x1000);
    this.call('YC register writer 604b5006', 0x604b5006, 0xf0, 24, { a0: BANK0, a1: YC });
    return { coring: block[13], gain: block[14], control: block[12], limitA: block[16] | (block[17] << 8), limitB: block[18] | (block[19] << 8),
      regs: { 'bank+40': this.g32(BANK0 + 0x40), 'bank+44': this.g32(BANK0 + 0x44) } };
  }
  // 604f55de: six-axis hue and saturation, twelve i16 at YC+108
  sixAxis(mode) {
    this.fixture(mode, 0);
    this.call('six-axis 604f55de', 0x604f55de, 0xf0, 100, { a0: C });
    const a = []; for (let i = 0; i < 12; i++) a.push((this.g16(YC + 108 + 2 * i) << 16) >> 16);
    return { sat: a.slice(0, 6), hue: a.slice(6) };
  }
  // 604ea2ba: creative grain configuration (MONO route)
  grain(level, stage = 0x901) {
    this.fixture(12, stage);
    this.put(Q + 0x440, level); this.p32(Q + 212, M); this.p16(M, 0x1234);
    this.call('grain builder 604ea2ba', 0x604ea2ba, 0xf0, 20, { a0: C });
    return { gain: this.g32(O + ICM + 112), seed: this.g32(O + ICM + 148) };
  }
  // 604f75e5: returns a pointer to a 256-entry luminance tone LUT
  tone(mode, stage = 0) {
    this.fixture(mode, stage);
    this.call('tone selector 604f75e5', 0x604f75e5, 0xf0, 24, { a0: Q, a1: RESULT });
    const a = R[A0] >>> 0;
    const main = this.regions.main;
    if (a < main.base || a + 512 > main.end) throw new NativeError(`tone selector returned ${hex(a)}, outside the firmware image`);
    const o = main.off + (a - main.base), lut = new Uint16Array(256);
    for (let i = 0; i < 256; i++) lut[i] = U8[o + 2 * i] | (U8[o + 2 * i + 1] << 8);
    return { pointer: a, lut };
  }
  // 604f83f1: chroma suppression and tint control word
  chroma(mode, stage = 0) {
    this.fixture(mode, stage);
    this.call('chroma control 604f83f1', 0x604f83f1, 0xb0, 20, { a0: C });
    return this.g32(YC + 0x4c);
  }
  // 604f7272: twelve-sector coefficient builder. Input is in wheel order; records in table order.
  hsl(saturation) {
    const table = 0x60622d74;
    this.zero('hsl_output', 'hsl_saturation');
    saturation.forEach((s, i) => this.put(HSL_SAT + i, s));
    const o = this.offset('main', table + 3024), d0 = U8[o] | (U8[o + 1] << 8);
    this.call('HSL builder 604f7272', 0x604f7272, 0xf0, 96, { a0: table, a1: HSL_SAT, d1: HSL_OUT, d0 }, 5000);
    const rec = [];
    for (let i = 0; i < 12; i++) { const r = []; for (let k = 0; k < 6; k++) r.push(this.g32(HSL_OUT + 676 + 24 * i + 4 * k) | 0); rec.push(r); }
    return { records: rec, enable: this.g32(HSL_OUT + 964) };
  }
  // Tables read straight from the image, so a patched table reaches the pipeline.
  tables() {
    const main = this.regions.main, r8 = (a) => U8[main.off + (a - main.base)], r16 = (a) => r8(a) | (r8(a + 1) << 8);
    const list16 = (a, n) => Array.from({ length: n }, (_, i) => r16(a + 2 * i));
    return { sharpLut: list16(0x60619ade, 11), coring: Array.from({ length: 12 }, (_, i) => r8(0x606199a6 + i)),
      grainGains: list16(0x605fc452, 3), grainMask: Uint16Array.from(list16(0x60610742, 256)),
      shadingCurve: list16(0x605fc340, 64), shadingWords: list16(0x605fc45e, 5) };
  }
}
export { hex };
