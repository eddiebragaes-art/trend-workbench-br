// Adicionado em trend-workbench-br: índices e commodities (futuros CME/COMEX/NYMEX via Yahoo).
// CME Globex trades Sunday 18:00 to Friday 17:00 New York time, with a daily
// pause from 17:00 to 18:00. The evening session belongs to the next trading
// date, so the "trading clock" here is the New York clock shifted by six hours:
// 18:00 New York becomes 00:00 of the trading date and 17:00 becomes minute 1380.
// Exchange holidays and early closes are not modelled; missing bars are not filled.
import type { Candle, Interval } from './market-types';

export const FUT_ZONE = 'America/New_York';
export const FUT_SHIFT_SECONDS = 6 * 3600;
export const FUT_CLOSE_MINUTE = 23 * 60;
/** Yahoo's public futures quotes are typically delayed by about ten minutes. */
export const FUT_DELAY_SECONDS = 600;

export interface FuturesContract { symbol: string; yahoo: string; name: string; exchange: string; currency: string }
export const FUTURES: FuturesContract[] = [
  { symbol: 'NAS100', yahoo: 'NQ=F', name: 'Nasdaq 100 (E-mini futures)', exchange: 'CME', currency: 'USD' },
  { symbol: 'US30', yahoo: 'YM=F', name: 'Dow Jones 30 (E-mini futures)', exchange: 'CBOT', currency: 'USD' },
  { symbol: 'US500', yahoo: 'ES=F', name: 'S&P 500 (E-mini futures)', exchange: 'CME', currency: 'USD' },
  { symbol: 'XAUUSD', yahoo: 'GC=F', name: 'Gold (COMEX futures)', exchange: 'COMEX', currency: 'USD' },
  { symbol: 'XAGUSD', yahoo: 'SI=F', name: 'Silver (COMEX futures)', exchange: 'COMEX', currency: 'USD' },
  { symbol: 'USOIL', yahoo: 'CL=F', name: 'WTI crude oil (NYMEX futures)', exchange: 'NYMEX', currency: 'USD' },
  { symbol: 'UKOIL', yahoo: 'BZ=F', name: 'Brent crude oil (NYMEX futures)', exchange: 'NYMEX', currency: 'USD' },
];
const ALIASES: Record<string, string> = { NASDAQ: 'NAS100', NAS: 'NAS100', NDX: 'NAS100', USTEC: 'NAS100', US100: 'NAS100', DJI: 'US30', DOW: 'US30', SPX: 'US500', SPX500: 'US500', SP500: 'US500', GOLD: 'XAUUSD', OURO: 'XAUUSD', SILVER: 'XAGUSD', PRATA: 'XAGUSD', WTI: 'USOIL', OIL: 'USOIL', PETROLEO: 'USOIL', BRENT: 'UKOIL' };

/** Canonical display symbol, or null when it is not a supported contract. */
export function futuresSymbol(input: string): string | null {
  const value = input.trim().toUpperCase().replace(/[\s/]/g, '');
  const found = FUTURES.find(f => f.symbol === value || f.yahoo === value);
  if (found) return found.symbol;
  return ALIASES[value] ?? null;
}
export function futuresContract(symbol: string): FuturesContract | undefined {
  return FUTURES.find(f => f.symbol === symbol);
}

