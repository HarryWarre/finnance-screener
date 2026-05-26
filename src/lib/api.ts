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

export type CryptoMarketCoin = {
  id: string;
  symbol: string;
  name: string;
  marketCapRank: number | null;
  marketCapUsd: number | null;
};

export type CryptoProvider = 'coingecko' | 'binance_spot';

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

export interface InvestingCalendarEvent {
  id: number;
  datetime: string; // Investing attribute `data-event-datetime`, e.g. "2026/05/29 00:00:00"
  currency: string; // e.g. "USD"
  country: string; // e.g. "United States"
  importance: number; // 0..3 (0 when unknown)
  title: string;
  actual: string;
  forecast: string;
  previous: string;
  url: string;
}

export interface InvestingCalendarResponse {
  dateFrom: string;
  dateTo: string;
  timeZone: number;
  events: InvestingCalendarEvent[];
  source: string;
  blocked?: boolean;
  message?: string;
}

export interface TradingEconomicsCalendarRawEvent {
  CalendarId?: string | number;
  Date?: string;
  Country?: string;
  Category?: string;
  Event?: string;
  Actual?: string;
  Previous?: string;
  Forecast?: string;
  TEForecast?: string;
  Importance?: number | string;
  SourceURL?: string;
  URL?: string;
  Currency?: string;
  Unit?: string;
  Ticker?: string;
  Symbol?: string;
}

export interface FinnhubEconomicCalendarEvent {
  actual?: number | string | null;
  country?: string | null; // e.g. "US"
  estimate?: number | string | null;
  event?: string | null;
  impact?: string | null; // "low" | "medium" | "high"
  prev?: number | string | null;
  time?: string | null; // e.g. "2020-06-02 01:30:00" or ISO
  unit?: string | null;
}

