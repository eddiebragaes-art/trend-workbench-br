// Modificado para trend-workbench-br: textos da análise em português.
// Works on the English output of translateAnalysis(…,'en'), so prices,
// timestamps, IDs and model states stay identical across languages.
import type { Analysis, TradeDecision, TradePlan } from './market-types';
import { toPt } from './i18n-pt.ts';

const side = (s: string) => s === 'long' ? 'compra' : s === 'short' ? 'venda' : s;

const exact: Record<string, string> = {
  // Factors
  'Center position': 'Posição vs. centro', 'Segment direction': 'Direção do segmento', 'Latest stroke': 'Último bi', 'MACD momentum': 'Momento do MACD',
  'Price is above the latest segment center.': 'O preço está acima do centro de segmento mais recente.',
  'Price is below the latest segment center.': 'O preço está abaixo do centro de segmento mais recente.',
  'Price remains inside the latest segment center.': 'O preço continua dentro do centro de segmento mais recente.',
  'No confirmed segment center is available.': 'Ainda não há centro de segmento confirmado.',
  'The latest confirmed segment points up.': 'O último segmento confirmado aponta para cima.',
  'The latest confirmed segment points down.': 'O último segmento confirmado aponta para baixo.',
  'Insufficient confirmed segments.': 'Segmentos confirmados insuficientes.',
  'The latest confirmed stroke points up; the developing stroke is excluded.': 'O último bi confirmado aponta para cima; o bi em formação fica de fora.',
  'The latest confirmed stroke points down; the developing stroke is excluded.': 'O último bi confirmado aponta para baixo; o bi em formação fica de fora.',
  'Insufficient valid strokes.': 'Bis válidos insuficientes.',
  'The MACD histogram is positive; used as supporting evidence.': 'O histograma do MACD está positivo; usado como evidência de apoio.',
  'The MACD histogram is negative; used as supporting evidence.': 'O histograma do MACD está negativo; usado como evidência de apoio.',
  'The MACD histogram is near zero.': 'O histograma do MACD está perto de zero.',
  'Positive contribution to the structure score.': 'Contribuição positiva para a nota da estrutura.',
  'Negative contribution to the structure score.': 'Contribuição negativa para a nota da estrutura.',
  'No directional contribution to the structure score.': 'Sem contribuição direcional para a nota da estrutura.',
  // Bias labels
  'Insufficient history': 'Histórico insuficiente', 'Bullish structure': 'Estrutura altista', 'Bearish structure': 'Estrutura baixista', 'Balanced structure': 'Estrutura equilibrada',
  'Segment center': 'Centro de segmento',
  // Warnings
  'Segments use an experimental feature-sequence implementation, including gap, no-gap and strong reverse-break cases. Complex inclusion and unusual segments require chart review; a unique decomposition under all original rules is not claimed.': 'Os segmentos usam uma implementação experimental da sequência de características, com os casos com gap, sem gap e de quebra forte. Inclusões complexas e segmentos incomuns exigem revisão no gráfico; não se afirma uma decomposição única segundo todas as regras originais.',
  'Centers are the minimum structures formed by confirmed segments. Full recursive levels and cross-timeframe nesting are not implemented. Third-class-like points and divergence remain algorithmic signals.': 'Os centros são a menor estrutura formada por segmentos confirmados. A recursão completa de níveis e o encaixe entre períodos não estão implementados. Pontos tipo terceira compra/venda e divergências continuam sendo sinais algorítmicos.',
  'Long/short percentages are weighted structure scores, not win rates, position sizing or execution probabilities. Dashed paths illustrate conditional scenarios.': 'Os percentuais de compra/venda são notas ponderadas da estrutura, não taxas de acerto, tamanho de posição nem probabilidade de execução. As linhas tracejadas ilustram cenários condicionais.',
  'Historical outcomes classify close-to-close returns over a fixed bar horizon using ±0.2%. Fees, slippage and trading constraints are excluded; these are not strategy returns.': 'Os resultados históricos classificam o retorno entre fechamentos num horizonte fixo de velas, usando ±0,2%. Taxas, slippage e restrições de negociação ficam de fora; não são retornos de estratégia.',
  'Fewer than 60 valid closed bars are available; structure and statistics have limited history.': 'Há menos de 60 velas fechadas válidas; a estrutura e as estatísticas têm histórico limitado.',
  'A 50/50 score is a neutral placeholder for insufficient history, not a confirmed balanced structure.': 'A nota 50/50 é um valor neutro por falta de histórico, não uma estrutura equilibrada confirmada.',
  'Forward annotations are conditional reference levels. Horizontal spacing is for layout, not a predicted execution time or month; actual structure must be reviewed as it develops.': 'As marcações à frente são níveis de referência condicionais. O espaçamento horizontal é só visual, não prevê horário nem mês de execução; a estrutura real precisa ser revista conforme se forma.',
  'The unfinished bar is displayed for price context and excluded from structure, scoring and historical statistics.': 'A vela ainda aberta aparece só como contexto de preço e fica fora da estrutura, da nota e das estatísticas históricas.',
  'This window has too few valid strokes. Load more history or select another interval.': 'Esta janela tem poucos bis válidos. Carregue mais histórico ou escolha outro período.',
  'Trade plans map confirmed structure and recent volatility into fixed entry bands, stops and risk-multiple targets. Model triggers do not imply fills; plans are recalculated as new structure becomes available.': 'Os planos de trade convertem a estrutura confirmada e a volatilidade recente em faixas de entrada, stops e alvos em múltiplos de risco. Um acionamento do modelo não significa execução; os planos são recalculados quando surge nova estrutura.',
  'Structural signals use an experimental implementation. Complete recursive Chan validation still requires review; the labels do not certify exact original-rule buy/sell points.': 'Os sinais de estrutura usam uma implementação experimental. A validação recursiva completa de Chan ainda exige revisão; os rótulos não certificam pontos de compra/venda exatos pelas regras originais.',
  'Long/short percentages measure relative structural bias, not the probability of profit or a recommended position size.': 'Os percentuais de compra/venda medem o viés estrutural relativo, não a probabilidade de lucro nem um tamanho de posição recomendado.',
  'Forward levels and paths are model scenarios. Horizontal spacing is illustrative and does not forecast event dates or guarantee execution.': 'Os níveis e trajetórias à frente são cenários do modelo. O espaçamento horizontal é ilustrativo e não prevê datas nem garante execução.',
  'Experimental structure analysis: verify the available history, calculation rules and market conditions before using these references.': 'Análise de estrutura experimental: confira o histórico disponível, as regras de cálculo e as condições de mercado antes de usar estas referências.',
  "Trade plans provide reference entry bands, stops and targets. ATR buffers and 1.5R/2.5R targets are this tool's strategy rules. Closed bars update model status, not actual fills. Horizontal spacing does not predict event dates, and targets are not guaranteed.": 'Os planos de trade dão faixa de entrada, stop e alvos de referência. As margens pelo ATR e os alvos de 1,5R/2,5R são regras desta ferramenta. Velas fechadas atualizam o status do modelo, não execuções reais. O espaçamento horizontal não prevê datas, e os alvos não são garantidos.',
  // Signals
  '3B-like': 'Tipo 3ª compra', '3S-like': 'Tipo 3ª venda',
  'Bullish divergence': 'Divergência de alta', 'Bearish divergence': 'Divergência de baixa', 'Downside weakening': 'Queda perdendo força', 'Upside weakening': 'Alta perdendo força',
  'After an upward departure, the confirmed return segment remains above the center high. Recursive lower-level completion has not been verified; this is a third-buy-like signal.': 'Depois de uma saída para cima, o segmento de retorno confirmado ficou acima do topo do centro. A conclusão recursiva no nível inferior não foi verificada; é um sinal do tipo terceira compra.',
  'After a downward departure, the confirmed return segment remains below the center low. Recursive lower-level completion has not been verified; this is a third-sell-like signal.': 'Depois de uma saída para baixo, o segmento de retorno confirmado ficou abaixo do fundo do centro. A conclusão recursiva no nível inferior não foi verificada; é um sinal do tipo terceira venda.',
  // Scenarios
  'Return to range': 'Retorno à faixa', 'Range continuation': 'Continuação lateral',
  'A completed departure and retest switches the analysis to the corresponding directional scenario.': 'Uma saída e um reteste completos mudam a análise para o cenário direcional correspondente.',
  'Monitor the range boundaries and formation of new centers. A return to the range or continued ranging is not guaranteed.': 'Acompanhe as bordas da faixa e a formação de novos centros. Não há garantia de retorno à faixa nem de continuação lateral.',
  'Upward breakout and retest': 'Rompimento para cima e reteste', 'Downward break and retest': 'Perda para baixo e reteste',
  'Support retest and extension': 'Reteste do suporte e extensão', 'Resistance retest and extension': 'Reteste da resistência e extensão',
  'Return, then break up': 'Retorno e depois rompimento para cima', 'Return, then break down': 'Retorno e depois perda para baixo',
  // Setups
  'Third-buy reference': 'Referência de 3ª compra', 'Third-sell reference': 'Referência de 3ª venda', 'Center buy reference': 'Referência de compra no centro', 'Center sell reference': 'Referência de venda no centro', 'Buy reference': 'Referência de compra', 'Sell reference': 'Referência de venda',
  // Plans
  'Long plan': 'Plano de compra', 'Short plan': 'Plano de venda', 'Local structure breakout': 'Rompimento da estrutura próxima', 'Local structure breakdown': 'Perda da estrutura próxima',
  'Not triggered': 'Não acionado', 'Triggered': 'Acionado', 'Invalidated': 'Invalidado', 'Target reached': 'Alvo atingido',
  'No closed bar after plan creation has met the entry conditions.': 'Nenhuma vela fechada depois da criação do plano atendeu às condições de entrada.',
  'The same bar covers both the stop and a target. Intrabar order is unknown; the plan is invalidated and no profit is recorded.': 'A mesma vela passou pelo stop e por um alvo. A ordem dentro da vela é desconhecida; o plano é invalidado e nenhum lucro é registrado.',
  'A closed bar covers the stop price; the model plan is invalidated.': 'Uma vela fechada passou pelo preço do stop; o plano do modelo foi invalidado.',
  'A closed bar covers the second target. This is a price event, not evidence of a fill or return.': 'Uma vela fechada passou pelo segundo alvo. É um evento de preço, não prova de execução nem de retorno.',
  'Triggered; the first target has been covered. The remaining plan tracks the original stop and second target.': 'Acionado; o primeiro alvo foi atingido. O restante do plano acompanha o stop original e o segundo alvo.',
  'An earlier close triggered the plan. The current close is outside the entry band; do not chase at the current price.': 'Um fechamento anterior acionou o plano. O fechamento atual está fora da faixa de entrada; não persiga o preço atual.',
  'An earlier close triggered the plan. The latest closed candle is outside the original entry band; keep tracking the original stop and targets.': 'Um fechamento anterior acionou o plano. A última vela fechada está fora da faixa de entrada original; continue acompanhando o stop e os alvos originais.',
  'An earlier close triggered the plan. The latest closed candle is within the original entry band; keep tracking the original stop and targets.': 'Um fechamento anterior acionou o plano. A última vela fechada está dentro da faixa de entrada original; continue acompanhando o stop e os alvos originais.',
  'The same bar contains both the trigger and stop. Their order is unknown; skip this plan.': 'A mesma vela contém o gatilho e o stop. A ordem é desconhecida; pule este plano.',
  'The stop boundary was breached before entry; the reference structure and plan are invalidated.': 'O stop foi rompido antes da entrada; a estrutura de referência e o plano foram invalidados.',
  'The close skipped the entry band. This plan is invalidated to avoid chasing.': 'O fechamento pulou a faixa de entrada. O plano foi invalidado para não perseguir o preço.',
  'The trigger bar also covers a target before its close can establish entry. Skip the plan because the intrabar sequence is not established.': 'A vela do gatilho também atingiu um alvo antes de o fechamento confirmar a entrada. Pule o plano, porque a sequência dentro da vela não é conhecida.',
  'A target was covered before entry. This opportunity has passed; do not enter using the original entry band.': 'Um alvo foi atingido antes da entrada. A oportunidade passou; não entre usando a faixa de entrada original.',
  'A closed bar met the crossing and entry-band rules. This is a model trigger, not evidence of a live fill.': 'Uma vela fechada atendeu às regras de cruzamento e de faixa de entrada. É um acionamento do modelo, não prova de execução real.',
  'No entry occurred within 12 closed bars after creation; the plan expired.': 'Não houve entrada em 12 velas fechadas após a criação; o plano expirou.',
  'A target was covered before entry. This opportunity has passed; the plan is invalidated.': 'Um alvo foi atingido antes da entrada. A oportunidade passou; o plano foi invalidado.',
  'The bar covers conflicting trigger, stop or target events. Their intrabar sequence is unknown; the plan is invalidated.': 'A vela contém eventos conflitantes de gatilho, stop ou alvo. A sequência dentro da vela é desconhecida; o plano foi invalidado.',
  'The model status follows closed-bar entry, stop, target and expiry rules; it is not an execution record.': 'O status do modelo segue as regras de entrada, stop, alvo e validade em velas fechadas; não é um registro de execução.',
  // Decision
  'At least three valid completed candles are needed to build a structure-based trade plan.': 'São necessárias pelo menos três velas concluídas válidas para montar um plano de trade baseado na estrutura.',
  'Current plans ended': 'Planos atuais encerrados',
  'No plan remains waiting or under tracking. Later completed candles must establish a new plan.': 'Nenhum plano segue aguardando ou em acompanhamento. As próximas velas concluídas precisam formar um novo plano.',
  'No new direction': 'Sem nova direção',
  'Direction is unclear. Previous plans remain available for review.': 'A direção está indefinida. Os planos anteriores continuam disponíveis para consulta.',
  'Direction is unclear. Wait for later candles to finish and establish a clear signal.': 'A direção está indefinida. Espere as próximas velas fecharem e formarem um sinal claro.',
};

