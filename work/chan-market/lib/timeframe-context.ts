// Modificado para trend-workbench-br: mercado brasileiro (B3).
import type { Candle, Interval, Market, MarketData } from './market-types';
import { B3_ZONE, b3CloseMinute } from './b3-session.ts';

type StockMarket='cn'|'us'|'br';

const seconds: Record<Exclude<Interval, '1M'>, number> = {
  '1m':60, '5m':300, '15m':900, '30m':1800, '1h':3600, '4h':14400, '1d':86400, '1w':604800,
};
const clocks = {
  cn:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),
  us:new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),
  br:new Intl.DateTimeFormat('en-CA',{timeZone:B3_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),
};
export function exchangeClock(time:number,market:StockMarket) {
  const p=Object.fromEntries(clocks[market].formatToParts(new Date(time*1000)).map(v=>[v.type,v.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,minute:Number(p.hour)*60+Number(p.minute)};
}
/** Exchange-local wall clock to epoch, including New York DST at the target date. */
function localEpoch(date:string,minute:number,market:StockMarket):number {
  const wall=Date.parse(`${date}T00:00:00Z`)/1000+minute*60;
  let guess=wall;
  for(let i=0;i<3;i++) {
    const c=exchangeClock(guess,market);
    const observed=Date.parse(`${c.date}T00:00:00Z`)/1000+c.minute*60;
    const delta=wall-observed;
    guess+=delta;
    if(!delta)break;
  }
  return guess;
}
export function higherInterval(market:Market,interval:Interval):Interval|null {
  const next:Record<Interval,Interval|null>={'1m':'5m','5m':'15m','15m':'1h','30m':'4h','1h':'4h','4h':'1d','1d':'1w','1w':'1M','1M':null};
  // A-share 4H is already the entire trading day; never count 4H and 1D as two confirmations.
  if(market==='cn'&&interval==='1h')return '1d';
  if(market==='cn'&&interval==='4h')return '1w';
  return next[interval];
}

/** Earliest conservative availability, not a prediction of the next trade time.
 * The feeds use start-labelled crypto/Yahoo bars and end-labelled China/EM minute bars.
 * Historical early US closes are deliberately delayed to 16:15 if no calendar is supplied.
 * This can omit evidence temporarily, but cannot expose a future completed candle in replay.
 */
export function candleAvailableAt(candle:Pick<Candle,'time'>,market:Market,interval:Interval,source=''):number {
  if(!Number.isFinite(candle.time))return Infinity;
  if(market==='crypto') {
    if(interval!=='1M')return candle.time+seconds[interval];
    const d=new Date(candle.time*1000);
    return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)/1000;
  }
  const c=exchangeClock(candle.time,market),delay=market==='cn'?120:900;
  // Session close in exchange minutes: A-shares 15:00, US 16:00, B3 17:00 or 18:00.
  const close=market==='cn'?900:market==='br'?b3CloseMinute(candle.time):960;
  const day=new Date(`${c.date}T00:00:00Z`);
  if(interval==='1M') {
    day.setUTCMonth(day.getUTCMonth()+1,1);
    return localEpoch(day.toISOString().slice(0,10),0,market);
  }
  if(interval==='1w') {
    day.setUTCDate(day.getUTCDate()+(5-day.getUTCDay()+7)%7);
    return localEpoch(day.toISOString().slice(0,10),close,market)+delay;
  }
  if(interval==='1d')return localEpoch(c.date,close,market)+delay;
  if(interval==='4h')return localEpoch(c.date,market==='cn'?900:market==='br'?(c.minute<840?840:close):c.minute<810?810:960,market)+delay;
  if(market==='cn'||/东方财富|Eastmoney|周期结束/i.test(source))return candle.time+delay;
  return Math.min(candle.time+seconds[interval],localEpoch(c.date,close,market))+delay;
}

/** Filter by what was available at the lower-timeframe close, never by today's closed flag alone. */
export function eligibleHigherCandles(data:MarketData,asOf:number):Candle[] {
  if(!Number.isFinite(asOf))return [];
  return data.candles.filter(c=>c.closed===true&&candleAvailableAt(c,data.instrument.market,data.interval,data.source)<=asOf);
}
