// Modificado para trend-workbench-br: mercado brasileiro (B3) e índices/commodities (fut).
import type { Candle, MarketData } from './market-types.ts';
import type { MarketForecast, ReadyForecastSide } from './forecast-types.ts';
import { candleAvailableAt, exchangeClock } from './timeframe-context.ts';
import { captureForecastAudit, forecastVersionKey, validForecastAudit, type ForecastAudit } from './forecast-audit.ts';

export type JournalEventType='condition-met'|'target1'|'target2'|'invalidated'|'expired'|'missed'|'ambiguous'|'data-gap';
export interface ForecastEvent {id:string;type:JournalEventType;at:number;barTime:number;price:number}
export interface ForecastRecord {
  id:string; key:string; market:MarketData['instrument']['market'];symbol:string;interval:MarketData['interval'];source:string;adjustment:string;
  createdAt:number;referencePrice:number;referenceTime:number;structureAsOf:number|null;
  outlook:ReadyForecastSide; lastBarTime:number;lastClose:number;barsObserved:number;
  status:'watching'|'condition-met'|'target2'|'invalidated'|'expired'|'missed'|'ambiguous'|'data-gap';
  events:ForecastEvent[];
  /** Missing only on records saved before versioned forecast snapshots. */
  audit?:ForecastAudit;
}
export interface ForecastJournal {version:1;records:ForecastRecord[];trimmed:number}
export const JOURNAL_KEY='trend-forecast-journal-v1';
const MAX_RECORDS=600;
export const emptyJournal=():ForecastJournal=>({version:1,records:[],trimmed:0});
export function forecastIdentity(data:Pick<MarketData,'instrument'|'interval'|'source'|'adjustment'>):string {
  return [data.instrument.market,data.instrument.symbol,data.interval,data.source,data.adjustment].join('|');
}
const validBar=(b:Candle)=>[b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)&&b.time>0&&b.low>0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close);
function localStart(date:string,market:'cn'|'us'|'br'|'fut'):number {
  const wall=Date.parse(`${date}T00:00:00Z`)/1000+(market==='br'?600:market==='fut'?0:570)*60;
  let guess=wall;
  for(let i=0;i<3;i++){const c=exchangeClock(guess,market);guess+=wall-(Date.parse(`${c.date}T00:00:00Z`)/1000+c.minute*60);}
  return guess;
}
export function forecastBarStart(b:Candle,data:Pick<MarketData,'instrument'|'interval'|'source'>):number {
  const market=data.instrument.market,period=data.interval;
  if(market==='crypto'||period==='4h')return b.time;
  const clock=exchangeClock(b.time,market);
  if(['1d','1w','1M'].includes(period)) {
    const date=new Date(`${clock.date}T00:00:00Z`);
    if(period==='1M')date.setUTCDate(1);
    if(period==='1w')date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
    return localStart(date.toISOString().slice(0,10),market);
  }
  if(market==='cn'||/东方财富|Eastmoney|周期结束/i.test(data.source)) {
    const span=({'1m':60,'5m':300,'15m':900,'30m':1800,'1h':3600} as const)[period as '1m'|'5m'|'15m'|'30m'|'1h'];
    return b.time-span;
  }
  return b.time;
}
function missingBars(previous:number,next:number,data:MarketData):boolean {
  const period=data.interval,market=data.instrument.market;
  const spans={'1m':60,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400,'1d':86400,'1w':604800};
  if(market==='crypto') {
    if(period==='1M'){const d=new Date(previous*1000);return next>Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)/1000+1;}
    return next-previous>spans[period]+1;
  }
  if(['1d','1w','1M'].includes(period))return false; // Holidays require an exchange calendar, not invented bars.
  const a=exchangeClock(previous,market),b=exchangeClock(next,market);
  if(a.date!==b.date)return false;
  let elapsed=next-previous;
  if(market==='cn'&&a.minute<=690&&b.minute>=780)elapsed-=90*60;
  return elapsed>spans[period as keyof typeof spans]+1;
}
function append(record:ForecastRecord,type:JournalEventType,b:Candle,at:number,price:number) {
  const event:ForecastEvent={id:`${record.id}:${type}:${b.time}`,type,at,barTime:b.time,price};
  if(!record.events.some(e=>e.id===event.id))record.events.push(event);
  if(type!=='target1')record.status=type;
}
/** These are immutable forecast observations, never fills, positions or orders.
 * Only bars that began after publication can confirm a new condition. This
 * prevents a forming bar's earlier high/low being attributed to a new forecast. */
