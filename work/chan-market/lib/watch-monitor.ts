// Modificado para trend-workbench-br: aceita os mercados B3 e índices/commodities.
import type { Analysis, Instrument, Interval, MarketData } from './market-types';
import { readMarketResponse } from './market-response.ts';
import type { MarketForecast } from './forecast-types';
import { analyze } from './chan.ts';
import { availableForecastCandles, buildForecast, marketSnapshotCutoff } from './forecast.ts';
import { getFeedHealth, type FeedHealth } from './feed-health.ts';
import { higherInterval } from './timeframe-context.ts';
import { deriveHigherFromPrimary } from './higher-from-primary.ts';

export const MAX_WATCH_INSTRUMENTS=12;
export const WATCH_POLL_MS=60000;
export interface WatchSnapshot {data:MarketData;analysis:Analysis;forecast:MarketForecast;health:FeedHealth}
export interface WatchRow {
  instrument:Instrument;interval:Interval;state:'waiting'|'loading'|'ready'|'error';
  health?:FeedHealth;price?:number;source?:string;checkedAtMs?:number;error?:string;
}
type Timer=ReturnType<typeof setTimeout>;
export interface WatchMonitorOptions {
  watchlist:Instrument[];interval:Interval;onSnapshot:(snapshot:WatchSnapshot)=>void;
  onStatus?:(row:WatchRow)=>void;
  fetcher?:(url:string,init:{signal:AbortSignal})=>Promise<Response>;
  now?:()=>number;pollMs?:number;
  setTimer?:(callback:()=>void,ms:number)=>Timer;clearTimer?:(timer:Timer)=>void;
}
export function selectWatchInstruments(watchlist:Instrument[]):Instrument[] {
  const seen=new Set<string>();
  return watchlist.filter(i=>{
    if(!i||!['crypto','us','cn','br','fut'].includes(i.market)||typeof i.symbol!=='string'||!i.symbol)return false;
    const key=`${i.market}:${i.symbol}`;
    if(seen.has(key))return false;
    seen.add(key);return true;
  }).slice(0,MAX_WATCH_INSTRUMENTS);
}
/** Window-owned polling. Two workers share one queue; never more than two fetches
 * run concurrently, and a new round starts at least 60s AFTER the last settles.
 * The consumer owns journal baselines/deduplication; this layer emits snapshots,
 * never old-plan trigger events or permission prompts. */
export function createWatchMonitor(options:WatchMonitorOptions) {
  const instruments=selectWatchInstruments(options.watchlist),interval=options.interval;
  const fetcher=options.fetcher??((url,init)=>fetch(url,init)),now=options.now??Date.now;
  const schedule=options.setTimer??setTimeout,cancel=options.clearTimer??clearTimeout;
  const pollMs=Math.max(WATCH_POLL_MS,Number.isFinite(options.pollMs)?options.pollMs!:WATCH_POLL_MS);
  const controllers=new Set<AbortController>(),timers=new Set<Timer>();
  const lastGood=new Map<string,{data:MarketData;at:number}>();
  let active=false,generation=0;
  const timer=(callback:()=>void,ms:number)=>{const handle=schedule(()=>{timers.delete(handle);callback();},ms);timers.add(handle);return handle;};
  const cancelTimer=(handle:Timer)=>{cancel(handle);timers.delete(handle);};
  const status=(row:WatchRow,epoch:number)=>{if(active&&epoch===generation)options.onStatus?.(row);};
  async function load(instrument:Instrument,epoch:number) {
    if(!active||epoch!==generation)return;
    const key=`${instrument.market}:${instrument.symbol}`,previous=lastGood.get(key);
    const controller=new AbortController();controllers.add(controller);
    const timeout=timer(()=>controller.abort(),20000);
    status({instrument,interval,state:'loading',source:previous?.data.source,price:previous?.data.candles.at(-1)?.close},epoch);
    try {
      const response=await fetcher(`/api/candles?market=${instrument.market}&symbol=${encodeURIComponent(instrument.symbol)}&interval=${interval}&limit=800`,{signal:controller.signal});
      const data=await readMarketResponse(response,{market:instrument.market,symbol:instrument.symbol,interval},{empty:'没有可用K线',failed:'行情请求失败'});
      if(!active||epoch!==generation)return;
      if(controller.signal.aborted)throw new Error('行情请求超时');
      const context={market:instrument.market,symbol:instrument.symbol,interval,source:data.source,adjustment:data.adjustment};
      const at=now(),asOf=marketSnapshotCutoff(data.asOf,at);
      const snapshot={...data,candles:availableForecastCandles(data.candles,context,asOf)};
      if(!snapshot.candles.length)throw new Error('截至行情获取时间，没有可用K线');
      const health=getFeedHealth(snapshot,{nowMs:at,lastSuccessAtMs:at});
      // Match the main chart's history depth. A complete same-source parent can
      // be derived without a second request; short or incomplete coverage stays unavailable.
      const higher=higherInterval(instrument.market,interval);
      const derived=deriveHigherFromPrimary(snapshot);
      const analysis=analyze(snapshot.candles,{penMode:'new',skipCalibration:true,skipTradePlans:true,context:{...context,higher:derived?{interval:higher,status:'ready',data:derived}:{interval:higher,status:higher?'error':'none'}}});
      const forecast=buildForecast(snapshot.candles,analysis,{...context,asOf});
      if(!active||epoch!==generation||controller.signal.aborted)return;
      lastGood.set(key,{data:snapshot,at});
      status({instrument,interval,state:'ready',health,price:snapshot.candles.at(-1)?.close,source:snapshot.source,checkedAtMs:at},epoch);
      options.onSnapshot({data:snapshot,analysis,forecast,health});
    }catch(error) {
      if(!active||epoch!==generation)return;
      const message=controller.signal.aborted?'行情请求超时':error instanceof Error?error.message:'行情请求失败';
      const at=now(),health=getFeedHealth(previous?.data||null,{nowMs:at,lastSuccessAtMs:previous?.at,error:message});
      status({instrument,interval,state:'error',health,source:previous?.data.source,price:previous?.data.candles.at(-1)?.close,checkedAtMs:at,error:message},epoch);
    }finally {cancelTimer(timeout);controllers.delete(controller);}
  }
  async function round(epoch:number) {
    let next=0;
    const worker=async()=>{while(active&&epoch===generation&&next<instruments.length){const item=instruments[next++];await load(item,epoch);}};
    await Promise.all([worker(),worker()]);
    if(active&&epoch===generation)timer(()=>void round(epoch),pollMs);
  }
  return {
    start(){if(active||!instruments.length)return;active=true;const epoch=++generation;for(const instrument of instruments)status({instrument,interval,state:'waiting'},epoch);void round(epoch);},
    stop(){active=false;generation++;for(const timer of timers)cancel(timer);timers.clear();for(const controller of controllers)controller.abort();controllers.clear();lastGood.clear();},
  };
}
