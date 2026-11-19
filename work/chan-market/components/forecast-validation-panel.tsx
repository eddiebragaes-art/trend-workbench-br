"use client";
// Modificado para trend-workbench-br: suporte a pt-BR e identidade própria.
import { localeFor, pickText } from '../lib/i18n-pt.ts';
import {useState} from 'react';
import {useLanguage,type Language} from '@/lib/language';
import {loadForecastValidationReport,type ValidationReportResult,type ValidationSummary} from '@/lib/forecast-validation-report';
import {forecastPeriod} from './forecast-copy';

const marketNames={crypto:['加密货币','Crypto'],us:['美股','US equities'],cn:['A股','A-shares'],br:['巴西B3','B3 equities'],fut:['指数与商品','Indices & commodities']} as const;
export function ForecastValidationResults({summary,language}:{summary:ValidationSummary;language:Language}) {
  const t=(zh:string,en:string)=>pickText(language,zh,en);
  const insufficient=summary.results.some(r=>r.baseline.completed<30||r.shadow.completed<30||r.baseline.sampleStatus==='insufficient'||r.shadow.sampleStatus==='insufficient');
  const number=(value:number|null)=>value===null?'—':`${value.toFixed(2)} R`;
  return <>
    <p className="validation-context">{insufficient?t('历史对照 · 样本不足，趋势筛选未启用','Historical comparison · insufficient sample; trend filter remains disabled'):t('历史对照 · 仍待验证，趋势筛选未启用','Historical comparison · unvalidated; trend filter remains disabled')}</p>
    <p className="validation-date">{t('报告生成：','Report generated: ')}<time dateTime={summary.generatedAt}>{new Date(summary.generatedAt).toLocaleString(localeFor(language),{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}</time></p>
    <div className="validation-table-scroll" tabIndex={0} role="region" aria-label={t('按市场与周期分别列出的历史对照','Historical comparisons separated by market and timeframe')}>
      <table className="validation-table">
        <caption>{t('各标的与周期单独计算，不合并统计','Each instrument and timeframe is calculated separately')}</caption>
        <thead><tr><th scope="col">{t('样本','Sample')}</th><th scope="col">{t('原预判已结束数','Baseline completed')}</th><th scope="col">{t('趋势筛选已结束数','Trend-filtered completed')}</th><th scope="col">{t('原预判平均净R','Baseline mean net R')}</th><th scope="col">{t('筛选后平均净R','Filtered mean net R')}</th></tr></thead>
        <tbody>{summary.results.map(row=>{
          const prefix=`${row.market}-`,suffix=`-${row.interval}`;
          const symbol=row.name.startsWith(prefix)&&row.name.endsWith(suffix)?row.name.slice(prefix.length,-suffix.length):row.name;
          return <tr key={`${row.market}:${row.interval}:${row.name}`}>
            <th scope="row"><strong>{symbol}</strong><span>{pickText(language,marketNames[row.market][0],marketNames[row.market][1])} · {forecastPeriod(row.interval,language)}</span><small>{t(`${row.closedBars}根K线 · ${row.folds}段验证`,`${row.closedBars} candles · ${row.folds} folds`)}</small></th>
            <td>{row.baseline.completed}</td><td>{row.shadow.completed}</td><td>{number(row.baseline.meanNetR)}</td><td>{number(row.shadow.meanNetR)}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <p className="validation-explanation">{t('R按最初止损距离计，已计假设成本；不是账户收益。','R uses the initial stop distance and includes assumed costs; it is not an account return.')}</p>
  </>;
}

export default function ForecastValidationPanel({language:override}:{language?:Language}) {
  const languageContext=useLanguage(),language=override??languageContext.language;
  const t=(zh:string,en:string)=>pickText(language,zh,en);
  const [report,setReport]=useState<ValidationReportResult|null>(null),[loading,setLoading]=useState(false);
  async function load(){
    if(loading||report)return;
    setLoading(true);setReport(await loadForecastValidationReport());setLoading(false);
  }
  function download(){
    if(report?.status!=='ready')return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(report.raw,null,2)],{type:'application/json;charset=utf-8'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download='forecast-validation-summary.json';anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),0);
  }
  return <details className="forecast-validation panel" data-testid="forecast-validation-panel" onToggle={event=>{if(event.currentTarget.open)void load();}}>
    <summary><span>{t('预判验证','Outlook validation')}</span><small>{t('查看历史对照','View historical comparison')}</small></summary>
    <div className="validation-content" aria-busy={loading}>
      {loading?<p role="status">{t('正在读取本机报告','Reading the local report')}</p>:report?.status==='ready'?<>
        <ForecastValidationResults summary={report.summary} language={language}/>
        <button type="button" className="validation-download" onClick={download}>{t('下载本次报告 JSON','Download this report as JSON')}</button>
      </>:<p className="validation-unverified">{t('当前模型尚未验证。','The current model has not been validated.')}</p>}
    </div>
  </details>;
}