export function advanceForecastJournal(journal:ForecastJournal,data:MarketData,now:number):{journal:ForecastJournal;events:ForecastEvent[]} {
  const key=forecastIdentity(data),events:ForecastEvent[]=[];
  const activeRecords=journal.records.filter(record=>record.key===key&&(record.status==='watching'||record.status==='condition-met'));
  if(!activeRecords.length)return {journal,events};
  const earliest=Math.min(...activeRecords.map(record=>record.lastBarTime));
  const bars:Candle[]=[];
  for(const bar of data.candles){
    if(validBar(bar)&&bar.closed!==false&&bar.time>(bars.at(-1)?.time??0)
      &&(bar.time<=earliest||candleAvailableAt(bar,data.instrument.market,data.interval,data.source)<=now))bars.push(bar);
  }
  const records=journal.records.map(original=>{
    if(original.key!==key||!['watching','condition-met'].includes(original.status))return original;
    const r:ForecastRecord={...original,events:[...original.events]};
    // If the saved reference disappeared, do not manufacture an outcome across
    // an unobserved gap. Historical data from another source is a separate key.
    if(bars.length&&bars[0].time>r.lastBarTime) {
      append(r,'data-gap',bars[0],now,bars[0].close);events.push(r.events.at(-1)!);return r;
    }
    for(const b of bars) {
      if(b.time<=r.lastBarTime)continue;
      if(missingBars(r.lastBarTime,b.time,data)){append(r,'data-gap',b,now,b.close);events.push(r.events.at(-1)!);break;}
      // A delayed or closed-history-only response may omit a candle already in
      // progress at publication. Its earlier extremes are not future evidence.
      if(forecastBarStart(b,data)<r.createdAt){r.lastBarTime=b.time;r.lastClose=b.close;continue;}
      const countBefore=r.events.length,at=candleAvailableAt(b,data.instrument.market,data.interval,data.source);
      const p=r.outlook,buy=p.side==='long';
      const stop=buy?b.low<=p.invalidationPrice:b.high>=p.invalidationPrice;
      const t1=buy?b.high>=p.targets[0].price:b.low<=p.targets[0].price;
      const t2=buy?b.high>=p.targets[1].price:b.low<=p.targets[1].price;
      r.barsObserved++;
      if(r.status==='condition-met') {
        if(stop&&(t1||t2))append(r,'ambiguous',b,at,p.invalidationPrice);
        else if(stop)append(r,'invalidated',b,at,p.invalidationPrice);
        else if(t2)append(r,'target2',b,at,p.targets[1].price);
        else if(t1&&!r.events.some(e=>e.type==='target1'))append(r,'target1',b,at,p.targets[0].price);
      } else {
        const crossed=buy?r.lastClose<p.triggerPrice&&b.close>=p.triggerPrice:r.lastClose>p.triggerPrice&&b.close<=p.triggerPrice;
        const touched=buy?b.low<=p.zoneHigh:b.high>=p.zoneLow;
        const condition=p.triggerRule.startsWith('touch-then')?touched&&(buy?b.close>=p.triggerPrice:b.close<=p.triggerPrice):crossed;
        const inside=b.close>=p.zoneLow&&b.close<=p.zoneHigh;
        if(condition&&(stop||t1))append(r,'ambiguous',b,at,b.close);
        else if(stop)append(r,'invalidated',b,at,p.invalidationPrice);
        else if(condition&&!inside)append(r,'missed',b,at,b.close);
        else if(t1)append(r,'missed',b,at,b.close);
        else if(condition&&inside)append(r,'condition-met',b,at,b.close);
        else if(r.barsObserved>=12)append(r,'expired',b,at,b.close);
      }
      r.lastBarTime=b.time;r.lastClose=b.close;
      events.push(...r.events.slice(countBefore));
      if(!['watching','condition-met'].includes(r.status))break;
    }
    return r;
  });
  return {journal:{...journal,records},events};
}
/** At most one published forecast per completed structure bar and direction.
 * Later refreshed prices are shown on the chart but never rewrite this record. */
