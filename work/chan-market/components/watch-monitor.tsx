"use client";
// Modificado para trend-workbench-br: suporte a pt-BR e identidade própria.
import { localeFor, pickText } from '../lib/i18n-pt.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Instrument, Interval } from '@/lib/market-types';
import { useLanguage } from '@/lib/language';
import { createWatchMonitor, selectWatchInstruments, type WatchRow, type WatchSnapshot } from '@/lib/watch-monitor';
import { marketDisplayText, translateInstrumentName } from '@/lib/market-i18n';
import { priceText } from './terminal-chart';

export interface WatchMonitorProps {
  watchlist:Instrument[];interval:Interval;enabled?:boolean;
  onEnabledChange?:(enabled:boolean)=>void;onSnapshot?:(snapshot:WatchSnapshot)=>void;
}
export default function WatchMonitor({watchlist,interval,enabled:controlledEnabled,onEnabledChange,onSnapshot}:WatchMonitorProps) {
  const {t,language,locale}=useLanguage();
  const [localEnabled,setLocalEnabled]=useState(false),[rows,setRows]=useState<Record<string,WatchRow>>({});
  const enabled=controlledEnabled??localEnabled;
  const callback=useRef(onSnapshot);
  useEffect(()=>{callback.current=onSnapshot;},[onSnapshot]);
  const instruments=useMemo(()=>selectWatchInstruments(watchlist),[watchlist]);
  useEffect(()=>{
    if(!enabled)return;
    const monitor=createWatchMonitor({watchlist:instruments,interval,
      onSnapshot:snapshot=>callback.current?.(snapshot),
      onStatus:row=>setRows(previous=>{const next:Record<string,WatchRow>={};for(const i of instruments){const key=`${i.market}:${i.symbol}`;if(previous[key])next[key]=previous[key];}next[`${row.instrument.market}:${row.instrument.symbol}`]=row;return next;}),
    });
    monitor.start();return()=>monitor.stop();
  },[enabled,instruments,interval]);
  function toggle(){const next=!enabled;if(controlledEnabled===undefined)setLocalEnabled(next);onEnabledChange?.(next);}
  return <section className="watch-monitor panel" aria-label={t('自选监测','Watchlist monitoring')}>
    <header className="watch-monitor-heading"><div><h2>{t('自选监测','Watchlist monitor')}</h2><p>{enabled?t('开窗运行 · 每轮至少间隔60秒','While this window is open · at least 60s between rounds'):t('已关闭 · 不占用监测请求','Off · no monitoring requests')}</p></div><button className={`watch-monitor-toggle ${enabled?'active':''}`} aria-pressed={enabled} disabled={!instruments.length} onClick={toggle}>{enabled?t('停止监测','Stop monitoring'):t('开启监测','Start monitoring')}</button></header>
    <p className="watch-monitor-note">{t(`当前周期 ${interval}，监测前 ${instruments.length} 个自选（最多12个）。只提醒新变化，关闭窗口后停止。`,`Interval ${interval}; monitoring the first ${instruments.length} saved symbols (maximum 12). Alerts cover new changes only. Closing the window stops monitoring.`)}</p>
    {!instruments.length?<p className="empty-watch">{t('先把标的加入自选，再开启监测。','Add instruments to the watchlist before starting.')}</p>:<div className="watch-monitor-table-wrap"><table className="watch-monitor-table"><thead><tr><th>{t('标的','Symbol')}</th><th>{t('行情状态','Feed state')}</th><th>{t('最近K线价格','Latest bar price')}</th><th>{t('最近检查','Last check')}</th></tr></thead><tbody>{instruments.map(instrument=>{
      const candidate=rows[`${instrument.market}:${instrument.symbol}`],row=candidate?.interval===interval?candidate:undefined;
      const state=!enabled?t('已停止','Stopped'):row?.state==='loading'?t('获取中','Fetching'):row?.state==='waiting'||!row?t('排队中','Queued'):row.health?t(row.health.label,row.health.labelEn):t('等待数据','Waiting');
      return <tr key={instrument.id}><td><b>{instrument.symbol}</b><small>{translateInstrumentName(instrument.name,language)}</small></td><td className={`feed-${row?.health?.state||'unknown'}`} title={row?.health?marketDisplayText(t(row.health.detail,row.health.detailEn),language):''}>{state}</td><td title={row?.source ? marketDisplayText(row.source,language) : undefined}>{row?.price!=null?priceText(row.price):'—'}</td><td>{row?.checkedAtMs?new Date(row.checkedAtMs).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):'—'}</td></tr>;
    })}</tbody></table></div>}
  </section>;
}
