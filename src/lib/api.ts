export interface OHLCV {
  timestamp: number[];
  close: number[];
}

export interface Fundamentals {
  pe: number;
  roe: number;
}

const PROXY_URL = 'proxy.php'; // relative path — works in any subfolder on cPanel

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
    const res = await fetch(
      `${PROXY_URL}?action=chart&symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`
    );
    if (!res.ok) throw new Error("Proxy failed");
    const data = await res.json();

    if (data && data.chart && data.chart.result && data.chart.result[0]) {
      const result = data.chart.result[0];
      const timestamps = result.timestamp || [];
      const closePrices = result.indicators?.quote?.[0]?.close || [];
      
      // Filter out nulls
      const validTimestamps: number[] = [];
      const validCloses: number[] = [];
      
      for (let i = 0; i < closePrices.length; i++) {
        if (closePrices[i] !== null && closePrices[i] !== undefined) {
          validTimestamps.push(timestamps[i]);
          validCloses.push(closePrices[i]);
        }
      }
      
      return { timestamp: validTimestamps, close: validCloses };
    }
    return null;
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

    const constituents = Array.isArray(data?.constituents) ? data.constituents : [];
    if (constituents.length) {
      const list = constituents
        .filter((c: any) => {
          if (!sectorFilter) return true;
          const sector = typeof c?.sector === 'string' ? c.sector : '';
          return sector.trim().toLowerCase() === sectorFilter;
        })
        .map((c: any) => (typeof c?.symbol === 'string' ? c.symbol : ''))
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
