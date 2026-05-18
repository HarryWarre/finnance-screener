export interface OHLCV {
  timestamp: number[];
  open?: number[];
  high?: number[];
  low?: number[];
  close: number[];
}

export interface Fundamentals {
  pe: number;
  roe: number;
}

export interface MacroCalendarRawEvent {
  CalendarId?: string | number;
  Date?: string;
  Country?: string;
  Category?: string;
  Event?: string;
  Reference?: string;
  Actual?: string;
  Previous?: string;
  Forecast?: string;
  TEForecast?: string;
  Importance?: number | string;
  Currency?: string;
  SourceURL?: string;
  LastUpdate?: string;
}

export interface MacroCalendarResponse {
  startDate: string;
  endDate: string;
  events: MacroCalendarRawEvent[];
  source: string;
}

export type MacroTrendBias = 'bullish' | 'bearish' | 'neutral';

export interface CurrencyMacroTrend {
  currency: 'USD' | 'EUR' | 'GBP' | 'JPY' | 'AUD';
  bias: MacroTrendBias;
  score: number;
  headline: string;
  signals: string[];
  updated: string;
  sourceUrls: string[];
}

export interface MacroTrendSnapshot {
  trends: CurrencyMacroTrend[];
}

const PROXY_URL = 'proxy.php'; // relative path — works in any subfolder on cPanel

const MAX_PARALLEL_PROXY_REQUESTS = 4;
let activeProxyRequests = 0;
const proxyRequestQueue: Array<() => void> = [];

async function runWithProxyConcurrencyLimit<T>(task: () => Promise<T>): Promise<T> {
  if (activeProxyRequests >= MAX_PARALLEL_PROXY_REQUESTS) {
    await new Promise<void>((resolve) => proxyRequestQueue.push(resolve));
  }
  activeProxyRequests += 1;
  try {
    return await task();
  } finally {
    activeProxyRequests -= 1;
    const next = proxyRequestQueue.shift();
    if (next) next();
  }
}

const proxyTextMemo = new Map<string, Promise<string>>();

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 6000): Promise<unknown> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

type YahooInterval = '1m' | '2m' | '5m' | '15m' | '30m' | '60m' | '90m' | '1h' | '1d' | '5d' | '1wk' | '1mo' | '3mo';
type YahooRange = '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y' | '10y' | 'ytd' | 'max';

const DEFAULT_RANGE_BY_INTERVAL: Record<YahooInterval, YahooRange> = {
  '1m': '5d',
  '2m': '1mo',
  '5m': '1mo',
  '15m': '3mo',
  '30m': '3mo',
  '60m': '6mo',
  '90m': '6mo',
  '1h': '6mo',
  '1d': '1y',
  '5d': '1y',
  '1wk': '5y',
  '1mo': '10y',
  '3mo': '10y',
};

