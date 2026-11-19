// Modificado para trend-workbench-br: suporte a pt-BR e identidade própria.
import type { MarketForecast, ReadyForecastSide } from '@/lib/forecast-types';
import { localeFor, pickText } from '../lib/i18n-pt.ts';
import { useLanguage, type Language } from '@/lib/language';
import { priceText } from './terminal-chart';
import { forecastCondition, forecastKind, forecastSummary, forecastTargetLabel } from './forecast-copy';
import ForecastTitleText from './forecast-title-text';

function ForecastLevels({side,language,alternative=false}:{side:ReadyForecastSide;language:Language;alternative?:boolean}) {
  const t=(zh:string,en:string)=>pickText(language,zh,en);
  return <article className={`forecast-side ${side.side}${alternative?' alternative':''}`} data-testid={`forecast-side-${side.side}`}>
    <header><h3>{side.side==='long'?t('做多方案','Long setup'):t('做空方案','Short setup')}{alternative&&t(' · 备选',' · Alternative')}</h3><span>{forecastKind(side,language)}</span></header>
    <div className="forecast-zone"><span>{t('入场区间','Entry zone')}</span><strong>{priceText(side.zoneLow)} – {priceText(side.zoneHigh)}</strong></div>
    <div className="forecast-level-grid">
      <div className="forecast-invalidation"><span>{t('止损价','Stop loss')}</span><strong>{priceText(side.invalidationPrice)}</strong></div>
      {side.targets.map((target,i)=><div key={i}><span>{forecastTargetLabel(i,target.estimated,language)}</span><strong>{priceText(target.price)}</strong></div>)}
    </div>
    <p className="forecast-condition">{forecastCondition(side,language,priceText)}</p>
  </article>;
}

export default function ForecastPanel({forecast,dataFresh=true,language:override}:{forecast:MarketForecast;dataFresh?:boolean;language?:Language}) {
  const languageContext=useLanguage(),language=override??languageContext.language;
  const t=(zh:string,en:string)=>pickText(language,zh,en),locale=localeFor(language);
  const time=(value:number|null)=>value===null?'—':new Date(value*1000).toLocaleString(locale,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  const primary=forecast.direction==='neutral'?null:forecast[forecast.direction];
  const other=forecast.direction==='long'?forecast.short:forecast.long;
  const ready=dataFresh&&forecast.status==='ready';
  return <section className="forecast-panel" aria-label={t('后续走势预判','Forward market outlook')} data-testid="forecast-panel">
    <div className={`forecast-heading ${ready?forecast.direction:'neutral'}`}><h2><ForecastTitleText forecast={forecast} language={language} dataFresh={dataFresh}/></h2><p>{forecastSummary(forecast,language,dataFresh)}</p></div>
    <div className="forecast-reference"><span>{t('基准价格','Reference price')} <b>{forecast.referencePrice===null?'—':priceText(forecast.referencePrice)}</b></span><span>{t('基准K线','Reference candle')} {time(forecast.referenceTime)}</span><span>{t('结构时间','Structure time')} {time(forecast.structureAsOf)}</span></div>
    {ready&&primary?.status==='ready'?<>
      <ForecastLevels side={primary} language={language}/>
      {other.status==='ready'&&<details className="forecast-alternative"><summary>{other.side==='long'?t('查看做多方案（备选）','View long setup (alternative)'):t('查看做空方案（备选）','View short setup (alternative)')}</summary><ForecastLevels side={other} language={language} alternative/></details>}
    </>:ready&&<div className="forecast-boundaries" data-testid="forecast-neutral-levels">
      <div><span>{forecast.support?.estimated?t('参考支撑（估算）','Reference support (estimated)'):t('参考支撑','Reference support')}</span><strong>{forecast.support?priceText(forecast.support.price):'—'}</strong></div>
      <div><span>{forecast.resistance?.estimated?t('参考阻力（估算）','Reference resistance (estimated)'):t('参考阻力','Reference resistance')}</span><strong>{forecast.resistance?priceText(forecast.resistance.price):'—'}</strong></div>
    </div>}
    {ready&&<p className="forecast-foot">{t('以上为参考价位；止盈不保证到达，工具不会自动下单。','These are reference levels. Take-profit prices are not guaranteed to be reached; the tool does not place orders.')}{forecast.context.market==='cn'&&t(' A股做空方案用于看空或减仓参考。',' For A-shares, short setups indicate downside or position-reduction context.')}</p>}
  </section>;
}
