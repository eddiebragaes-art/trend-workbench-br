// Adicionado em trend-workbench-br: laboratório de mesa proprietária.
import test from 'node:test';
import assert from 'node:assert/strict';
import { backtestSignals, LUCID_50K, runGrid, setupOf, setupStats, simulateEvaluation, spanDays, type BacktestTrade } from '../lib/prop-lab.ts';

const candles = Array.from({ length: 360 }, (_, i) => { const p = 100 + 10 * Math.sin(i / 37) + 4 * Math.sin(i / 9) + 1.5 * Math.sin(i / 2.3) + i * 0.01; return { time: 1.7e9 + i * 3600, open: p - 0.3, high: p + 0.9, low: p - 0.9, close: p + 0.3, volume: 1000, closed: true }; });
const base = { sims: 3000, ticket: 100, payout: 1500, seed: 7 };

test('signal types map to setups', () => {
  assert.equal(setupOf('first-buy-candidate'), 'first');
  assert.equal(setupOf('second-sell-candidate'), 'second');
  assert.equal(setupOf('third-buy-candidate'), 'third');
  assert.equal(setupOf('range-divergence-candidate'), 'weakening');
  assert.equal(setupOf('trend-divergence-candidate'), null);
});

test('backtest trades start after the signal is visible and resolve in R', () => {
  const trades = backtestSignals(candles, 'TEST', 'stroke', { targetR: 2, maxHoldBars: 30 });
  assert.ok(trades.length > 3);
  for (const t of trades) {
    assert.ok(t.entryTime >= t.signalTime);
    assert.ok(t.r === -1 || t.r === 2 || t.exit === 'time');
    assert.ok(t.side === 'long' ? t.stop < t.entry && t.target > t.entry : t.stop > t.entry && t.target < t.entry);
  }
  // No look-ahead: a shorter history yields the same earlier trades.
  const early = backtestSignals(candles.slice(0, 250), 'TEST', 'stroke', { targetR: 2, maxHoldBars: 30 });
  const cutoff = candles[249].time - 31 * 3600;
  const pick = (x: BacktestTrade[]) => x.filter(t => t.entryTime < cutoff).map(t => [t.setup, t.entryTime, t.r]);
  assert.deepEqual(pick(early), pick(trades));
});

test('stats report win rate, average R and the worst losing streak', () => {
  const t = (r: number, i: number) => ({ setup: 'third', r, entryTime: i } as BacktestTrade);
  const s = setupStats([t(2, 1), t(-1, 2), t(-1, 3), t(-1, 4), t(2, 5)], 'all', 10);
  assert.equal(s.trades, 5); assert.equal(s.winRate, 40); assert.equal(s.avgR, 0.2); assert.equal(s.maxLosingStreak, 3); assert.equal(s.tradesPerDay, 0.5);
});

test('the evaluation simulator respects the prop rules', () => {
  // Every trade wins 2R: $500 risk passes on the third win ($3,000).
  const win = simulateEvaluation([2], LUCID_50K, { ...base, risk: 500, stopAfterLosses: 0, tradesPerDay: 1 });
  assert.equal(win.pass, 1); assert.ok(win.meanDays! >= 3); assert.equal(win.ev, 1400);
  // Every trade loses: $1,000 risk breaches the daily loss on the first loss.
  const lose = simulateEvaluation([-1], LUCID_50K, { ...base, risk: 1000, stopAfterLosses: 0, tradesPerDay: 2 });
  assert.equal(lose.fail, 1); assert.equal(lose.ev, -100);
  // With "pause the day" the same losses end on the $2,000 drawdown instead.
  const paused = simulateEvaluation([-1], { ...LUCID_50K, dailyLossMode: 'pause' }, { ...base, risk: 500, stopAfterLosses: 1, tradesPerDay: 3 });
  assert.equal(paused.fail, 1);
});

test('a positive edge favours more risk; the grid recommends the best EV', () => {
  const edge = [2, 2, -1, -1, -1, 2, -1, 2, -1, -1];
  const low = simulateEvaluation(edge, LUCID_50K, { ...base, risk: 250, stopAfterLosses: 0, tradesPerDay: 1 });
  const high = simulateEvaluation(edge, LUCID_50K, { ...base, risk: 750, stopAfterLosses: 0, tradesPerDay: 1 });
  assert.ok(low.open > high.open);
  const trades = Array.from({ length: 40 }, (_, i) => ({ setup: i % 2 ? 'third' : 'first', r: edge[i % edge.length], entryTime: i } as BacktestTrade));
  const grid = runGrid(trades, 40, LUCID_50K, { ...base, sims: 500 });
  assert.ok(grid.recommendation);
  const best = Math.max(...grid.groups.flatMap(g => g.stats.trades >= 20 ? g.results.map(r => r.ev) : []));
  assert.equal(grid.recommendation!.result.ev, best);
  assert.equal(spanDays(candles.slice(0, 25)), 1);
});
