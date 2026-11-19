// Modificado para trend-workbench-br: mercado brasileiro (B3).
import type { Candle, Interval, MarketData } from './market-types';
import { aggregateB3FourHour, aggregateEquityFourHour } from './equity-four-hour.ts';
import { candleAvailableAt, exchangeClock, higherInterval } from './timeframe-context.ts';

export const SAME_SOURCE_AGGREGATION = ' · 真实同源聚合';
const DAY = 86400;
const duration: Partial<Record<Interval, number>> = { '1m':60, '5m':300, '15m':900, '30m':1800, '1h':3600, '4h':14400, '1d':DAY, '1w':7*DAY };

// Keep provider and adjustment identity aligned with confluence.ts. The suffix
// describes construction, not a different price feed or adjustment convention.
function provider(source: string): string {
  const value = source.replace(/\s*·\s*真实同源聚合\s*$/i, '').replace(/\s*·\s*(?:30分(?:钟)?|1小时)聚合4小时\s*$/i, '').trim().toLowerCase();
  if (/^yahoo finance/.test(value)) return 'yahoo-finance';
  if (/^腾讯证券/.test(value)) return 'tencent';
  if (/^东方财富/.test(value)) return 'eastmoney';
  if (/^新浪财经/.test(value)) return 'sina';
  return value;
}
function adjustmentKind(value: string): string | null {
  if (/未独立核验|未知|unknown/i.test(value)) return null;
  if (/不复权|unadjusted|no adjustment/i.test(value)) return 'unadjusted';
  if (/后复权|backward adjusted/i.test(value)) return 'backward';
  if (/前复权|forward adjusted/i.test(value)) return 'forward';
  if (/按调整后收盘价等比例调整OHLC/i.test(value)) return 'adjusted-close-ratio';
  if (/来源原始OHLC|未请求复权/i.test(value)) return 'unadjusted';
  return null;
}
export function compatibleMarketFeeds(primary: MarketData, higher: MarketData): boolean {
  if (!primary.source || !higher.source || !primary.adjustment || !higher.adjustment) return false;
  const adjustment = adjustmentKind(primary.adjustment);
  return primary.instrument.market === higher.instrument.market
    && primary.instrument.symbol.toUpperCase() === higher.instrument.symbol.toUpperCase()
    && provider(primary.source) === provider(higher.source)
    && adjustment !== null && adjustment === adjustmentKind(higher.adjustment);
}
function valid(c: Candle): boolean {
  return [c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)
    && c.time > 0 && c.low > 0 && c.volume >= 0
    && c.high >= Math.max(c.open,c.close) && c.low <= Math.min(c.open,c.close);
}
function merge(rows: Candle[], time: number): Candle {
  return { time, open:rows[0].open, high:Math.max(...rows.map(c=>c.high)), low:Math.min(...rows.map(c=>c.low)), close:rows.at(-1)!.close, volume:rows.reduce((sum,c)=>sum+c.volume,0), closed:true };
}
function monday(day: number): number {
  return day - ((new Date(day*1000).getUTCDay()+6)%7)*DAY;
}
type Aggregation = { candles:Candle[]; skipped:number };

function crypto(primary:MarketData, target:Interval, asOf:number):Aggregation|null {
  const child=duration[primary.interval], parent=duration[target];
  if (!child || !parent || parent <= child || parent % child !== 0) return null;
  const groups=new Map<number,Candle[]>();
  for(const c of primary.candles) {
    const start=target==='1w'?monday(Math.floor(c.time/DAY)*DAY):Math.floor(c.time/parent)*parent;
    groups.set(start,[...(groups.get(start)??[]),c]);
  }
  const candles:Candle[]=[];let skipped=0;
  for(const [start,rows] of groups) {
    if(rows.length!==parent/child || rows.some((c,i)=>c.time!==start+i*child || c.closed!==true) || start+parent>asOf) { skipped++;continue; }
    candles.push(merge(rows,start));
  }
  return {candles,skipped};
}

/** Every required weekday/slot must be present. Holidays, early closes and
 * unknown timestamp conventions are not guessed or filled with synthetic rows. */
