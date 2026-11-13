// AMaZE demosaic (Aliasing Minimization and Zipper Elimination)
// JavaScript port of RawTherapee's amaze_demosaic_RT.cc, scalar (non-SIMD) branch.
//
// Copyright (c) 2008-2010 Emil Martinec <ejmartin@uchicago.edu>, optimized for speed by Ingo Weyrich,
// incorporating ideas of Luis Sanz Rodrigues and Paul Lee.
//
// This file is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
// License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any
// later version. It is distributed WITHOUT ANY WARRANTY; see <https://www.gnu.org/licenses/>.
//
// The working buffers keep the original's shared memory layout, because the original reads a few locations that an
// earlier use of the same memory wrote. Input and output are scaled 0..1 rather than 0..65535.

const ts = 160, tsh = 80, v1 = ts, v2 = 2 * ts, v3 = 3 * ts, p1 = -ts + 1, p2 = -2 * ts + 2, p3 = -3 * ts + 3, m1 = ts + 1, m2 = 2 * ts + 2, m3 = 3 * ts + 3;
const fr = Math.fround, eps = fr(1e-5), epssq = fr(1e-10), arthresh = 0.75, nyqthresh = 0.5;
const gaussodd = [0.14659727707323927, 0.103592713382435, 0.0732036125103057, 0.0365543548389495].map(fr);
const gaussgrad = [0.07384411893421103, 0.06207511968171489, 0.0521818194747806, 0.03687419286733595, 0.03099732204057846, 0.018413194161458882].map((x) => Math.fround(nyqthresh * x));
const gausseven = [0.13719494435797422, 0.05640252782101291].map(fr);
const gquinc = [0.169917, 0.108947, 0.069855, 0.0287182].map(fr);
const SQR = (x) => x * x;
const fabs = Math.abs;
const median = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));

