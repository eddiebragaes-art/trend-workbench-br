"use client";
// Adicionado em trend-workbench-br: painel da conta virtual (paper trading) com regras de mesa proprietária.
import {useEffect,useMemo,useState} from 'react';
import {useLanguage} from '@/lib/language';
import type {ForecastJournal} from '@/lib/forecast-journal';
import {computePaperAccount,PROP_PROFILES,paperTradesCsv,profileRules,readPaperSettings,sanitizeRules,writePaperSettings,type PaperAccountSettings,type PropRules} from '../lib/paper-account.ts';
import {priceText} from './terminal-chart';

type NumberRule='initialBalance'|'riskPerTrade'|'dailyLoss'|'maxDrawdown'|'profitTarget'|'maxOpenTrades'|'feeBps'|'slippageBps';
const FIELDS:[NumberRule,string,string][]=[
  ['initialBalance','初始资金','Starting balance'],['riskPerTrade','每笔风险','Risk per trade'],['dailyLoss','单日最大亏损','Daily loss limit'],
  ['maxDrawdown','最大回撤','Maximum drawdown'],['profitTarget','盈利目标','Profit target'],['maxOpenTrades','最多同时持仓','Max open trades'],
  ['feeBps','单边手续费（基点）','Fee per side (bps)'],['slippageBps','单边滑点（基点）','Slippage per side (bps)'],
];