function equities(primary:MarketData, target:Interval, asOf:number):Aggregation|null {
  const market=primary.instrument.market;
  if(market==='crypto')return null;
  const source=primary.source;
  const endLabelled=market==='cn' && /^(?:东方财富|腾讯证券|新浪财经)/.test(source)
    || market==='us' && /^东方财富/.test(source);
  const startLabelled=(market==='us'||market==='br') && /^Yahoo Finance/i.test(source);
  if(!endLabelled&&!startLabelled)return null;
  if(market==='br'&&target==='4h') {
    if(primary.interval!=='1h')return null;
    const result=aggregateB3FourHour(primary.candles,asOf);
    return {candles:result.candles.filter(c=>c.closed===true),skipped:result.discardedBuckets+result.excludedRows+result.candles.filter(c=>c.closed!==true).length};
  }
  if(market!=='br'&&target==='4h'&&(primary.interval==='30m'||primary.interval==='1h')) {
    const result=aggregateEquityFourHour(primary.candles,{market,sourceInterval:primary.interval,timestamp:endLabelled?'end':'start',now:asOf});
    return {candles:result.candles.filter(c=>c.closed===true),skipped:result.discardedBuckets+result.excludedRows+result.candles.filter(c=>c.closed!==true).length};
  }
  const weekly=target==='1w'&&(primary.interval==='1d'||market==='cn'&&primary.interval==='4h');
  const daily=target==='1d'&&(market==='cn'&&primary.interval==='1h'||(market==='us'||market==='br')&&primary.interval==='4h');
  if(!weekly&&!daily)return null;
  const groups=new Map<number,{time:number;rows:Candle[];slots:number[]}>();
  let skipped=0;
  for(const c of primary.candles) {
    const clock=exchangeClock(c.time,market), day=Date.parse(`${clock.date}T00:00:00Z`)/1000;
    const weekday=new Date(day*1000).getUTCDay();
    if(weekday===0||weekday===6||c.time%60!==0) { skipped++;continue; }
    const key=weekly?monday(day):day;
    // Convert observed exchange clock to local midnight without using the
    // current UTC offset; this also preserves historical New York DST.
    const midnight=c.time-clock.minute*60;
    const group=groups.get(key)??{time:midnight-(weekly?(weekday-1)*DAY:0),rows:[],slots:[]};
    group.rows.push(c);
    group.slots.push(weekly?weekday:clock.minute);
    // A-share 4H means the full split trading session, labelled 09:30.
    if(weekly&&primary.interval==='4h'&&clock.minute!==570)group.slots.push(-1);
    groups.set(key,group);
  }
  const candles:Candle[]=[];
  const expected=weekly?[1,2,3,4,5]:market==='cn'?[630,690,840,900]:market==='br'?[600,840]:[570,810];
  for(const group of groups.values()) {
    const {rows,slots}=group;
    const candle=merge(rows,group.time);
    if(rows.length!==expected.length||slots.length!==expected.length||slots.some((s,i)=>s!==expected[i])||rows.some(c=>c.closed!==true)||candleAvailableAt(candle,market,target,source)>asOf) { skipped++;continue; }
    candles.push(candle);
  }
  return {candles,skipped};
}

/** Fallback only: ≥35 completed parent bars constructed from one immutable
 * primary snapshot. Weekly bars are never relabelled or split into months. */
export function deriveHigherFromPrimary(primary:MarketData):MarketData|null {
  const target=higherInterval(primary.instrument.market,primary.interval);
  const asOf=Date.parse(primary.asOf)/1000;
  if(!target||target==='1M'||!Number.isFinite(asOf)||!compatibleMarketFeeds(primary,primary))return null;
  if(!primary.candles.length||primary.candles.some((c,i)=>!valid(c)||i>0&&c.time<=primary.candles[i-1].time))return null;
  const result=primary.instrument.market==='crypto'?crypto(primary,target,asOf):equities(primary,target,asOf);
  if(!result||result.candles.length<35)return null;
  return {
    ...primary,interval:target,candles:result.candles,source:primary.source+SAME_SOURCE_AGGREGATION,
    delayNotice:`${primary.delayNotice} · ${primary.interval}真实子K线聚合${target}；仅含完整已收盘周期`,
    warnings:[...primary.warnings,`大周期备用数据由当前${primary.interval}同一来源、同一复权口径的真实子K线聚合为${target}；未混入其他行情源。`, `已跳过${result.skipped}个不完整周期或非正常时段数据；缺K、节假日及未收盘周期均不补价。`],
  };
}
