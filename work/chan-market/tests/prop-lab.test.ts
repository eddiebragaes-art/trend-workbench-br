// Adicionado em trend-workbench-br: laboratório de mesa proprietária.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateCandles, backtestCandidates, backtestSignals, BASELINE, compareVariants, inSession, LUCID_50K, resolveCandidate, runGrid, setupOf, setupStats, simulateEvaluation, spanDays, variantKey, variantTrades, type BacktestTrade, type Candidate } from '../lib/prop-lab.ts';
import { structureSignals } from '../lib/chan.ts';

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

test('break-even after 1R turns a later stop into 0R', () => {
  const c: Candidate = { symbol: 'X', setup: 'third', level: 'stroke', side: 'long', signalTime: 0, entryTime: 0, entry: 100, stop: 99, path: [[101.2, 99.5, 101], [100.5, 98.5, 99]], complete: true, higher: null };
  assert.deepEqual(resolveCandidate(c, 2, false)?.r, -1);
  assert.deepEqual(resolveCandidate(c, 2, true)?.exit, 'breakeven');
  assert.equal(resolveCandidate(c, 2, true)?.r, 0);
  // Target 1.5R is reached on the first bar? No: high 101.2 < 101.5, so the stop still wins.
  assert.equal(resolveCandidate({ ...c, path: [[101.6, 99.5, 101]] }, 1.5)?.r, 1.5);
  // Unfinished path without a hit is not resolved.
  assert.equal(resolveCandidate({ ...c, path: [[100.5, 99.5, 100]], complete: false }, 2), null);
});

test('sessions use local London and New York hours', () => {
  const t = (iso: string) => Date.parse(iso) / 1000;
  assert.equal(inSession(t('2026-07-01T07:30:00Z'), 'london'), true);  // 08:30 London (BST)
  assert.equal(inSession(t('2026-07-01T07:30:00Z'), 'ny'), false);     // 03:30 New York
  assert.equal(inSession(t('2026-01-15T14:00:00Z'), 'ny'), true);      // 09:00 New York (EST)
  assert.equal(inSession(t('2026-01-15T22:00:00Z'), 'london-ny'), false);
  assert.equal(inSession(t('2026-01-15T22:00:00Z'), 'all'), true);
});

test('higher bars only include buckets closed by the entry', () => {
  const aligned = candles.slice(0, 10).map((c, i) => ({ ...c, time: 14400 * 120000 + i * 3600 }));
  const h = aggregateCandles(aligned, 4 * 3600, aligned[9].time + 3600);
  assert.equal(h.length, 2); // bars 0-3 and 4-7; bars 8-9 are an unfinished bucket
  assert.equal(h[0].high, Math.max(...aligned.slice(0, 4).map(c => c.high)));
});

test('variants compare against the unfiltered 2R baseline', () => {
  const cands = backtestCandidates(candles, 'TEST', 'stroke', { maxHoldBars: 30, barSeconds: 3600, higherSeconds: 14400 });
  assert.deepEqual(variantTrades(cands, BASELINE).map(t => t.r), backtestSignals(candles, 'TEST', 'stroke', { maxHoldBars: 30 }).map(t => t.r));
  const cmp = compareVariants(cands, 'all', 15, 3600);
  assert.equal(cmp.rows.length, 96);
  assert.equal(cmp.baseline.key, variantKey(BASELINE));
  assert.ok(cmp.rows.every(r => r.inSampleTrades + r.outSampleTrades === r.stats.trades));
  assert.ok(cands.some(c => c.higher !== null));
});

test('1st and 2nd points appear on strokes once two centers do not overlap', () => {
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let p = 100; const walk = Array.from({ length: 800 }, (_, i) => { p *= 1 + (rnd() - 0.5) * 0.02; return { time: 1.7e9 + i * 3600, open: p * 0.999, high: p * 1.004, low: p * 0.996, close: p * 1.001, volume: 1, closed: true }; });
  const types = new Set<string>();
  for (let n = 0; n < 6; n++) for (const s of structureSignals(walk.slice(0, 400 + n * 80), 'stroke').signals) types.add(s.type.replace(/-(buy|sell)-candidate$/, ''));
  assert.ok(types.has('first'), [...types].join(','));
});