export async function fetchChartData(
  symbol: string,
  interval: YahooInterval = '1d',
  range: YahooRange = DEFAULT_RANGE_BY_INTERVAL[interval]
): Promise<OHLCV | null> {
  try {
    const data = await fetchJsonWithTimeout(
      `${PROXY_URL}?action=chart&symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`,
      8000
    );

    if (!isRecord(data)) return null;
    const chart = data.chart;
    if (!isRecord(chart)) return null;
    const result = (Array.isArray(chart.result) ? chart.result[0] : null) as unknown;
    if (!isRecord(result)) return null;
    const timestamps = Array.isArray(result.timestamp) ? (result.timestamp as unknown[]).filter((n) => typeof n === 'number') as number[] : [];
    const indicators = result.indicators;
    const quote0 =
      isRecord(indicators) &&
      Array.isArray(indicators.quote) &&
      isRecord(indicators.quote[0])
        ? (indicators.quote[0] as Record<string, unknown>)
        : null;
    const closePrices =
      quote0 && Array.isArray(quote0.close)
        ? (quote0.close as unknown[])
        : [];
    const openPrices =
      quote0 && Array.isArray(quote0.open)
        ? (quote0.open as unknown[])
        : [];
    const highPrices =
      quote0 && Array.isArray(quote0.high)
        ? (quote0.high as unknown[])
        : [];
    const lowPrices =
      quote0 && Array.isArray(quote0.low)
        ? (quote0.low as unknown[])
        : [];
      
      // Filter out nulls
      const validTimestamps: number[] = [];
      const validOpens: number[] = [];
      const validHighs: number[] = [];
      const validLows: number[] = [];
      const validCloses: number[] = [];
      
    for (let i = 0; i < closePrices.length; i++) {
      const c = closePrices[i];
      const ts = timestamps[i];
      const o = openPrices[i];
      const h = highPrices[i];
      const l = lowPrices[i];
      if (
        typeof c === 'number' &&
        typeof ts === 'number' &&
        typeof o === 'number' &&
        typeof h === 'number' &&
        typeof l === 'number'
      ) {
        validTimestamps.push(ts);
        validOpens.push(o);
        validHighs.push(h);
        validLows.push(l);
        validCloses.push(c);
        }
      }
      
    if (validCloses.length < 2) return null;
    return {
      timestamp: validTimestamps,
      open: validOpens,
      high: validHighs,
      low: validLows,
      close: validCloses,
    };
  } catch {
    console.warn(`⚠️ Could not fetch chart data for ${symbol} (Might not exist on Yahoo)`);
    return null;
  }
}

export async function fetchSp500Symbols(opts?: { sector?: string; limit?: number }): Promise<string[]> {
  try {
    const res = await fetch(`${PROXY_URL}?action=sp500`);
    if (!res.ok) throw new Error('Proxy failed');
    const data = await res.json();
    const sectorFilter = (opts?.sector || '').trim().toLowerCase();
    const limit = Number.isFinite(opts?.limit) ? Math.max(1, opts!.limit!) : undefined;

    const constituents: unknown[] = Array.isArray(data?.constituents) ? data.constituents : [];
    if (constituents.length) {
      const list = constituents
        .filter((c: unknown) => {
          if (!sectorFilter) return true;
          const sector =
            typeof c === 'object' && c !== null && 'sector' in c && typeof (c as { sector?: unknown }).sector === 'string'
              ? (c as { sector: string }).sector
              : '';
          return sector.trim().toLowerCase() === sectorFilter;
        })
        .map((c: unknown) => {
          if (typeof c === 'object' && c !== null && 'symbol' in c && typeof (c as { symbol?: unknown }).symbol === 'string') {
            return (c as { symbol: string }).symbol;
          }
          return '';
        })
        .filter((s: string) => s.length > 0);
      return typeof limit === 'number' ? list.slice(0, limit) : list;
    }
    const symbols = Array.isArray(data?.symbols) ? data.symbols : [];
    const list = symbols.filter((s: unknown) => typeof s === 'string' && s.length > 0);
    return typeof limit === 'number' ? list.slice(0, limit) : list;
  } catch {
    console.warn('⚠️ Could not fetch S&P 500 symbols');
    return [];
  }
}

export type CotSummary = {
  instrument: string;
  reportDate: string;
  marketName: string;
  nonCommercialNet: number;
  nonCommercialZ52w: number | null;
  nonCommercialCotIndex3y: number | null;
};

export async function fetchCot(instrument: string): Promise<CotSummary | null> {
  try {
    const data = await fetchJsonWithTimeout(`${PROXY_URL}?action=cot&instrument=${encodeURIComponent(instrument)}`, 6000);
    if (!isRecord(data)) return null;
    if ('error' in data) return null;
    if (typeof data.report_date !== 'string' || !data.report_date) return null;
    const nc = isRecord(data.non_commercial) ? data.non_commercial : {};
    const net = typeof nc.net === 'number' ? nc.net : Number(nc.net ?? 0);
    const z52 = nc.zscore_52w === undefined || nc.zscore_52w === null ? null : Number(nc.zscore_52w);
    const idx3y = nc.cot_index_3y === undefined || nc.cot_index_3y === null ? null : Number(nc.cot_index_3y);
    return {
      instrument: typeof data.cftc_code === 'string' && data.cftc_code ? data.cftc_code : instrument,
      reportDate: data.report_date,
      marketName: typeof data.market_name === 'string' ? data.market_name : '',
      nonCommercialNet: net,
      nonCommercialZ52w: z52,
      nonCommercialCotIndex3y: idx3y,
    };
  } catch {
    return null;
  }
}

