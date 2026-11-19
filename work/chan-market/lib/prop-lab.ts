// Adicionado em trend-workbench-br: laboratório de mesa proprietária.
// 1) Backtest of Chan signals without look-ahead: the structure is recomputed
//    on every prefix and a trade starts at the close of the bar where a signal
//    first appears. 2) Monte Carlo of a prop-firm evaluation using the backtest
//    R outcomes. 3) Grid search for the risk/rule/setup with the best EV per ticket.
import type { Candle } from './market-types';
import { structureSignals } from './chan.ts';

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

export interface BacktestOptions { targetR: number; maxHoldBars: number; stopBufferAtr: number; maxRiskAtr: number; warmup: number }
export const DEFAULT_BACKTEST: BacktestOptions = { targetR: 2, maxHoldBars: 48, stopBufferAtr: 0.1, maxRiskAtr: 4, warmup: 60 };
export interface BacktestTrade { symbol: string; setup: SetupId; level: SignalLevel; side: 'long' | 'short'; signalTime: number; entryTime: number; entry: number; stop: number; target: number; r: number; exit: 'target' | 'stop' | 'time' | 'open'; bars: number }

/** Trades for one instrument and one signal level. */
export function backtestSignals(candles: Candle[], symbol: string, level: SignalLevel, options: Partial<BacktestOptions> = {}): BacktestTrade[] {
  const o = { ...DEFAULT_BACKTEST, ...options };
  const bars = candles.filter(c => c.closed !== false);
  const seen = new Set<string>(), trades: BacktestTrade[] = [];
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
      const target = buy ? entry + o.targetR * risk : entry - o.targetR * risk;
      let r = 0, exit: BacktestTrade['exit'] = 'open', held = 0;
      for (let j = k + 1; j < bars.length && held < o.maxHoldBars; j++) {
        const b = bars[j]; held++;
        const hitStop = buy ? b.low <= stop : b.high >= stop, hitTarget = buy ? b.high >= target : b.low <= target;
        // Same-bar stop and target: the order is unknown, so count the stop.
        if (hitStop) { r = -1; exit = 'stop'; break; }
        if (hitTarget) { r = o.targetR; exit = 'target'; break; }
        if (held === o.maxHoldBars) { r = (buy ? b.close - entry : entry - b.close) / risk; exit = 'time'; }
      }
      if (exit === 'open') continue; // not enough future bars yet
      trades.push({ symbol, setup, level, side: s.side, signalTime: s.time, entryTime: bars[k].time, entry, stop, target, r, exit, bars: held });
    }
  }
  return trades;
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
