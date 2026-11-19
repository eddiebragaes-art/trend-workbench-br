// Adicionado em trend-workbench-br: laboratório de mesa proprietária.
// 1) Backtest of Chan signals without look-ahead: the structure is recomputed
//    on every prefix and a trade starts at the close of the bar where a signal
//    first appears. 2) Monte Carlo of a prop-firm evaluation using the backtest
//    R outcomes. 3) Grid search for the risk/rule/setup with the best EV per ticket.
import type { Candle, Interval } from './market-types';
import { structureBias, structureSignals } from './chan.ts';

export type SetupId = 'first' | 'second' | 'third' | 'weakening';
export const SETUPS: SetupId[] = ['first', 'second', 'third', 'weakening'];
export type SignalLevel = 'segment' | 'stroke';
export function setupOf(type: string): SetupId | null {
  if (type.startsWith('first-')) return 'first';
  if (type.startsWith('second-')) return 'second';
  if (type.startsWith('third-')) return 'third';
  if (type === 'range-divergence-candidate') return 'weakening';
  return null;
}

export interface BacktestOptions { targetR: number; maxHoldBars: number; stopBufferAtr: number; maxRiskAtr: number; warmup: number; barSeconds?: number; higherSeconds?: number }
export const DEFAULT_BACKTEST: BacktestOptions = { targetR: 2, maxHoldBars: 48, stopBufferAtr: 0.1, maxRiskAtr: 4, warmup: 60 };
export type Exit = 'target' | 'stop' | 'breakeven' | 'time' | 'open';
export interface BacktestTrade { symbol: string; setup: SetupId; level: SignalLevel; side: 'long' | 'short'; signalTime: number; entryTime: number; entry: number; stop: number; target: number; r: number; exit: Exit; bars: number }
/** A signal entry before the exit rules are applied: the bars after the entry
 * are kept so that every target / break-even variant replays the same trade. */
export interface Candidate { symbol: string; setup: SetupId; level: SignalLevel; side: 'long' | 'short'; signalTime: number; entryTime: number; entry: number; stop: number; path: [number, number, number][]; complete: boolean; higher: 'long' | 'short' | 'neutral' | null }

/** Seconds per bar and of the next timeframe used for the confluence filter. */
export const HIGHER_OF: Partial<Record<Interval, { bar: number; higher: number }>> = {
  '1m': { bar: 60, higher: 300 }, '5m': { bar: 300, higher: 900 }, '15m': { bar: 900, higher: 3600 }, '30m': { bar: 1800, higher: 14400 },
  '1h': { bar: 3600, higher: 14400 }, '4h': { bar: 14400, higher: 86400 }, '1d': { bar: 86400, higher: 604800 }
};
const MIN_HIGHER_BARS = 30;
/** Buckets bars into a longer timeframe; only buckets that ended by `until`. */
export function aggregateCandles(bars: Candle[], seconds: number, until: number): Candle[] {
  const out: Candle[] = [];
  for (const b of bars) {
    const start = Math.floor(b.time / seconds) * seconds;
    if (start + seconds > until) break;
    const last = out[out.length - 1];
    if (last && last.time === start) { last.high = Math.max(last.high, b.high); last.low = Math.min(last.low, b.low); last.close = b.close; last.volume += b.volume; }
    else out.push({ time: start, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, closed: true });
  }
  return out;
}

/** Signal entries for one instrument and one signal level, without look-ahead:
 * the structure is recomputed on every prefix and the entry is the close of the
 * bar where the signal first appears. */
