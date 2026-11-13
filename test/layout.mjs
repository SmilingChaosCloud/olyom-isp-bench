import { createRequire } from 'node:module';
const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const errs=[];
for (const [w,h] of [[1440,900],[1920,1080],[1000,800]]) {
  const page = await b.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror',(e)=>errs.push(e.message));
  await page.goto('file:///home/claude/isp-lab/dist/index.html'); await page.waitForTimeout(400);
  const info = await page.evaluate(() => { const r=(s)=>document.querySelector(s).getBoundingClientRect(); const R=document.querySelector('#right'), L=document.querySelector('#left');
    return { pageScrollH: document.documentElement.scrollHeight, overflowX: document.documentElement.scrollWidth-innerWidth, left:[Math.round(r('#left').left),Math.round(r('#left').width)], right:[Math.round(r('#right').left),Math.round(r('#right').width)], rightScroll:[R.clientHeight,R.scrollHeight], leftScroll:[L.clientHeight,L.scrollHeight], canvas:[r('#in').width,r('#out').width,Math.round(r('#out').bottom)], stripBottom:Math.round(r('#strip').bottom) }; });
  console.log(w,h,JSON.stringify(info));
  await page.screenshot({ path: `/tmp/l${w}.png` });
  if (w===1440) {
    const before=await page.evaluate(()=>[document.querySelector('#in').getBoundingClientRect().top, document.querySelector('#right').scrollTop]);
    await page.evaluate(()=>{document.querySelector('#right').scrollTop=900}); await page.waitForTimeout(100);
    const after=await page.evaluate(()=>[document.querySelector('#in').getBoundingClientRect().top, document.querySelector('#right').scrollTop]);
    console.log('scroll right pane: image top & scrollTop',before,'->',after);
    await page.evaluate(()=>{document.querySelector('#right').scrollTop=0});
    const t0=await page.evaluate(()=>document.querySelector('#h-sixaxis').getBoundingClientRect().top);
    await page.click('#h-levels ~ .fold'); await page.click('#h-wb ~ .fold'); await page.waitForTimeout(150);
    const t1=await page.evaluate(()=>document.querySelector('#h-sixaxis').getBoundingClientRect().top);
    console.log('collapse moves lower panels up',t0,'->',t1);
    await page.fill('#c-chroma-gain ~ input[type=number]','1.5'); await page.waitForTimeout(200); console.log('slider still drives', await page.inputValue('#c-chroma-gain'));
  }
  await page.close();
}
console.log('errors',errs); await b.close();
