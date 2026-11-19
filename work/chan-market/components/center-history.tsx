"use client";
// Modificado para trend-workbench-br: suporte a pt-BR e identidade própria.
import { localeFor, pickText } from '../lib/i18n-pt.ts';

import type {Candle,Center,Interval} from '@/lib/market-types';
import type {StrokeCenter} from '@/lib/center-layers';
import {useLanguage,type Language} from '@/lib/language';
import {priceText} from './terminal-chart';

export default function CenterHistory({centers,strokeCenters=[],candles,interval,language:override}:{centers:Center[];strokeCenters?:StrokeCenter[];candles:Candle[];interval:Interval;language?:Language}) {
  const context=useLanguage(),language=override??context.language,locale=localeFor(language);
  const t=(zh:string,en:string)=>pickText(language,zh,en);
  const total=centers.length+strokeCenters.length;
  if(!total)return null;
  const date=(index:number)=>{
    const candle=candles[index];if(!candle)return '—';
    const value=new Date(candle.time*1000);if(!Number.isFinite(value.getTime()))return '—';
    return value.toLocaleString(locale,{year:'numeric',month:'2-digit',day:'2-digit',...(!['1d','1w','1M'].includes(interval)?{hour:'2-digit' as const,minute:'2-digit' as const,hour12:false}:{})});
  };
  const groups=[
    {layer:'stroke',name:t('笔中枢（局部）','Stroke centers (local)'),prefix:t('笔','B'),color:'#8bbcf6',items:strokeCenters.map(center=>({center,number:center.sequence}))},
    {layer:'segment',name:t('线段中枢','Segment centers'),prefix:t('段','S'),color:'#e1c895',items:centers.map((center,index)=>({center,number:index+1}))},
  ];
  return <details data-testid="center-history" style={{marginTop:14,borderTop:'1px solid #2a3c48'}}>
    <summary style={{cursor:'pointer',padding:'13px 0',fontSize:15,color:'#d3e4eb'}}>{t('历史中枢','Center history')} <span style={{fontFamily:'var(--mono)',marginLeft:5,color:'#9bcbbb'}}>{total}</span></summary>
    {groups.map(group=><section key={group.layer} data-testid={`center-history-${group.layer}`}>
      <h3 style={{fontSize:15,fontWeight:600,color:group.color,margin:'7px 0'}}>{group.name} · {group.items.length}</h3>
      {group.items.length?group.items.sort((a,b)=>a.center.startIndex-b.center.startIndex||a.center.endIndex-b.center.endIndex).map(({center,number})=><article key={`${center.startIndex}-${center.endIndex}-${number}`} data-testid="center-history-record" data-center-number={number} data-center-layer={group.layer} style={{borderTop:'1px solid #2a3c48',padding:'12px 0',fontSize:14,lineHeight:1.8,color:'#c9dce4'}}>
      <strong style={{fontSize:15,fontWeight:600,color:group.color}}>{group.prefix}{number}</strong>
      <p style={{margin:'3px 0 7px',color:'#b1c7d2',overflowWrap:'anywhere'}}>{date(center.startIndex)} — {date(center.endIndex)}</p>
      <div style={{display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}><span>{t('上沿 ZG','Upper ZG')}</span><b style={{fontFamily:'var(--mono)',fontWeight:500,color:'#e3ecf0'}}>{priceText(center.high)}</b></div>
      <div style={{display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}><span>{t('下沿 ZD','Lower ZD')}</span><b style={{fontFamily:'var(--mono)',fontWeight:500,color:'#e3ecf0'}}>{priceText(center.low)}</b></div>
    </article>):<p style={{fontSize:14,color:'#a9bec9',marginBottom:12}}>{t('尚未形成','Not formed')}</p>}
    </section>)}
  </details>;
}