export type EnsoSummary = {
  asOf: string;
  oni: number;
  state: 'El Nino' | 'La Nina' | 'Neutral';
};

export async function fetchEnso(): Promise<EnsoSummary | null> {
  try {
    const data = await fetchJsonWithTimeout(`${PROXY_URL}?action=enso`, 6000);
    if (!isRecord(data) || typeof data.asOf !== 'string' || !data.asOf) return null;
    const stateRaw = typeof data.state === 'string' ? data.state : 'Neutral';
    const state: EnsoSummary['state'] =
      stateRaw === 'El Nino' || stateRaw === 'La Nina' || stateRaw === 'Neutral' ? stateRaw : 'Neutral';
    return { asOf: data.asOf, oni: Number(data.oni || 0), state };
  } catch {
    console.warn('⚠️ Could not fetch ENSO');
    return null;
  }
}

export type WasdeSummary = {
  commodity: 'corn' | 'soybean' | 'wheat';
  reportMonth: string;
  scope: 'us';
  marketYear: string | null;
  endingStocks: number | null;
  totalUse: number | null;
  stocksToUse: number | null;
};

export async function fetchWasde(commodity: WasdeSummary['commodity']): Promise<WasdeSummary | null> {
  try {
    const data = await fetchJsonWithTimeout(
      `${PROXY_URL}?action=wasde&commodity=${encodeURIComponent(commodity)}&scope=us`,
      6000
    );
    if (!isRecord(data)) return null;
    if ('error' in data) return null;
    return {
      commodity,
      reportMonth: typeof data.reportMonth === 'string' ? data.reportMonth : '',
      scope: 'us',
      marketYear: typeof data.marketYear === 'string' ? data.marketYear : null,
      endingStocks: data.endingStocks === null || data.endingStocks === undefined ? null : Number(data.endingStocks),
      totalUse: data.totalUse === null || data.totalUse === undefined ? null : Number(data.totalUse),
      stocksToUse: data.stocksToUse === null || data.stocksToUse === undefined ? null : Number(data.stocksToUse),
    };
  } catch {
    return null;
  }
}

export async function fetchFundamentals(symbol: string): Promise<Fundamentals | null> {
  try {
    const res = await fetch(`${PROXY_URL}?action=quote&symbol=${encodeURIComponent(symbol)}`);
    if (!res.ok) throw new Error("Proxy failed");
    const data = await res.json();

    if (data && data.quoteSummary && data.quoteSummary.result && data.quoteSummary.result[0]) {
      const result = data.quoteSummary.result[0];
      const pe = result.summaryDetail?.trailingPE?.raw || 0;
      const roe = result.financialData?.returnOnEquity?.raw || 0;
      // Convert ROE to percentage to match PineScript logic (where 10.0 means 10%)
      return { pe, roe: roe * 100 };
    }
    return { pe: 0, roe: 0 };
  } catch {
    console.warn(`⚠️ Could not fetch fundamentals for ${symbol} (Might not exist on Yahoo)`);
    return { pe: 0, roe: 0 }; // Return defaults on error
  }
}

const MACRO_FREE_CACHE_KEY = 'macro_free_calendar_cache_v2';
const MACRO_FREE_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const MACRO_TREND_CACHE_KEY = 'macro_free_trend_cache_v1';

type FreeMacroCalendarEntry = {
  title: string;
  country: string;
  date: string;
  impact: string;
  forecast: string;
  previous: string;
  url: string;
};

type MacroActualSnapshot = {
  actualText: string;
  sourceUrl: string;
};

type MacroActualCatalog = {
  usCpiYoy: MacroActualSnapshot | null;
  usCpiMom: MacroActualSnapshot | null;
  usNfp: MacroActualSnapshot | null;
  usRetail: MacroActualSnapshot | null;
  fomc: MacroActualSnapshot | null;
  ecb: MacroActualSnapshot | null;
  boe: MacroActualSnapshot | null;
};

