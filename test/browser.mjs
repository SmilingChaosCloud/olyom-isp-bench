import { createRequire } from 'node:module';
const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
import { writeFileSync } from 'node:fs';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text()); });
await page.route(/fonts\.g/, (r) => r.abort());
await page.goto('file:///home/claude/isp-lab/dist/index.html');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/s1.png', fullPage: true });
const hashOut = () => page.evaluate(() => { const d = document.querySelector('#out').getContext('2d').getImageData(0, 0, 400, 400).data; let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) | 0; return h; });
const h0 = await hashOut();
// numeric field and slider stay in step and change output
await page.fill('#c-chroma-gain ~ input[type=number]', '1.8'); await page.waitForTimeout(150);
console.log('slider follows number', await page.inputValue('#c-chroma-gain'), 'output changed', h0 !== await hashOut());
await page.fill('#c-chroma-gain ~ input[type=number]', '1'); await page.waitForTimeout(150);
console.log('restored', h0 === await hashOut());
// bypass through the strip
await page.click('#strip .stage:nth-child(3)'); await page.waitForTimeout(150);
console.log('bypass demosaic changes output', h0 !== await hashOut(), await page.getAttribute('#strip .stage:nth-child(3)', 'aria-pressed'));
await page.click('#strip .stage:nth-child(3)'); await page.waitForTimeout(150);
// 16-bit PNG, a grey ramp, via python
await page.setInputFiles('#fileimg', '/tmp/ramp16.png'); await page.waitForTimeout(500);
console.log('msg', await page.textContent('#msg'), '| name', await page.textContent('#inname'));
console.log('mosaic sample', await page.evaluate(() => [__isp.mosaic[0], __isp.mosaic[399], __isp.mosaic[200*400+200]]));
await page.setInputFiles('#fileimg', '/tmp/small.png'); await page.waitForTimeout(300);
console.log('small', await page.textContent('#msg'));
// firmware
await page.setInputFiles('#filefw', '/tmp/fake.BIN');
await page.waitForFunction(() => document.querySelector('#fw').dataset.kind !== 'busy' && document.querySelector('#fw').dataset.kind !== 'none', null, { timeout: 90000 });
await page.waitForTimeout(400);
console.log('fw chip', await page.textContent('#fw'), '| msg', await page.textContent('#msg'), '|', await page.textContent('#timing'));
await page.fill('#c-sharpen-s ~ input[type=number]', '-1'); await page.waitForTimeout(200);
console.log('K shown', await page.inputValue('#c-sharpen-K ~ input[type=number]'), 'disabled', await page.isDisabled('#c-sharpen-K'));
console.log('log', (await page.textContent('#log')).slice(0, 400));
console.log('tags', await page.textContent('#h-sharpen .tags'), await page.textContent('#h-demosaic .tags'));
await page.screenshot({ path: '/tmp/s2.png', fullPage: true });
await page.click('#source button[data-v=reg]'); await page.waitForTimeout(200);
console.log('reg mode K enabled', !(await page.isDisabled('#c-sharpen-K')), 'sharpness disabled', await page.isDisabled('#c-sharpen-s'), await page.textContent('#h-sharpen .tags'));
// download fallback
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#saveout')]);
const f = await dl.path(); console.log('download', dl.suggestedFilename());
await page.setViewportSize({ width: 420, height: 800 }); await page.waitForTimeout(200);
await page.screenshot({ path: '/tmp/s3.png' });
console.log('overflow x', await page.evaluate(() => document.documentElement.scrollWidth - innerWidth));
console.log('errors', errs);
await b.close();
