import type { MacroCalendarRawEvent, OHLCV } from './api';
import {
  evaluateMacroStrategy,
  getEventConfig,
  type MacroPair,
  type ConfirmationState,
  type OverlapState,
  type SpreadState,
  type StrategyResult,
  type SurpriseState,
} from './macroStrategy';

export const FOREX_PAIR_TICKERS: Record<MacroPair, string> = {
  'EUR/USD': 'EURUSD=X',
  'GBP/USD': 'GBPUSD=X',
  'USD/JPY': 'USDJPY=X',
  'AUD/USD': 'AUDUSD=X',
  'EUR/GBP': 'EURGBP=X',
  'EUR/JPY': 'EURJPY=X',
  'EUR/AUD': 'EURAUD=X',
  'GBP/JPY': 'GBPJPY=X',
  'GBP/AUD': 'GBPAUD=X',
  'AUD/JPY': 'AUDJPY=X',
};

export interface NormalizedMacroEvent {
  id: string;
  eventId: string;
  title: string;
  country: string;
  currency: 'USD' | 'EUR' | 'GBP' | 'JPY' | 'AUD';
  timestamp: number;
  isoTime: string;
  tier: 'S' | 'A' | 'B';
  importance: number;
  actualText: string;
  forecastText: string;
  previousText: string;
  sourceUrl: string;
  released: boolean;
  surprise: SurpriseState;
  surpriseNote: string;
  pairs: MacroPair[];
}

export interface AutoRecommendation extends StrategyResult {
  pair: MacroPair;
  eventTitle: string;
  eventTime: string;
  actualText: string;
  forecastText: string;
  sourceUrl: string;
}

export interface UpcomingMacroWatch {
  id: string;
  eventTitle: string;
  currency: string;
  eventTime: string;
  tier: 'S' | 'A' | 'B';
  pairs: MacroPair[];
}

export interface MacroTapeItem {
  id: string;
  currency: string;
  eventTitle: string;
  eventTime: string;
  tier: 'S' | 'A' | 'B';
  surprise: SurpriseState;
  surpriseNote: string;
  actualText: string;
  forecastText: string;
  previousText: string;
  pairs: MacroPair[];
  sourceUrl: string;
}

function parseMetricValue(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;

  const upper = text.toUpperCase().replace(/,/g, '');
  const match = upper.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  let value = Number(match[0]);
  if (!Number.isFinite(value)) return null;
  if (upper.includes('B')) value *= 1_000_000_000;
  else if (upper.includes('M')) value *= 1_000_000;
  else if (upper.includes('K')) value *= 1_000;

  return value;
}

function getForecastText(event: MacroCalendarRawEvent) {
  return (event.Forecast ?? event.TEForecast ?? '').trim();
}

function mapRawEvent(event: MacroCalendarRawEvent): {
  eventId: string;
  currency: 'USD' | 'EUR' | 'GBP' | 'JPY' | 'AUD';
} | null {
  const country = (event.Country ?? '').toLowerCase();
  const currencyCode = (event.Currency ?? '').toUpperCase();
  const title = `${event.Category ?? ''} ${event.Event ?? ''}`.toLowerCase();

  if (currencyCode === 'USD' || country.includes('united states')) {
    if (/interest rate|fomc|fed/.test(title)) return { eventId: 'fomc', currency: 'USD' };
    if (/non-farm employment change|nonfarm employment change|nonfarm payrolls|non farm payrolls/.test(title)) {
      return { eventId: 'us_nfp', currency: 'USD' };
    }
    if ((/inflation|consumer price index|cpi/.test(title)) && !/producer|ppi/.test(title)) return { eventId: 'us_cpi', currency: 'USD' };
    if (/retail sales/.test(title)) return { eventId: 'us_retail', currency: 'USD' };
    return null;
  }

  if ((currencyCode === 'EUR' || country.includes('euro area')) && /interest rate|deposit facility|deposit rate|refinancing rate|ecb/.test(title)) {
    return { eventId: 'ecb', currency: 'EUR' };
  }
  if ((currencyCode === 'GBP' || country.includes('united kingdom')) && /interest rate|official bank rate|bank rate|boe/.test(title)) {
    return { eventId: 'boe', currency: 'GBP' };
  }
  if ((currencyCode === 'JPY' || country.includes('japan')) && /interest rate|policy rate|boj/.test(title)) {
    return { eventId: 'boj', currency: 'JPY' };
  }
  if (currencyCode === 'AUD' || country.includes('australia')) {
    if (/interest rate|cash rate|rba/.test(title)) return { eventId: 'rba', currency: 'AUD' };
    if (/employment change/.test(title)) return { eventId: 'au_jobs', currency: 'AUD' };
  }

  return null;
}