function emptyMacroActualCatalog(): MacroActualCatalog {
  return {
    usCpiYoy: null,
    usCpiMom: null,
    usNfp: null,
    usRetail: null,
    fomc: null,
    ecb: null,
    boe: null,
  };
}

function normalizeMacroText(value: string) {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseCsvLine(line: string) {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (inQuotes) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
      continue;
    }

    if (character === ',') {
      out.push(current);
      current = '';
      continue;
    }

    current += character;
  }

  out.push(current);
  return out;
}

function getUsEasternOffset(date: Date) {
  const year = date.getUTCFullYear();

  const firstSunday = (monthZeroBased: number) => {
    const firstDay = new Date(Date.UTC(year, monthZeroBased, 1));
    const firstSundayDate = 1 + ((7 - firstDay.getUTCDay()) % 7);
    return firstSundayDate;
  };

  const secondSundayInMarch = firstSunday(2) + 7;
  const firstSundayInNovember = firstSunday(10);
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const isDst =
    month > 2 && month < 10
      ? true
      : month < 2 || month > 10
        ? false
        : month === 2
          ? day >= secondSundayInMarch
          : day < firstSundayInNovember;

  return isDst ? '-04:00' : '-05:00';
}

function buildForexFactoryIso(dateText: string, timeText: string) {
  const [monthRaw, dayRaw, yearRaw] = dateText.split('-').map((part) => part.trim());
  const timeMatch = timeText.trim().match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
  if (!monthRaw || !dayRaw || !yearRaw || !timeMatch) return '';

  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const year = Number(yearRaw);
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return '';

  let hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const meridiem = timeMatch[3].toLowerCase();

  if (meridiem === 'pm' && hours !== 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;

  const date = new Date(Date.UTC(year, month - 1, day, hours, minutes));
  const offset = getUsEasternOffset(date);
  const monthText = String(month).padStart(2, '0');
  const dayText = String(day).padStart(2, '0');
  const hourText = String(hours).padStart(2, '0');
  const minuteText = String(minutes).padStart(2, '0');
  return `${year}-${monthText}-${dayText}T${hourText}:${minuteText}:00${offset}`;
}

function mapForexFactoryCountry(country: string) {
  switch (country.trim().toUpperCase()) {
    case 'USD':
      return 'United States';
    case 'EUR':
      return 'Euro Area';
    case 'GBP':
      return 'United Kingdom';
    case 'JPY':
      return 'Japan';
    case 'AUD':
      return 'Australia';
    default:
      return country.trim().toUpperCase();
  }
}

function mapImpactToImportance(impact: string) {
  switch (impact.trim().toLowerCase()) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
    default:
      return 0;
  }
}

function pickMacroEventId(title: string, currencyCode: string) {
  const lowerTitle = title.toLowerCase();
  const code = currencyCode.trim().toUpperCase();

  if (code === 'USD') {
    if (/federal funds rate|fomc/.test(lowerTitle)) return 'fomc';
    if (/non-farm employment change|nonfarm employment change|non-farm payrolls|nonfarm payrolls/.test(lowerTitle)) return 'us_nfp';
    if (/retail sales/.test(lowerTitle)) return 'us_retail';
    if (/\bcpi\b/.test(lowerTitle) && !/\bppi\b|producer/.test(lowerTitle) && !/\bcore\b/.test(lowerTitle)) return 'us_cpi';
    return null;
  }

  if (code === 'EUR') {
    if (/deposit facility rate|ecb rate decision|interest rate decision|main refinancing rate/.test(lowerTitle)) return 'ecb';
    return null;
  }

  if (code === 'GBP') {
    if (/official bank rate|bank rate/.test(lowerTitle)) return 'boe';
    return null;
  }

  if (code === 'JPY') {
    if (/policy rate|boj rate/.test(lowerTitle)) return 'boj';
    return null;
  }

  if (code === 'AUD') {
    if (/cash rate/.test(lowerTitle)) return 'rba';
    if (/employment change/.test(lowerTitle)) return 'au_jobs';
    return null;
  }

  return null;
}

