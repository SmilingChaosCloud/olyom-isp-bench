import { createRequire } from 'node:module';
const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errs=[]; page.on('pageerror',(e)=>errs.push(e.message));
await page.goto('file:///home/claude/isp-lab/dist/index.html'); await page.waitForTimeout(400);
const num=(id)=>`#c-${id} ~ input[type=number]`, val=(id)=>page.inputValue(num(id));
const out = () => page.evaluate(() => { const d = document.querySelector('#out').getContext('2d').getImageData(0, 0, 400, 400).data; let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) | 0; return h; });
const h0=await out();
// row reset
await page.fill(num('chroma-gain'),'1.7'); await page.waitForTimeout(150);
await page.click('#c-chroma-gain ~ .reset1'); await page.waitForTimeout(150);
console.log('row reset value',await val('chroma-gain'),'output restored',h0===await out());
// panel reset
await page.fill(num('wb-r'),'2.2'); await page.fill(num('wb-ev'),'1'); await page.waitForTimeout(100);
await page.click('#h-wb .resetp'); await page.waitForTimeout(150);
console.log('panel reset',await val('wb-r'),await val('wb-ev'),'restored',h0===await out());
// HSL reset
await page.fill(num('hsl-s2'),'5'); await page.fill(num('hsl-h3'),'-3'); await page.waitForTimeout(150); const hh=await out();
await page.click('#h-hsl .resetp'); await page.waitForTimeout(150);
console.log('hsl changed',hh!==h0,'hsl reset',await val('hsl-s2'),await val('hsl-h3'),'restored',h0===await out());
// Measured kernel: disables radius, changes output
await page.selectOption('#c-sharpen-kernel','gaussian'); await page.waitForTimeout(250); const hm=await out();
console.log('gaussian kernel changes output',hm!==h0,'radius enabled',!(await page.isDisabled('#c-sharpen-radius')), await page.textContent('#h-sharpen .tags'));
// tooltip on enabled slider, field, and disabled (read-only) slider
const tip=async()=>({ hidden: await page.isHidden('#tip'), text: await page.textContent('#tip') });
await page.evaluate(()=>document.querySelector('#right').scrollTop=0); await page.waitForTimeout(100);
await page.hover('#c-wb-r'); await page.waitForTimeout(80); console.log('range tip',await tip()); await page.screenshot({path:'/tmp/t1.png'});
await page.hover(num('wb-g')); await page.waitForTimeout(80); console.log('number tip',await tip());
await page.hover('#h-wb'); await page.waitForTimeout(80); console.log('off field tip hidden',await page.isHidden('#tip'));
const box=await page.evaluate(()=>{const e=document.querySelector('#c-sixaxis-s0'); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return [r.left+r.width/2,r.top+r.height/2, e.disabled]}); await page.waitForTimeout(120);
await page.mouse.move(box[0],box[1]); await page.waitForTimeout(100); console.log('read-only slider disabled?',box[2],'tip',await tip());
await page.evaluate(()=>document.querySelector('#right').scrollTop=2000); await page.waitForTimeout(100); console.log('hidden on scroll',await page.isHidden('#tip'));
// read-only row has no usable reset; switching mode enables it
const rb=await page.isDisabled('#c-sharpen-K ~ .reset1'); await page.click('#source button[data-v=reg]'); await page.waitForTimeout(200); console.log('K reset disabled in camera mode',rb,'enabled in register mode',!(await page.isDisabled('#c-sharpen-K ~ .reset1')));
await page.click('#source button[data-v=camera]');await page.waitForTimeout(150);
// CFA row reset reloads mosaic
await page.evaluate(()=>document.querySelector('#right').scrollTop=0); await page.selectOption('#c-levels-cfa','BGGR'); await page.waitForTimeout(200); const hc=await out(); await page.click('#c-levels-cfa ~ .reset1'); await page.waitForTimeout(200); console.log('CFA changed',hc!==hm,'CFA reset restored',hm===await out());
await page.selectOption('#c-sharpen-kernel','measured'); await page.waitForTimeout(150); console.log('radius greyed again',await page.isDisabled('#c-sharpen-radius'));
await page.click('#h-levels ~ .fold');await page.waitForTimeout(100);console.log('collapsed hides panel reset',await page.isHidden('#h-levels .resetp'),'checkbox',await page.isVisible('#on-levels'));
await page.screenshot({path:'/tmp/t2.png',fullPage:false});
await page.evaluate(()=>document.querySelector('#h-hsl').scrollIntoView()); await page.waitForTimeout(100); await page.screenshot({path:'/tmp/t3.png'});
console.log('errors',errs); await b.close();
