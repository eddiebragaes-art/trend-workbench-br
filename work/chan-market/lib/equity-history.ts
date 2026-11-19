// Modificado para trend-workbench-br: mercado brasileiro (B3).
import type { Candle, MarketData } from './market-types';
import { candleAvailableAt } from './timeframe-context.ts';

function validCandle(c:Candle):boolean {
  return [c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)
    &&c.time>0&&Number.isFinite(new Date(c.time*1000).getTime())&&c.low>0&&c.volume>=0
    &&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close);
}
/** Compare coverage, not the provider's label timestamp or fetch time. The
 * existing market clock accounts for start/end labels, DST and session tails.
 * Its conservative close-confirmation delay is not extra price history. */
function coveredThrough(data:MarketData):number {
  const last=data.candles.at(-1)!;
  const available=candleAvailableAt(last,data.instrument.market,data.interval,data.source);
  const delay=data.interval==='1M'?0:data.instrument.market==='cn'?120:900;
  return available-delay;
}

/** Select one complete, coherent provider response; never splice prices or
 * adjustment regimes. A deeper but older feed cannot hide the latest period.
 * Equal coverage prefers more completed bars, then more total bars. Ties keep
 * the caller's provider preference. Calendar labels normalize to one period. */
export function chooseEquityHistory(candidates:MarketData[]):MarketData|undefined {
  const first=candidates[0];
  if(!first)return undefined;
  if(!['cn','us','br'].includes(first.instrument.market))throw new Error('Equity history selection requires a stock market.');
  const identity=(data:MarketData)=>`${data.instrument.market}:${data.instrument.symbol.toUpperCase()}:${data.interval}`;
  const expected=identity(first);
  for(const candidate of candidates)if(identity(candidate)!==expected)throw new Error('Equity history candidates must share market, symbol and interval.');
  let selected:MarketData|undefined,coverage=-Infinity,completed=-1,total=-1;
  for(const candidate of candidates) {
    const rows=candidate.candles;
    if(!rows.length||rows.some((c,i)=>!validCandle(c)||(i>0&&c.time<=rows[i-1].time)))continue;
    const through=coveredThrough(candidate),closed=rows.filter(c=>c.closed!==false).length;
    if(!Number.isFinite(through))continue;
    if(through>coverage||(through===coverage&&(closed>completed||(closed===completed&&rows.length>total)))) {
      selected=candidate;coverage=through;completed=closed;total=rows.length;
    }
  }
  return selected;
}