function getEventPriority(title: string, eventId: string) {
  const lowerTitle = title.toLowerCase();
  if (eventId === 'us_cpi') {
    if (/\bcpi y\/y\b/.test(lowerTitle)) return 4;
    if (/\bcpi m\/m\b/.test(lowerTitle)) return 3;
    return 2;
  }
  if (eventId === 'ecb') {
    if (/deposit facility rate/.test(lowerTitle)) return 4;
    if (/main refinancing rate/.test(lowerTitle)) return 3;
    return 2;
  }
  return 1;
}

async function fetchTextViaProxy(url: string, timeoutMs = 35000) {
  const key = `${url}::${timeoutMs}`;
  const cached = proxyTextMemo.get(key);
  if (cached) return cached;

  const promise = runWithProxyConcurrencyLimit(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${PROXY_URL}?action=rss&url=${encodeURIComponent(url)}`, {
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || `HTTP ${res.status}`);
      }
      return text;
    } finally {
      clearTimeout(timer);
    }
  });

  proxyTextMemo.set(key, promise);
  promise.catch(() => proxyTextMemo.delete(key));
  return promise;
}

function parseForexFactoryJson(text: string): FreeMacroCalendarEntry[] {
  const trimmed = text.trim();
  if (!trimmed.startsWith('[')) {
    throw new Error('Forex Factory JSON unavailable');
  }

  const raw = JSON.parse(trimmed) as unknown[];
  if (!Array.isArray(raw)) {
    throw new Error('Forex Factory JSON shape invalid');
  }

  return raw
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const title = typeof entry.title === 'string' ? entry.title : '';
      const country = typeof entry.country === 'string' ? entry.country : '';
      const date = typeof entry.date === 'string' ? entry.date : '';
      if (!title || !country || !date) return null;

      return {
        title: normalizeMacroText(title),
        country: country.trim().toUpperCase(),
        date: date.trim(),
        impact: typeof entry.impact === 'string' ? entry.impact : '',
        forecast: typeof entry.forecast === 'string' ? normalizeMacroText(entry.forecast) : '',
        previous: typeof entry.previous === 'string' ? normalizeMacroText(entry.previous) : '',
        url: typeof entry.url === 'string' ? entry.url : '',
      };
    })
    .filter((entry): entry is FreeMacroCalendarEntry => entry !== null);
}

function parseForexFactoryCsv(text: string): FreeMacroCalendarEntry[] {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('<')) {
    throw new Error('Forex Factory CSV unavailable');
  }

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('Forex Factory CSV empty');
  }

  const header = parseCsvLine(lines[0]).map((value) => value.trim().toLowerCase());
  const titleIndex = header.indexOf('title');
  const countryIndex = header.indexOf('country');
  const dateIndex = header.indexOf('date');
  const timeIndex = header.indexOf('time');
  const impactIndex = header.indexOf('impact');
  const forecastIndex = header.indexOf('forecast');
  const previousIndex = header.indexOf('previous');
  const urlIndex = header.indexOf('url');

  return lines
    .slice(1)
    .map((line) => {
      const cells = parseCsvLine(line);
      const title = cells[titleIndex] ?? '';
      const country = cells[countryIndex] ?? '';
      const date = cells[dateIndex] ?? '';
      const time = cells[timeIndex] ?? '';
      if (!title || !country || !date || !time) return null;

      return {
        title: normalizeMacroText(title),
        country: country.trim().toUpperCase(),
        date: buildForexFactoryIso(date, time),
        impact: cells[impactIndex] ?? '',
        forecast: normalizeMacroText(cells[forecastIndex] ?? ''),
        previous: normalizeMacroText(cells[previousIndex] ?? ''),
        url: cells[urlIndex] ?? '',
      };
    })
    .filter((entry): entry is FreeMacroCalendarEntry => entry !== null && entry.date.length > 0);
}

async function fetchForexFactoryCalendar() {
  const jsonUrl = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
  const csvUrl = 'https://nfs.faireconomy.media/ff_calendar_thisweek.csv';

  try {
    // CSV endpoint is typically more reliable than JSON (the JSON one is rate-limited more aggressively).
    const csvText = await fetchTextViaProxy(csvUrl, 12000);
    return { events: parseForexFactoryCsv(csvText), source: 'forexfactory_csv' };
  } catch (csvError) {
    const text = await fetchTextViaProxy(jsonUrl, 12000).catch(() => {
      throw csvError;
    });
    return { events: parseForexFactoryJson(text), source: 'forexfactory_json' };
  }
}


function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatSigned(value: number, digits = 2) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits).replace(/\.00$/, '').replace(/(\.\d*[1-9])0+$/, '$1')}`;
}


function scoreToBias(score: number): MacroTrendBias {
  if (score >= 2) return 'bullish';
  if (score <= -2) return 'bearish';
  return 'neutral';
}

function summariseBias(currency: CurrencyMacroTrend['currency'], bias: MacroTrendBias, detail: string) {
  if (bias === 'bullish') return `${currency} nghiêng mạnh hơn ${detail}`;
  if (bias === 'bearish') return `${currency} nghiêng yếu hơn ${detail}`;
  return `${currency} đang ở trạng thái cân bằng hơn ${detail}`;
}

function getActualSnapshotForEntry(entry: FreeMacroCalendarEntry, catalog: MacroActualCatalog): MacroActualSnapshot | null {
  const eventId = pickMacroEventId(entry.title, entry.country);
  const eventDate = Date.parse(entry.date);
  if (!eventId || !Number.isFinite(eventDate) || eventDate > Date.now() + 10 * 60 * 1000) {
    return null;
  }

  const lowerTitle = entry.title.toLowerCase();
  switch (eventId) {
    case 'us_cpi':
      return /\by\/y\b/.test(lowerTitle) ? catalog.usCpiYoy : catalog.usCpiMom ?? catalog.usCpiYoy;
    case 'us_nfp':
      return catalog.usNfp;
    case 'us_retail':
      return catalog.usRetail;
    case 'fomc':
      return catalog.fomc;
    case 'ecb':
      return catalog.ecb;
    case 'boe':
      return catalog.boe;
    default:
      return null;
  }
}

function buildMacroCalendarResponse(
  entries: FreeMacroCalendarEntry[],
  actualCatalog: MacroActualCatalog,
  source: string,
): MacroCalendarResponse {
  const relevantEntries = entries.filter((entry) => pickMacroEventId(entry.title, entry.country) !== null);
  const deduped = new Map<string, FreeMacroCalendarEntry>();

  for (const entry of relevantEntries) {
    const eventId = pickMacroEventId(entry.title, entry.country);
    if (!eventId) continue;
    const key = `${eventId}-${entry.date}`;
    const existing = deduped.get(key);
    if (!existing || getEventPriority(entry.title, eventId) > getEventPriority(existing.title, eventId)) {
      deduped.set(key, entry);
    }
  }

  const events = Array.from(deduped.values())
    .map((entry) => {
      const actualSnapshot = getActualSnapshotForEntry(entry, actualCatalog);
      return {
        Date: entry.date,
        Country: mapForexFactoryCountry(entry.country),
        Event: entry.title,
        Category: entry.impact,
        Forecast: entry.forecast,
        Previous: entry.previous,
        Actual: actualSnapshot?.actualText ?? '',
        Importance: mapImpactToImportance(entry.impact),
        Currency: entry.country,
        SourceURL: actualSnapshot?.sourceUrl || entry.url,
      } satisfies MacroCalendarRawEvent;
    })
    .sort((left, right) => Date.parse(left.Date ?? '') - Date.parse(right.Date ?? ''));

  const startDate = events[0]?.Date?.slice(0, 10) ?? '';
  const endDate = events.at(-1)?.Date?.slice(0, 10) ?? '';
  return { startDate, endDate, events, source };
}

function readMacroCalendarCache(): { cachedAt: number; data: MacroCalendarResponse } | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(MACRO_FREE_CACHE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { cachedAt?: number; data?: MacroCalendarResponse };
    if (
      !parsed ||
      typeof parsed.cachedAt !== 'number' ||
      !parsed.data ||
      typeof parsed.data.startDate !== 'string' ||
      typeof parsed.data.endDate !== 'string' ||
      !Array.isArray(parsed.data.events) ||
      typeof parsed.data.source !== 'string'
    ) {
      return null;
    }

    return {
      cachedAt: parsed.cachedAt,
      data: parsed.data,
    };
  } catch {
    return null;
  }
}