const patterns: [RegExp, (...m: string[]) => string][] = [
  [/^Only (\d+) comparable historical samples are available, fewer than 20\. The results are not calibrated probabilities\.$/, (_, n) => `Há só ${n} amostras históricas comparáveis, menos de 20. Os resultados não são probabilidades calibradas.`],
  [/^(\d+) invalid, duplicate or out-of-order bars were excluded\. Check the data source\.$/, (_, n) => `${n} velas inválidas, duplicadas ou fora de ordem foram excluídas. Verifique a fonte de dados.`],
  [/^A same-direction segment makes a new (low|high) with a smaller absolute MACD histogram area than the prior comparison segment\. (.*) This is an algorithmic divergence signal; (.*)$/, (_, lh, ctx) =>
    `Um segmento na mesma direção faz nova ${lh === 'low' ? 'mínima' : 'máxima'} com área absoluta do histograma do MACD menor que a do segmento anterior de comparação. ${ctx.startsWith('Two') ? 'Dois candidatos a centro separados na mesma direção dão o contexto de tendência.' : 'Falta o contexto completo de tendência; indica perda de força em lateralidade.'} É um sinal algorítmico de divergência; os níveis recursivos e os segmentos de comparação ainda precisam ser revistos.`],
  [/^A close must first return inside (.+); then monitor movement between the boundaries\.$/, (_, b) => `Um fechamento precisa primeiro voltar para dentro de ${b}; depois, acompanhe o movimento entre as bordas.`],
  [/^Price remains inside (.+) without a completed departure and a retest that stays outside the range\.$/, (_, b) => `O preço continua dentro de ${b}, sem uma saída completa seguida de reteste que fique fora da faixa.`],
  [/^(First return inside (.+?)\. )?(Price is already (above|below) the range\. A retest of (\S+) must stay outside it\.|A close must break (above|below) (\S+), followed by a retest that holds this boundary\.) Review the lower-level structure before treating the extension as valid\.$/, (_, first, band, _b, ab1, e1, ab2, e2) =>
    `${first ? `Primeiro, voltar para dentro de ${band}. ` : ''}${ab1 ? `O preço já está ${ab1 === 'above' ? 'acima' : 'abaixo'} da faixa. Um reteste de ${e1} precisa ficar fora dela.` : `Um fechamento precisa romper ${ab2 === 'above' ? 'acima de' : 'abaixo de'} ${e2}, seguido de um reteste que segure essa borda.`} Revise a estrutura do nível inferior antes de considerar a extensão válida.`],
  [/^The retest returns (below|above) (\S+); (\S+) is the further invalidation boundary\.$/, (_, ba, e, f) => `O reteste volta para ${ba === 'below' ? 'abaixo' : 'acima'} de ${e}; ${f} é a borda de invalidação seguinte.`],
  [/^If the conditions hold, monitor (\S+)\. This range-width projection does not guarantee arrival\.$/, (_, t) => `Se as condições se confirmarem, observe ${t}. Esta projeção pela largura da faixa não garante que o preço chegue lá.`],
  [/^After a (upward|downward) departure, review a completed lower-level retest at (\S+) that stays (above|below) the boundary\. (.*?) A single bar crossin.*$/, (_, ud, p, ab, rest) =>
    `Depois de uma saída para ${ud === 'upward' ? 'cima' : 'baixo'}, confira um reteste completo no nível inferior em ${p} que fique ${ab === 'above' ? 'acima' : 'abaixo'} da borda. ${rest.startsWith('Only') ? 'Só o primeiro reteste válido pode formar um ponto de terceira classe.' : 'Este é um centro antigo; é preciso uma estrutura nova e válida, e um novo reteste não vira automaticamente um ponto de terceira classe.'} Uma única vela cruzando o nível não basta para confirmar.`],
  [/^Review a return toward (\S+) without a new (low|high), a confirmed (bottom|top) fractal and an? (upward|downward) stroke\..*$/, (_, p, lh, bt, ud) =>
    `Observe um retorno até ${p} sem nova ${lh === 'low' ? 'mínima' : 'máxima'}, um fractal de ${bt === 'bottom' ? 'fundo' : 'topo'} confirmado e um bi para ${ud === 'upward' ? 'cima' : 'baixo'}. Confira a divergência e a conclusão no nível inferior antes de classificar o ponto de Chan. Só tocar o preço não basta.`],
  [/^A (low below|high above) (\S+) invalidates this reference\..*$/, (_, lh, p) => `Uma ${lh === 'low below' ? 'mínima abaixo' : 'máxima acima'} de ${p} invalida esta referência. Reavalie a estrutura; um primeiro reteste antigo não pode ser reutilizado.`],
  [/^Reference level (\S+) is the center (high \(ZG\)|low \(ZD\))\..*$/, (_, p, hl) => `O nível de referência ${p} é o ${hl.startsWith('high') ? 'topo (ZG)' : 'fundo (ZD)'} do centro. O ponto real depende de um reteste futuro concluído; não é um preço de execução conhecido de antemão.`],
  [/^Based on the latest (closed-bar extreme|confirmed fractal).*$/, (_, k) => `Baseado ${k.startsWith('closed') ? 'no extremo da última vela fechada, ainda aguardando a formação de fractal' : 'no último fractal ou ponta de bi confirmado'}. Não há centro de segmento confirmado. As condições de tendência, divergência e recursão para pontos de primeira, segunda ou terceira classe estão incompletas.`],
  [/^A later closed bar must cross (up|down) through (\S+) and close inside (\S+)\. A close beyond the band is skipped; do not chase\.$/, (_, ud, t, band) => `Uma vela fechada posterior precisa cruzar ${ud === 'up' ? 'para cima' : 'para baixo'} ${t} e fechar dentro de ${band}. Um fechamento além da faixa é ignorado; não persiga o preço.`],
  [/^A (low at or below|high at or above) (\S+) invalidates the plan\..*$/, (_, lh, s) => `Uma ${lh.startsWith('low') ? 'mínima igual ou abaixo' : 'máxima igual ou acima'} de ${s} invalida o plano. Um plano não acionado expira após 12 velas fechadas. Gatilho e stop/alvo na mesma vela contam como plano ambíguo e invalidado.`],
  [/^(.+?)\. (The old center is far from current price and provides directional context only\. )?ATR14=(\S+?)(?:; execution buffer=(\S+))?, bounded to.*$/, (_, src, old, atr, buf) =>
    `${({ 'The nearest confirmed top fractal': 'Fractal de topo confirmado mais próximo', 'The nearest confirmed bottom fractal': 'Fractal de fundo confirmado mais próximo', 'A nearby center boundary': 'Borda de um centro próximo', 'The nearest confirmed stroke endpoint': 'Ponta de bi confirmada mais próxima' } as Record<string, string>)[src] ?? 'Limites derivados das últimas 8 velas fechadas e da volatilidade (nenhum nível estrutural próximo cabe na faixa de preço válida)'}. ${old ? 'O centro antigo está longe do preço atual e serve só como contexto de direção. ' : ''}ATR14=${atr}${buf ? `; margem de execução=${buf}` : ''}, limitada entre 0,2% e 10% do preço de criação; a faixa de entrada tem 0,25 margem de largura. Os stops usam a estrutura oposta próxima, com distância de risco limitada. T1/T2 projetam 1,5R/2,5R a partir da borda conservadora da faixa de entrada. São regras desta ferramenta, não regras originais de Chan para alvos fixos nem probabilidades de lucro calibradas.`],
  [/^(Long|Short) plan triggered · tracking$/, (_, ls) => `Plano de ${ls === 'Long' ? 'compra' : 'venda'} acionado · acompanhando`],
  [/^The (long|short) plan triggered earlier; continue tracking its original stop and targets\.(.*)$/, (_, s, rest) =>
    `O plano de ${side(s)} foi acionado antes; continue acompanhando seu stop e alvos originais.${rest.includes('has not triggered') ? ` O plano de ${side(s === 'long' ? 'short' : 'long')} não foi acionado e aguarda as condições de fechamento da vela.` : rest.includes('ended') ? ` O plano de ${side(s === 'long' ? 'short' : 'long')} terminou; não há novo acionamento no sentido oposto.` : ''}`],
  [/^Waiting for candle-close confirmation · (.+)$/, (_, l) => `Aguardando confirmação no fechamento da vela · ${exact[l] ?? l}`],
  [/^(Neither plan has triggered|The (long|short) plan has not triggered)\. A candle at the selected interval.*$/, (_, all, s) =>
    `${s ? `O plano de ${side(s)} não foi acionado` : 'Nenhum dos planos foi acionado'}. Uma vela do período escolhido precisa fechar com preço que cruze o gatilho e fique dentro da faixa de entrada para o status mudar para acionado.`],
];

