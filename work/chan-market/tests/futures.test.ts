// Adicionado em trend-workbench-br: índices e commodities (futuros).
import test from 'node:test';
import assert from 'node:assert/strict';
import { getCandles, normalizeSymbol, searchInstruments } from '../lib/market-data.ts';
import { aggregateFuturesFourHour, futuresBarClosed, futuresClock, futuresOpen } from '../lib/futures-session.ts';
import { candleAvailableAt } from '../lib/timeframe-context.ts';
import { getFeedHealth } from '../lib/feed-health.ts';
import type { Candle, Interval } from '../lib/market-types';

const epoch = (value: string) => Date.parse(value) / 1000;
const bar = (time: number, value = 100, closed = true): Candle => ({ time, open: value, high: value + 1, low: value - 1, close: value + 0.5, volume: 800, closed });
// Hourly Globex bars for one trading date: 18:00 New York the evening before until 17:00.
const session = (date: string) => {
  const start = epoch(`${date}T18:00:00-05:00`) - 86400;
  return Array.from({ length: 23 }, (_, i) => bar(start + i * 3600, 100 + i));
};

async function yahoo(symbol: string, interval: Interval, rows: Candle[], now: string, zone = 'America/New_York') {
  const originalFetch = globalThis.fetch, originalNow = Date.now, urls: string[] = [];
  Date.now = () => Date.parse(now);
  globalThis.fetch = async input => {
    const url = String(input); urls.push(url);
    const granularity = url.match(/interval=([^&]+)/)?.[1];
    return new Response(JSON.stringify({ chart: { result: [{
      meta: { dataGranularity: granularity, exchangeTimezoneName: zone, currency: 'USD' },
      timestamp: rows.map(c => c.time), indicators: { quote: [{ open: rows.map(c => c.open), high: rows.map(c => c.high), low: rows.map(c => c.low), close: rows.map(c => c.close), volume: rows.map(c => c.volume) }] },
    }] } }));
  };
  try { return { data: await getCandles('fut', symbol, interval, 100), urls }; }
  finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
}

test('broker-style names map to the supported futures contracts', () => {
  assert.equal(normalizeSymbol('fut', 'nas100'), 'NAS100');
  assert.equal(normalizeSymbol('fut', 'GC=F'), 'XAUUSD');
  assert.equal(normalizeSymbol('fut', 'gold'), 'XAUUSD');
  assert.equal(normalizeSymbol('fut', 'WTI'), 'USOIL');
  assert.equal(normalizeSymbol('fut', 'US30'), 'US30');
  assert.throws(() => normalizeSymbol('fut', 'AAPL'));
});

test('the Globex trading clock starts at 18:00 New York and pauses at 17:00', () => {
  // Sunday 18:00 New York opens Monday's trading date.
  assert.deepEqual(futuresClock(epoch('2026-11-15T18:00:00-05:00')), { date: '2026-11-16', minute: 0, weekday: 1 });
  assert.equal(futuresOpen(epoch('2026-11-15T18:30:00-05:00')), true);
  assert.equal(futuresOpen(epoch('2026-11-18T17:30:00-05:00')), false);
  assert.equal(futuresOpen(epoch('2026-11-18T18:30:00-05:00')), true);
  assert.equal(futuresOpen(epoch('2026-11-20T17:30:00-05:00')), false);
  assert.equal(futuresOpen(epoch('2026-11-21T12:00:00-05:00')), false);
  assert.equal(futuresOpen(epoch('2026-11-22T12:00:00-05:00')), false);
});

test('futures bars close at their end or the 17:00 pause, plus a 10-minute delay', () => {
  const last = epoch('2026-11-18T16:00:00-05:00');
  assert.equal(futuresBarClosed(last, '1h', epoch('2026-11-18T17:05:00-05:00')), false);
  assert.equal(futuresBarClosed(last, '1h', epoch('2026-11-18T17:10:00-05:00')), true);
  const day = epoch('2026-11-18T00:00:00-05:00');
  assert.equal(futuresBarClosed(day, '1d', epoch('2026-11-18T17:05:00-05:00')), false);
  assert.equal(futuresBarClosed(day, '1d', epoch('2026-11-18T17:10:00-05:00')), true);
  assert.equal(candleAvailableAt({ time: day }, 'fut', '1d'), epoch('2026-11-18T17:10:00-05:00'));
  assert.equal(candleAvailableAt({ time: epoch('2026-11-18T14:00:00-05:00') }, 'fut', '4h'), epoch('2026-11-18T17:10:00-05:00'));
  assert.equal(candleAvailableAt({ time: epoch('2026-11-17T18:00:00-05:00') }, 'fut', '4h'), epoch('2026-11-17T22:10:00-05:00'));
});