function getThreshold(eventId: string) {
  switch (eventId) {
    case 'fomc':
    case 'ecb':
    case 'boe':
    case 'rba':
    case 'boj':
      return 0.05;
    case 'us_cpi':
      return 0.1;
    case 'us_retail':
      return 0.2;
    case 'us_nfp':
      return 20_000;
    case 'au_jobs':
      return 10_000;
    default:
      return 0.1;
  }
}

function getDirectionMode(eventId: string): 'higher' | 'lower' {
  if (eventId === 'minor') return 'higher';
  return 'higher';
}

function deriveSurprise(eventId: string, actualText: string, forecastText: string): { surprise: SurpriseState; note: string } {
  const actual = parseMetricValue(actualText);
  const forecast = parseMetricValue(forecastText);
  if (actual == null || forecast == null) {
    return { surprise: 'none', note: 'Chưa có đủ actual/forecast để đo surprise.' };
  }

  const diff = actual - forecast;
  const threshold = getThreshold(eventId);
  if (Math.abs(diff) < threshold) {
    return { surprise: 'none', note: 'Sai lệch so với forecast còn quá nhỏ.' };
  }

  const mode = getDirectionMode(eventId);
  const bullish = mode === 'higher' ? diff > 0 : diff < 0;
  return {
    surprise: bullish ? 'bullish' : 'bearish',
    note: bullish
      ? `Actual cao hơn forecast đủ rõ (${actualText} vs ${forecastText}).`
      : `Actual thấp hơn forecast đủ rõ (${actualText} vs ${forecastText}).`,
  };
}

function toTimestamp(value: string) {
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? Math.floor(ts / 1000) : 0;
}

function buildDirection(result: StrategyResult) {
  return result.direction.startsWith('BUY') || result.direction.startsWith('SELL');
}

function getDirectionSide(direction: string) {
  if (direction.startsWith('BUY')) return 'BUY';
  if (direction.startsWith('SELL')) return 'SELL';
  return '';
}

function deriveConfirmation(chart: OHLCV | null, eventTime: number, direction: string): ConfirmationState {
  if (!chart?.timestamp.length || !chart.high?.length || !chart.low?.length) return 'none';
  const nextHourStart = Math.floor(eventTime / 3600) * 3600 + 3600;
  const idx = chart.timestamp.findIndex((ts) => ts >= nextHourStart);
  if (idx < 3) return 'none';

  const preHigh = Math.max(...chart.high.slice(idx - 3, idx));
  const preLow = Math.min(...chart.low.slice(idx - 3, idx));
  const eventClose = chart.close[idx];
  const prevClose = chart.close[idx - 1];
  const side = getDirectionSide(direction);

  if (side === 'BUY') {
    if (eventClose > preHigh) return 'strong';
    if (eventClose > prevClose) return 'weak';
    return 'none';
  }

  if (side === 'SELL') {
    if (eventClose < preLow) return 'strong';
    if (eventClose < prevClose) return 'weak';
    return 'none';
  }

  return 'none';
}

function derivePreMove(chart: OHLCV | null, eventTime: number, direction: string) {
  if (!chart?.timestamp.length || !chart.high?.length || !chart.low?.length) return false;
  const nextHourStart = Math.floor(eventTime / 3600) * 3600 + 3600;
  const idx = chart.timestamp.findIndex((ts) => ts >= nextHourStart);
  if (idx < 4) return false;

  const preClose = chart.close[idx - 1];
  const earlierHigh = Math.max(...chart.high.slice(idx - 4, idx - 1));
  const earlierLow = Math.min(...chart.low.slice(idx - 4, idx - 1));
  const side = getDirectionSide(direction);

  if (side === 'BUY') return preClose > earlierHigh;
  if (side === 'SELL') return preClose < earlierLow;
  return false;
}

function deriveOverlap(events: NormalizedMacroEvent[], current: NormalizedMacroEvent): OverlapState {
  const nearby = events
    .filter((event) => event.id !== current.id)
    .filter((event) => Math.abs(event.timestamp - current.timestamp) <= 3 * 3600);

  if (nearby.some((event) => event.tier === 'S')) return 'tier_s';
  if (nearby.some((event) => event.tier === 'A')) return 'tier_a';
  return 'none';
}

