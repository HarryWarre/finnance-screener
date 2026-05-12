export interface OHLCV {
  timestamp: number[];
  close: number[];
}

export interface Fundamentals {
  pe: number;
  roe: number;
}

const PROXY_URL = 'proxy.php'; // relative path — works in any subfolder on cPanel

export async function fetchChartData(symbol: string): Promise<OHLCV | null> {
  try {
    const res = await fetch(`${PROXY_URL}?action=chart&symbol=${encodeURIComponent(symbol)}`);
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