test('hourly futures bars form six session-aligned 4-hour candles per trading date', () => {
  const rows = [...session('2026-11-17'), ...session('2026-11-18')];
  const { candles, discardedBuckets } = aggregateFuturesFourHour(rows, epoch('2026-11-19T12:00:00-05:00'));
  assert.equal(discardedBuckets, 0);
  assert.equal(candles.length, 12);
  assert.equal(candles[0].time, epoch('2026-11-16T18:00:00-05:00'));
  assert.equal(candles[5].time, epoch('2026-11-17T14:00:00-05:00'));
  assert.equal(candles[5].volume, 3 * 800);
  assert.ok(candles.every(c => c.closed));
  const gap = aggregateFuturesFourHour(session('2026-11-17').filter(c => c.time !== epoch('2026-11-16T19:00:00-05:00')), epoch('2026-11-19T12:00:00-05:00'));
  assert.equal(gap.candles.length, 5); assert.equal(gap.discardedBuckets, 1);
});

test('Yahoo futures requests use the contract symbol and drop bars in the daily pause', async () => {
  const rows = [...session('2026-11-17'), bar(epoch('2026-11-17T17:00:00-05:00'), 99), ...session('2026-11-18')];
  const { data, urls } = await yahoo('NAS100', '1h', rows, '2026-11-19T12:00:00-05:00');
  assert.ok(urls[0].includes('/chart/NQ%3DF?'));
  assert.equal(data.instrument.market, 'fut'); assert.equal(data.instrument.symbol, 'NAS100');
  assert.equal(data.candles.length, 46);
  assert.ok(!data.candles.some(c => c.time === epoch('2026-11-17T17:00:00-05:00')));
  assert.match(data.source, /^Yahoo Finance public feed · futures NQ=F/);
  const four = await yahoo('XAUUSD', '4h', [...session('2026-11-17'), ...session('2026-11-18')], '2026-11-19T12:00:00-05:00');
  assert.ok(four.urls[0].includes('/chart/GC%3DF?') && four.urls[0].includes('interval=60m'));
  assert.equal(four.data.candles.length, 12);
  await assert.rejects(() => yahoo('USOIL', '1h', session('2026-11-18'), '2026-11-19T12:00:00-05:00', 'Europe/London'));
});

test('feed health treats the weekend and the daily pause as closed, not stale', () => {
  const data = (time: number) => ({ instrument: { id: 'fut:XAUUSD', symbol: 'XAUUSD', name: 'Gold', market: 'fut' as const, exchange: 'COMEX', currency: 'USD' }, interval: '1h' as const, candles: [bar(time)], source: 'Yahoo Finance public feed · futures GC=F', asOf: new Date(Date.parse('2026-11-21T12:00:00-05:00')).toISOString(), delayNotice: '', adjustment: '', warnings: [], availableIntervals: [] });
  const weekend = getFeedHealth(data(epoch('2026-11-20T16:00:00-05:00')), { nowMs: Date.parse('2026-11-21T12:00:00-05:00'), interval: '1h' });
  assert.equal(weekend.state, 'closed');
  const live = getFeedHealth({ ...data(epoch('2026-11-18T10:00:00-05:00')), asOf: new Date(Date.parse('2026-11-18T11:05:00-05:00')).toISOString() }, { nowMs: Date.parse('2026-11-18T11:05:00-05:00'), interval: '1h' });
  assert.ok(live.state === 'fresh' || live.state === 'delayed');
});

test('futures contracts are listed offline', async () => {
  const result = await searchInstruments('fut', '');
  assert.deepEqual(result.results.map(r => r.symbol).slice(0, 4), ['NAS100', 'US30', 'US500', 'XAUUSD']);
  const gold = await searchInstruments('fut', 'ouro');
  assert.equal(gold.results[0]?.symbol, 'XAUUSD');
});