export interface FxStreetEventDateRaw {
  IdEventDate?: string;
  DateUtc?: string;
  CountryCode?: string;
  CountryName?: string;
  CurrencyId?: string;
  CurrencySymbol?: string;
  Volatility?: number;
  Actual?: number | string | null;
  Consensus?: number | string | null;
  Previous?: number | string | null;
  Revised?: number | string | null;
  EventName?: string;
  Name?: string;
  Event?: string;
  Title?: string;
  UrlSource?: string;
  SourceUrl?: string;
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
const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';
const CG_CHART_CACHE_TTL_MS = 2 * 60 * 1000;
type CgChartCacheKey = string;
const cgMarketChartMemo = new Map<CgChartCacheKey, { expiresAt: number; promise: Promise<OHLCV | null> }>();

let cgNextAllowedAt = 0;
let cgMinSpacingMs = 700;
async function paceCoinGecko() {
  const now = Date.now();
  const waitMs = Math.max(0, cgNextAllowedAt - now);
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  const nextNow = Date.now();
  cgNextAllowedAt = nextNow + cgMinSpacingMs;
}
function noteCoinGeckoResult(status?: number) {
  if (status === 429) {
    cgMinSpacingMs = Math.min(3000, Math.round(cgMinSpacingMs * 1.6));
    return;
  }
  // Slowly relax pacing after successes / non-rate-limit errors.
  cgMinSpacingMs = Math.max(350, Math.round(cgMinSpacingMs * 0.92));
}

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
    if (!res.ok) {
      const err = new Error('HTTP ' + res.status) as Error & { status?: number; retryAfterMs?: number };
      err.status = res.status;
      const retryAfterRaw = res.headers.get('retry-after');
      const retryAfterSec = retryAfterRaw ? Number(retryAfterRaw) : NaN;
      if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) err.retryAfterMs = Math.round(retryAfterSec * 1000);
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchJsonWithRetry(
  url: string,
  opts?: { timeoutMs?: number; retries?: number; minRetryDelayMs?: number }
): Promise<unknown> {
  const timeoutMs = Math.max(1000, Math.round(opts?.timeoutMs ?? 8000));
  const retries = Math.max(0, Math.min(4, Math.round(opts?.retries ?? 2)));
  const minRetryDelayMs = Math.max(250, Math.round(opts?.minRetryDelayMs ?? 900));

  const readNumberField = (err: unknown, key: 'status' | 'retryAfterMs') => {
    if (!err || typeof err !== 'object') return NaN;
    const v = (err as Record<string, unknown>)[key];
    return typeof v === 'number' ? v : NaN;
  };

  let attempt = 0;
  for (;;) {
    try {
      const isCoinGecko = url.includes('cg_') || url.startsWith(COINGECKO_API_BASE);
      if (isCoinGecko) {
        await paceCoinGecko();
      }
      const out = await fetchJsonWithTimeout(url, timeoutMs);
      if (isCoinGecko) noteCoinGeckoResult(200);
      return out;
    } catch (e: unknown) {
      const status = readNumberField(e, 'status');
      const retryAfterMs = readNumberField(e, 'retryAfterMs');
      const isRateLimit = status === 429;
      if (Number.isFinite(status)) noteCoinGeckoResult(status);
      if (attempt >= retries || (!isRateLimit && status !== 503)) throw e;

      const backoff = Math.round(minRetryDelayMs * Math.pow(2, attempt));
      const delay = Number.isFinite(retryAfterMs) ? Math.max(backoff, retryAfterMs) : backoff;
      await new Promise((r) => setTimeout(r, delay));
      attempt += 1;
    }
  }
}

export async function fetchCryptoTopMarketCap(opts?: {
  perPage?: number;
  page?: number;
  vsCurrency?: string;
  ids?: string[];
}): Promise<CryptoMarketCoin[]> {
  const perPage = Math.max(1, Math.min(250, Number(opts?.perPage ?? 50)));
  const page = Math.max(1, Number(opts?.page ?? 1));
  const vs = (opts?.vsCurrency ?? 'usd').trim().toLowerCase() || 'usd';
  const ids = (opts?.ids ?? []).map((s) => s.trim()).filter(Boolean);
  const idsParam = ids.length ? `&ids=${encodeURIComponent(ids.join(','))}` : '';
  const proxyUrl = `${PROXY_URL}?action=cg_markets&vs_currency=${encodeURIComponent(vs)}&order=market_cap_desc&per_page=${encodeURIComponent(String(perPage))}&page=${encodeURIComponent(String(page))}&sparkline=false${idsParam}`;
  const directUrl = `${COINGECKO_API_BASE}/coins/markets?vs_currency=${encodeURIComponent(vs)}&order=market_cap_desc&per_page=${encodeURIComponent(String(perPage))}&page=${encodeURIComponent(String(page))}&sparkline=false${idsParam}`;

  try {
    let data: unknown;
    try {
      data = await fetchJsonWithRetry(proxyUrl, { timeoutMs: 10000, retries: 2, minRetryDelayMs: 900 });
    } catch {
      data = await fetchJsonWithRetry(directUrl, { timeoutMs: 10000, retries: 2, minRetryDelayMs: 900 });
    }
    const arr = Array.isArray(data) ? data : [];
    return arr
      .map((c: unknown) => {
        if (!isRecord(c)) return null;
        const id = typeof c.id === 'string' ? c.id : '';
        const symbol = typeof c.symbol === 'string' ? c.symbol : '';
        const name = typeof c.name === 'string' ? c.name : '';
        const marketCapRank = c.market_cap_rank === null || c.market_cap_rank === undefined ? null : Number(c.market_cap_rank);
        const marketCapUsd = c.market_cap === null || c.market_cap === undefined ? null : Number(c.market_cap);
        if (!id || !symbol) return null;
        return { id, symbol, name, marketCapRank: Number.isFinite(marketCapRank) ? marketCapRank : null, marketCapUsd: Number.isFinite(marketCapUsd) ? marketCapUsd : null };
      })
      .filter(Boolean) as CryptoMarketCoin[];
  } catch {
    return [];
  }
}

type BinanceTicker24hr = {
  symbol: string;
  quoteVolume?: string;
  volume?: string;
  lastPrice?: string;
};

async function fetchBinanceTicker24hr(): Promise<BinanceTicker24hr[]> {
  try {
    const data = await fetchJsonWithRetry(`${PROXY_URL}?action=binance_ticker24hr`, { timeoutMs: 12000, retries: 1, minRetryDelayMs: 700 });
    return Array.isArray(data) ? (data as BinanceTicker24hr[]) : [];
  } catch {
    try {
      const data = await fetchJsonWithRetry(`https://api.binance.com/api/v3/ticker/24hr`, { timeoutMs: 12000, retries: 1, minRetryDelayMs: 700 });
      return Array.isArray(data) ? (data as BinanceTicker24hr[]) : [];
    } catch {
      return [];
    }
  }
}

export async function fetchCryptoTopSymbolsBinance(opts?: {
  topN?: number;
  quoteAsset?: 'USDT' | 'USDC' | 'BUSD';
  minQuoteVolumeUsd?: number;
}): Promise<Array<{ symbol: string; base: string; quote: 'USDT' | 'USDC' | 'BUSD'; quoteVolume: number }>> {
  const topN = Math.max(1, Math.min(400, Math.round(Number(opts?.topN ?? 100))));
  const quoteAsset = (opts?.quoteAsset ?? 'USDT').trim().toUpperCase() as 'USDT' | 'USDC' | 'BUSD';
  const minQuoteVolumeUsd = Math.max(0, Number(opts?.minQuoteVolumeUsd ?? 0));

  const tickers = await fetchBinanceTicker24hr();
  if (!tickers.length) return [];

  const rows: Array<{ symbol: string; base: string; quote: 'USDT' | 'USDC' | 'BUSD'; quoteVolume: number }> = [];
  for (const t of tickers) {
    const sym = typeof t.symbol === 'string' ? t.symbol.trim().toUpperCase() : '';
    if (!sym || !sym.endsWith(quoteAsset)) continue;
    // Filter leveraged tokens / weird tickers to reduce garbage universe.
    if (/(UP|DOWN|BULL|BEAR)$/.test(sym.replace(quoteAsset, ''))) continue;
    const quoteVol = Number(t.quoteVolume ?? '');
    if (!Number.isFinite(quoteVol)) continue;
    if (quoteVol < minQuoteVolumeUsd) continue;
    const base = sym.slice(0, sym.length - quoteAsset.length);
    if (!base) continue;
    rows.push({ symbol: sym, base, quote: quoteAsset, quoteVolume: quoteVol });
  }

  rows.sort((a, b) => b.quoteVolume - a.quoteVolume);
  return rows.slice(0, topN);
}

export async function fetchCryptoKlinesBinance(opts: {
  symbol: string; // e.g. BTCUSDT
  interval: string; // Binance interval
  limit: number;
}): Promise<OHLCV | null> {
  const symbol = opts.symbol.trim().toUpperCase();
  if (!symbol) return null;
  const interval = opts.interval.trim() || '1d';
  const limit = Math.max(2, Math.min(1000, Math.round(opts.limit)));
  const url = `${PROXY_URL}?action=binance_klines&symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${encodeURIComponent(String(limit))}`;

  try {
    let data: unknown;
    try {
      data = await fetchJsonWithRetry(url, { timeoutMs: 15000, retries: 1, minRetryDelayMs: 700 });
    } catch {
      data = await fetchJsonWithRetry(`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${encodeURIComponent(String(limit))}`, {
        timeoutMs: 15000,
        retries: 1,
        minRetryDelayMs: 700,
      });
    }

    if (!Array.isArray(data)) return null;
    const ts: number[] = [];
    const close: number[] = [];
    for (const row of data as unknown[]) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const openTime = row[0];
      const closeStr = row[4];
      if (typeof openTime !== 'number' || (typeof closeStr !== 'string' && typeof closeStr !== 'number')) continue;
      const c = typeof closeStr === 'number' ? closeStr : Number(closeStr);
      if (!Number.isFinite(c)) continue;
      ts.push(Math.round(openTime / 1000));
      close.push(c);
    }
    if (close.length < 2) return null;
    return { timestamp: ts, close };
  } catch {
    return null;
  }
}

