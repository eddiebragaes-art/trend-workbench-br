// Adicionado em trend-workbench-br: mercado brasileiro (B3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { getCandles, normalizeSymbol, stockBarClosed, searchInstruments } from '../lib/market-data.ts';
import { aggregateB3FourHour } from '../lib/equity-four-hour.ts';
import { b3CloseMinute, b3YahooSymbol } from '../lib/b3-session.ts';
import { candleAvailableAt, higherInterval } from '../lib/timeframe-context.ts';
import { analyze } from '../lib/chan.ts';
import type { Candle, Interval } from '../lib/market-types';

const epoch = (value: string) => Date.parse(value) / 1000;
const bar = (stamp: string, value = 30, closed = true): Candle => ({ time: epoch(stamp), open: value, high: value + 0.5, low: value - 0.4, close: value + 0.2, volume: 5000, closed });
const hours = (date: string, from: number, to: number) => Array.from({ length: to - from }, (_, i) => bar(`${date}T${String(from + i).padStart(2, '0')}:00:00-03:00`, 30 + i));

async function yahoo(symbol: string, interval: Interval, rows: Candle[], now: string, zone = 'America/Sao_Paulo') {
  const originalFetch = globalThis.fetch, originalNow = Date.now, urls: string[] = [];
  Date.now = () => Date.parse(now);
  globalThis.fetch = async input => {
    const url = String(input); urls.push(url);
    const granularity = url.match(/interval=([^&]+)/)?.[1];
    return new Response(JSON.stringify({ chart: { result: [{
      meta: { dataGranularity: granularity, exchangeTimezoneName: zone, currency: 'BRL', longName: 'Petróleo Brasileiro S.A.' },
      timestamp: rows.map(c => c.time), indicators: { quote: [{ open: rows.map(c => c.open), high: rows.map(c => c.high), low: rows.map(c => c.low), close: rows.map(c => c.close), volume: rows.map(c => c.volume) }] },
    }] } }));
  };
  try { return { data: await getCandles('br', symbol, interval, 100), urls }; }
  finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
}

test('B3 tickers are normalized and mapped to Yahoo symbols', () => {
  assert.equal(normalizeSymbol('br', 'petr4'), 'PETR4');
  assert.equal(normalizeSymbol('br', 'BOVA11.SA'), 'BOVA11');
  assert.equal(normalizeSymbol('br', 'B3SA3'), 'B3SA3');
  assert.equal(normalizeSymbol('br', '^bvsp'), '^BVSP');
  assert.throws(() => normalizeSymbol('br', 'AAPL'));
  assert.equal(b3YahooSymbol('PETR4'), 'PETR4.SA');
  assert.equal(b3YahooSymbol('^BVSP'), '^BVSP');
});

test('the B3 session closes at 17:00 during US daylight time and at 18:00 otherwise', () => {
  assert.equal(b3CloseMinute(epoch('2026-10-15T12:00:00-03:00')), 17 * 60);
  assert.equal(b3CloseMinute(epoch('2026-11-18T12:00:00-03:00')), 18 * 60);
  assert.equal(b3CloseMinute(epoch('2026-01-15T12:00:00-03:00')), 18 * 60);
});

test('B3 daily and intraday bars close only after the session end plus a 15-minute delay', () => {
  const day = epoch('2026-11-18T10:00:00-03:00');
  assert.equal(stockBarClosed(day, '1d', 'br', epoch('2026-11-18T18:10:00-03:00')), false);
  assert.equal(stockBarClosed(day, '1d', 'br', epoch('2026-11-18T18:16:00-03:00')), true);
  const last = epoch('2026-11-18T17:00:00-03:00');
  assert.equal(stockBarClosed(last, '1h', 'br', epoch('2026-11-18T18:10:00-03:00')), false);
  assert.equal(stockBarClosed(last, '1h', 'br', epoch('2026-11-18T18:15:00-03:00')), true);
  assert.equal(candleAvailableAt({ time: day }, 'br', '1d'), epoch('2026-11-18T18:15:00-03:00'));
  assert.equal(higherInterval('br', '1h'), '4h');
});