export function recordForecast(journal:ForecastJournal,data:MarketData,forecast:MarketForecast,now:number):ForecastJournal {
  if(forecast.context.market!==data.instrument.market||forecast.context.symbol!==data.instrument.symbol||forecast.context.interval!==data.interval||forecast.context.source!==data.source||forecast.context.adjustment!==data.adjustment)return journal;
  if(forecast.status!=='ready'||forecast.mode!=='structure'||forecast.direction==='neutral'||forecast.referencePrice===null||forecast.referenceTime===null)return journal;
  const side=forecast[forecast.direction];if(side.status!=='ready')return journal;
  const key=forecastIdentity(data),id=`${key}:${forecast.lastClosedTime}:${side.side}:${forecastVersionKey(forecast)}`;
  if(journal.records.some(r=>r.id===id))return journal;
  const audit=captureForecastAudit(data,forecast);
  // Delayed end-labelled bars may have a future timestamp. The exact snapshot
  // bar is skipped until the next bar, irrespective of its eventual extremes.
  const record:ForecastRecord={id,key,market:data.instrument.market,symbol:data.instrument.symbol,interval:data.interval,source:data.source,adjustment:data.adjustment,
    createdAt:now,referencePrice:forecast.referencePrice,referenceTime:forecast.referenceTime,structureAsOf:forecast.structureAsOf,
    outlook:structuredClone(side),lastBarTime:forecast.referenceTime,lastClose:forecast.referencePrice,barsObserved:0,status:'watching',events:[],audit};
  const records=[...journal.records,record],extra=Math.max(0,records.length-MAX_RECORDS);
  return {version:1,records:records.slice(extra),trimmed:journal.trimmed+extra};
}
export interface RiskTouch {id:string;recordId:string;symbol:string;interval:MarketData['interval'];side:'long'|'short';type:'invalidation'|'target1'|'target2';price:number;level:number;at:number}
/** Intrabar warnings use the received quote, not a bar's pre-publication high/low. */
export function currentRiskTouches(journal:ForecastJournal,data:MarketData,now:number):RiskTouch[] {
  const b=data.candles.at(-1);if(!b||!validBar(b))return [];
  if(forecastBarStart(b,data)>now||b.closed!==false&&candleAvailableAt(b,data.instrument.market,data.interval,data.source)>now)return [];
  const key=forecastIdentity(data);return journal.records.flatMap(r=>{
    if(r.key!==key||r.status!=='condition-met')return [];
    const trigger=r.events.find(e=>e.type==='condition-met');if(!trigger||b.time<=trigger.barTime)return [];
    const p=r.outlook,buy=p.side==='long';
    const type=buy?b.close<=p.invalidationPrice?'invalidation':b.close>=p.targets[1].price?'target2':b.close>=p.targets[0].price?'target1':null:
      b.close>=p.invalidationPrice?'invalidation':b.close<=p.targets[1].price?'target2':b.close<=p.targets[0].price?'target1':null;
    if(!type||r.events.some(e=>e.type===type))return [];
    return [{id:`${r.id}:touch:${type}`,recordId:r.id,symbol:r.symbol,interval:r.interval,side:p.side,type,price:b.close,level:type==='invalidation'?p.invalidationPrice:p.targets[type==='target1'?0:1].price,at:now}];
  });
}
export interface JournalStats {published:number;confirmed:number;resolved:number;targets:number;invalidated:number;ambiguous:number;pending:number;netMeanPct:number|null;positivePct:number|null;feeBps:number;slippageBps:number}
/** Event-study estimate only: independent observations may overlap. No capital
 * curve, portfolio drawdown or actual-execution claims are produced. */
