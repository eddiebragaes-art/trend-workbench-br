// Adicionado em trend-workbench-br: 1ª e 2ª compra/venda.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addFirstSecondSignals, analyze } from '../lib/chan.ts';
import { translateAnalysis } from '../lib/analysis-i18n.ts';
import { analysisToPt } from '../lib/analysis-i18n-pt.ts';
import type { Signal, StructureLine } from '../lib/market-types';

const point = (index: number, price: number) => ({ index, time: 1_700_000_000 + index * 3600, price });
const line = (a: [number, number], b: [number, number]): StructureLine => ({ from: point(...a), to: point(...b), direction: b[1] > a[1] ? 'up' : 'down', confirmed: true, confirmedAt: b[0] + 3 });
const divergence = (at: [number, number], side: 'long' | 'short'): Signal => ({ ...point(...at), label: side === 'long' ? '底背驰信号' : '顶背驰信号', side, type: 'trend-divergence-candidate', confirmed: false, reason: '' });

test('a trend divergence becomes a first buy and a higher pullback low a second buy', () => {
  const segments = [line([0, 120], [20, 100]), line([20, 100], [30, 110]), line([30, 110], [50, 90]), line([50, 90], [60, 104]), line([60, 104], [70, 95]), line([70, 95], [80, 115])];
  const structure = { segments, signals: [divergence([50, 90], 'long')] };
  addFirstSecondSignals(structure);
  assert.deepEqual(structure.signals.map(s => [s.type, s.label, s.index, s.price]), [['first-buy-candidate', '一买', 50, 90], ['second-buy-candidate', '二买', 70, 95]]);
});

test('no second buy when the pullback breaks the first-buy low', () => {
  const segments = [line([30, 110], [50, 90]), line([50, 90], [60, 104]), line([60, 104], [70, 88])];
  const structure = { segments, signals: [divergence([50, 90], 'long')] };
  addFirstSecondSignals(structure);
  assert.deepEqual(structure.signals.map(s => s.type), ['first-buy-candidate']);
});

test('the sell side mirrors first and second sell points', () => {
  const segments = [line([30, 90], [50, 120]), line([50, 120], [60, 105]), line([60, 105], [70, 116]), line([70, 116], [80, 100])];
  const structure = { segments, signals: [divergence([50, 120], 'short')] };
  addFirstSecondSignals(structure);
  assert.deepEqual(structure.signals.map(s => [s.label, s.side, s.price]), [['一卖', 'short', 120], ['二卖', 'short', 116]]);
});

test('first and second points are translated without Chinese text', () => {
  const candles = Array.from({ length: 400 }, (_, i) => {
    const p = 100 - i * 0.08 + 6 * Math.sin(i / 11) + 2 * Math.sin(i / 3) + (i > 300 ? (i - 300) * 0.3 : 0);
    return { time: 1_700_000_000 + i * 3600, open: p - 0.2, high: p + 0.8, low: p - 0.8, close: p + 0.2, volume: 1000, closed: true };
  });
  const analysis = analyze(candles, { skipCalibration: true });
  analysis.signals.push({ ...point(10, 99), label: '一买', side: 'long', type: 'first-buy-candidate', confirmed: false, reason: '' }, { ...point(20, 99), label: '二卖', side: 'short', type: 'second-sell-candidate', confirmed: false, reason: '' });
  const pt = analysisToPt(translateAnalysis(analysis, 'en'));
  const labels = pt.signals.map(s => s.label);
  assert.ok(labels.includes('1ª compra') && labels.includes('2ª venda'));
  assert.ok(pt.signals.every(s => !/[一-鿿]/.test(s.label + s.reason)));
});
