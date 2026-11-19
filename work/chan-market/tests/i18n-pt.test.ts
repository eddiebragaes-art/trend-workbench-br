// Adicionado em trend-workbench-br: cobertura da tradução pt-BR.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../lib/chan.ts';
import { translateAnalysis } from '../lib/analysis-i18n.ts';
import { localeFor, pickText, toPt } from '../lib/i18n-pt.ts';
import { marketLoadErrorText } from '../lib/market-i18n.ts';
import { syntheticDaily } from './synthetic-daily.ts';

const han = /[㐀-鿿]/;

test('UI strings fall back to English and keep surrounding spaces', () => {
  assert.equal(pickText('pt', '刷新行情', 'Refresh'), 'Atualizar');
  assert.equal(pickText('zh', '刷新行情', 'Refresh'), '刷新行情');
  assert.equal(toPt('Up '), 'Alta ');
  assert.equal(toPt('Imported 1,200 bars'), 'Importadas 1,200 velas');
  assert.equal(toPt('Something not in the dictionary'), 'Something not in the dictionary');
  assert.equal(localeFor('pt'), 'pt-BR');
});

test('Portuguese analysis keeps every number and contains no Chinese text', () => {
  const raw = analyze(syntheticDaily(400));
  const pt = translateAnalysis(raw, 'pt'), en = translateAnalysis(raw, 'en');
  assert.deepEqual(pt.tradePlans.map(p => [p.entryLow, p.entryHigh, p.stopLoss, p.target1, p.target2, p.status]),
    raw.tradePlans.map(p => [p.entryLow, p.entryHigh, p.stopLoss, p.target1, p.target2, p.status]));
  const texts = [pt.bias.label, ...pt.bias.factors.flatMap(f => [f.name, f.detail]), ...pt.warnings,
    ...pt.signals.flatMap(s => [s.label, s.reason]), ...pt.scenarios.flatMap(s => [s.title, s.trigger, s.invalidation, s.target]),
    ...pt.tradeSetups.flatMap(s => [s.label, s.trigger, s.invalidation, s.basis]),
    ...pt.tradePlans.flatMap(p => [p.label, p.strategy, p.statusLabel, p.trigger, p.invalidation, p.basis, p.statusReason]),
    pt.decision.title, pt.decision.summary];
  for (const text of texts) assert.doesNotMatch(text, han, text);
  // Every plan sentence is actually translated, not left in English.
  for (const [i, p] of pt.tradePlans.entries()) {
    for (const key of ['label', 'trigger', 'invalidation', 'basis'] as const) assert.notEqual(p[key], en.tradePlans[i][key], key);
  }
  assert.notEqual(pt.decision.title, en.decision.title);
});

test('market errors are translated', () => {
  assert.equal(marketLoadErrorText('fetch failed', 'pt'), 'Não foi possível conectar ao serviço de dados de mercado.');
});