export function forecastStats(records:ForecastRecord[],feeBps=5,slippageBps=3):JournalStats {
  feeBps=Number.isFinite(feeBps)?Math.min(1000,Math.max(0,feeBps)):5;
  slippageBps=Number.isFinite(slippageBps)?Math.min(1000,Math.max(0,slippageBps)):3;
  const confirmed=records.filter(r=>r.events.some(e=>e.type==='condition-met'));
  const completed=confirmed.filter(r=>r.status==='target2'||r.status==='invalidated');
  const returns=completed.map(r=>{
    const buy=r.outlook.side==='long',entry=(buy?r.outlook.zoneHigh:r.outlook.zoneLow)*(1+(buy?1:-1)*slippageBps/10000);
    const event=r.events.at(-1)!,exit=event.price*(1+(buy?-1:1)*slippageBps/10000);
    return ((buy?exit-entry:entry-exit)-(entry+exit)*feeBps/10000)/entry*100;
  });
  return {published:records.length,confirmed:confirmed.length,resolved:completed.length,targets:completed.filter(r=>r.status==='target2').length,invalidated:completed.filter(r=>r.status==='invalidated').length,
    ambiguous:records.filter(r=>r.status==='ambiguous').length,pending:records.filter(r=>['watching','condition-met'].includes(r.status)).length,
    netMeanPct:returns.length?returns.reduce((a,b)=>a+b,0)/returns.length:null,positivePct:returns.length?returns.filter(r=>r>0).length/returns.length*100:null,feeBps,slippageBps};
}
type StorageLike=Pick<Storage,'getItem'|'setItem'>;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const number=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
function validRecord(v:unknown):v is ForecastRecord {
  if(!object(v)||!object(v.outlook)||!Array.isArray(v.outlook.targets)||v.outlook.targets.length!==2||!Array.isArray(v.events))return false;
  if(v.audit!==undefined&&!validForecastAudit(v.audit))return false;
  if(!['id','key','symbol','source','adjustment'].every(k=>typeof v[k]==='string')||!['crypto','cn','us','br','fut'].includes(String(v.market))||!['1m','5m','15m','30m','1h','4h','1d','1w','1M'].includes(String(v.interval)))return false;
  if(v.key!==[v.market,v.symbol,v.interval,v.source,v.adjustment].join('|'))return false;
  if(!['watching','condition-met','target2','invalidated','expired','missed','ambiguous','data-gap'].includes(String(v.status))||!['createdAt','referencePrice','referenceTime','lastBarTime','lastClose','barsObserved'].every(k=>number(v[k])&&(v[k] as number)>=0))return false;
  const p=v.outlook;if(!Array.isArray(p.targets)||p.status!=='ready'||!['long','short'].includes(String(p.side))||!['zoneLow','zoneHigh','triggerPrice','invalidationPrice'].every(k=>number(p[k])&&(p[k] as number)>0)||!p.targets.every(t=>object(t)&&number(t.price)&&t.price>0))return false;
  if(!['close-above','close-below','touch-then-close-above','touch-then-close-below'].includes(String(p.triggerRule)))return false;
  const plan=p as unknown as ReadyForecastSide;
  if(!(plan.zoneLow<=plan.triggerPrice&&plan.triggerPrice<=plan.zoneHigh))return false;
  if(!(plan.side==='long'?plan.invalidationPrice<plan.zoneLow&&plan.zoneHigh<plan.targets[0].price&&plan.targets[0].price<plan.targets[1].price:plan.invalidationPrice>plan.zoneHigh&&plan.zoneLow>plan.targets[0].price&&plan.targets[0].price>plan.targets[1].price))return false;
  return v.events.every(e=>object(e)&&typeof e.id==='string'&&['condition-met','target1','target2','invalidated','expired','missed','ambiguous','data-gap'].includes(String(e.type))&&number(e.at)&&number(e.barTime)&&number(e.price)&&e.price>0);
}
export function readForecastJournal(storage?:StorageLike):ForecastJournal {
  try {const s=storage??(typeof window!=='undefined'?window.localStorage:undefined),value:unknown=JSON.parse(s?.getItem(JOURNAL_KEY)||'null');
    if(!object(value)||value.version!==1||!Array.isArray(value.records))return emptyJournal();
    const records=value.records.filter(validRecord);
    const extra=Math.max(0,records.length-MAX_RECORDS);
    return {version:1,records:records.slice(extra),trimmed:number(value.trimmed)?Math.max(0,value.trimmed)+extra:extra};
  }catch{return emptyJournal();}
}
export function writeForecastJournal(journal:ForecastJournal,storage?:StorageLike):boolean {
  try{const s=storage??(typeof window!=='undefined'?window.localStorage:undefined);if(!s)return false;s.setItem(JOURNAL_KEY,JSON.stringify(journal));return true;}catch{return false;}
}
