// Adicionado em trend-workbench-br: conta virtual de mesa proprietária.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computePaperAccount, DEFAULT_RULES, paperTradesCsv, profileRules, sanitizeRules, tradingDay, type PaperAccountSettings } from '../lib/paper-account.ts';
import type { ForecastRecord, JournalEventType } from '../lib/forecast-journal.ts';

const T0 = Date.parse('2026-11-18T14:00:00Z') / 1000;
const noCost = (over = {}): PaperAccountSettings => ({ version: 1, startedAt: T0 - 60, rules: { ...DEFAULT_RULES, feeBps: 0, slippageBps: 0, ...over } });
function record(id: string, side: 'long' | 'short', entry: number, stop: number, t1: number, t2: number, events: [JournalEventType, number, number][], createdAt = T0): ForecastRecord {
  return {
    id, key: 'k', market: 'fut', symbol: 'XAUUSD', interval: '1h', source: 's', adjustment: 'a', createdAt, referencePrice: entry, referenceTime: createdAt, structureAsOf: createdAt,
    outlook: { side, status: 'ready', zoneLow: entry - 1, zoneHigh: entry + 1, triggerPrice: entry, invalidationPrice: stop, targets: [{ price: t1, estimated: true }, { price: t2, estimated: true }] } as unknown as ForecastRecord['outlook'],
    lastBarTime: createdAt, lastClose: entry, barsObserved: 0, status: 'watching',
    events: events.map(([type, at, price]) => ({ id: `${id}:${type}:${at}`, type, at, barTime: at, price })),
  };
}

test('the Lucid 50K profile is the default and values stay editable', () => {
  assert.deepEqual([DEFAULT_RULES.initialBalance, DEFAULT_RULES.riskPerTrade, DEFAULT_RULES.dailyLoss, DEFAULT_RULES.maxDrawdown, DEFAULT_RULES.profitTarget, DEFAULT_RULES.drawdownMode], [50000, 500, 1000, 2000, 3000, 'static']);
  assert.equal(sanitizeRules({ riskPerTrade: 250, profile: 'nope' }).riskPerTrade, 250);
  assert.equal(sanitizeRules({ profile: 'nope' }).profile, 'custom');
  assert.equal(profileRules('lucid-50k').dailyLoss, 1000);
});

test('a stopped trade loses exactly the fixed risk and a full target wins the reward', () => {
  const loss = record('a', 'long', 100, 95, 105, 110, [['condition-met', T0 + 3600, 100], ['invalidated', T0 + 7200, 95]]);
  const win = record('b', 'short', 200, 210, 190, 180, [['condition-met', T0 + 3600, 200], ['target1', T0 + 7200, 190], ['target2', T0 + 10800, 180]]);
  const account = computePaperAccount([loss, win], noCost());
  assert.equal(account.trades[0].units, 100);
  assert.equal(Math.round(account.trades[0].pnl), -500);
  // Half at 1R (+250) and half at 2R (+500).
  assert.equal(Math.round(account.trades[1].pnl), 750);
  assert.equal(Math.round(account.balance), 50250);
  assert.equal(account.stats.wins, 1); assert.equal(account.stats.losses, 1);
  assert.match(paperTradesCsv(account), /XAUUSD,1h,long/);
});

test('two stops in one trading day breach the $1,000 daily loss and block new entries', () => {
  const rows = [0, 1, 2].map(i => record(`s${i}`, 'long', 100, 95, 105, 110, [['condition-met', T0 + 600 + i * 1200, 100], ['invalidated', T0 + 900 + i * 1200, 95]]));
  const account = computePaperAccount(rows, noCost());
  assert.equal(account.status, 'failed');
  assert.equal(account.violations[0].kind, 'daily-loss');
  assert.equal(account.trades.length, 2);
  assert.deepEqual(account.skipped.map(s => s.reason), ['account-closed']);
});

test('losses spread over days breach the static $2,000 drawdown at $48,000', () => {
  const rows = [0, 1, 2, 3].map(i => record(`d${i}`, 'long', 100, 95, 105, 110, [['condition-met', T0 + i * 86400, 100], ['invalidated', T0 + i * 86400 + 600, 95]]));
  const account = computePaperAccount(rows, noCost());
  assert.equal(account.status, 'failed');
  assert.equal(account.violations[0].kind, 'max-drawdown');
  assert.equal(Math.round(account.balance), 48000);
});

test('reaching the $3,000 target passes the account', () => {
  const rows = [0, 1, 2, 3, 4].map(i => record(`w${i}`, 'long', 100, 95, 105, 110, [['condition-met', T0 + i * 86400, 100], ['target1', T0 + i * 86400 + 600, 105], ['target2', T0 + i * 86400 + 1200, 110]]));
  const account = computePaperAccount(rows, noCost());
  assert.equal(account.status, 'passed');
  assert.equal(account.trades.length, 4);
  assert.ok(account.balance >= 53000);
});

test('records before the account start and ambiguous bars are handled conservatively', () => {
  const old = record('old', 'long', 100, 95, 105, 110, [['condition-met', T0 - 3600, 100], ['target2', T0 - 600, 110]], T0 - 7200);
  const amb = record('amb', 'long', 100, 95, 105, 110, [['ambiguous', T0 + 600, 100]]);
  const account = computePaperAccount([old, amb], noCost());
  assert.equal(account.trades.length, 1);
  assert.equal(Math.round(account.trades[0].pnl), -500);
  assert.equal(tradingDay(Date.parse('2026-11-18T21:59:00Z') / 1000), '2026-11-18');
  assert.equal(tradingDay(Date.parse('2026-11-18T22:01:00Z') / 1000), '2026-11-19');
});