function writeMacroCalendarCache(data: MacroCalendarResponse) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(MACRO_FREE_CACHE_KEY, JSON.stringify({ cachedAt: Date.now(), data }));
}

function readMacroTrendCache(): { cachedAt: number; data: MacroTrendSnapshot } | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(MACRO_TREND_CACHE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { cachedAt?: number; data?: MacroTrendSnapshot };
    if (
      !parsed ||
      typeof parsed.cachedAt !== 'number' ||
      !parsed.data ||
      !Array.isArray(parsed.data.trends)
    ) {
      return null;
    }

    return {
      cachedAt: parsed.cachedAt,
      data: parsed.data,
    };
  } catch {
    return null;
  }
}

function writeMacroTrendCache(data: MacroTrendSnapshot) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(MACRO_TREND_CACHE_KEY, JSON.stringify({ cachedAt: Date.now(), data }));
}

export async function fetchMacroCalendar(): Promise<MacroCalendarResponse> {
  try {
    // Hosting-friendly mode: avoid FRED/BoE fetches (often blocked/slow on shared hosting).
    const { events, source } = await fetchForexFactoryCalendar();
    const actualCatalog = emptyMacroActualCatalog();

    const response = buildMacroCalendarResponse(events, actualCatalog, `${source}+fred+boe`);
    writeMacroCalendarCache(response);
    return response;
  } catch (error) {
    const cached = readMacroCalendarCache();
    if (cached && Date.now() - cached.cachedAt <= MACRO_FREE_CACHE_MAX_AGE_MS) {
      return {
        ...cached.data,
        source: `${cached.data.source}+cached`,
      };
    }

    const message = error instanceof Error ? error.message : 'Macro calendar fetch failed';
    throw new Error(`Không lấy được calendar free mode. ${message}`, { cause: error });
  }
}

