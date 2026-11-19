// Modificado para trend-workbench-br: aceita os mercados B3 e índices/commodities.
import {FORECAST_MODEL_VERSION,FORECAST_PARAMETER_VERSION} from './forecast.ts';
import type {Interval,Market} from './market-types';

export interface ValidationComparison {
  completed:number; meanNetR:number|null; sampleStatus:'insufficient'|'unvalidated';
}
export interface ValidationReportRow {
  name:string;market:Market;interval:Interval;closedBars:number;folds:number;
  baseline:ValidationComparison;shadow:ValidationComparison;
}
export interface ValidationSummary {
  generatedAt:string;modelVersions:string[];parameterVersions:string[];analysisVersions:string[];
  engineUnchanged:true;matchesInstalledBuild:true;results:ValidationReportRow[];
}
export type ValidationReportResult={status:'ready';summary:ValidationSummary;raw:unknown}|{status:'unverified'};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const count=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const strings=(value:unknown):value is string[]=>Array.isArray(value)&&value.length>0&&value.length<=20&&value.every(v=>typeof v==='string'&&v.length>0&&v.length<100)&&new Set(value).size===value.length;
const versionMatches=(value:unknown,expected:string)=>strings(value)&&value.length===1&&value[0]===expected;
function comparison(value:unknown):value is ValidationComparison {
  if(!object(value)||!count(value.completed)||!['insufficient','unvalidated'].includes(String(value.sampleStatus)))return false;
  if(value.completed<30&&value.sampleStatus!=='insufficient')return false;
  return value.completed===0?value.meanNetR===null:typeof value.meanNetR==='number'&&Number.isFinite(value.meanNetR);
}
function row(value:unknown):value is ValidationReportRow {
  return object(value)&&typeof value.name==='string'&&value.name.length>0&&value.name.length<=160
    &&['crypto','us','cn','br','fut'].includes(String(value.market))&&['1m','5m','15m','30m','1h','4h','1d','1w','1M'].includes(String(value.interval))
    &&count(value.closedBars)&&count(value.folds)&&comparison(value.baseline)&&comparison(value.shadow)
    &&(value.modelVersions===undefined||versionMatches(value.modelVersions,FORECAST_MODEL_VERSION))
    &&(value.parameterVersions===undefined||versionMatches(value.parameterVersions,FORECAST_PARAMETER_VERSION));
}
/** Never mix old models or malformed summary rows into this model's report. */
export function parseForecastValidationReport(raw:unknown):ValidationReportResult {
  if(!object(raw)||typeof raw.generatedAt!=='string'||!Number.isFinite(Date.parse(raw.generatedAt))
    ||raw.engineUnchanged!==true||raw.matchesInstalledBuild!==true||!strings(raw.modelVersions)||!strings(raw.parameterVersions)||!strings(raw.analysisVersions)
    ||!versionMatches(raw.modelVersions,FORECAST_MODEL_VERSION)||!versionMatches(raw.parameterVersions,FORECAST_PARAMETER_VERSION)
    ||!Array.isArray(raw.results)||raw.results.length===0||raw.results.length>64||!raw.results.every(row)
    ||new Set(raw.results.map(r=>`${r.market}:${r.interval}:${r.name}`)).size!==raw.results.length)return {status:'unverified'};
  return {status:'ready',summary:{generatedAt:raw.generatedAt,modelVersions:[...raw.modelVersions],parameterVersions:[...raw.parameterVersions],analysisVersions:[...raw.analysisVersions],engineUnchanged:true,matchesInstalledBuild:true,results:raw.results},raw};
}
type SummaryFetcher=(url:string,options:{cache:'no-cache'})=>Promise<{ok:boolean;json:()=>Promise<unknown>}>;
/** One promise per page load, including failures. Construction performs no I/O. */
export function createForecastValidationLoader(fetcher:SummaryFetcher=(url,options)=>fetch(url,options)) {
  let pending:Promise<ValidationReportResult>|undefined;
  return ()=>pending??=Promise.resolve().then(async()=>{
    try {
      const response=await fetcher('/forecast-validation.json',{cache:'no-cache'});
      return response.ok?parseForecastValidationReport(await response.json()):{status:'unverified' as const};
    }catch{return {status:'unverified' as const};}
  });
}
export const loadForecastValidationReport=createForecastValidationLoader();