export function normalizeMacroCalendar(events: MacroCalendarRawEvent[]): NormalizedMacroEvent[] {
  return events
    .map((event) => {
      const mapped = mapRawEvent(event);
      if (!mapped) return null;

      const config = getEventConfig(mapped.eventId);
      const actualText = (event.Actual ?? '').trim();
      const forecastText = getForecastText(event);
      const released = actualText.length > 0;
      const { surprise, note } = deriveSurprise(mapped.eventId, actualText, forecastText);
      const isoTime = (event.Date ?? '').trim();
      const timestamp = toTimestamp(isoTime);

      if (!timestamp) return null;

      return {
        id: `${event.CalendarId ?? mapped.eventId}-${timestamp}`,
        eventId: mapped.eventId,
        title: (event.Event ?? event.Category ?? config.title).trim() || config.title,
        country: (event.Country ?? '').trim(),
        currency: mapped.currency,
        timestamp,
        isoTime,
        tier: config.tier,
        importance: Number(event.Importance ?? 0) || 0,
        actualText,
        forecastText,
        previousText: (event.Previous ?? '').trim(),
        sourceUrl: (event.SourceURL ?? '').trim(),
        released,
        surprise,
        surpriseNote: note,
        pairs: config.pairs,
      };
    })
    .filter((event): event is NormalizedMacroEvent => event !== null)
    .sort((a, b) => b.timestamp - a.timestamp);
}

export function buildAutoRecommendations(
  events: NormalizedMacroEvent[],
  charts: Partial<Record<MacroPair, OHLCV | null>>,
): AutoRecommendation[] {
  const now = Math.floor(Date.now() / 1000);
  const recentEvents = events.filter((event) => event.released && event.timestamp >= now - 36 * 3600);
  const results: AutoRecommendation[] = [];

  for (const pair of Object.keys(FOREX_PAIR_TICKERS) as MacroPair[]) {
    let best: AutoRecommendation | null = null;
    for (const event of recentEvents) {
      if (!event.pairs.includes(pair)) continue;
      const base = getEventConfig(event.eventId);
      const preview = evaluateMacroStrategy({
        pair,
        eventId: event.eventId,
        surprise: event.surprise,
        confirmation: 'none',
        overlap: 'none',
        spread: 'normal',
        preMove: false,
      });
      if (!buildDirection(preview)) continue;

      const direction = preview.direction;
      const confirmation = deriveConfirmation(charts[pair] ?? null, event.timestamp, direction);
      const preMove = derivePreMove(charts[pair] ?? null, event.timestamp, direction);
      const overlap = deriveOverlap(recentEvents, event);
      const spread: SpreadState = 'normal';
      const evaluated = evaluateMacroStrategy({
        pair,
        eventId: event.eventId,
        surprise: event.surprise,
        confirmation,
        overlap,
        spread,
        preMove,
      });

      const candidate: AutoRecommendation = {
        ...evaluated,
        pair,
        eventTitle: base.title,
        eventTime: event.isoTime,
        actualText: event.actualText,
        forecastText: event.forecastText,
        sourceUrl: event.sourceUrl,
      };

      if (!best || candidate.confidence > best.confidence) best = candidate;
    }

    if (best) results.push(best);
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

export function buildUpcomingWatchlist(events: NormalizedMacroEvent[]): UpcomingMacroWatch[] {
  const now = Math.floor(Date.now() / 1000);
  return events
    .filter((event) => event.timestamp >= now && event.timestamp <= now + 24 * 3600)
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(0, 8)
    .map((event) => ({
      id: event.id,
      eventTitle: event.title,
      currency: event.currency,
      eventTime: event.isoTime,
      tier: event.tier,
      pairs: event.pairs,
    }));
}

export function buildRecentMacroTape(events: NormalizedMacroEvent[]): MacroTapeItem[] {
  const now = Math.floor(Date.now() / 1000);
  return events
    .filter((event) => event.released)
    .filter((event) => event.timestamp >= now - 10 * 24 * 3600)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 10)
    .map((event) => ({
      id: event.id,
      currency: event.currency,
      eventTitle: event.title,
      eventTime: event.isoTime,
      tier: event.tier,
      surprise: event.surprise,
      surpriseNote: event.surpriseNote,
      actualText: event.actualText,
      forecastText: event.forecastText,
      previousText: event.previousText,
      pairs: event.pairs,
      sourceUrl: event.sourceUrl,
    }));
}
