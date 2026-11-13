import { createRequire } from 'node:module';
const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const pg = await b.newPage();
const errs = [];
pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
await pg.goto('file://' + process.cwd() + '/dist/index.html');
await pg.waitForTimeout(500);
// hover the sharpen Gain K row (an ISP register) and a kernel select (hardware) and read the tip
async function tipFor(key){
  const row = await pg.$(`.row[data-key="${key}"]`);
  if(!row) return '(row not found)';
  await row.scrollIntoViewIfNeeded(); await row.hover(); await pg.waitForTimeout(120);
  const vis = await pg.$eval('#tip', t => t.hidden ? null : t.innerText);
  return vis;
}
console.log('sharpen.K ->', JSON.stringify(await tipFor('sharpen.K')));
console.log('sharpen.kernel ->', JSON.stringify(await tipFor('sharpen.kernel')));
console.log('wb.r ->', JSON.stringify(await tipFor('wb.r')));
console.log('sharpen.s ->', JSON.stringify(await tipFor('sharpen.s')));
console.log('errs:', errs);
await b.close();