export async function fetchCryptoMarketChart(opts: {
  id: string;
  vsCurrency?: string;
  days?: number;
  interval?: 'hourly' | 'daily';
}): Promise<OHLCV | null> {
  const id = opts.id.trim();
  if (!id) return null;
  const vs = (opts.vsCurrency ?? 'usd').trim().toLowerCase() || 'usd';
  const days = Math.max(1, Math.min(3650, Math.round(Number(opts.days ?? 120))));
  const interval = opts.interval;
  const cacheKey = `${id}::${vs}::${days}::${interval ?? ''}`;
  const cached = cgMarketChartMemo.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const proxyUrl =
    `${PROXY_URL}?action=cg_market_chart&id=${encodeURIComponent(id)}` +
    `&vs_currency=${encodeURIComponent(vs)}` +
    `&days=${encodeURIComponent(String(days))}` +
    (interval ? `&interval=${encodeURIComponent(interval)}` : '');
  const directUrl =
    `${COINGECKO_API_BASE}/coins/${encodeURIComponent(id)}/market_chart` +
    `?vs_currency=${encodeURIComponent(vs)}` +
    `&days=${encodeURIComponent(String(days))}` +
    (interval ? `&interval=${encodeURIComponent(interval)}` : '');

  const promise = (async () => {
    try {
      let data: unknown;
      try {
        data = await fetchJsonWithRetry(proxyUrl, { timeoutMs: 15000, retries: 2, minRetryDelayMs: 1100 });
      } catch {
        data = await fetchJsonWithRetry(directUrl, { timeoutMs: 15000, retries: 2, minRetryDelayMs: 1100 });
      }
      if (!isRecord(data)) return null;
      const prices = Array.isArray(data.prices) ? data.prices as unknown[] : [];
      const ts: number[] = [];
      const close: number[] = [];
      for (const p of prices) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const t0 = p[0];
        const v0 = p[1];
        if (typeof t0 !== 'number' || typeof v0 !== 'number') continue;
        ts.push(Math.round(t0 / 1000));
        close.push(v0);
      }
      if (close.length < 2) return null;
      return { timestamp: ts, close };
    } catch {
      return null;
    }
  })();

  cgMarketChartMemo.set(cacheKey, { expiresAt: Date.now() + CG_CHART_CACHE_TTL_MS, promise });
  promise.catch(() => cgMarketChartMemo.delete(cacheKey));
  return promise;
}

