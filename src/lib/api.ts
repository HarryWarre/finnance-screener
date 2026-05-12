export interface OHLCV {
  timestamp: number[];
  close: number[];
}

export interface Fundamentals {
  pe: number;
  roe: number;
}

const PROXY_URL = 'proxy.php'; // relative path — works in any subfolder on cPanel

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
      
      // Filter out nulls
      const validTimestamps: number[] = [];
      const validCloses: number[] = [];
      
    for (let i = 0; i < closePrices.length; i++) {
      const c = closePrices[i];
      const ts = timestamps[i];
      if (typeof c === 'number' && typeof ts === 'number') {
        validTimestamps.push(ts);
        validCloses.push(c);
        }
      }
      
    if (validCloses.length < 2) return null;
    return { timestamp: validTimestamps, close: validCloses };
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