export function demosaicAMaZE(m, width, height, idx, red, green, blue, clip_pt = 1) {
  const clip_pt8 = 0.8 * clip_pt;
  const fc = (r, c) => idx[((r & 1) << 1) | (c & 1)];
  const raw = (row, col) => m[row * width + col];
  let ex, ey;
  if (fc(0, 0) === 1) { if (fc(0, 1) === 0) { ey = 0; ex = 1; } else { ey = 1; ex = 0; } }
  else if (fc(0, 0) === 0) { ey = 0; ex = 0; } else { ey = 1; ex = 1; }

  const CL = 128, FULL = 4 * ts * ts + CL, HALF = 4 * ts * tsh + CL;
  const buffer = new ArrayBuffer(14 * 4 * ts * ts + ts * tsh + 18 * CL + 64);
  const F = (off) => new Float32Array(buffer, off);
  let o = 0;
  const oGreen = o; o += FULL; const oDelhv = o; o += FULL; const oW0 = o; o += FULL; const oW1 = o; o += FULL;
  const oVcd = o; o += FULL; const oHcd = o; o += FULL; const oVcdalt = o; o += FULL; const oHcdalt = o; o += FULL;
  const oCddiff = o; o += FULL + CL; const oHvwt = o; o += HALF;
  const oDgrb2 = o; o += FULL; const oDginth = o; o += FULL; const oSq1m = o; o += HALF; const oSq1p = o; o += HALF;
  const oCfa = o; o += FULL; const oNyq = o; o += ts * tsh + CL; const oNyqtest = o;
  const rgbgreen = F(oGreen), delhvsqsum = F(oDelhv), dirwts0 = F(oW0), dirwts1 = F(oW1), vcd = F(oVcd), hcd = F(oHcd);
  const vcdalt = F(oVcdalt), hcdalt = F(oHcdalt), cddiffsq = F(oCddiff), hvwt = F(oHvwt), Dgrb = F(oVcdalt);
  const delp = F(oCddiff), delm = F(oCddiff + HALF), rbint = F(oCddiff + HALF), Dgrb2 = F(oDgrb2), dgintv = F(oDgrb2), dginth = F(oDginth);
  const Dgrbsq1m = F(oSq1m), Dgrbsq1p = F(oSq1p), cfa = F(oCfa), pmwt = F(oDelhv), rbm = F(oVcd), rbp = F(oVcd + HALF);
  const nyquist = new Uint8Array(buffer, oNyq), nyquist2 = new Uint8Array(buffer, oCddiff), nyqutest = F(oNyqtest);
  const D1 = ts * tsh;   // Dgrb[1] starts here

  for (let top = -16; top < height; top += ts - 32) {
    for (let left = -16; left < width; left += ts - 32) {
      nyquist.fill(0, 3 * tsh, 3 * tsh + (ts - 6) * tsh);
      const bottom = Math.min(top + ts, height + 16), right = Math.min(left + ts, width + 16);
      const rr1 = bottom - top, cc1 = right - left;
      const rrmin = top < 0 ? 16 : 0, ccmin = left < 0 ? 16 : 0;
      const rrmax = bottom > height ? height - top : rr1, ccmax = right > width ? width - left : cc1;

      const set = (i, v) => { cfa[i] = v; rgbgreen[i] = cfa[i]; };
      if (rrmin > 0) for (let rr = 0; rr < 16; rr++) for (let cc = ccmin, row = 32 - rr + top; cc < ccmax; cc++) set(rr * ts + cc, raw(row, cc + left));
      for (let rr = rrmin; rr < rrmax; rr++) { const row = rr + top; for (let cc = ccmin; cc < ccmax; cc++) set(rr * ts + cc, raw(row, cc + left)); }
      if (rrmax < rr1) for (let rr = 0; rr < 16; rr++) for (let cc = ccmin; cc < ccmax; cc++) set((rrmax + rr) * ts + cc, raw(height - rr - 2, left + cc));
      if (ccmin > 0) for (let rr = rrmin; rr < rrmax; rr++) for (let cc = 0, row = rr + top; cc < 16; cc++) set(rr * ts + cc, raw(row, 32 - cc + left));
      if (ccmax < cc1) for (let rr = rrmin; rr < rrmax; rr++) for (let cc = 0; cc < 16; cc++) set(rr * ts + ccmax + cc, raw(top + rr, width - cc - 2));
      if (rrmin > 0 && ccmin > 0) for (let rr = 0; rr < 16; rr++) for (let cc = 0; cc < 16; cc++) set(rr * ts + cc, raw(32 - rr, 32 - cc));
      if (rrmax < rr1 && ccmax < cc1) for (let rr = 0; rr < 16; rr++) for (let cc = 0; cc < 16; cc++) set((rrmax + rr) * ts + ccmax + cc, raw(height - rr - 2, width - cc - 2));
      if (rrmin > 0 && ccmax < cc1) for (let rr = 0; rr < 16; rr++) for (let cc = 0; cc < 16; cc++) set(rr * ts + ccmax + cc, raw(32 - rr, width - cc - 2));
      if (rrmax < rr1 && ccmin > 0) for (let rr = 0; rr < 16; rr++) for (let cc = 0; cc < 16; cc++) set((rrmax + rr) * ts + cc, raw(height - rr - 2, 32 - cc));

      for (let rr = 2; rr < rr1 - 2; rr++) for (let cc = 2, indx = rr * ts + cc; cc < cc1 - 2; cc++, indx++) {
        const delh = fabs(cfa[indx + 1] - cfa[indx - 1]), delv = fabs(cfa[indx + v1] - cfa[indx - v1]);
        dirwts0[indx] = eps + fabs(cfa[indx + v2] - cfa[indx]) + fabs(cfa[indx] - cfa[indx - v2]) + delv;
        dirwts1[indx] = eps + fabs(cfa[indx + 2] - cfa[indx]) + fabs(cfa[indx] - cfa[indx - 2]) + delh;
        delhvsqsum[indx] = SQR(delh) + SQR(delv);
      }

      for (let rr = 4; rr < rr1 - 4; rr++) {
        let fcswitch = (fc(rr, 4) & 1) !== 0;
        for (let cc = 4, indx = rr * ts + cc; cc < cc1 - 4; cc++, indx++) {
          const c0 = cfa[indx];
          const cru = cfa[indx - v1] * (dirwts0[indx - v2] + dirwts0[indx]) / (dirwts0[indx - v2] * (eps + c0) + dirwts0[indx] * (eps + cfa[indx - v2]));
          const crd = cfa[indx + v1] * (dirwts0[indx + v2] + dirwts0[indx]) / (dirwts0[indx + v2] * (eps + c0) + dirwts0[indx] * (eps + cfa[indx + v2]));
          const crl = cfa[indx - 1] * (dirwts1[indx - 2] + dirwts1[indx]) / (dirwts1[indx - 2] * (eps + c0) + dirwts1[indx] * (eps + cfa[indx - 2]));
          const crr = cfa[indx + 1] * (dirwts1[indx + 2] + dirwts1[indx]) / (dirwts1[indx + 2] * (eps + c0) + dirwts1[indx] * (eps + cfa[indx + 2]));
          const guha = cfa[indx - v1] + 0.5 * (c0 - cfa[indx - v2]), gdha = cfa[indx + v1] + 0.5 * (c0 - cfa[indx + v2]);
          const glha = cfa[indx - 1] + 0.5 * (c0 - cfa[indx - 2]), grha = cfa[indx + 1] + 0.5 * (c0 - cfa[indx + 2]);
          let guar = fabs(1 - cru) < arthresh ? c0 * cru : guha, gdar = fabs(1 - crd) < arthresh ? c0 * crd : gdha;
          let glar = fabs(1 - crl) < arthresh ? c0 * crl : glha, grar = fabs(1 - crr) < arthresh ? c0 * crr : grha;
          const hwt = dirwts1[indx - 1] / (dirwts1[indx - 1] + dirwts1[indx + 1]), vwt = dirwts0[indx - v1] / (dirwts0[indx + v1] + dirwts0[indx - v1]);
          const Gintvha = vwt * gdha + (1 - vwt) * guha, Ginthha = hwt * grha + (1 - hwt) * glha;
          if (fcswitch) {
            vcd[indx] = c0 - (vwt * gdar + (1 - vwt) * guar); hcd[indx] = c0 - (hwt * grar + (1 - hwt) * glar);
            vcdalt[indx] = c0 - Gintvha; hcdalt[indx] = c0 - Ginthha;
          } else {
            vcd[indx] = (vwt * gdar + (1 - vwt) * guar) - c0; hcd[indx] = (hwt * grar + (1 - hwt) * glar) - c0;
            vcdalt[indx] = Gintvha - c0; hcdalt[indx] = Ginthha - c0;
          }
          fcswitch = !fcswitch;
          if (c0 > clip_pt8 || Gintvha > clip_pt8 || Ginthha > clip_pt8) {
            guar = guha; gdar = gdha; glar = glha; grar = grha;
            vcd[indx] = vcdalt[indx]; hcd[indx] = hcdalt[indx];
          }
          dgintv[indx] = Math.min(SQR(guha - gdha), SQR(guar - gdar));
          dginth[indx] = Math.min(SQR(glha - grha), SQR(glar - grar));
        }
      }

      for (let rr = 4; rr < rr1 - 4; rr++) {
        let c = fc(rr, 4) & 1;
        for (let cc = 4, indx = rr * ts + cc; cc < cc1 - 4; cc++, indx++) {
          const hcdvar = 3 * (SQR(hcd[indx - 2]) + SQR(hcd[indx]) + SQR(hcd[indx + 2])) - SQR(hcd[indx - 2] + hcd[indx] + hcd[indx + 2]);
          const hcdaltvar = 3 * (SQR(hcdalt[indx - 2]) + SQR(hcdalt[indx]) + SQR(hcdalt[indx + 2])) - SQR(hcdalt[indx - 2] + hcdalt[indx] + hcdalt[indx + 2]);
          const vcdvar = 3 * (SQR(vcd[indx - v2]) + SQR(vcd[indx]) + SQR(vcd[indx + v2])) - SQR(vcd[indx - v2] + vcd[indx] + vcd[indx + v2]);
          const vcdaltvar = 3 * (SQR(vcdalt[indx - v2]) + SQR(vcdalt[indx]) + SQR(vcdalt[indx + v2])) - SQR(vcdalt[indx - v2] + vcdalt[indx] + vcdalt[indx + v2]);
          if (hcdaltvar < hcdvar) hcd[indx] = hcdalt[indx];
          if (vcdaltvar < vcdvar) vcd[indx] = vcdalt[indx];
          const c0 = cfa[indx];
          if (c) {
            const Ginth = -hcd[indx] + c0, Gintv = -vcd[indx] + c0;
            if (hcd[indx] > 0) {
              if (3 * hcd[indx] > (Ginth + c0)) hcd[indx] = -median(Ginth, cfa[indx - 1], cfa[indx + 1]) + c0;
              else { const hwt = 1 - 3 * hcd[indx] / (eps + Ginth + c0); hcd[indx] = hwt * hcd[indx] + (1 - hwt) * (-median(Ginth, cfa[indx - 1], cfa[indx + 1]) + c0); }
            }
            if (vcd[indx] > 0) {
              if (3 * vcd[indx] > (Gintv + c0)) vcd[indx] = -median(Gintv, cfa[indx - v1], cfa[indx + v1]) + c0;
              else { const vwt = 1 - 3 * vcd[indx] / (eps + Gintv + c0); vcd[indx] = vwt * vcd[indx] + (1 - vwt) * (-median(Gintv, cfa[indx - v1], cfa[indx + v1]) + c0); }
            }
            if (Ginth > clip_pt) hcd[indx] = -median(Ginth, cfa[indx - 1], cfa[indx + 1]) + c0;
            if (Gintv > clip_pt) vcd[indx] = -median(Gintv, cfa[indx - v1], cfa[indx + v1]) + c0;
          } else {
            const Ginth = hcd[indx] + c0, Gintv = vcd[indx] + c0;
            if (hcd[indx] < 0) {
              if (3 * hcd[indx] < -(Ginth + c0)) hcd[indx] = median(Ginth, cfa[indx - 1], cfa[indx + 1]) - c0;
              else { const hwt = 1 + 3 * hcd[indx] / (eps + Ginth + c0); hcd[indx] = hwt * hcd[indx] + (1 - hwt) * (median(Ginth, cfa[indx - 1], cfa[indx + 1]) - c0); }
            }
            if (vcd[indx] < 0) {
              if (3 * vcd[indx] < -(Gintv + c0)) vcd[indx] = median(Gintv, cfa[indx - v1], cfa[indx + v1]) - c0;
              else { const vwt = 1 + 3 * vcd[indx] / (eps + Gintv + c0); vcd[indx] = vwt * vcd[indx] + (1 - vwt) * (median(Gintv, cfa[indx - v1], cfa[indx + v1]) - c0); }
            }
            if (Ginth > clip_pt) hcd[indx] = median(Ginth, cfa[indx - 1], cfa[indx + 1]) - c0;
            if (Gintv > clip_pt) vcd[indx] = median(Gintv, cfa[indx - v1], cfa[indx + v1]) - c0;
            cddiffsq[indx] = SQR(vcd[indx] - hcd[indx]);
          }
          c = c ? 0 : 1;
        }
      }

      for (let rr = 6; rr < rr1 - 6; rr++) for (let cc = 6 + (fc(rr, 2) & 1), indx = rr * ts + cc; cc < cc1 - 6; cc += 2, indx += 2) {
        const uave = vcd[indx] + vcd[indx - v1] + vcd[indx - v2] + vcd[indx - v3], dave = vcd[indx] + vcd[indx + v1] + vcd[indx + v2] + vcd[indx + v3];
        const lave = hcd[indx] + hcd[indx - 1] + hcd[indx - 2] + hcd[indx - 3], rave = hcd[indx] + hcd[indx + 1] + hcd[indx + 2] + hcd[indx + 3];
        let Dgrbvvaru = SQR(vcd[indx] - uave) + SQR(vcd[indx - v1] - uave) + SQR(vcd[indx - v2] - uave) + SQR(vcd[indx - v3] - uave);
        let Dgrbvvard = SQR(vcd[indx] - dave) + SQR(vcd[indx + v1] - dave) + SQR(vcd[indx + v2] - dave) + SQR(vcd[indx + v3] - dave);
        let Dgrbhvarl = SQR(hcd[indx] - lave) + SQR(hcd[indx - 1] - lave) + SQR(hcd[indx - 2] - lave) + SQR(hcd[indx - 3] - lave);
        let Dgrbhvarr = SQR(hcd[indx] - rave) + SQR(hcd[indx + 1] - rave) + SQR(hcd[indx + 2] - rave) + SQR(hcd[indx + 3] - rave);
        const hwt = dirwts1[indx - 1] / (dirwts1[indx - 1] + dirwts1[indx + 1]), vwt = dirwts0[indx - v1] / (dirwts0[indx + v1] + dirwts0[indx - v1]);
        const vcdvar = epssq + vwt * Dgrbvvard + (1 - vwt) * Dgrbvvaru, hcdvar = epssq + hwt * Dgrbhvarr + (1 - hwt) * Dgrbhvarl;
        Dgrbvvaru = dgintv[indx] + dgintv[indx - v1] + dgintv[indx - v2]; Dgrbvvard = dgintv[indx] + dgintv[indx + v1] + dgintv[indx + v2];
        Dgrbhvarl = dginth[indx] + dginth[indx - 1] + dginth[indx - 2]; Dgrbhvarr = dginth[indx] + dginth[indx + 1] + dginth[indx + 2];
        const vcdvar1 = epssq + vwt * Dgrbvvard + (1 - vwt) * Dgrbvvaru, hcdvar1 = epssq + hwt * Dgrbhvarr + (1 - hwt) * Dgrbhvarl;
        const varwt = hcdvar / (vcdvar + hcdvar), diffwt = hcdvar1 / (vcdvar1 + hcdvar1);
        hvwt[indx >> 1] = ((0.5 - varwt) * (0.5 - diffwt) > 0 && fabs(0.5 - diffwt) < fabs(0.5 - varwt)) ? varwt : diffwt;
      }

      for (let rr = 6; rr < rr1 - 6; rr++) for (let cc = 6 + (fc(rr, 2) & 1), indx = rr * ts + cc; cc < cc1 - 6; cc += 2, indx += 2) {
        const d = cddiffsq, s = delhvsqsum;
        nyqutest[indx >> 1] = (gaussodd[0] * d[indx] + gaussodd[1] * (d[indx - m1] + d[indx + p1] + d[indx - p1] + d[indx + m1]) +
          gaussodd[2] * (d[indx - v2] + d[indx - 2] + d[indx + 2] + d[indx + v2]) + gaussodd[3] * (d[indx - m2] + d[indx + p2] + d[indx - p2] + d[indx + m2])) -
          (gaussgrad[0] * s[indx] + gaussgrad[1] * (s[indx - v1] + s[indx + 1] + s[indx - 1] + s[indx + v1]) +
           gaussgrad[2] * (s[indx - m1] + s[indx + p1] + s[indx - p1] + s[indx + m1]) + gaussgrad[3] * (s[indx - v2] + s[indx - 2] + s[indx + 2] + s[indx + v2]) +
           gaussgrad[4] * (s[indx - v2 - 1] + s[indx - v2 + 1] + s[indx - ts - 2] + s[indx - ts + 2] + s[indx + ts - 2] + s[indx + ts + 2] + s[indx + v2 - 1] + s[indx + v2 + 1]) +
           gaussgrad[5] * (s[indx - m2] + s[indx + p2] + s[indx - p2] + s[indx + m2]));
      }

      let nystartrow = 0, nyendrow = 0, nystartcol = ts + 1, nyendcol = 0;
      for (let rr = 6; rr < rr1 - 6; rr++) for (let cc = 6 + (fc(rr, 2) & 1), indx = rr * ts + cc; cc < cc1 - 6; cc += 2, indx += 2) {
        if (nyqutest[indx >> 1] > 0) {
          nyquist[indx >> 1] = 1;
          nystartrow = nystartrow ? nystartrow : rr; nyendrow = rr;
          nystartcol = nystartcol > cc ? cc : nystartcol; nyendcol = nyendcol < cc ? cc : nyendcol;
        }
      }
      const doNyquist = nystartrow !== nyendrow && nystartcol !== nyendcol;
      if (doNyquist) {
        nyendrow++; nyendcol++;
        nystartcol -= nystartcol & 1;
        nystartrow = Math.max(8, nystartrow); nyendrow = Math.min(rr1 - 8, nyendrow);
        nystartcol = Math.max(8, nystartcol); nyendcol = Math.min(cc1 - 8, nyendcol);
        nyquist2.fill(0, 4 * tsh, 4 * tsh + (ts - 8) * tsh);
        for (let rr = nystartrow; rr < nyendrow; rr++) for (let indx = rr * ts + nystartcol + (fc(rr, 2) & 1); indx < rr * ts + nyendcol; indx += 2) {
          const t = nyquist[(indx - v2) >> 1] + nyquist[(indx - m1) >> 1] + nyquist[(indx + p1) >> 1] + nyquist[(indx - 2) >> 1] + nyquist[(indx + 2) >> 1] + nyquist[(indx - p1) >> 1] + nyquist[(indx + m1) >> 1] + nyquist[(indx + v2) >> 1];
          nyquist2[indx >> 1] = t > 4 ? 1 : t < 4 ? 0 : nyquist[indx >> 1];
        }
        for (let rr = nystartrow; rr < nyendrow; rr++) for (let indx = rr * ts + nystartcol + (fc(rr, 2) & 1); indx < rr * ts + nyendcol; indx += 2) {
          if (nyquist2[indx >> 1]) {
            let sumcfa = 0, sumh = 0, sumv = 0, sumsqh = 0, sumsqv = 0, areawt = 0;
            for (let i = -6; i < 7; i += 2) {
              let indx1 = indx + i * ts - 6;
              for (let j = -6; j < 7; j += 2, indx1 += 2) {
                if (nyquist2[indx1 >> 1]) {
                  const t = cfa[indx1];
                  sumcfa += t; sumh += cfa[indx1 - 1] + cfa[indx1 + 1]; sumv += cfa[indx1 - v1] + cfa[indx1 + v1];
                  sumsqh += SQR(t - cfa[indx1 - 1]) + SQR(t - cfa[indx1 + 1]); sumsqv += SQR(t - cfa[indx1 - v1]) + SQR(t - cfa[indx1 + v1]);
                  areawt += 1;
                }
              }
            }
            sumh = sumcfa - 0.5 * sumh; sumv = sumcfa - 0.5 * sumv; areawt *= 0.5;
            const hcdvar = epssq + fabs(areawt * sumsqh - sumh * sumh), vcdvar = epssq + fabs(areawt * sumsqv - sumv * sumv);
            hvwt[indx >> 1] = hcdvar / (vcdvar + hcdvar);
          }
        }
      }

      for (let rr = 8; rr < rr1 - 8; rr++) for (let indx = rr * ts + 8 + (fc(rr, 2) & 1); indx < rr * ts + cc1 - 8; indx += 2) {
        const i = indx >> 1;
        const alt = 0.25 * (hvwt[(indx - m1) >> 1] + hvwt[(indx + p1) >> 1] + hvwt[(indx - p1) >> 1] + hvwt[(indx + m1) >> 1]);
        hvwt[i] = fabs(0.5 - hvwt[i]) < fabs(0.5 - alt) ? alt : hvwt[i];
        Dgrb[i] = hvwt[i] * vcd[indx] + (1 - hvwt[i]) * hcd[indx];
        rgbgreen[indx] = cfa[indx] + Dgrb[i];
        Dgrb2[2 * i] = nyquist2[i] ? SQR(rgbgreen[indx] - 0.5 * (rgbgreen[indx - 1] + rgbgreen[indx + 1])) : 0;
        Dgrb2[2 * i + 1] = nyquist2[i] ? SQR(rgbgreen[indx] - 0.5 * (rgbgreen[indx - v1] + rgbgreen[indx + v1])) : 0;
      }

      if (doNyquist) for (let rr = nystartrow; rr < nyendrow; rr++) for (let indx = rr * ts + nystartcol + (fc(rr, 2) & 1); indx < rr * ts + nyendcol; indx += 2) {
        if (nyquist2[indx >> 1]) {
          const g = (k) => epssq + (gquinc[0] * Dgrb2[2 * (indx >> 1) + k] +
            gquinc[1] * (Dgrb2[2 * ((indx - m1) >> 1) + k] + Dgrb2[2 * ((indx + p1) >> 1) + k] + Dgrb2[2 * ((indx - p1) >> 1) + k] + Dgrb2[2 * ((indx + m1) >> 1) + k]) +
            gquinc[2] * (Dgrb2[2 * ((indx - v2) >> 1) + k] + Dgrb2[2 * ((indx - 2) >> 1) + k] + Dgrb2[2 * ((indx + 2) >> 1) + k] + Dgrb2[2 * ((indx + v2) >> 1) + k]) +
            gquinc[3] * (Dgrb2[2 * ((indx - m2) >> 1) + k] + Dgrb2[2 * ((indx + p2) >> 1) + k] + Dgrb2[2 * ((indx - p2) >> 1) + k] + Dgrb2[2 * ((indx + m2) >> 1) + k]));
          const gvarh = g(0), gvarv = g(1);
          Dgrb[indx >> 1] = (hcd[indx] * gvarv + vcd[indx] * gvarh) / (gvarv + gvarh);
          rgbgreen[indx] = cfa[indx] + Dgrb[indx >> 1];
        }
      }

      for (let rr = 6; rr < rr1 - 6; rr++) {
        if ((fc(rr, 2) & 1) === 0) for (let cc = 6, indx = rr * ts + cc; cc < cc1 - 6; cc += 2, indx += 2) {
          delp[indx >> 1] = fabs(cfa[indx + p1] - cfa[indx - p1]); delm[indx >> 1] = fabs(cfa[indx + m1] - cfa[indx - m1]);
          Dgrbsq1p[indx >> 1] = SQR(cfa[indx + 1] - cfa[indx + 1 - p1]) + SQR(cfa[indx + 1] - cfa[indx + 1 + p1]);
          Dgrbsq1m[indx >> 1] = SQR(cfa[indx + 1] - cfa[indx + 1 - m1]) + SQR(cfa[indx + 1] - cfa[indx + 1 + m1]);
        } else for (let cc = 6, indx = rr * ts + cc; cc < cc1 - 6; cc += 2, indx += 2) {
          Dgrbsq1p[indx >> 1] = SQR(cfa[indx] - cfa[indx - p1]) + SQR(cfa[indx] - cfa[indx + p1]);
          Dgrbsq1m[indx >> 1] = SQR(cfa[indx] - cfa[indx - m1]) + SQR(cfa[indx] - cfa[indx + m1]);
          delp[indx >> 1] = fabs(cfa[indx + 1 + p1] - cfa[indx + 1 - p1]); delm[indx >> 1] = fabs(cfa[indx + 1 + m1] - cfa[indx + 1 - m1]);
        }
      }

      const qv = (arr, indx) => gausseven[0] * (arr[(indx - v1) >> 1] + arr[(indx - 1) >> 1] + arr[(indx + 1) >> 1] + arr[(indx + v1) >> 1]) +
        gausseven[1] * (arr[(indx - v2 - 1) >> 1] + arr[(indx - v2 + 1) >> 1] + arr[(indx - 2 - v1) >> 1] + arr[(indx + 2 - v1) >> 1] + arr[(indx - 2 + v1) >> 1] + arr[(indx + 2 + v1) >> 1] + arr[(indx + v2 - 1) >> 1] + arr[(indx + v2 + 1) >> 1]);
      for (let rr = 8; rr < rr1 - 8; rr++) for (let cc = 8 + (fc(rr, 2) & 1), indx = rr * ts + cc, indx1 = indx >> 1; cc < cc1 - 8; cc += 2, indx += 2, indx1++) {
        const c0 = cfa[indx];
        const crse = 2 * cfa[indx + m1] / (eps + c0 + cfa[indx + m2]), crnw = 2 * cfa[indx - m1] / (eps + c0 + cfa[indx - m2]);
        const crne = 2 * cfa[indx + p1] / (eps + c0 + cfa[indx + p2]), crsw = 2 * cfa[indx - p1] / (eps + c0 + cfa[indx - p2]);
        const rbse = fabs(1 - crse) < arthresh ? c0 * crse : cfa[indx + m1] + 0.5 * (c0 - cfa[indx + m2]);
        const rbnw = fabs(1 - crnw) < arthresh ? c0 * crnw : cfa[indx - m1] + 0.5 * (c0 - cfa[indx - m2]);
        const rbne = fabs(1 - crne) < arthresh ? c0 * crne : cfa[indx + p1] + 0.5 * (c0 - cfa[indx + p2]);
        const rbsw = fabs(1 - crsw) < arthresh ? c0 * crsw : cfa[indx - p1] + 0.5 * (c0 - cfa[indx - p2]);
        const wtse = eps + delm[indx1] + delm[(indx + m1) >> 1] + delm[(indx + m2) >> 1], wtnw = eps + delm[indx1] + delm[(indx - m1) >> 1] + delm[(indx - m2) >> 1];
        const wtne = eps + delp[indx1] + delp[(indx + p1) >> 1] + delp[(indx + p2) >> 1], wtsw = eps + delp[indx1] + delp[(indx - p1) >> 1] + delp[(indx - p2) >> 1];
        rbm[indx1] = (wtse * rbnw + wtnw * rbse) / (wtse + wtnw);
        rbp[indx1] = (wtne * rbsw + wtsw * rbne) / (wtne + wtsw);
        const rbvarm = epssq + qv(Dgrbsq1m, indx);
        pmwt[indx1] = rbvarm / ((epssq + qv(Dgrbsq1p, indx)) + rbvarm);
        if (rbp[indx1] < c0) {
          if (2 * rbp[indx1] < c0) rbp[indx1] = median(rbp[indx1], cfa[indx - p1], cfa[indx + p1]);
          else { const pwt = 2 * (c0 - rbp[indx1]) / (eps + rbp[indx1] + c0); rbp[indx1] = pwt * rbp[indx1] + (1 - pwt) * median(rbp[indx1], cfa[indx - p1], cfa[indx + p1]); }
        }
        if (rbm[indx1] < c0) {
          if (2 * rbm[indx1] < c0) rbm[indx1] = median(rbm[indx1], cfa[indx - m1], cfa[indx + m1]);
          else { const mwt = 2 * (c0 - rbm[indx1]) / (eps + rbm[indx1] + c0); rbm[indx1] = mwt * rbm[indx1] + (1 - mwt) * median(rbm[indx1], cfa[indx - m1], cfa[indx + m1]); }
        }
        if (rbp[indx1] > clip_pt) rbp[indx1] = median(rbp[indx1], cfa[indx - p1], cfa[indx + p1]);
        if (rbm[indx1] > clip_pt) rbm[indx1] = median(rbm[indx1], cfa[indx - m1], cfa[indx + m1]);
      }

      for (let rr = 10; rr < rr1 - 10; rr++) for (let cc = 10 + (fc(rr, 2) & 1), indx = rr * ts + cc, indx1 = indx >> 1; cc < cc1 - 10; cc += 2, indx += 2, indx1++) {
        const alt = 0.25 * (pmwt[(indx - m1) >> 1] + pmwt[(indx + p1) >> 1] + pmwt[(indx - p1) >> 1] + pmwt[(indx + m1) >> 1]);
        if (fabs(0.5 - pmwt[indx1]) < fabs(0.5 - alt)) pmwt[indx1] = alt;
        rbint[indx1] = 0.5 * (cfa[indx] + rbm[indx1] * (1 - pmwt[indx1]) + rbp[indx1] * pmwt[indx1]);
      }

      for (let rr = 12; rr < rr1 - 12; rr++) for (let cc = 12 + (fc(rr, 2) & 1), indx = rr * ts + cc, indx1 = indx >> 1; cc < cc1 - 12; cc += 2, indx += 2, indx1++) {
        if (fabs(0.5 - pmwt[indx >> 1]) < fabs(0.5 - hvwt[indx >> 1])) continue;
        const rb = rbint[indx1];
        const cru = cfa[indx - v1] * 2 / (eps + rb + rbint[indx1 - v1]), crd = cfa[indx + v1] * 2 / (eps + rb + rbint[indx1 + v1]);
        const crl = cfa[indx - 1] * 2 / (eps + rb + rbint[indx1 - 1]), crr = cfa[indx + 1] * 2 / (eps + rb + rbint[indx1 + 1]);
        const gu = fabs(1 - cru) < arthresh ? rb * cru : cfa[indx - v1] + 0.5 * (rb - rbint[indx1 - v1]);
        const gd = fabs(1 - crd) < arthresh ? rb * crd : cfa[indx + v1] + 0.5 * (rb - rbint[indx1 + v1]);
        const gl = fabs(1 - crl) < arthresh ? rb * crl : cfa[indx - 1] + 0.5 * (rb - rbint[indx1 - 1]);
        const gr = fabs(1 - crr) < arthresh ? rb * crr : cfa[indx + 1] + 0.5 * (rb - rbint[indx1 + 1]);
        let Gintv = (dirwts0[indx - v1] * gd + dirwts0[indx + v1] * gu) / (dirwts0[indx + v1] + dirwts0[indx - v1]);
        let Ginth = (dirwts1[indx - 1] * gr + dirwts1[indx + 1] * gl) / (dirwts1[indx - 1] + dirwts1[indx + 1]);
        if (Gintv < rb) {
          if (2 * Gintv < rb) Gintv = median(Gintv, cfa[indx - v1], cfa[indx + v1]);
          else { const vwt = 2 * (rb - Gintv) / (eps + Gintv + rb); Gintv = vwt * Gintv + (1 - vwt) * median(Gintv, cfa[indx - v1], cfa[indx + v1]); }
        }
        if (Ginth < rb) {
          if (2 * Ginth < rb) Ginth = median(Ginth, cfa[indx - 1], cfa[indx + 1]);
          else { const hwt = 2 * (rb - Ginth) / (eps + Ginth + rb); Ginth = hwt * Ginth + (1 - hwt) * median(Ginth, cfa[indx - 1], cfa[indx + 1]); }
        }
        if (Ginth > clip_pt) Ginth = median(Ginth, cfa[indx - 1], cfa[indx + 1]);
        if (Gintv > clip_pt) Gintv = median(Gintv, cfa[indx - v1], cfa[indx + v1]);
        rgbgreen[indx] = Ginth * (1 - hvwt[indx1]) + Gintv * hvwt[indx1];
        Dgrb[indx >> 1] = rgbgreen[indx] - cfa[indx];
      }

      for (let rr = 13 - ey; rr < rr1 - 12; rr += 2) for (let indx1 = (rr * ts + 13 - ex) >> 1; indx1 < (rr * ts + cc1 - 12) >> 1; indx1++) {
        Dgrb[D1 + indx1] = Dgrb[indx1];
        Dgrb[indx1] = 0;
      }

      for (let rr = 14; rr < rr1 - 14; rr++) for (let cc = 14 + (fc(rr, 2) & 1), indx = rr * ts + cc, c = 1 - Math.floor(fc(rr, cc) / 2); cc < cc1 - 14; cc += 2, indx += 2) {
        const b = c * D1, d = (k) => Dgrb[b + (k >> 1)];
        const wtnw = 1 / (eps + fabs(d(indx - m1) - d(indx + m1)) + fabs(d(indx - m1) - d(indx - m3)) + fabs(d(indx + m1) - d(indx - m3)));
        const wtne = 1 / (eps + fabs(d(indx + p1) - d(indx - p1)) + fabs(d(indx + p1) - d(indx + p3)) + fabs(d(indx - p1) - d(indx + p3)));
        const wtsw = 1 / (eps + fabs(d(indx - p1) - d(indx + p1)) + fabs(d(indx - p1) - d(indx + m3)) + fabs(d(indx + p1) - d(indx - p3)));
        const wtse = 1 / (eps + fabs(d(indx + m1) - d(indx - m1)) + fabs(d(indx + m1) - d(indx - p3)) + fabs(d(indx - m1) - d(indx + m3)));
        Dgrb[b + (indx >> 1)] = (wtnw * (1.325 * d(indx - m1) - 0.175 * d(indx - m3) - 0.075 * d(indx - m1 - 2) - 0.075 * d(indx - m1 - v2)) +
          wtne * (1.325 * d(indx + p1) - 0.175 * d(indx + p3) - 0.075 * d(indx + p1 + 2) - 0.075 * d(indx + p1 + v2)) +
          wtsw * (1.325 * d(indx - p1) - 0.175 * d(indx - p3) - 0.075 * d(indx - p1 - 2) - 0.075 * d(indx - p1 - v2)) +
          wtse * (1.325 * d(indx + m1) - 0.175 * d(indx + m3) - 0.075 * d(indx + m1 + 2) - 0.075 * d(indx + m1 + v2))) / (wtnw + wtne + wtsw + wtse);
      }

      const nearby = (out, base, indx, col, row) => {
        const temp = 1 / (hvwt[(indx - v1) >> 1] + 2 - hvwt[(indx + 1) >> 1] - hvwt[(indx - 1) >> 1] + hvwt[(indx + v1) >> 1]);
        out[row * width + col] = Math.max(0, rgbgreen[indx] - (hvwt[(indx - v1) >> 1] * Dgrb[base + ((indx - v1) >> 1)] + (1 - hvwt[(indx + 1) >> 1]) * Dgrb[base + ((indx + 1) >> 1)] + (1 - hvwt[(indx - 1) >> 1]) * Dgrb[base + ((indx - 1) >> 1)] + hvwt[(indx + v1) >> 1] * Dgrb[base + ((indx + v1) >> 1)]) * temp);
      };
      const direct = (out, base, indx, col, row) => { out[row * width + col] = Math.max(0, rgbgreen[indx] - Dgrb[base + (indx >> 1)]); };
      for (let rr = 16; rr < rr1 - 16; rr++) {
        const row = rr + top;
        let col = left + 16, indx = rr * ts + 16;
        const first = (fc(rr, 2) & 1) === 1 ? nearby : direct, second = first === nearby ? direct : nearby;
        for (; indx < rr * ts + cc1 - 16 - (cc1 & 1); indx++, col++) {
          first(red, 0, indx, col, row); first(blue, D1, indx, col, row);
          indx++; col++;
          second(red, 0, indx, col, row); second(blue, D1, indx, col, row);
        }
        if (cc1 & 1) { first(red, 0, indx, col, row); first(blue, D1, indx, col, row); }
      }
      for (let rr = 16; rr < rr1 - 16; rr++) { const row = rr + top; for (let cc = 16; cc < cc1 - 16; cc++) green[row * width + cc + left] = Math.max(0, rgbgreen[rr * ts + cc]); }
    }
  }
}
