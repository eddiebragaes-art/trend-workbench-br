// Modificado para trend-workbench-br: título e idioma da página em português.
import { build } from '../chan-market/node_modules/esbuild/lib/main.js';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../chan-market');
const [mode,destination]=process.argv.slice(2);
if (mode !== '--shared-assets' || !destination) throw new Error('Usage: node build.mjs --shared-assets <directory>');
const app = path.resolve(destination);
const require=createRequire(path.join(repo,'package.json'));
const postcss=require('postcss');
const tailwind=require('@tailwindcss/postcss');
execFileSync(process.execPath,['--experimental-strip-types','--test','tests/official-header.test.ts'],{cwd:repo,stdio:'inherit'});
await mkdir(path.join(app,'public'),{recursive:true});
await build({
  absWorkingDir:repo,entryPoints:[path.join(here,'main.tsx')],outfile:path.join(app,'public/app.js'),
  bundle:true,minify:true,format:'esm',platform:'browser',target:'es2022',jsx:'automatic',
  nodePaths:[path.join(repo,'node_modules')],tsconfig:path.join(repo,'tsconfig.json'),
  alias:{'next/link':path.join(here,'link.tsx')},define:{'process.env.NODE_ENV':'"production"'},
});
await build({absWorkingDir:repo,entryPoints:[path.join(repo,'lib/market-data.ts')],outfile:path.join(app,'market-data.mjs'),bundle:true,format:'esm',platform:'node',target:'node24',minify:false});
const cssSource=path.join(repo,'app/globals.css');
const stylesheet=await postcss([tailwind({base:repo})]).process(await readFile(cssSource,'utf8'),{from:cssSource});
await writeFile(path.join(app,'public/style.css'),stylesheet.css);
await copyFile(path.join(repo,'public/favicon.svg'),path.join(app,'public/favicon.svg'));
// A fresh public installation has no local validation report.
const validationSummary = {available: false, matchesInstalledBuild: false};
await writeFile(path.join(app,'public/forecast-validation.json'),JSON.stringify(validationSummary));
await copyFile(path.join(here,'server.mjs'),path.join(app,'server.mjs'));
await copyFile(path.join(here,'network-bootstrap.mjs'),path.join(app,'network-bootstrap.mjs'));
await writeFile(path.join(app,'public/index.html'),'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Estação de Tendências</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><noscript>Ative o JavaScript nesta janela.</noscript><script type="module" src="/app.js"></script></body></html>');
console.log(`Built shared desktop assets in ${app}`);
