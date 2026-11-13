import { createRequire } from 'node:module';
const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const pg = await b.newPage();
const errs = [];
pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
await pg.goto('file://' + process.cwd() + '/dist/index.html');
await pg.waitForTimeout(600);
// find the sharpen panel, confirm the new Edge path select + register rows exist
const hasPath = await pg.locator('text=Edge path').count();
const hasES = await pg.locator('text=YC1_EDGE_STRENGTH').count();
const hasESEL = await pg.locator('text=YC1_ESEL').count();
const hasDER = await pg.locator('text=YC1_DER').count();
// switch the Edge path select to workspace and confirm reg rows ungrey
const sel = pg.locator('select').filter({ has: pg.locator('option', { hasText: 'Workspace shaper' }) }).first();
await sel.selectOption({ label: 'Workspace shaper (decoded ed820)' });
await pg.waitForTimeout(300);
console.log(JSON.stringify({ hasPath, hasES, hasESEL, hasDER, errs }));
await b.close();