const nyClock = new Intl.DateTimeFormat('en-CA', { timeZone: FUT_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** Trading date and minutes since the 18:00 New York session start. */
export function futuresClock(time: number): { date: string; minute: number; weekday: number } {
  const p = Object.fromEntries(nyClock.formatToParts(new Date((time + FUT_SHIFT_SECONDS) * 1000)).map(v => [v.type, v.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, minute: Number(p.hour) * 60 + Number(p.minute), weekday: new Date(`${date}T00:00:00Z`).getUTCDay() };
}
/** True during the Globex session (Monday to Friday trading dates, before 17:00 New York). */
export function futuresOpen(time: number): boolean {
  const c = futuresClock(time);
  return c.weekday >= 1 && c.weekday <= 5 && c.minute < FUT_CLOSE_MINUTE;
}
const SPAN: Record<Exclude<Interval, '1M' | '1d' | '1w'>, number> = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400 };

/** Epoch when a start-stamped bar ends; calendar bars end at the session close. */
export function futuresBarEnd(time: number, interval: Interval): number {
  const c = futuresClock(time), sessionEnd = time + (FUT_CLOSE_MINUTE - c.minute) * 60;
  if (interval === '1d') return sessionEnd;
  if (interval === '1w') return sessionEnd + ((5 - c.weekday + 7) % 7) * 86400;
  if (interval === '1M') {
    const d = new Date(`${c.date}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1, 1);
    // First trading-clock instant of the next month (18:00 New York the day before).
    // One extra hour keeps the estimate conservative across a DST change.
    return time - c.minute * 60 + Math.round((d.getTime() - Date.parse(`${c.date}T00:00:00Z`)) / 1000) + 3600;
  }
  if (interval === '4h') {
    const bucket = Math.floor(c.minute / 240) * 240;
    return time + (Math.min(bucket + 240, FUT_CLOSE_MINUTE) - c.minute) * 60;
  }
  return Math.min(time + SPAN[interval], sessionEnd);
}
export function futuresBarClosed(time: number, interval: Interval, now = Date.now() / 1000): boolean {
  if (!Number.isFinite(time) || !Number.isFinite(now)) return false;
  return now >= futuresBarEnd(time, interval) + FUT_DELAY_SECONDS;
}

/** Hourly bars into session-aligned 4-hour bars: 18:00, 22:00, 02:00, 06:00,
 * 10:00 and 14:00–17:00 New York. A bucket with missing hours (holidays,
 * early closes) is kept only if it is the latest bucket and still forming. */
export function aggregateFuturesFourHour(rows: Candle[], now = Date.now() / 1000): { candles: Candle[]; discardedBuckets: number; excludedRows: number } {
  const buckets = new Map<number, { end: number; expected: number; rows: Candle[] }>();
  let excludedRows = 0, discardedBuckets = 0;
  const unique = [...new Map(rows.map(r => [r.time, r])).values()].sort((a, b) => a.time - b.time);
  for (const row of unique) {
    const c = futuresClock(row.time);
    if (![row.time, row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite) || row.low <= 0 || row.time % 3600 !== 0 || c.weekday === 0 || c.weekday === 6 || c.minute >= FUT_CLOSE_MINUTE || row.time > now) { excludedRows++; continue; }
    const start = row.time - (c.minute % 240) * 60, bucketMinute = c.minute - (c.minute % 240);
    const span = Math.min(240, FUT_CLOSE_MINUTE - bucketMinute);
    const bucket = buckets.get(start) ?? { end: start + span * 60, expected: span / 60, rows: [] };
    bucket.rows.push(row);
    buckets.set(start, bucket);
  }
  const candles: Candle[] = [];
  const starts = [...buckets.keys()].sort((a, b) => a - b), latest = starts.at(-1);
  for (const start of starts) {
    const { end, expected, rows: values } = buckets.get(start)!;
    const complete = values.length === expected && values.every((v, i) => v.time === start + i * 3600);
    const forming = start === latest && now < end + FUT_DELAY_SECONDS;
    if (!complete && !forming) { discardedBuckets++; continue; }
    candles.push({
      time: start,
      open: values[0].open,
      high: Math.max(...values.map(v => v.high)),
      low: Math.min(...values.map(v => v.low)),
      close: values[values.length - 1].close,
      volume: values.reduce((s, v) => s + v.volume, 0),
      closed: complete && values.every(v => v.closed === true) && now >= end + FUT_DELAY_SECONDS,
    });
  }
  return { candles, discardedBuckets, excludedRows };
}
