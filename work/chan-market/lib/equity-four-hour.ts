// Modificado para trend-workbench-br: agregação de 4 horas da B3.
import type { Candle } from './market-types';
import { B3_OPEN_MINUTE, B3_ZONE, b3CloseMinute } from './b3-session.ts';

export interface EquityFourHourOptions {
  market: 'cn' | 'us';
  sourceInterval: '30m' | '1h';
  timestamp: 'start' | 'end';
  now?: number;
}
export interface EquityFourHourResult {
  candles: Candle[];
  discardedBuckets: number;
  excludedRows: number;
}

const clocks = {
  cn: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' }),
  us: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' }),
};
function local(time: number, market: 'cn' | 'us') {
  const parts = Object.fromEntries(clocks[market].formatToParts(new Date(time * 1000)).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute), second: Number(parts.second), weekday: parts.weekday };
}

/** Build exchange-session candles, never groups of arbitrary consecutive rows.
 * Missing historical slots are omitted, not filled or declared closed. The US
 * regular-session tail is 2.5 hours and remains a distinct candle. */
export function aggregateEquityFourHour(rows: Candle[], options: EquityFourHourOptions): EquityFourHourResult {
  const { market, sourceInterval, timestamp } = options;
  const now = options.now ?? Date.now() / 1000;
  const current = local(now, market);
  const step = sourceInterval === '1h' ? 60 : 30;
  const windows = market === 'cn' ? [{ start: 570, end: 900 }] : [{ start: 570, end: 810 }, { start: 810, end: 960 }];
  const slots = windows.map(window => {
    const result: { start: number; end: number }[] = [];
    for (let start = window.start; start < window.end; start += step) {
      if (market === 'cn' && start === 690) start = 780;
      result.push({ start, end: Math.min(start + step, window.end, market === 'cn' && start < 690 ? 690 : Infinity) });
    }
    return result;
  });
  const days = new Map<string, { midnight: number; buckets: Map<number, Candle>[] }>();
  let excludedRows = 0, discardedBuckets = 0;
  // Last occurrence wins, consistent with the provider adapter's deduplication.
  const unique = [...new Map(rows.map(row => [row.time, row])).values()].sort((a, b) => a.time - b.time);
  for (const row of unique) {
    if (![row.time, row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite) || row.time <= 0 || row.low <= 0 || row.volume < 0 || row.high < Math.max(row.open, row.close) || row.low > Math.min(row.open, row.close)) { excludedRows++; continue; }
    const clock = local(row.time, market);
    if (clock.second !== 0 || row.time % 60 !== 0 || ['Sat', 'Sun'].includes(clock.weekday) || clock.date > current.date) { excludedRows++; continue; }
    let bucket = -1, index = -1;
    for (let i = 0; i < slots.length; i++) {
      const candidate = slots[i].findIndex(slot => slot[timestamp] === clock.minute);
      if (candidate >= 0) { bucket = i; index = candidate; break; }
    }
    // This also rejects Yahoo's appended instantaneous quote and extended hours.
    if (bucket < 0) { excludedRows++; continue; }
    if (row.time + (slots[bucket][index].start - clock.minute) * 60 > now) { excludedRows++; continue; }
    let day = days.get(clock.date);
    if (!day) {
      // Derive midnight from an observed local timestamp, preserving NY DST.
      day = { midnight: row.time - clock.minute * 60, buckets: windows.map(() => new Map()) };
      days.set(clock.date, day);
    }
    day.buckets[bucket].set(index, row);
  }
  const candles: Candle[] = [];
  for (const [date, day] of days) {
    for (let bucket = 0; bucket < windows.length; bucket++) {
      const source = day.buckets[bucket];
      if (!source.size) continue;
      const parts = [...source.entries()].sort(([a], [b]) => a - b);
      const prefix = parts.every(([index], i) => index === i);
      const complete = prefix && parts.length === slots[bucket].length;
      // On a US half-day the 12:30 hourly bar may end at 13:00. A later
      // afternoon bar is required to prove that it actually covered to 13:30.
      const hourlyFirstProven = market !== 'us' || sourceInterval !== '1h' || bucket !== 0 || day.buckets[1].size > 0;
      if (!prefix || ((!complete || !hourlyFirstProven) && date !== current.date)) { discardedBuckets++; continue; }
      const values = parts.map(([, row]) => row);
      const end = day.midnight + windows[bucket].end * 60;
      const closed = complete && hourlyFirstProven && values.every(row => row.closed === true) && now >= end + (market === 'us' ? 900 : 120);
      candles.push({
        time: day.midnight + windows[bucket].start * 60,
        open: values[0].open,
        high: Math.max(...values.map(row => row.high)),
        low: Math.min(...values.map(row => row.low)),
        close: values[values.length - 1].close,
        volume: values.reduce((sum, row) => sum + row.volume, 0),
        closed,
      });
    }
  }
  return { candles, discardedBuckets, excludedRows };
}