export async function fetchMacroTrendSnapshot(): Promise<MacroTrendSnapshot> {
  try {
    const [dxy, us10y, spx, eurusd, gbpusd, usdjpy, audusd] = await Promise.all([
      fetchChartData('DX-Y.NYB', '1d', '3mo'),
      fetchChartData('^TNX', '1d', '3mo'),
      fetchChartData('^GSPC', '1d', '3mo'),
      fetchChartData('EURUSD=X', '1d', '3mo'),
      fetchChartData('GBPUSD=X', '1d', '3mo'),
      fetchChartData('USDJPY=X', '1d', '3mo'),
      fetchChartData('AUDUSD=X', '1d', '3mo'),
    ]);

    const pctChangeFrom = (series: OHLCV | null, pointsBack: number) => {
      const closes = series?.close ?? [];
      if (closes.length < pointsBack + 1) return null;
      const start = closes.at(-(pointsBack + 1));
      const end = closes.at(-1);
      if (!start || !end || start === 0) return null;
      return ((end / start) - 1) * 100;
    };

    const deltaFrom = (series: OHLCV | null, pointsBack: number) => {
      const closes = series?.close ?? [];
      if (closes.length < pointsBack + 1) return null;
      const start = closes.at(-(pointsBack + 1));
      const end = closes.at(-1);
      if (start == null || end == null) return null;
      return end - start;
    };

    const scoreFromPct = (pct: number) => {
      if (pct >= 2.0) return 3;
      if (pct >= 0.7) return 2;
      if (pct <= -2.0) return -3;
      if (pct <= -0.7) return -2;
      return 0;
    };

    const scoreFromDeltaPp = (deltaPp: number) => {
      if (deltaPp >= 0.30) return 2;
      if (deltaPp >= 0.10) return 1;
      if (deltaPp <= -0.30) return -2;
      if (deltaPp <= -0.10) return -1;
      return 0;
    };

    const dxyPct = pctChangeFrom(dxy, 21);
    const spxPct = pctChangeFrom(spx, 21);
    const tnxDelta = deltaFrom(us10y, 21);
    const tnxDeltaPp = tnxDelta == null ? null : tnxDelta / 10; // ^TNX is 10x yield

    const usdSignals: string[] = [];
    let usdScore = 0;
    if (dxyPct != null) {
      usdScore += scoreFromPct(dxyPct);
      usdSignals.push(`DXY 1M: ${formatSigned(dxyPct, 2)}%.`);
    } else {
      usdSignals.push('DXY 1M: N/A.');
    }
    if (tnxDeltaPp != null) {
      usdScore += scoreFromDeltaPp(tnxDeltaPp);
      usdSignals.push(`US10Y (proxy ^TNX) 1M: ${formatSigned(tnxDeltaPp, 2)} điểm %.`);
    } else {
      usdSignals.push('US10Y 1M: N/A.');
    }
    if (spxPct != null) {
      // Risk-off tends to support USD.
      usdScore += spxPct <= -1.0 ? 1 : spxPct >= 1.0 ? -1 : 0;
      usdSignals.push(`S&P500 1M: ${formatSigned(spxPct, 2)}%.`);
    }

    const usdBias = scoreToBias(usdScore);
    const usdTrend: CurrencyMacroTrend = {
      currency: 'USD',
      bias: usdBias,
      score: clamp(usdScore, -6, 6),
      headline: summariseBias('USD', usdBias, 'dựa trên DXY, US10Y và risk-on/off'),
      signals: usdSignals,
      updated: new Date().toISOString().slice(0, 10),
      sourceUrls: [
        'https://finance.yahoo.com/quote/DX-Y.NYB/',
        'https://finance.yahoo.com/quote/%5ETNX/',
        'https://finance.yahoo.com/quote/%5EGSPC/',
      ],
    };

    const fxTrend = (currency: CurrencyMacroTrend['currency'], symbol: string, invert = false): CurrencyMacroTrend => {
      const pct = pctChangeFrom(symbol === 'EURUSD=X' ? eurusd : symbol === 'GBPUSD=X' ? gbpusd : symbol === 'USDJPY=X' ? usdjpy : audusd, 21);
      const signedPct = pct == null ? null : (invert ? -pct : pct);
      const score = signedPct == null ? 0 : scoreFromPct(signedPct);
      const bias = scoreToBias(score);
      const label = invert ? `${symbol} (inverted)` : symbol;
      const signals = [
        `${label} 1M: ${signedPct == null ? 'N/A' : `${formatSigned(signedPct, 2)}%`}.`,
        'Proxy theo động lượng FX (không phải CPI/NFP chính thức).',
      ];
      return {
        currency,
        bias,
        score: clamp(score, -6, 6),
        headline: summariseBias(currency, bias, 'theo động lượng tỷ giá so với USD'),
        signals,
        updated: new Date().toISOString().slice(0, 10),
        sourceUrls: [`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`],
      };
    };

    const trends: CurrencyMacroTrend[] = [
      usdTrend,
      fxTrend('EUR', 'EURUSD=X', false),
      fxTrend('GBP', 'GBPUSD=X', false),
      fxTrend('JPY', 'USDJPY=X', true),
      fxTrend('AUD', 'AUDUSD=X', false),
    ];

    const snapshot = { trends };
    writeMacroTrendCache(snapshot);
    return snapshot;
  } catch (error) {
    const cached = readMacroTrendCache();
    if (cached && Date.now() - cached.cachedAt <= MACRO_FREE_CACHE_MAX_AGE_MS) {
      return cached.data;
    }

    const message = error instanceof Error ? error.message : 'Macro trend fetch failed';
    throw new Error(`Không lấy được macro trend snapshot. ${message}`, { cause: error });
  }
}