export type YahooInterval = '1m' | '2m' | '5m' | '15m' | '30m' | '60m' | '90m' | '1h' | '1d' | '5d' | '1wk' | '1mo' | '3mo';
export type YahooRange = '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y' | '10y' | 'ytd' | 'max';

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

export async function fetchInvestingCalendarRange(opts: {
  dateFrom: string; // YYYY-MM-DD
  dateTo: string; // YYYY-MM-DD
  timeZone?: number;
}): Promise<InvestingCalendarResponse> {
  const dateFrom = opts.dateFrom.trim();
  const dateTo = opts.dateTo.trim();
  const timeZone = Number.isFinite(opts.timeZone) ? Math.round(opts.timeZone as number) : 8;

  const url =
    `${PROXY_URL}?action=investing_calendar` +
    `&dateFrom=${encodeURIComponent(dateFrom)}` +
    `&dateTo=${encodeURIComponent(dateTo)}` +
    `&timeZone=${encodeURIComponent(String(timeZone))}`;

  const data = await fetchJsonWithRetry(url, { timeoutMs: 15000, retries: 2, minRetryDelayMs: 900 });
  if (!isRecord(data)) throw new Error('Invalid investing calendar response');
  const events = Array.isArray(data.events) ? (data.events as unknown[]) : [];
  return {
    dateFrom: typeof data.dateFrom === 'string' ? data.dateFrom : dateFrom,
    dateTo: typeof data.dateTo === 'string' ? data.dateTo : dateTo,
    timeZone: typeof data.timeZone === 'number' ? data.timeZone : timeZone,
    events: events
      .map((e) => {
        if (!isRecord(e)) return null;
        const id = Number(e.id);
        const datetime = typeof e.datetime === 'string' ? e.datetime : '';
        const currency = typeof e.currency === 'string' ? e.currency : '';
        const country = typeof e.country === 'string' ? e.country : '';
        const importance = Number(e.importance);
        const title = typeof e.title === 'string' ? e.title : '';
        const actual = typeof e.actual === 'string' ? e.actual : '';
        const forecast = typeof e.forecast === 'string' ? e.forecast : '';
        const previous = typeof e.previous === 'string' ? e.previous : '';
        const url = typeof e.url === 'string' ? e.url : '';
        if (!datetime || !title) return null;
        return {
          id: Number.isFinite(id) ? id : 0,
          datetime,
          currency,
          country,
          importance: Number.isFinite(importance) ? importance : 0,
          title,
          actual,
          forecast,
          previous,
          url,
        } satisfies InvestingCalendarEvent;
      })
      .filter(Boolean) as InvestingCalendarEvent[],
    source: typeof data.source === 'string' ? data.source : 'investing_calendar',
    blocked: typeof data.blocked === 'boolean' ? data.blocked : undefined,
    message: typeof data.message === 'string' ? data.message : undefined,
  };
}