export function backtestCandidates(candles: Candle[], symbol: string, level: SignalLevel, options: Partial<BacktestOptions> = {}): Candidate[] {
  const o = { ...DEFAULT_BACKTEST, ...options };
  const bars = candles.filter(c => c.closed !== false);
  const seen = new Set<string>(), out: Candidate[] = [], bias = new Map<number, 'long' | 'short' | 'neutral'>();
  const higherAt = (k: number) => {
    if (!o.barSeconds || !o.higherSeconds) return null;
    const higher = aggregateCandles(bars.slice(0, k + 1), o.higherSeconds, bars[k].time + o.barSeconds);
    if (higher.length < MIN_HIGHER_BARS) return null;
    if (!bias.has(higher.length)) bias.set(higher.length, structureBias(higher));
    return bias.get(higher.length)!;
  };
  for (let k = o.warmup; k < bars.length - 1; k++) {
    const { signals, atr } = structureSignals(bars.slice(0, k + 1), level);
    for (const s of signals) {
      const setup = setupOf(s.type);
      const key = `${s.type}:${s.time}`;
      if (!setup || seen.has(key)) continue;
      seen.add(key);
      const buy = s.side === 'long', entry = bars[k].close;
      const window = bars.slice(Math.max(0, bars.findIndex(b => b.time === s.time)), k + 1);
      const extreme = buy ? Math.min(s.price, ...window.map(b => b.low)) : Math.max(s.price, ...window.map(b => b.high));
      const stop = buy ? extreme - o.stopBufferAtr * atr : extreme + o.stopBufferAtr * atr;
      const risk = buy ? entry - stop : stop - entry;
      if (!(risk > 0) || (atr > 0 && risk > o.maxRiskAtr * atr)) continue;
      const path = bars.slice(k + 1, k + 1 + o.maxHoldBars).map(b => [b.high, b.low, b.close] as [number, number, number]);
      out.push({ symbol, setup, level, side: s.side, signalTime: s.time, entryTime: bars[k].time, entry, stop, path, complete: path.length === o.maxHoldBars, higher: higherAt(k) });
    }
  }
  return out;
}

/** Exit rules: fixed target in R and, optionally, the stop moves to the entry
 * after 1R (Target 1). The new stop applies from the next bar. A bar that
 * touches stop and target counts as the stop. null = not resolved yet. */
export function resolveCandidate(c: Candidate, targetR: number, breakEven = false): { r: number; exit: Exit; bars: number; target: number } | null {
  const buy = c.side === 'long', risk = buy ? c.entry - c.stop : c.stop - c.entry;
  const target = buy ? c.entry + targetR * risk : c.entry - targetR * risk, one = buy ? c.entry + risk : c.entry - risk;
  let stop = c.stop, moved = false;
  for (let j = 0; j < c.path.length; j++) {
    const [high, low, close] = c.path[j];
    if (buy ? low <= stop : high >= stop) return moved ? { r: 0, exit: 'breakeven', bars: j + 1, target } : { r: -1, exit: 'stop', bars: j + 1, target };
    if (buy ? high >= target : low <= target) return { r: targetR, exit: 'target', bars: j + 1, target };
    if (breakEven && !moved && (buy ? high >= one : low <= one)) { moved = true; stop = c.entry; }
    if (j === c.path.length - 1 && c.complete) return { r: (buy ? close - c.entry : c.entry - close) / risk, exit: 'time', bars: j + 1, target };
  }
  return null;
}

export type HigherFilter = 'off' | 'not-against' | 'aligned';
export type SessionFilter = 'all' | 'london' | 'ny' | 'london-ny';
export interface Variant { higher: HigherFilter; session: SessionFilter; targetR: number; breakEven: boolean }
export const BASELINE: Variant = { higher: 'off', session: 'all', targetR: 2, breakEven: false };
export const HIGHER_FILTERS: HigherFilter[] = ['off', 'not-against', 'aligned'];
export const SESSION_FILTERS: SessionFilter[] = ['all', 'london', 'ny', 'london-ny'];
export const TARGETS = [1.5, 2, 2.5, 3];
export const variantKey = (v: Variant) => `${v.higher}|${v.session}|${v.targetR}|${v.breakEven ? 'be' : 'no'}`;

