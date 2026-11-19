// Modificado para trend-workbench-br: suporte a pt-BR e identidade própria.
import type { Interval } from '@/lib/market-types';
import { localeFor, pickText } from '../lib/i18n-pt.ts';
import type { ForecastDirection, MarketForecast, ReadyForecastSide } from '@/lib/forecast-types';
import type { Language } from '@/lib/language';

const pick=(language:Language,zh:string,en:string)=>pickText(language,zh,en);
const periods:Record<Interval,[string,string]>={'1m':['1分钟','1 min'],'5m':['5分钟','5 min'],'15m':['15分钟','15 min'],'30m':['30分钟','30 min'],'1h':['1小时','1 hour'],'4h':['4小时','4 hours'],'1d':['日线','Daily'],'1w':['周线','Weekly'],'1M':['月线','Monthly']};
export const forecastPeriod=(interval:Interval,language:Language)=>pick(language,...periods[interval]);
export function forecastHigherText(forecast:MarketForecast,language:Language):string {
  const a=forecast.timeframeAssessment;
  if(!a||a.status==='unavailable')return a?.reason==='no-higher-timeframe'
    ?pick(language,'未提供更大周期','No higher timeframe supplied')
    :pick(language,'暂无可用的同一时点数据','No eligible data at this snapshot');
  return a.higherDirection==='long'?pick(language,'偏多','Bullish'):a.higherDirection==='short'?pick(language,'偏空','Bearish'):pick(language,'方向尚不明确','No clear direction');
}
export function forecastRegimeText(forecast:MarketForecast,language:Language):string {
  const r=forecast.regime;
  if(!r||r.status!=='ready')return pick(language,'历史不足，暂未分类','Insufficient history to classify');
  if(r.state==='trend')return r.direction==='long'?pick(language,'上行趋势','Upward trend'):r.direction==='short'?pick(language,'下行趋势','Downward trend'):pick(language,'趋势行情','Trending market');
  if(r.state==='range')return pick(language,'区间震荡','Range-bound');
  if(r.state==='volatile')return pick(language,'高波动','High volatility');
  return pick(language,'趋势过渡','Transition');
}
const directionLabels: Record<ForecastDirection, [string, string]> = {
  long: ['偏多', 'bullish'], short: ['偏空', 'bearish'], neutral: ['方向待明', 'unclear'],
};
function timeframeLabel(interval:Interval,direction:ForecastDirection,language:Language) {
  const label=pick(language,...directionLabels[direction]);
  return [forecastPeriod(interval,language),label].join(language==='zh'?'':' ');
}
/** Only the final published direction leads a heading. An auxiliary veto
 * produces a neutral heading even when the raw timeframe comparison is directional. */
export function forecastTitleParts(forecast:MarketForecast,language:Language,dataFresh=true):[string,string?] {
  if(!dataFresh)return [pick(language,'数据待更新 · 暂不提供新预判','Awaiting fresh data · outlook paused')];
  const period=forecast.context.interval;
  if(forecast.status!=='ready')return [forecastPeriod(period,language)+pick(language,'数据不足',' · insufficient data')];
  const current=timeframeLabel(period,forecast.direction,language);
  const comparison=forecast.timeframeAssessment;
  if(forecast.direction==='neutral'||!comparison||comparison.status==='unavailable'||comparison.currentDirection!==forecast.direction||
    !comparison.higherInterval||!comparison.higherDirection)return [current];
  return [current,timeframeLabel(comparison.higherInterval,comparison.higherDirection,language)];
}
export function forecastTitle(forecast:MarketForecast,language:Language,dataFresh=true):string {
  return forecastTitleParts(forecast,language,dataFresh).join(' · ');
}
export function forecastSummary(forecast:MarketForecast,language:Language,dataFresh=true):string {
  if(!dataFresh)return pick(language,'行情恢复更新后重新计算入场区间。','Entry zones will be recalculated when market data updates resume.');
  if(forecast.status!=='ready')return pick(language,'已完成K线不足，暂不生成操作价位。','There are not enough completed candles to generate reference levels.');
  if(forecast.mode==='volatility')return pick(language,'已确认结构不足，先观察波动参考支撑与阻力。','Confirmed structure is limited. Watch the volatility-based support and resistance.');
  if(forecast.direction==='neutral')return pick(language,'当前方向不明确，先观察支撑与阻力。','Direction is unclear. Watch support and resistance first.');
  const period=forecastPeriod(forecast.context.interval,language);
  const explanation=pick(language,`入场区间、止损和止盈按${period}计算。`,`Entry zones, stops and targets use the selected timeframe (${period}).`);
  const comparison=forecast.timeframeAssessment;
  if(comparison?.status!=='unavailable')return explanation;
  const availability=comparison.reason==='no-higher-timeframe'
    ?pick(language,'未提供更大周期。','No higher timeframe is supplied.')
    :pick(language,'更大周期暂不可用。','Higher-timeframe data is unavailable.');
  return explanation+' '+availability;
}
export function forecastKind(side:ReadyForecastSide,language:Language):string {
  const names={breakout:['突破后做多','Buy after breakout'],pullback:['回踩后做多','Buy after pullback'],breakdown:['跌破后做空','Short after breakdown'],rebound:['反弹后做空','Short after rebound']} as const;
  return pick(language,names[side.kind][0],names[side.kind][1]);
}
export function forecastCondition(side:ReadyForecastSide,language:Language,format:(price:number)=>string):string {
  const trigger=format(side.triggerPrice);
  if(side.triggerRule==='touch-then-close-above')return pick(language,`入场条件：先回踩入场区间，随后本周期K线结束价在区间内站上 ${trigger}。`,`Entry condition: retest the entry zone, then wait for this timeframe's candle to close within it at or above ${trigger}.`);
  if(side.triggerRule==='touch-then-close-below')return pick(language,`入场条件：先反弹至入场区间，随后本周期K线结束价在区间内跌回 ${trigger} 或以下。`,`Entry condition: rebound into the entry zone, then wait for this timeframe's candle to close within it at or below ${trigger}.`);
  return side.triggerRule==='close-above'
    ?pick(language,`入场条件：本周期K线结束价突破 ${trigger}，且仍在入场区间内；区间外不追价。`,`Entry condition: wait for a candle close crossing above ${trigger} and still within the entry zone. Do not chase outside it.`)
    :pick(language,`入场条件：本周期K线结束价跌破 ${trigger}，且仍在入场区间内；区间外不追价。`,`Entry condition: wait for a candle close crossing below ${trigger} and still within the entry zone. Do not chase outside it.`);
}

export function forecastTargetLabel(index:number,estimated:boolean,language:Language):string {
  const label=pick(language,index===0?'第一止盈':'第二止盈',`Take profit ${index+1}`);
  return label+(estimated?pick(language,'（估算）',' (est.)'):'');
}