function inferCurrencyFromCountry(country: string): string {
  const c = country.trim().toLowerCase();
  if (!c) return '';
  if (c.includes('united states')) return 'USD';
  if (c.includes('euro') || c.includes('germany') || c.includes('france') || c.includes('italy') || c.includes('spain') || c.includes('netherlands')) return 'EUR';
  if (c.includes('united kingdom')) return 'GBP';
  if (c.includes('japan')) return 'JPY';
  if (c.includes('switzerland')) return 'CHF';
  if (c.includes('canada')) return 'CAD';
  if (c.includes('australia')) return 'AUD';
  if (c.includes('new zealand')) return 'NZD';
  if (c.includes('china') || c.includes('hong kong')) return 'CNY';
  return '';
}

function inferCurrencyFromCountryCode(code: string): string {
  const c = code.trim().toUpperCase();
  if (!c) return '';
  if (c === 'US') return 'USD';
  if (c === 'EU' || c === 'EMU' || c === 'EA') return 'EUR';
  if (c === 'GB' || c === 'UK') return 'GBP';
  if (c === 'JP') return 'JPY';
  if (c === 'CH') return 'CHF';
  if (c === 'CA') return 'CAD';
  if (c === 'AU') return 'AUD';
  if (c === 'NZ') return 'NZD';
  if (c === 'CN' || c === 'HK') return 'CNY';
  return '';
}

function hashStringToId(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 2147483647;
}

function toDisplayNumberString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'string') return v;
  return '';
}

