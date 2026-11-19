"use client";
// Adicionado em trend-workbench-br: laboratório de mesa proprietária (backtest + Monte Carlo + EV por ticket).
import {useState} from 'react';
import {useLanguage} from '@/lib/language';
import type {Instrument,Interval,MarketData} from '@/lib/market-types';
import {readMarketResponse} from '../lib/market-response.ts';
import {backtestSignals,LUCID_50K,MIN_TRADES,RISKS,STOP_AFTER,runGrid,spanDays,type BacktestTrade,type EvalRules,type SetupId,type SignalLevel} from '../lib/prop-lab.ts';

type Grid=ReturnType<typeof runGrid>;
const pause=()=>new Promise(r=>setTimeout(r,0));

export default function PropLab({data,watchlist,interval}:{data:MarketData|null;watchlist:Instrument[];interval:Interval}) {
  const {t,locale}=useLanguage();
  const [ticket,setTicket]=useState(100),[payout,setPayout]=useState(1500),[targetR,setTargetR]=useState(2),[maxHold,setMaxHold]=useState(48);
  const [rules,setRules]=useState<EvalRules>(LUCID_50K),[levels,setLevels]=useState<'both'|SignalLevel>('both'),[useFavorites,setUseFavorites]=useState(true),[rate,setRate]=useState<number|''>('');
  const [running,setRunning]=useState(false),[progress,setProgress]=useState(''),[trades,setTrades]=useState<BacktestTrade[]>([]),[days,setDays]=useState(0),[grid,setGrid]=useState<Grid|null>(null),[view,setView]=useState<SetupId|'all'>('all'),[errors,setErrors]=useState<string[]>([]);
  const money=(v:number)=>v.toLocaleString(locale,{style:'currency',currency:'USD',maximumFractionDigits:0});
  const pct=(v:number)=>`${(v*100).toFixed(0)}%`;
  const setupName=(s:SetupId|'all')=>({all:t('全部信号','All signals'),first:t('一买/一卖','1st buy/sell'),second:t('二买/二卖','2nd buy/sell'),third:t('类三买/卖','3rd buy/sell'),weakening:t('盘整力度减弱','Range weakening')})[s];
  const stopName=(n:number)=>n===0?t('不限','No limit'):t(`${n}次亏损后停`,`Stop after ${n} loss${n>1?'es':''}`);

  async function run() {
    if(running)return;
    setRunning(true);setGrid(null);setErrors([]);
    const all:BacktestTrade[]=[],failed:string[]=[];let span=0;
    const sources:{symbol:string;load:()=>Promise<MarketData>}[]=[];
    if(data)sources.push({symbol:data.instrument.symbol,load:async()=>data});
    if(useFavorites)for(const i of watchlist){if(data&&i.market===data.instrument.market&&i.symbol===data.instrument.symbol)continue;sources.push({symbol:i.symbol,load:async()=>readMarketResponse(await fetch(`/api/candles?market=${i.market}&symbol=${encodeURIComponent(i.symbol)}&interval=${interval}&limit=1000`),{market:i.market,symbol:i.symbol,interval})});}
    const chosen:SignalLevel[]=levels==='both'?['segment','stroke']:[levels];
    for(const [n,source] of sources.entries()) {
      setProgress(t(`正在回测 ${source.symbol}（${n+1}/${sources.length}）…`,`Backtesting ${source.symbol} (${n+1}/${sources.length})…`));await pause();
      try {
        const market=await source.load(),candles=market.candles.filter(c=>c.closed!==false);
        span=Math.max(span,spanDays(candles));
        for(const level of chosen){all.push(...backtestSignals(candles,source.symbol,level,{targetR,maxHoldBars:maxHold}));await pause();}
      } catch { failed.push(source.symbol); }
    }
    setProgress(t('正在模拟账户…','Simulating evaluations…'));await pause();
    const result=runGrid(all,span,rules,{sims:2000,ticket,payout,seed:20261119,...(rate!==''?{tradesPerDay:rate}:{})});
    setTrades(all);setDays(span);setGrid(result);setView(result.recommendation?.setup??'all');setErrors(failed);setProgress('');setRunning(false);
  }

  const shown=grid?.groups.find(g=>g.setup===view);
  const rec=grid?.recommendation;
  const num=(v:number,set:(n:number)=>void)=>(e:React.ChangeEvent<HTMLInputElement>)=>{const n=Number(e.target.value);if(Number.isFinite(n)&&n>=0)set(n);else set(v);};
  return <section className="forecast-activity prop-lab panel" aria-label={t('自营账户实验室','Prop-firm lab')}>
    <div className="card-top"><strong>{t('自营账户实验室','Prop-firm lab')}</strong><span>{t('每张门票的期望值','EV per ticket')}</span></div>
    <p className="watch-monitor-note">{t('自营账户像一张期权：门票约$100，通过后可提现。这里先在历史K线上回测缠论信号（不使用未来数据），再按账户规则做蒙特卡洛模拟，找出每张门票期望值最高的风险和信号。','A prop account works like an option: the ticket costs about $100 and passing unlocks a payout. This backtests the Chan signals on past candles (no look-ahead), then runs a Monte Carlo of the account rules to find the risk and setup with the best EV per ticket.')}</p>
    <div className="paper-rules">
      <label>{t('门票价格','Ticket price')}<input type="number" min="0" value={ticket} onChange={num(ticket,setTicket)}/></label>
      <label>{t('平均提现','Average payout')}<input type="number" min="0" value={payout} onChange={num(payout,setPayout)}/></label>
      <label>{t('单日最大亏损','Daily loss limit')}<input type="number" min="1" value={rules.dailyLoss} onChange={num(rules.dailyLoss,v=>setRules({...rules,dailyLoss:v}))}/></label>
      <label>{t('最大回撤','Maximum drawdown')}<input type="number" min="1" value={rules.maxDrawdown} onChange={num(rules.maxDrawdown,v=>setRules({...rules,maxDrawdown:v}))}/></label>
      <label>{t('盈利目标','Profit target')}<input type="number" min="1" value={rules.profitTarget} onChange={num(rules.profitTarget,v=>setRules({...rules,profitTarget:v}))}/></label>
      <label>{t('最多交易天数','Max trading days')}<input type="number" min="1" value={rules.maxDays} onChange={num(rules.maxDays,v=>setRules({...rules,maxDays:Math.max(1,Math.round(v))}))}/></label>
      <label>{t('触及单日亏损时','When the daily loss is hit')}<select value={rules.dailyLossMode} onChange={e=>setRules({...rules,dailyLossMode:e.target.value as EvalRules['dailyLossMode']})}><option value="fail">{t('账户失败','Account fails')}</option><option value="pause">{t('当日停止交易','Stop for the day')}</option></select></label>
      <label>{t('止盈（R倍数）','Target (R multiple)')}<input type="number" min="0.5" step="0.5" value={targetR} onChange={num(targetR,setTargetR)}/></label>
      <label>{t('最长持仓K线','Max bars in trade')}<input type="number" min="1" value={maxHold} onChange={num(maxHold,v=>setMaxHold(Math.max(1,Math.round(v))))}/></label>
      <label>{t('信号级别','Signal level')}<select value={levels} onChange={e=>setLevels(e.target.value as typeof levels)}><option value="both">{t('线段+笔','Segments + strokes')}</option><option value="segment">{t('线段','Segments')}</option><option value="stroke">{t('笔','Strokes')}</option></select></label>
      <label>{t('每日交易次数（空=按回测）','Trades per day (blank = from backtest)')}<input type="number" min="0" step="0.1" value={rate} onChange={e=>setRate(e.target.value===''?'':Math.max(0,Number(e.target.value)||0))}/></label>
      <label className="paper-check"><input type="checkbox" checked={useFavorites} onChange={e=>setUseFavorites(e.target.checked)}/>{t('包含自选标的','Include favorites')}</label>
    </div>
    <div className="journal-controls"><span className="micro-copy">{progress||t('使用当前周期','Uses the current timeframe')+` (${interval})`}</span><button onClick={()=>void run()} disabled={running||!data}>{running?t('运行中…','Running…'):t('运行实验','Run lab')}</button></div>
    {errors.length>0&&<p className="activity-warning">{t('以下标的无法加载：','Could not load: ')}{errors.join(', ')}</p>}
    {grid&&<>
      {rec?<div className="lab-recommendation"><b>{t('推荐','Recommendation')}</b> {setupName(rec.setup)} · {t('每笔风险','Risk per trade')} {money(rec.result.risk)} · {stopName(rec.result.stopAfterLosses)}
        <span>{t('通过概率','Pass probability')} <b>{pct(rec.result.pass)}</b> · {t('每张门票期望值','EV per ticket')} <b className={rec.result.ev<0?'neg':'pos'}>{money(rec.result.ev)}</b> · {t('平均达标天数','Average days to target')} <b>{rec.result.meanDays===null?'—':rec.result.meanDays.toFixed(0)}</b></span>
        {rec.smallSample&&<small>{t(`样本少于${MIN_TRADES}笔，结论不可靠。可加入更多自选标的或更长周期。`,`Fewer than ${MIN_TRADES} trades: not reliable. Add more favorites or use more history.`)}</small>}
        {rec.result.ev<=0&&<small>{t('所有组合的期望值都不为正：按这些信号和规则，买门票长期会亏钱。','No combination has a positive EV: with these signals and rules, buying tickets loses money over time.')}</small>}</div>
      :<p className="activity-warning">{t('回测没有产生交易。请加入更多标的或换一个周期。','The backtest produced no trades. Add more symbols or try another timeframe.')}</p>}
      <table className="lab-table"><thead><tr><th>{t('信号','Setup')}</th><th>{t('交易','Trades')}</th><th>{t('胜率','Win rate')}</th><th>{t('平均R','Avg R')}</th><th>{t('盈亏比','Profit factor')}</th><th>{t('最长连亏','Worst losing streak')}</th><th>{t('每日','Per day')}</th></tr></thead>
        <tbody>{grid.groups.map(g=><tr key={g.setup} className={g.setup===view?'selected':''} onClick={()=>setView(g.setup)}><td>{setupName(g.setup)}</td><td>{g.stats.trades}</td><td>{g.stats.trades?`${g.stats.winRate.toFixed(0)}%`:'—'}</td><td className={g.stats.avgR<0?'neg':'pos'}>{g.stats.trades?g.stats.avgR.toFixed(2):'—'}</td><td>{g.stats.profitFactor===null?'—':g.stats.profitFactor.toFixed(2)}</td><td>{g.stats.maxLosingStreak}</td><td>{g.stats.tradesPerDay.toFixed(2)}</td></tr>)}</tbody></table>
      <p className="micro-copy">{t(`回测：${trades.length}笔，约${days.toFixed(0)}天。点击一行查看该信号的模拟。`,`Backtest: ${trades.length} trades over about ${days.toFixed(0)} days. Click a row to see its simulation.`)}</p>
      {shown&&shown.stats.trades>0&&<table className="lab-table"><thead><tr><th>{t('每笔风险','Risk per trade')}</th>{STOP_AFTER.map(n=><th key={n}>{stopName(n)}</th>)}</tr></thead>
        <tbody>{RISKS.map(risk=><tr key={risk}><td>{money(risk)}</td>{STOP_AFTER.map(n=>{const r=shown.results.find(x=>x.risk===risk&&x.stopAfterLosses===n)!;const best=rec&&rec.setup===view&&rec.result.risk===risk&&rec.result.stopAfterLosses===n;return <td key={n} className={best?'best':''}><b className={r.ev<0?'neg':'pos'}>{money(r.ev)}</b><small>{pct(r.pass)} · {r.meanDays===null?'—':`${r.meanDays.toFixed(0)}d`}</small></td>;})}</tr>)}</tbody></table>}
      <p className="micro-copy">{t('每格：每张门票期望值，下方为通过概率和平均达标天数。期望值 = 通过概率 × 平均提现 − 门票。模拟2000次，从回测结果有放回抽样，期限内未完成按无提现计算。历史结果不保证未来，未计手续费与滑点。','Each cell: EV per ticket, with pass probability and average days to target below. EV = pass probability × average payout − ticket. 2,000 simulations bootstrap the backtest outcomes; attempts unfinished within the day limit earn nothing. Past results do not guarantee the future; fees and slippage are not included.')}</p>
    </>}
  </section>;
}
