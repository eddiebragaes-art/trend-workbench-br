// Modificado para trend-workbench-br: verifica o nome desta versão e o crédito ao projeto original.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';
import test from 'node:test';
import { build, type Plugin } from 'esbuild';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const project = fileURLToPath(new URL('../', import.meta.url));

// The production page starts in Chinese on the server. Supply the English
// context for the second render, just as the language toggle does in the UI.
const englishContext: Plugin = {
  name: 'english-language-context',
  setup(builder) {
    builder.onResolve({filter: /^@\/lib\/language$/}, () => ({path:'language', namespace:'english'}));
    builder.onLoad({filter: /.*/, namespace:'english'}, () => ({
      contents: `export const LanguageProvider = ({children}) => children;
        export const LANGUAGES = ['pt','en','zh'];
        export const useLanguage = () => ({language:'en', locale:'en-US', setLanguage() {}, t:(_zh,en) => en});`,
    }));
  },
};

// Check the rendered homepage, so an unused constant or a link in a footer
// cannot satisfy the release check. No network or browser is needed.
async function renderHeader(language: 'pt' | 'en') {
  const bundle = await build({
    absWorkingDir: project, entryPoints: ['app/page.tsx'], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', alias: {'@': project},
    jsx: 'automatic', plugins: language === 'en' ? [englishContext] : [],
  });
  const compiled = {exports: {} as {default: ComponentType}};
  compileFunction(bundle.outputFiles[0].text, ['module', 'exports', 'require'])(
    compiled, compiled.exports, createRequire(import.meta.url),
  );
  const html = renderToStaticMarkup(createElement(compiled.exports.default));
  const subtitle = html.match(/class="instrument-identity"[\s\S]*?<p>([\s\S]*?)<\/p>/)?.[1].replace(/<[^>]*>/g, '').trim();
  assert.equal(subtitle, 'Bitcoin', 'The initial BTC subtitle should contain only the asset name.');
  assert.doesNotMatch(html, /\b(?:binance|okx)\b|币安|欧易/i);
  const header = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/)?.[1];
  assert.ok(header, 'The workbench header is missing.');
  assert.match(html, /href="https:\/\/github\.com\/nhovongoc0-max\/trend-workbench"/, 'The credit link to the original project is missing.');
  return Array.from(header.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g), ([, attrs, contents]) => ({
    href: attrs.match(/\shref="([^"]*)"/)?.[1],
    text: contents.replace(/<(\w+)\b[^>]*\saria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, '')
      .replace(/<[^>]*>/g, '').trim(),
  }));
}

for (const language of ['pt', 'en'] as const) {
  test(`header names this version and credits the original project (${language})`, async () => {
    const anchors = await renderHeader(language);
    const required = [
      ['/', language === 'pt' ? 'Estação de Tendências' : 'Trend Station'],
      ['https://x.com/bi_9527zx', language === 'pt' ? 'Autor original' : 'Developer (DeFi狙击手)'],
      ['https://t.me/jujishou9527', language === 'pt' ? 'Comunidade' : 'Community'],
    ];
    for (const [href, text] of required) {
      assert.deepEqual(anchors.filter(link => link.href === href || link.text === text), [{href, text}],
        `Missing or incorrect header link for ${text} (${href}).`);
    }
  });
}