export async function fetchTradingEconomicsCalendarRange(opts: {
  dateFrom: string; // YYYY-MM-DD
  dateTo: string; // YYYY-MM-DD
  importance?: 1 | 2 | 3;
}): Promise<{ dateFrom: string; dateTo: string; events: InvestingCalendarEvent[]; source: string }> {
  const dateFrom = opts.dateFrom.trim();
  const dateTo = opts.dateTo.trim();
  const imp = opts.importance ? `&importance=${encodeURIComponent(String(opts.importance))}` : '';
  const url =
    `${PROXY_URL}?action=te_calendar` +
    `&dateFrom=${encodeURIComponent(dateFrom)}` +
    `&dateTo=${encodeURIComponent(dateTo)}` +
    imp;

  const data = await fetchJsonWithRetry(url, { timeoutMs: 15000, retries: 2, minRetryDelayMs: 900 });
  if (!isRecord(data)) throw new Error('Invalid TradingEconomics calendar response');
  const events = Array.isArray(data.events) ? (data.events as unknown[]) : [];

  const mapped: InvestingCalendarEvent[] = events
    .map((e) => {
      if (!isRecord(e)) return null;
      const calendarId = e.CalendarId ?? e.calendarId;
      const id = Number(calendarId);
      const datetime = typeof e.Date === 'string' ? e.Date : typeof e.date === 'string' ? e.date : '';
      const country = typeof e.Country === 'string' ? e.Country : '';
      const currencyRaw = typeof e.Currency === 'string' ? e.Currency : '';
      const currency = currencyRaw.trim().toUpperCase() || inferCurrencyFromCountry(country);
      const importanceRaw = e.Importance ?? e.importance;
      const importance = typeof importanceRaw === 'number' ? importanceRaw : Number(importanceRaw);
      const title = typeof e.Event === 'string' ? e.Event : '';
      const actual = typeof e.Actual === 'string' ? e.Actual : '';
      const forecast = typeof e.Forecast === 'string' && e.Forecast.trim() ? e.Forecast : typeof e.TEForecast === 'string' ? e.TEForecast : '';
      const previous = typeof e.Previous === 'string' ? e.Previous : '';
      const sourceUrl = typeof e.SourceURL === 'string' ? e.SourceURL : '';
      const urlPath = typeof e.URL === 'string' ? e.URL : '';
      const url = sourceUrl || (urlPath ? `https://tradingeconomics.com${urlPath}` : '');
      if (!datetime || !title) return null;
      return {
        id: Number.isFinite(id) ? id : 0,
        datetime,
        currency,
        country,
        importance: Number.isFinite(importance) ? importance : 0,
        title,
        actual,
        forecast,
        previous,
        url,
      } satisfies InvestingCalendarEvent;
    })
    .filter(Boolean) as InvestingCalendarEvent[];

  return {
    dateFrom: typeof data.dateFrom === 'string' ? data.dateFrom : dateFrom,
    dateTo: typeof data.dateTo === 'string' ? data.dateTo : dateTo,
    events: mapped,
    source: typeof data.source === 'string' ? data.source : 'tradingeconomics_api',
  };
}

export async function fetchFinnhubCalendarRange(opts: {
  dateFrom: string; // YYYY-MM-DD
  dateTo: string; // YYYY-MM-DD
}): Promise<{ dateFrom: string; dateTo: string; events: InvestingCalendarEvent[]; source: string }> {
  const dateFrom = opts.dateFrom.trim();
  const dateTo = opts.dateTo.trim();
  const url = `${PROXY_URL}?action=finnhub_calendar&dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`;

  const data = await fetchJsonWithRetry(url, { timeoutMs: 15000, retries: 1, minRetryDelayMs: 900 });
  if (!isRecord(data)) throw new Error('Invalid Finnhub calendar response');
  const raw = Array.isArray(data.events) ? (data.events as unknown[]) : [];

  const mapped: InvestingCalendarEvent[] = raw
    .map((e) => {
      if (!isRecord(e)) return null;
      const time = typeof e.time === 'string' ? e.time : '';
      const title = typeof e.event === 'string' ? e.event : '';
      const countryCode = typeof e.country === 'string' ? e.country : '';
      const impact = typeof e.impact === 'string' ? e.impact : '';
      const unit = typeof e.unit === 'string' ? e.unit : '';

      const currencyFromUnit = /^[A-Z]{3}$/.test(unit.trim().toUpperCase()) ? unit.trim().toUpperCase() : '';
      const currency = currencyFromUnit || inferCurrencyFromCountryCode(countryCode) || inferCurrencyFromCountry(countryCode);

      const importance =
        impact.toLowerCase() === 'high' ? 3 :
        impact.toLowerCase() === 'medium' ? 2 :
        impact.toLowerCase() === 'low' ? 1 : 0;

      if (!time || !title) return null;
      const id = hashStringToId(`${countryCode}|${title}|${time}`);

      return {
        id,
        datetime: time,
        currency,
        country: countryCode,
        importance,
        title,
        actual: toDisplayNumberString(e.actual),
        forecast: toDisplayNumberString(e.estimate),
        previous: toDisplayNumberString(e.prev),
        url: '',
      } satisfies InvestingCalendarEvent;
    })
    .filter(Boolean) as InvestingCalendarEvent[];

  return {
    dateFrom: typeof data.dateFrom === 'string' ? data.dateFrom : dateFrom,
    dateTo: typeof data.dateTo === 'string' ? data.dateTo : dateTo,
    events: mapped,
    source: typeof data.source === 'string' ? data.source : 'finnhub_calendar',
  };
}