const b3Clock = new Intl.DateTimeFormat('en-CA', { timeZone: B3_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' });
const B3_SPLIT_MINUTE = 14 * 60;

/** B3 4-hour candles from start-stamped 1-hour bars: 10:00–14:00 and
 * 14:00–close (17:00 or 18:00). A bucket must contain every hourly slot, in
 * order; incomplete historical buckets are skipped, never filled. */
export function aggregateB3FourHour(rows: Candle[], now = Date.now() / 1000): EquityFourHourResult {
  const days = new Map<string, { midnight: number; close: number; buckets: [Map<number, Candle>, Map<number, Candle>] }>();
  let excludedRows = 0, discardedBuckets = 0;
  const parts = (time: number) => {
    const p = Object.fromEntries(b3Clock.formatToParts(new Date(time * 1000)).map(x => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute), second: Number(p.second), weekday: p.weekday };
  };
  const today = parts(now).date;
  const unique = [...new Map(rows.map(row => [row.time, row])).values()].sort((a, b) => a.time - b.time);
  for (const row of unique) {
    if (![row.time, row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite) || row.low <= 0 || row.high < Math.max(row.open, row.close) || row.low > Math.min(row.open, row.close)) { excludedRows++; continue; }
    const clock = parts(row.time), close = b3CloseMinute(row.time);
    if (clock.second !== 0 || ['Sat', 'Sun'].includes(clock.weekday) || clock.minute < B3_OPEN_MINUTE || clock.minute >= close || (clock.minute - B3_OPEN_MINUTE) % 60 !== 0 || row.time > now) { excludedRows++; continue; }
    let day = days.get(clock.date);
    if (!day) { day = { midnight: row.time - clock.minute * 60, close, buckets: [new Map(), new Map()] }; days.set(clock.date, day); }
    const bucket = clock.minute < B3_SPLIT_MINUTE ? 0 : 1;
    day.buckets[bucket].set((clock.minute - (bucket ? B3_SPLIT_MINUTE : B3_OPEN_MINUTE)) / 60, row);
  }
  const candles: Candle[] = [];
  for (const [date, day] of days) {
    const windows = [[B3_OPEN_MINUTE, B3_SPLIT_MINUTE], [B3_SPLIT_MINUTE, day.close]];
    for (let bucket = 0; bucket < 2; bucket++) {
      const source = day.buckets[bucket];
      if (!source.size) continue;
      const entries = [...source.entries()].sort(([a], [b]) => a - b);
      const expected = (windows[bucket][1] - windows[bucket][0]) / 60;
      const prefix = entries.every(([index], i) => index === i);
      const complete = prefix && entries.length === expected;
      if (!prefix || (!complete && date !== today)) { discardedBuckets++; continue; }
      const values = entries.map(([, row]) => row);
      const end = day.midnight + windows[bucket][1] * 60;
      candles.push({
        time: day.midnight + windows[bucket][0] * 60,
        open: values[0].open,
        high: Math.max(...values.map(row => row.high)),
        low: Math.min(...values.map(row => row.low)),
        close: values[values.length - 1].close,
        volume: values.reduce((sum, row) => sum + row.volume, 0),
        closed: complete && values.every(row => row.closed === true) && now >= end + 900,
      });
    }
  }
  return { candles, discardedBuckets, excludedRows };
}
