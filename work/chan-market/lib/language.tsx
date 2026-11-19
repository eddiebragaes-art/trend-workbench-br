"use client";
// Modificado para trend-workbench-br: idioma português (pt-BR) como padrão.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { WORKBENCH_BRAND } from './workbench-brand';
import { localeFor, pickText, type UiLanguage } from './i18n-pt.ts';

export type Language=UiLanguage;
export const LANGUAGES:Language[]=['pt','en','zh'];
type LanguageContextValue={language:Language;setLanguage:(language:Language)=>void;t:(zh:string,en:string)=>string;locale:string};
const LanguageContext=createContext<LanguageContextValue>({language:'pt',setLanguage:()=>{},t:(zh,en)=>pickText('pt',zh,en),locale:'pt-BR'});
export function LanguageProvider({children}:{children:ReactNode}) {
  const [language,updateLanguage]=useState<Language>('pt');
  // The persisted preference belongs to the browser; SSR always starts in Portuguese.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{try{const saved=localStorage.getItem('chan-language-v1');if(saved==='en'||saved==='zh')updateLanguage(saved);}catch{}},[]);
  const setLanguage=useCallback((next:Language)=>{updateLanguage(next);try{localStorage.setItem('chan-language-v1',next);}catch{}},[]);
  useEffect(()=>{document.documentElement.lang=localeFor(language);document.title=WORKBENCH_BRAND.name[language];},[language]);
  const t=useCallback((zh:string,en:string)=>pickText(language,zh,en),[language]);
  const value=useMemo(()=>({language,setLanguage,t,locale:localeFor(language)}),[language,setLanguage,t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
export const useLanguage=()=>useContext(LanguageContext);
