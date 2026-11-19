// Adicionado em trend-workbench-br: horário do pregão da B3.
// The B3 regular cash-equity session runs 10:00 to 17:00 (São Paulo) while
// New York observes daylight saving time and 10:00 to 18:00 otherwise
// (B3 follows the US clock change; closing call in the last 5 minutes).
// Exchange holidays are not modelled; a missing day only withholds data.

export const B3_ZONE = 'America/Sao_Paulo';
export const B3_OPEN_MINUTE = 600;

const nyOffset = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' });

/** True when New York is on daylight saving time at this instant. */
export function newYorkOnDst(time: number): boolean {
  const name = nyOffset.formatToParts(new Date(time * 1000)).find(p => p.type === 'timeZoneName')?.value ?? '';
  return name === 'GMT-4';
}

/** Session close in São Paulo minutes after midnight for the trading day containing `time`. */
export function b3CloseMinute(time: number): number {
  return newYorkOnDst(time) ? 17 * 60 : 18 * 60;
}

/** Yahoo symbol for a B3 ticker (indices such as ^BVSP keep their own form). */
export function b3YahooSymbol(symbol: string): string {
  return symbol.startsWith('^') ? symbol : `${symbol}.SA`;
}