export async function fetchFxStreetCalendarRange(opts: {
  dateFrom: string; // YYYY-MM-DD
  dateTo: string; // YYYY-MM-DD
  culture?: string; // default 'en'
  apiVersion?: 'v1' | 'v2';
  countries?: string; // CSV: "US,EMU,UK,..."
}): Promise<{ dateFrom: string; dateTo: string; events: InvestingCalendarEvent[]; source: string }> {
  const dateFrom = opts.dateFrom.trim();
  const dateTo = opts.dateTo.trim();
  const culture = (opts.culture ?? 'en').trim();
  const apiVersion = (opts.apiVersion ?? 'v1').trim();
  const countries = (opts.countries ?? 'US,EMU,UK,JP,CH,CA,AU,NZ,CN,HK').trim();
  const url =
    `${PROXY_URL}?action=fxstreet_calendar` +
    `&dateFrom=${encodeURIComponent(dateFrom)}` +
    `&dateTo=${encodeURIComponent(dateTo)}` +
    `&culture=${encodeURIComponent(culture)}` +
    `&apiVersion=${encodeURIComponent(apiVersion)}` +
    `&countries=${encodeURIComponent(countries)}`;

  const data = await fetchJsonWithRetry(url, { timeoutMs: 20000, retries: 1, minRetryDelayMs: 1200 });
  if (!isRecord(data)) throw new Error('Invalid FXStreet calendar response');
  const raw = Array.isArray(data.events) ? (data.events as unknown[]) : [];

  const mapped: InvestingCalendarEvent[] = raw
    .map((e) => {
      if (!isRecord(e)) return null;
      const guid = typeof e.IdEventDate === 'string' ? e.IdEventDate : typeof e.idEventDate === 'string' ? e.idEventDate : typeof e.eventDateId === 'string' ? e.eventDateId : '';
      const datetime =
        typeof e.DateUtc === 'string' ? e.DateUtc :
        typeof e.dateUtc === 'string' ? e.dateUtc :
        typeof e.time === 'string' ? e.time :
        typeof e.date === 'string' ? e.date : '';

      const countryCode = typeof e.CountryCode === 'string' ? e.CountryCode : typeof e.countryCode === 'string' ? e.countryCode : '';
      const countryName = typeof e.CountryName === 'string' ? e.CountryName : typeof e.countryName === 'string' ? e.countryName : '';
      const currency = (typeof e.CurrencyId === 'string' ? e.CurrencyId : typeof e.currencyId === 'string' ? e.currencyId : '').trim().toUpperCase() ||
        inferCurrencyFromCountryCode(countryCode);

      const volatility = typeof e.Volatility === 'number' ? e.Volatility : Number((e as any).volatility);
      const importance = Number.isFinite(volatility) ? volatility : 0;

      const title =
        typeof e.EventName === 'string' ? e.EventName :
        typeof e.Name === 'string' ? e.Name :
        typeof e.Event === 'string' ? e.Event :
        typeof e.Title === 'string' ? e.Title :
        typeof (e as any).eventName === 'string' ? (e as any).eventName :
        '';

      const actual = toDisplayNumberString((e as any).Actual ?? (e as any).actual);
      const forecast = toDisplayNumberString((e as any).Consensus ?? (e as any).consensus ?? (e as any).Forecast ?? (e as any).forecast);
      const previous = toDisplayNumberString((e as any).Previous ?? (e as any).previous);

      const urlSource = typeof e.UrlSource === 'string' ? e.UrlSource : typeof e.SourceUrl === 'string' ? e.SourceUrl : '';
      const id = guid ? hashStringToId(guid) : hashStringToId(`${countryCode}|${title}|${datetime}`);

      if (!datetime || !title) return null;
      return {
        id,
        datetime,
        currency,
        country: countryName || countryCode,
        importance,
        title,
        actual,
        forecast,
        previous,
        url: urlSource,
      } satisfies InvestingCalendarEvent;
    })
    .filter(Boolean) as InvestingCalendarEvent[];

  return {
    dateFrom: typeof data.dateFrom === 'string' ? data.dateFrom : dateFrom,
    dateTo: typeof data.dateTo === 'string' ? data.dateTo : dateTo,
    events: mapped,
    source: typeof data.source === 'string' ? data.source : 'fxstreet_api',
  };
}

