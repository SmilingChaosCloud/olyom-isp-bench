// node build.mjs: bundles src/main.js and inlines everything into dist/index.html
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const ES = process.env.ESBUILD || '/opt/npm-tools/node_modules/esbuild/bin/esbuild';
const js = execFileSync(ES, ['src/main.js', '--bundle', '--format=iife', '--minify', '--target=es2022'], { maxBuffer: 1 << 26 }).toString().replaceAll('</script', '<\\/script');
const css = readFileSync('src/style.css', 'utf8');
const html = readFileSync('src/index.html', 'utf8').replace('/*CSS*/', () => css).replace('/*JS*/', () => js);
writeFileSync('dist/index.html', html);
console.log('dist/index.html', html.length, 'bytes');
