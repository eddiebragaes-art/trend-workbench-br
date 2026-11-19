// Adicionado em trend-workbench-br: conta virtual (paper trading) com regras de mesa proprietária.
// The account is replayed deterministically from the forecast journal: every
// recorded outlook whose entry condition was met becomes a virtual trade. No
// real orders are sent. Fills use the journal's closed-bar event prices.
import type { ForecastRecord } from './forecast-journal.ts';

export interface PropRules {
  /** Firm profile this rule set started from; values stay editable. */
  profile: string;
  initialBalance: number;
  /** Fixed risk per trade in account currency (distance to the stop × size). */
  riskPerTrade: number;
  /** Maximum realized loss in one trading day (resets 17:00 New York). */
  dailyLoss: number;
  /** Maximum drawdown in account currency. */
  maxDrawdown: number;
  /** static: floor = initial − maxDrawdown; trailing: follows the balance peak up to the initial balance. */
  drawdownMode: 'static' | 'trailing';
  profitTarget: number;
  maxOpenTrades: number;
  /** Close half the position at take-profit 1, the rest at take-profit 2 or the stop. */
  partialAtTarget1: boolean;
  feeBps: number;
  slippageBps: number;
}
export interface PropProfile { id: string; name: string; rules: Omit<PropRules, 'profile'> }
/** Starting points only. Firms change their rules; check the current terms. */
export const PROP_PROFILES: PropProfile[] = [
  { id: 'lucid-50k', name: 'Lucid 50K', rules: { initialBalance: 50000, riskPerTrade: 500, dailyLoss: 1000, maxDrawdown: 2000, drawdownMode: 'static', profitTarget: 3000, maxOpenTrades: 3, partialAtTarget1: true, feeBps: 0, slippageBps: 0 } },
  { id: 'custom', name: 'Custom', rules: { initialBalance: 50000, riskPerTrade: 250, dailyLoss: 2500, maxDrawdown: 5000, drawdownMode: 'static', profitTarget: 5000, maxOpenTrades: 5, partialAtTarget1: true, feeBps: 0, slippageBps: 0 } },
];
export const DEFAULT_RULES: PropRules = { profile: 'lucid-50k', ...PROP_PROFILES[0].rules };
export interface PaperAccountSettings { version: 1; startedAt: number; rules: PropRules }
export const PAPER_KEY = 'trend-paper-account-v1';

export interface PaperFill { at: number; price: number; units: number; reason: 'target1' | 'target2' | 'stop' | 'ambiguous' | 'data-gap'; pnl: number }
export interface PaperTrade {
  id: string; recordId: string; symbol: string; market: string; interval: string; side: 'long' | 'short';
  openedAt: number; entry: number; stop: number; targets: [number, number]; units: number; risk: number;
  fills: PaperFill[]; remaining: number; pnl: number; status: 'open' | 'closed'; lastPrice: number; unrealized: number;
}
export type ViolationKind = 'daily-loss' | 'max-drawdown';
export interface PaperViolation { kind: ViolationKind; at: number; balance: number; limit: number }
export interface PaperAccount {
  rules: PropRules; startedAt: number; status: 'active' | 'passed' | 'failed';
  balance: number; equity: number; peak: number; floor: number; target: number;
  dayKey: string; dayPnl: number; dayLimit: number;
  trades: PaperTrade[]; violations: PaperViolation[]; skipped: { recordId: string; reason: 'max-open' | 'account-closed' | 'invalid-risk' }[];
  stats: { closed: number; wins: number; losses: number; winRate: number | null; profitFactor: number | null; netPnl: number };
  passedAt: number | null;
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback; };
export function sanitizeRules(input: Partial<PropRules> | undefined): PropRules {
  const r = { ...DEFAULT_RULES, ...(input ?? {}) };
  const initialBalance = clamp(r.initialBalance, 100, 100_000_000, DEFAULT_RULES.initialBalance);
  return {
    profile: PROP_PROFILES.some(p => p.id === r.profile) ? r.profile : 'custom',
    initialBalance,
    riskPerTrade: clamp(r.riskPerTrade, 1, initialBalance, DEFAULT_RULES.riskPerTrade),
    dailyLoss: clamp(r.dailyLoss, 1, initialBalance, DEFAULT_RULES.dailyLoss),
    maxDrawdown: clamp(r.maxDrawdown, 1, initialBalance, DEFAULT_RULES.maxDrawdown),
    drawdownMode: r.drawdownMode === 'trailing' ? 'trailing' : 'static',
    profitTarget: clamp(r.profitTarget, 0, 100_000_000, DEFAULT_RULES.profitTarget),
    maxOpenTrades: Math.round(clamp(r.maxOpenTrades, 1, 50, DEFAULT_RULES.maxOpenTrades)),
    partialAtTarget1: r.partialAtTarget1 !== false,
    feeBps: clamp(r.feeBps, 0, 1000, DEFAULT_RULES.feeBps),
    slippageBps: clamp(r.slippageBps, 0, 1000, DEFAULT_RULES.slippageBps),
  };
}
export function profileRules(id: string): PropRules {
  const profile = PROP_PROFILES.find(p => p.id === id) ?? PROP_PROFILES[0];
  return { profile: profile.id, ...profile.rules };
}

const nyDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Prop-firm trading day: resets at 17:00 New York time. */
export function tradingDay(time: number): string {
  return nyDate.format(new Date((time + 7 * 3600) * 1000));
}

type Step = { at: number; order: number; record: ForecastRecord; type: string; price: number };

export function computePaperAccount(records: ForecastRecord[], settings: PaperAccountSettings): PaperAccount {
  const rules = sanitizeRules(settings.rules), start = settings.startedAt;
  const initial = rules.initialBalance, slip = rules.slippageBps / 10000, fee = rules.feeBps / 10000;
  const steps: Step[] = [];
  for (const record of records) {
    if (record.createdAt < start) continue;
    const events = record.events.filter(e => e.at >= start);
    const entered = events.find(e => e.type === 'condition-met' || e.type === 'ambiguous');
    if (!entered) continue;
    // An ambiguous bar before entry (condition and stop on the same bar) is
    // booked conservatively as an entry that was stopped out.
    steps.push({ at: entered.at, order: 0, record, type: 'entry', price: entered.price });
    for (const e of events) {
      if (e === entered && e.type === 'condition-met') continue;
      if (['target1', 'target2', 'invalidated', 'ambiguous', 'data-gap'].includes(e.type)) steps.push({ at: e.at, order: 1, record, type: e.type, price: e.price });
    }
  }
  steps.sort((a, b) => a.at - b.at || a.order - b.order);
  let balance = initial, peak = initial, status: PaperAccount['status'] = 'active', passedAt: number | null = null;
  let dayKey = tradingDay(start), dayStart = initial;
  const trades: PaperTrade[] = [], violations: PaperViolation[] = [], skipped: PaperAccount['skipped'] = [], byRecord = new Map<string, PaperTrade>();
  const floorNow = () => rules.drawdownMode === 'trailing' ? Math.min(initial, peak - rules.maxDrawdown) : initial - rules.maxDrawdown;
  const target = initial + rules.profitTarget;
  const rollDay = (at: number) => { const key = tradingDay(at); if (key !== dayKey) { dayKey = key; dayStart = balance; } };
  const close = (trade: PaperTrade, at: number, price: number, units: number, reason: PaperFill['reason']) => {
    const buy = trade.side === 'long', exit = price * (buy ? 1 - slip : 1 + slip);
    const gross = (buy ? exit - trade.entry : trade.entry - exit) * units;
    const pnl = gross - exit * units * fee;
    trade.fills.push({ at, price: exit, units, reason, pnl });
    trade.remaining -= units; trade.pnl += pnl; balance += pnl;
    if (trade.remaining <= trade.units * 1e-9) { trade.remaining = 0; trade.status = 'closed'; }
    peak = Math.max(peak, balance);
    if (status !== 'active') return;
    if (balance - dayStart <= -rules.dailyLoss) { status = 'failed'; violations.push({ kind: 'daily-loss', at, balance, limit: dayStart - rules.dailyLoss }); }
    else if (balance <= floorNow()) { status = 'failed'; violations.push({ kind: 'max-drawdown', at, balance, limit: floorNow() }); }
    else if (rules.profitTarget > 0 && balance >= target) { status = 'passed'; passedAt = at; }
  };
  for (const step of steps) {
    rollDay(step.at);
    const r = step.record, buy = r.outlook.side === 'long';
    if (step.type === 'entry') {
      if (status !== 'active') { skipped.push({ recordId: r.id, reason: 'account-closed' }); continue; }
      if (trades.filter(t => t.status === 'open').length >= rules.maxOpenTrades) { skipped.push({ recordId: r.id, reason: 'max-open' }); continue; }
      const entry = step.price * (buy ? 1 + slip : 1 - slip), stop = r.outlook.invalidationPrice;
      const perUnit = buy ? entry - stop : stop - entry;
      if (!(perUnit > 0)) { skipped.push({ recordId: r.id, reason: 'invalid-risk' }); continue; }
      const risk = rules.riskPerTrade, units = risk / perUnit;
      const trade: PaperTrade = { id: `paper:${r.id}`, recordId: r.id, symbol: r.symbol, market: r.market, interval: r.interval, side: r.outlook.side, openedAt: step.at, entry, stop, targets: [r.outlook.targets[0].price, r.outlook.targets[1].price], units, risk, fills: [], remaining: units, pnl: -entry * units * fee, status: 'open', lastPrice: entry, unrealized: 0 };
      balance -= entry * units * fee;
      trades.push(trade); byRecord.set(r.id, trade);
      continue;
    }
    const trade = byRecord.get(r.id);
    if (!trade || trade.status !== 'open') continue;
    if (step.type === 'target1') { if (rules.partialAtTarget1) close(trade, step.at, step.price, trade.units / 2, 'target1'); }
    else if (step.type === 'target2') close(trade, step.at, step.price, trade.remaining, 'target2');
    else if (step.type === 'invalidated') close(trade, step.at, step.price, trade.remaining, 'stop');
    else if (step.type === 'ambiguous') close(trade, step.at, trade.stop, trade.remaining, 'ambiguous');
    else if (step.type === 'data-gap') close(trade, step.at, step.price, trade.remaining, 'data-gap');
  }
  let unrealized = 0;
  for (const trade of trades) {
    if (trade.status !== 'open') continue;
    const record = records.find(r => r.id === trade.recordId);
    trade.lastPrice = record?.lastClose ?? trade.entry;
    trade.unrealized = (trade.side === 'long' ? trade.lastPrice - trade.entry : trade.entry - trade.lastPrice) * trade.remaining;
    unrealized += trade.unrealized;
  }
  const closed = trades.filter(t => t.status === 'closed'), wins = closed.filter(t => t.pnl > 0), losses = closed.filter(t => t.pnl <= 0);
  const gain = wins.reduce((s, t) => s + t.pnl, 0), loss = -losses.reduce((s, t) => s + t.pnl, 0);
  return {
    rules, startedAt: start, status, balance, equity: balance + unrealized, peak, floor: floorNow(), target,
    dayKey, dayPnl: balance - dayStart, dayLimit: rules.dailyLoss,
    trades, violations, skipped,
    stats: { closed: closed.length, wins: wins.length, losses: losses.length, winRate: closed.length ? wins.length / closed.length * 100 : null, profitFactor: loss > 0 ? gain / loss : null, netPnl: balance - initial },
    passedAt,
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export function readPaperSettings(storage?: StorageLike): PaperAccountSettings | null {
  try {
    const raw = (storage ?? localStorage).getItem(PAPER_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || v.version !== 1 || !Number.isFinite(v.startedAt)) return null;
    return { version: 1, startedAt: v.startedAt, rules: sanitizeRules(v.rules) };
  } catch { return null; }
}
export function writePaperSettings(settings: PaperAccountSettings | null, storage?: StorageLike): boolean {
  try { (storage ?? localStorage).setItem(PAPER_KEY, settings ? JSON.stringify(settings) : ''); return true; } catch { return false; }
}
/** Spreadsheet-friendly export of the trade log. */
export function paperTradesCsv(account: PaperAccount): string {
  const rows = [['symbol', 'interval', 'side', 'opened_utc', 'entry', 'stop', 'target1', 'target2', 'units', 'risk', 'status', 'pnl', 'exits']];
  for (const t of account.trades) rows.push([t.symbol, t.interval, t.side, new Date(t.openedAt * 1000).toISOString(), t.entry.toFixed(6), t.stop.toFixed(6), t.targets[0].toFixed(6), t.targets[1].toFixed(6), t.units.toFixed(6), t.risk.toFixed(2), t.status, t.pnl.toFixed(2), t.fills.map(f => `${f.reason}@${f.price.toFixed(6)}`).join(' ')]);
  return rows.map(r => r.join(',')).join('\n') + '\n';
}