const hourFormat = new Map<string, Intl.DateTimeFormat>();
function hourIn(zone: string, seconds: number) {
  if (!hourFormat.has(zone)) hourFormat.set(zone, new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  const [h, m] = hourFormat.get(zone)!.format(new Date(seconds * 1000)).split(':').map(Number);
  return h + m / 60;
}
/** London 08:00–17:00 London time, New York 08:00–17:00 New York time, at the entry. */
export function inSession(seconds: number, session: SessionFilter): boolean {
  if (session === 'all') return true;
  const london = () => { const h = hourIn('Europe/London', seconds); return h >= 8 && h < 17; };
  const ny = () => { const h = hourIn('America/New_York', seconds); return h >= 8 && h < 17; };
  return session === 'london' ? london() : session === 'ny' ? ny() : london() || ny();
}
export function passesFilters(c: Candidate, v: Variant, barSeconds = 0): boolean {
  if (v.higher === 'aligned' && c.higher !== c.side) return false;
  if (v.higher === 'not-against' && (c.higher === null || (c.higher !== 'neutral' && c.higher !== c.side))) return false;
  return inSession(c.entryTime + barSeconds, v.session);
}
export function variantTrades(candidates: Candidate[], v: Variant, barSeconds = 0): BacktestTrade[] {
  const out: BacktestTrade[] = [];
  for (const c of candidates) {
    if (!passesFilters(c, v, barSeconds)) continue;
    const r = resolveCandidate(c, v.targetR, v.breakEven);
    if (r) out.push({ symbol: c.symbol, setup: c.setup, level: c.level, side: c.side, signalTime: c.signalTime, entryTime: c.entryTime, entry: c.entry, stop: c.stop, target: r.target, r: r.r, exit: r.exit, bars: r.bars });
  }
  return out;
}

/** Trades for one instrument and one signal level (no filters). */
export function backtestSignals(candles: Candle[], symbol: string, level: SignalLevel, options: Partial<BacktestOptions> = {}): BacktestTrade[] {
  const o = { ...DEFAULT_BACKTEST, ...options };
  return variantTrades(backtestCandidates(candles, symbol, level, o), { ...BASELINE, targetR: o.targetR });
}

export interface SetupStats { setup: SetupId | 'all'; trades: number; winRate: number; avgR: number; profitFactor: number | null; maxLosingStreak: number; tradesPerDay: number }
export function setupStats(trades: BacktestTrade[], setup: SetupId | 'all', days: number): SetupStats {
  const rows = (setup === 'all' ? trades : trades.filter(t => t.setup === setup)).slice().sort((a, b) => a.entryTime - b.entryTime);
  const wins = rows.filter(t => t.r > 0), gain = wins.reduce((s, t) => s + t.r, 0), loss = -rows.filter(t => t.r <= 0).reduce((s, t) => s + t.r, 0);
  let streak = 0, worst = 0;
  for (const t of rows) { streak = t.r <= 0 ? streak + 1 : 0; worst = Math.max(worst, streak); }
  return { setup, trades: rows.length, winRate: rows.length ? wins.length / rows.length * 100 : 0, avgR: rows.length ? rows.reduce((s, t) => s + t.r, 0) / rows.length : 0, profitFactor: loss > 0 ? gain / loss : null, maxLosingStreak: worst, tradesPerDay: days > 0 ? rows.length / days : 0 };
}

export interface EvalRules { dailyLoss: number; maxDrawdown: number; profitTarget: number; dailyLossMode: 'fail' | 'pause'; maxDays: number }
export const LUCID_50K: EvalRules = { dailyLoss: 1000, maxDrawdown: 2000, profitTarget: 3000, dailyLossMode: 'fail', maxDays: 60 };
export interface SimOptions { risk: number; stopAfterLosses: number; tradesPerDay: number; sims: number; ticket: number; payout: number; seed: number }
export interface SimResult { risk: number; stopAfterLosses: number; pass: number; fail: number; open: number; meanDays: number | null; ev: number }

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function poisson(lambda: number, random: () => number): number {
  if (lambda <= 0) return 0;
  const limit = Math.exp(-lambda); let k = 0, p = 1;
  do { k++; p *= random(); } while (p > limit && k < 100);
  return k - 1;
}

/** Bootstraps trade outcomes (in R) into evaluation attempts. EV per ticket =
 * P(pass) × average payout − ticket. Attempts still open at maxDays earn nothing. */
export function simulateEvaluation(rs: number[], rules: EvalRules, o: SimOptions): SimResult {
  const random = rng(o.seed);
  let pass = 0, fail = 0, days = 0;
  for (let sim = 0; sim < o.sims && rs.length; sim++) {
    let balance = 0, done = false;
    for (let day = 1; day <= rules.maxDays && !done; day++) {
      let dayPnl = 0, losses = 0;
      const n = poisson(o.tradesPerDay, random);
      for (let i = 0; i < n; i++) {
        if (o.stopAfterLosses > 0 && losses >= o.stopAfterLosses) break;
        const pnl = rs[Math.floor(random() * rs.length)] * o.risk;
        balance += pnl; dayPnl += pnl; if (pnl < 0) losses++;
        if (balance <= -rules.maxDrawdown) { fail++; done = true; break; }
        if (dayPnl <= -rules.dailyLoss) { if (rules.dailyLossMode === 'fail') { fail++; done = true; } break; }
        if (balance >= rules.profitTarget) { pass++; days += day; done = true; break; }
      }
    }
  }
  const sims = rs.length ? o.sims : 1;
  return { risk: o.risk, stopAfterLosses: o.stopAfterLosses, pass: pass / sims, fail: fail / sims, open: (sims - pass - fail) / sims, meanDays: pass ? days / pass : null, ev: pass / sims * o.payout - o.ticket };
}

export interface LabRecommendation { setup: SetupId | 'all'; result: SimResult; stats: SetupStats; smallSample: boolean }
export const RISKS = [250, 375, 500, 625, 750, 1000];
export const STOP_AFTER = [0, 1, 2, 3];
export const MIN_TRADES = 20;

export function runGrid(trades: BacktestTrade[], days: number, rules: EvalRules, base: Omit<SimOptions, 'risk' | 'stopAfterLosses' | 'tradesPerDay'> & { tradesPerDay?: number }) {
  const groups: (SetupId | 'all')[] = ['all', ...SETUPS];
  const out = groups.map(setup => {
    const stats = setupStats(trades, setup, days);
    const rs = (setup === 'all' ? trades : trades.filter(t => t.setup === setup)).map(t => t.r);
    const tradesPerDay = base.tradesPerDay ?? stats.tradesPerDay;
    const results = RISKS.flatMap(risk => STOP_AFTER.map(stopAfterLosses => simulateEvaluation(rs, rules, { ...base, risk, stopAfterLosses, tradesPerDay })));
    return { setup, stats, results };
  });
  const candidates = out.filter(g => g.stats.trades > 0).flatMap(g => g.results.map(result => ({ setup: g.setup, result, stats: g.stats, smallSample: g.stats.trades < MIN_TRADES })));
  const ranked = candidates.sort((a, b) => Number(a.smallSample) - Number(b.smallSample) || b.result.ev - a.result.ev);
  return { groups: out, recommendation: (ranked[0] ?? null) as LabRecommendation | null };
}

/** Calendar days covered, used to turn trade counts into a daily rate. */
export function spanDays(candles: Candle[]): number {
  if (candles.length < 2) return 0;
  return Math.max(1, (candles[candles.length - 1].time - candles[0].time) / 86400);
}

export interface VariantRow { variant: Variant; key: string; stats: SetupStats; inSampleR: number | null; inSampleTrades: number; outSampleR: number | null; outSampleTrades: number }
/** Every combination of filters against the baseline (2R, no filters). To limit
 * overfitting the best variant is chosen on the first 70% of the history (by
 * entry time) and its average R is then reported on the last 30%. */
export function compareVariants(candidates: Candidate[], setup: SetupId | 'all', days: number, barSeconds = 0) {
  const scoped = setup === 'all' ? candidates : candidates.filter(c => c.setup === setup);
  const times = scoped.map(c => c.entryTime).sort((a, b) => a - b);
  const cutoff = times.length ? times[Math.floor(times.length * 0.7)] ?? Infinity : Infinity;
  const mean = (x: BacktestTrade[]) => x.length ? x.reduce((s, t) => s + t.r, 0) / x.length : null;
  const rows: VariantRow[] = [];
  for (const higher of HIGHER_FILTERS) for (const session of SESSION_FILTERS) for (const targetR of TARGETS) for (const breakEven of [false, true]) {
    const variant = { higher, session, targetR, breakEven }, trades = variantTrades(scoped, variant, barSeconds);
    const early = trades.filter(t => t.entryTime < cutoff), late = trades.filter(t => t.entryTime >= cutoff);
    rows.push({ variant, key: variantKey(variant), stats: setupStats(trades, setup, days), inSampleR: mean(early), inSampleTrades: early.length, outSampleR: mean(late), outSampleTrades: late.length });
  }
  const baseline = rows.find(r => r.key === variantKey(BASELINE))!;
  const eligible = rows.filter(r => r.stats.trades >= MIN_TRADES && r.inSampleTrades >= 10 && r.outSampleTrades >= 5);
  const best = eligible.slice().sort((a, b) => (b.inSampleR ?? -Infinity) - (a.inSampleR ?? -Infinity))[0] ?? null;
  // Use the chosen variant only when it also holds up on the unseen 30%.
  const holds = !!best && best.outSampleR !== null && best.outSampleR > 0 && best.outSampleR > (baseline.outSampleR ?? -Infinity);
  const ranked = rows.filter(r => r.stats.trades > 0).sort((a, b) => b.stats.avgR - a.stats.avgR);
  return { rows, ranked, baseline, best, holds, recommended: holds ? best! : baseline };
}