test('B3 4-hour candles split the session at 14:00 and follow the seasonal close', () => {
  const rows = [...hours('2026-10-15', 10, 17), ...hours('2026-11-18', 10, 18)];
  const { candles, discardedBuckets } = aggregateB3FourHour(rows, epoch('2026-11-19T12:00:00-03:00'));
  assert.equal(discardedBuckets, 0);
  assert.deepEqual(candles.map(c => c.time), [epoch('2026-10-15T10:00:00-03:00'), epoch('2026-10-15T14:00:00-03:00'), epoch('2026-11-18T10:00:00-03:00'), epoch('2026-11-18T14:00:00-03:00')]);
  assert.deepEqual(candles.map(c => c.volume), [20000, 15000, 20000, 20000]);
  assert.ok(candles.every(c => c.closed));
  // A missing hour in a past bucket is skipped, never filled.
  const gap = aggregateB3FourHour(hours('2026-11-17', 10, 18).filter(c => c.time !== epoch('2026-11-17T11:00:00-03:00')), epoch('2026-11-19T12:00:00-03:00'));
  assert.equal(gap.candles.length, 1); assert.equal(gap.discardedBuckets, 1);
});

test('Yahoo B3 hourly data keeps regular-session slots only and is labelled for B3', async () => {
  const regular = [...hours('2026-11-17', 10, 18), ...hours('2026-11-18', 10, 18)];
  const extra = [bar('2026-11-18T18:00:00-03:00', 99), bar('2026-11-18T09:00:00-03:00', 98), bar('2026-11-14T12:00:00-03:00', 97)];
  const { data, urls } = await yahoo('PETR4', '1h', [...regular, ...extra].sort((a, b) => a.time - b.time), '2026-11-19T12:00:00-03:00');
  assert.ok(urls[0].includes('/chart/PETR4.SA?'));
  assert.equal(data.instrument.market, 'br'); assert.equal(data.instrument.currency, 'BRL');
  assert.deepEqual(data.candles.map(c => c.time), regular.map(c => c.time));
  assert.ok(data.candles.every(c => c.closed));
  assert.match(data.source, /^Yahoo Finance/);
});

test('a non-B3 Yahoo response is rejected', async () => {
  await assert.rejects(() => yahoo('VALE3', '1d', hours('2026-11-18', 10, 18), '2026-11-19T12:00:00-03:00', 'America/New_York'));
});

test('B3 4-hour requests aggregate Yahoo hourly bars', async () => {
  const days = ['2026-11-16', '2026-11-17', '2026-11-18'];
  const { data, urls } = await yahoo('ITUB4', '4h', days.flatMap(d => hours(d, 10, 18)), '2026-11-19T12:00:00-03:00');
  assert.ok(urls[0].includes('interval=60m'));
  assert.equal(data.interval, '4h'); assert.equal(data.candles.length, 6);
  assert.ok(data.candles.every(c => c.closed));
});

test('B3 popular symbols are searchable offline and the analysis runs on B3 data', async () => {
  const result = await searchInstruments('br', '');
  assert.ok(result.results.some(r => r.symbol === 'PETR4'));
  const daily = Array.from({ length: 300 }, (_, i) => {
    const t = epoch('2025-01-02T10:00:00-03:00') + i * 86400, p = 30 + 3 * Math.sin(i / 9) + 1.5 * Math.sin(i / 3);
    return { time: t, open: p - 0.1, high: p + 0.6, low: p - 0.6, close: p + 0.1, volume: 1000, closed: true };
  });
  const analysis = analyze(daily, { context: { market: 'br', interval: '1d', symbol: 'PETR4', source: 'Yahoo Finance public feed · B3', adjustment: '来源原始OHLC；拆股或其他公司行动可能影响历史比较' } });
  assert.ok(analysis.strokes.length > 3);
  assert.equal(analysis.tradePlans.length, 2);
});
