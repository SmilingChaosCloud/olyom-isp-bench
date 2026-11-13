// A synthetic stand-in for the PEN-F main block: real container format, documented table addresses, and tiny hand-assembled
// MN103 builders that honour the call contracts. It proves the load/run/capture path. It says nothing about the real builders.
import { PENF } from '../src/firmware.js';
import { PERM } from '../vendor/om-emu/olyfw.mjs';
export function fakeMain() {
  const img = new Uint8Array(PENF.len).fill(0xff);
  const at = (a) => a - PENF.base;
  const put = (a, bytes) => img.set(bytes, at(a));
  const p16 = (a, list) => list.forEach((v, i) => put(a + 2 * i, [v & 255, v >> 8]));
  const addA = (n, v) => { const o = []; for (; v > 127; v -= 127) o.push(0x20 | n, 127); for (; v < -128; v += 128) o.push(0x20 | n, 0x80); o.push(0x20 | n, v & 255); return o; };
  const ldA = (dst, addr) => [0xf0, (dst << 2) | addr];                 // mov (Aaddr),Adst
  const movD = (n, v) => [0x2c | n, v & 255, (v >> 8) & 255];
  const sb = (d, a) => [0xf0, 0x50 | (d << 2) | a];                     // movbu Dd,(Aa)
  const lb = (d, a) => [0xf0, 0x40 | (d << 2) | a];                     // movbu (Aa),Dd
  const addD = (n, v) => [0x28 | n, v & 255];
  const movImmA = (n, v) => [0xfc, 0xdc | n, v & 255, (v >>> 8) & 255, (v >>> 16) & 255, v >>> 24];
  const ret = (mask, frame) => [0xdf, mask, frame];
  // Sharpen: coring 12, K = 100 + 10 * sharpness, limits 200 and 300
  put(0x604f3ba1, [...ldA(2, 0), ...addA(0, 4), ...ldA(2, 0), ...addA(2, 0x422), ...lb(1, 2), ...addD(1, 100), ...addD(1, 0),
    ...addA(0, 8), ...ldA(1, 0), ...addA(1, 13), ...movD(0, 12), ...sb(0, 1), ...addA(1, 1), ...sb(1, 1), ...addA(1, 2), ...movD(0, 200), ...sb(0, 1), ...addA(1, 2), ...movD(0, 44), ...sb(0, 1), ...addA(1, 1), ...movD(0, 1), ...sb(0, 1), ...ret(0xf0, 24)]);
  // Register writer: copy block+12..15 to bank+0x40..43
  put(0x604b5006, [...addA(0, 0x40), ...addA(1, 12), ...lb(0, 1), ...sb(0, 0), ...addA(0, 1), ...addA(1, 1), ...lb(0, 1), ...sb(0, 0), ...addA(0, 1), ...addA(1, 1), ...lb(0, 1), ...sb(0, 0), ...ret(0xf0, 24)]);
  // Six-axis: sat[0] = 18
  put(0x604f55de, [...addA(0, 12), ...ldA(1, 0), ...addA(1, 108), ...movD(0, 18), ...sb(0, 1), ...ret(0xf0, 100)]);
  // Grain: gain = 100 * level + 10
  put(0x604ea2ba, [...addA(0, 4), ...ldA(2, 0), ...addA(2, 0x440), ...lb(1, 2), ...addA(0, 4), ...ldA(1, 0), ...addA(1, 0x17a8 + 112), ...addD(1, 10), ...sb(1, 1), ...ret(0xf0, 20)]);
  // Tone: return a pointer to a linear table
  put(0x604f75e5, [...movImmA(0, 0x60700000), ...ret(0xf0, 24)]);
  p16(0x60700000, Array.from({ length: 256 }, (_, i) => i * 4));
  // Chroma: mono control word
  put(0x604f83f1, [...addA(0, 12), ...ldA(1, 0), ...addA(1, 0x4c), ...movD(0, 1), ...sb(0, 1), ...addA(1, 1), ...movD(0, 0x80), ...sb(0, 1), ...addA(1, 1), ...sb(0, 1), ...ret(0xb0, 20)]);
  // HSL: record 0 word 2 = 100 + saturation[0]
  put(0x604f7272, [...lb(0, 1), ...addD(0, 100), ...movImmA(2, 0x19100000 + 676 + 8), ...sb(0, 2), ...ret(0xf0, 96)]);
  p16(0x60619ade, [64, 96, 128, 160, 208, 256, 256, 256, 256, 256, 256]);
  put(0x606199a6, [7, 7, 8, 8, 9, 12, 14, 18, 23, 35, 45, 60]);
  p16(0x605fc452, [110, 300, 600]);
  p16(0x60610742, Array.from({ length: 256 }, (_, i) => (i <= 36 ? 0 : i >= 120 ? 1023 : (i - 36) * 12)));
  p16(0x605fc340, Array.from({ length: 64 }, (_, i) => 1024 - i * 16));
  p16(0x605fc45e, [928, 952, 976, 1000, 1024]);
  return img;
}
export function fakeBin(main) {
  const head = new Uint8Array(32), tail = new Uint8Array(32), dv = new DataView(head.buffer);
  head[0] = 0x4f; head[1] = 0x45; head[2] = 0x01; head[3] = 0x22;
  dv.setUint32(8, 0x403a0020, true); dv.setUint32(12, main.length, true); dv.setUint16(16, 0x3101, true); dv.setUint16(20, 0x0100, true);
  const sum = (u) => { let s = 0; const d = new DataView(u.buffer, u.byteOffset, u.length); for (let i = 0; i + 4 <= u.length; i += 4) s = (s + d.getUint32(i, true)) >>> 0; return s; };
  dv.setUint32(28, (0 - sum(head) - sum(main) - sum(tail)) >>> 0, true);
  const enc = new Uint8Array(main.length);
  for (let g = 0; g + 16 <= main.length; g += 16) for (let k = 0; k < 16; k++) enc[g + PERM[k]] = main[g + k] ^ 0xff;
  const out = new Uint8Array(64 + main.length);
  out.set(head, 0); out.set(enc, 32); out.set(tail, 32 + main.length);
  return out;
}