export default function PaperAccountPanel({journal}:{journal:ForecastJournal}) {
  const {t,locale}=useLanguage();
  const [settings,setSettings]=useState<PaperAccountSettings|null>(null),[profile,setProfile]=useState(PROP_PROFILES[0].id),[confirmReset,setConfirmReset]=useState(false);
  // Browser-only storage; there is no server-side equivalent to hydrate from.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{setSettings(readPaperSettings());},[]);
  const save=(next:PaperAccountSettings|null)=>{setSettings(next);writePaperSettings(next);};
  const account=useMemo(()=>settings?computePaperAccount(journal.records,settings):null,[journal,settings]);
  const money=(v:number)=>v.toLocaleString(locale,{style:'currency',currency:'USD',maximumFractionDigits:2});
  const time=(s:number)=>new Date(s*1000).toLocaleString(locale,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  const profileName=(id:string)=>id==='custom'?t('自定义','Custom'):PROP_PROFILES.find(p=>p.id===id)?.name??id;
  const update=(patch:Partial<PropRules>)=>{if(settings)save({...settings,rules:sanitizeRules({...settings.rules,...patch})});};
  const exportCsv=()=>{if(!account)return;const url=URL.createObjectURL(new Blob([paperTradesCsv(account)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='virtual-account-trades.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

  if(!settings||!account) return <section className="forecast-activity paper-account panel" aria-label={t('模拟账户','Virtual account')}>
    <div className="card-top"><strong>{t('模拟账户','Virtual account')}</strong><span>{t('未开始','Not started')}</span></div>
    <p className="watch-monitor-note">{t('用虚拟资金自动跟随本工具的预判：入场条件满足即开仓，按止损和止盈平仓，并检查自营交易账户规则。不会发送真实订单。','Follow this tool\'s outlooks with virtual money: a trade opens when the entry condition is met, closes at the stop or targets, and is checked against prop-firm rules. No real orders are sent.')}</p>
    <div className="journal-controls"><label>{t('账户规则','Account rules')}<select value={profile} onChange={e=>setProfile(e.target.value)}>{PROP_PROFILES.map(p=><option key={p.id} value={p.id}>{profileName(p.id)}</option>)}</select></label>
      <button onClick={()=>save({version:1,startedAt:Math.floor(Date.now()/1000),rules:profileRules(profile)})}>{t('开始模拟账户','Start virtual account')}</button></div>
  </section>;

  const r=account.rules,open=account.trades.filter(x=>x.status==='open'),closed=account.trades.filter(x=>x.status==='closed').reverse();
  const statusLabel=account.status==='passed'?t('已达标','Profit target reached'):account.status==='failed'?t('已违规','Rule breached'):t('进行中','Active');
  const progress=r.profitTarget>0?Math.max(0,Math.min(100,(account.balance-r.initialBalance)/r.profitTarget*100)):0;
  const reason=(kind:string)=>kind==='daily-loss'?t('超过单日最大亏损','Daily loss limit breached'):t('超过最大回撤','Maximum drawdown breached');
  const exitName=(x:string)=>({target1:t('止盈1','Take-profit 1'),target2:t('止盈2','Take-profit 2'),stop:t('止损','Stop'),ambiguous:t('先后不明（按止损）','Ambiguous (booked as stop)'),'data-gap':t('数据断档','Data gap')} as Record<string,string>)[x]??x;
  return <section className="forecast-activity paper-account panel" aria-label={t('模拟账户','Virtual account')}>
    <div className="card-top"><strong>{t('模拟账户','Virtual account')} · {profileName(r.profile)}</strong><span className={`paper-status ${account.status}`}>{statusLabel}</span></div>
    {account.violations.map(v=><p key={v.kind+v.at} className="activity-warning">{reason(v.kind)} · {time(v.at)} · {t('余额','Balance')} {money(v.balance)} · {t('限额','Limit')} {money(v.limit)}</p>)}
    <div className="journal-metrics paper-metrics">
      <span>{t('余额','Balance')} <b>{money(account.balance)}</b></span>
      <span>{t('含浮动盈亏','Equity')} <b>{money(account.equity)}</b></span>
      <span>{t('今日盈亏','Today\'s P&L')} <b className={account.dayPnl<0?'neg':'pos'}>{money(account.dayPnl)}</b> <small>/ −{money(account.dayLimit)}</small></span>
      <span>{t('回撤底线','Drawdown floor')} <b>{money(account.floor)}</b> <small>{t('剩余','left')} {money(Math.max(0,account.balance-account.floor))}</small></span>
      <span>{t('盈利目标','Profit target')} <b>{money(account.target)}</b> <small>{progress.toFixed(0)}%</small></span>
      <span>{t('胜率','Win rate')} <b>{account.stats.winRate===null?'—':`${account.stats.winRate.toFixed(0)}%`}</b> <small>{account.stats.wins}/{account.stats.closed}</small></span>
    </div>
    <div className="paper-progress" aria-hidden="true"><i style={{width:`${progress}%`}}/></div>
    <p className="micro-copy">{t('自动入场：每条已记录预判的入场条件满足时开仓。要同时跟踪多个标的，请打开自选监控并保持窗口开启。余额只计算已平仓；违规按已实现盈亏检查，交易日在纽约时间17:00重置。','Automatic entries: every recorded outlook whose entry condition is met opens a trade. To follow several symbols, turn on the favorites monitor and keep this window open. Violations are checked on realized P&L; the trading day resets at 17:00 New York time.')}</p>
    <details className="journal-details" open={open.length>0}><summary>{t('持仓','Open trades')} <span>{open.length}</span></summary>
      {!open.length&&<p className="empty-mini">{t('暂无持仓。','No open trades.')}</p>}
      {open.map(x=><p key={x.id} className="paper-trade"><b>{x.symbol} · {x.interval} · {x.side==='long'?t('买入','Buy'):t('卖出','Sell')}</b> {t('入场','Entry')} {priceText(x.entry)} · {t('止损','Stop')} {priceText(x.stop)} · {t('止盈','Targets')} {priceText(x.targets[0])} / {priceText(x.targets[1])} · {t('数量','Size')} {x.remaining.toPrecision(4)} · <span className={x.unrealized<0?'neg':'pos'}>{money(x.unrealized)}</span> <small>{time(x.openedAt)}</small></p>)}
    </details>
    <details className="journal-details"><summary>{t('已平仓','Closed trades')} <span>{closed.length}</span></summary>
      {closed.slice(0,50).map(x=><p key={x.id} className="paper-trade"><b>{x.symbol} · {x.interval} · {x.side==='long'?t('买入','Buy'):t('卖出','Sell')}</b> {priceText(x.entry)} → {x.fills.map(f=>`${exitName(f.reason)} ${priceText(f.price)}`).join(', ')} · <span className={x.pnl<0?'neg':'pos'}>{money(x.pnl)}</span> <small>{time(x.openedAt)}</small></p>)}
      {account.skipped.length>0&&<p className="micro-copy">{t(`另有${account.skipped.length}个信号因持仓上限或账户已结束而未开仓。`,`${account.skipped.length} more signals were not taken (open-trade limit or account closed).`)}</p>}
    </details>
    <details className="journal-details"><summary>{t('账户规则','Account rules')}</summary>
      <div className="paper-rules">{FIELDS.map(([key,zh,en])=><label key={key}>{t(zh,en)}<input type="number" min="0" step="any" value={r[key]} onChange={e=>update({[key]:Number(e.target.value),profile:'custom'})}/></label>)}
        <label>{t('回撤方式','Drawdown type')}<select value={r.drawdownMode} onChange={e=>update({drawdownMode:e.target.value as PropRules['drawdownMode'],profile:'custom'})}><option value="static">{t('固定','Static')}</option><option value="trailing">{t('跟踪','Trailing')}</option></select></label>
        <label className="paper-check"><input type="checkbox" checked={r.partialAtTarget1} onChange={e=>update({partialAtTarget1:e.target.checked,profile:'custom'})}/>{t('止盈1平一半','Close half at take-profit 1')}</label></div>
      <p className="micro-copy">{t('修改规则会按新规则重算本账户的全部记录。','Changing a rule recalculates every trade in this account with the new rules.')}</p>
    </details>
    <div className="journal-controls"><span className="micro-copy">{t('开始于','Started')} {time(account.startedAt)}</span><span>
      <button onClick={exportCsv} disabled={!account.trades.length}>{t('导出交易CSV','Export trades CSV')}</button>{' '}
      {confirmReset?<><button onClick={()=>{save(null);setConfirmReset(false);}}>{t('确认重置','Confirm reset')}</button>{' '}<button onClick={()=>setConfirmReset(false)}>{t('取消','Cancel')}</button></>:<button onClick={()=>setConfirmReset(true)}>{t('重置账户','Reset account')}</button>}
    </span></div>
  </section>;
}