export async function fetchMacroCalendarRange(opts: {
  dateFrom: string;
  dateTo: string;
}): Promise<{ dateFrom: string; dateTo: string; events: InvestingCalendarEvent[]; source: string }> {
  const { dateFrom, dateTo } = opts;

  // Free/no-key mode: use ForexFactory "this week" feed (no actual; partial scoring).
  // We keep a local static file as an optional fallback for offline/dev.
  const errors: string[] = [];
  try {
    const url = `/proxy.php?action=forexfactory_thisweek&format=json`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = (await r.json()) as unknown;
    if (!isRecord(data) || !Array.isArray((data as any).events)) throw new Error('Invalid forexfactory_thisweek payload');
    const raw = (data as any).events as any[];

    const mapped: InvestingCalendarEvent[] = raw
      .map((e) => {
        if (!isRecord(e)) return null;
        const title = typeof e.title === 'string' ? e.title : '';
        const country = typeof e.country === 'string' ? e.country : '';
        const impact = typeof e.impact === 'string' ? e.impact : '';
        const dt = typeof e.date === 'string' ? e.date : '';
        if (!title || !country || !dt) return null;

        // FF feed uses `country` as currency code (USD/EUR/JPY...), keep consistent.
        const currency = country.toUpperCase();
        const impactLc = impact.toLowerCase();
        const importance = impactLc === 'high' ? 3 : impactLc === 'medium' ? 2 : impactLc === 'low' ? 1 : 0;

        // `actual` is typically missing from the free feed; keep empty string.
        const actual = typeof (e as any).actual === 'string' ? (e as any).actual : '';
        const forecast = typeof e.forecast === 'string' ? e.forecast : '';
        const previous = typeof e.previous === 'string' ? e.previous : '';
        const datetime = new Date(dt).toISOString();
        const id = hashStringToId(`${currency}|${title}|${datetime}`);

        return {
          id,
          datetime,
          currency,
          country: currency,
          importance,
          title,
          actual,
          forecast,
          previous,
          url: '',
        } satisfies InvestingCalendarEvent;
      })
      .filter(Boolean) as InvestingCalendarEvent[];

    // Filter to requested range (still useful when caller asks 180D; we just return what we have).
    const fromTs = Date.parse(`${dateFrom}T00:00:00Z`);
    const toTs = Date.parse(`${dateTo}T23:59:59Z`);
    const filtered = mapped.filter((e) => {
      const t = Date.parse(e.datetime);
      return Number.isFinite(t) && t >= fromTs && t <= toTs;
    });

    return { dateFrom, dateTo, events: filtered, source: 'forexfactory_thisweek' };
  } catch (e: unknown) {
    errors.push(`forexfactory_thisweek: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Fallback: local static dataset if present.
  try {
    const resp = await fetch(`/data/macro_calendar.v1.json`, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as unknown;
    if (!isRecord(data) || !Array.isArray((data as any).events)) throw new Error('Invalid local macro calendar dataset format.');
    const events = (data as any).events as InvestingCalendarEvent[];
    const fromTs = Date.parse(`${dateFrom}T00:00:00Z`);
    const toTs = Date.parse(`${dateTo}T23:59:59Z`);
    const filtered = events.filter((e) => {
      const t = Date.parse(e.datetime);
      return Number.isFinite(t) && t >= fromTs && t <= toTs;
    });
    return { dateFrom, dateTo, events: filtered, source: 'local_static' };
  } catch (e: unknown) {
    errors.push(`local_static: ${e instanceof Error ? e.message : String(e)}`);
  }

  throw new Error(`No calendar source available (no-key mode). (${errors.join(' | ')})`);
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