export function analysisTextPt(en: string): string {
  if (!en) return en;
  if (exact[en] !== undefined) return exact[en];
  for (const [re, fn] of patterns) { const m = en.match(re); if (m) return fn(...m); }
  return toPt(en);
}

const tx = analysisTextPt;
function planPt(p: TradePlan): TradePlan {
  return { ...p, label: tx(p.label), strategy: tx(p.strategy), statusLabel: tx(p.statusLabel), trigger: tx(p.trigger), invalidation: tx(p.invalidation), basis: tx(p.basis), statusReason: tx(p.statusReason),
    ...(p.previousOutcome ? { previousOutcome: { ...p.previousOutcome, reason: tx(p.previousOutcome.reason) } } : {}) };
}

/** Input is the English analysis produced by translateAnalysis(…,'en'). */
export function analysisToPt(a: Analysis): Analysis {
  const extended = a as Analysis & { tradePlans?: TradePlan[]; decision?: TradeDecision };
  return {
    ...a,
    centers: a.centers.map(c => ({ ...c, level: tx(c.level) })),
    signals: a.signals.map(s => ({ ...s, label: tx(s.label), reason: tx(s.reason) })),
    scenarios: a.scenarios.map(s => ({ ...s, title: tx(s.title), trigger: tx(s.trigger), invalidation: tx(s.invalidation), target: tx(s.target) })),
    tradeSetups: a.tradeSetups.map(s => ({ ...s, label: tx(s.label), trigger: tx(s.trigger), invalidation: tx(s.invalidation), basis: tx(s.basis) })),
    bias: { ...a.bias, label: tx(a.bias.label), factors: a.bias.factors.map(f => ({ ...f, name: tx(f.name), detail: tx(f.detail) })) },
    calibration: { ...a.calibration, method: a.calibration.method
      .replace(/^Rolling prefixes; three-factor distance ≤1 across center position, confirmed stroke direction and MACD sign\. Non-overlapping samples every (\d+) bars\./, 'Prefixos móveis; distância ≤1 nos três fatores: posição vs. centro, direção do bi confirmado e sinal do MACD. Amostras sem sobreposição a cada $1 velas.')
      .replace('Fewer than 20 samples: descriptive only, with no future probability estimate.', 'Menos de 20 amostras: só descritivo, sem estimar probabilidade futura.')
      .replace('Historical frequencies without independent out-of-sample calibration.', 'Frequências históricas sem calibração independente fora da amostra.')
      .replace('The interval is the 95% Wilson interval for the upward frequency.', 'O intervalo é o de Wilson de 95% para a frequência de alta.') },
    warnings: a.warnings.map(tx),
    ruleVersion: a.ruleVersion.replace('2007-09-18 new-stroke rules', 'regras de bi novas (2007-09-18)').replace('lesson 62 old-stroke rules', 'regras de bi antigas (aula 62)').replace('closed bars only', 'só velas fechadas'),
    ...(extended.tradePlans ? { tradePlans: extended.tradePlans.map(planPt) } : {}),
    ...(extended.decision ? { decision: { ...extended.decision, title: tx(extended.decision.title), summary: tx(extended.decision.summary) } } : {}),
  };
}
