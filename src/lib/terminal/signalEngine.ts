import { buildSmartMoneyWindow } from '../smartMoney';
import type { AssetClass } from '../smartMoney';
import type { RssItem } from '../rss';

export type Driver = {
  labelVi: string;
  value: string;
  tone: 'pos' | 'neg' | 'neu';
};

export type OverallSignal = {
  scorePct: number; // -100..100
  labelVi: 'RISK-ON' | 'RISK-OFF' | 'TRUNG LẬP';
  confidence: number; // 0..100 (heuristic)
  drivers: Driver[];
};

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function toneFromPct(p: number) {
  if (p >= 20) return 'pos' as const;
  if (p <= -20) return 'neg' as const;
  return 'neu' as const;
}

function summarizeNews(items: RssItem[]) {
  const recent = items.slice(0, 40);
  let buy = 0;
  let sell = 0;
  for (const it of recent) {
    buy += it.score.buy;
    sell += it.score.sell;
  }
  const total = buy + sell;
  const net = total ? ((buy - sell) / total) * 100 : 0;
  return { netPct: clamp(net, -100, 100), buy, sell };
}

export function computeMarketSignal(params: {
  marketVi: string;
  assetClass: AssetClass;
  newsItems: RssItem[];
  // optional proxies
  spx7d?: number | null;
  btc7d?: number | null;
  dxy7d?: number | null;
  vix7d?: number | null;
  extraDrivers?: Driver[];
  windowDays?: number;
  baselineDays?: number;
}) : OverallSignal {
  const windowDays = params.windowDays ?? 7;
  const baselineDays = params.baselineDays ?? 180;

  const smart = buildSmartMoneyWindow({ assetClass: params.assetClass, windowDays, baselineDays });
  const smartPct = smart.scorePct;

  const news = summarizeNews(params.newsItems);

  const m: { labelVi: string; pct?: number | null; sign: 1 | -1 }[] = [
    { labelVi: 'S&P 500 (7D)', pct: params.spx7d, sign: 1 },
    { labelVi: 'BTC (7D)', pct: params.btc7d, sign: 1 },
    { labelVi: 'DXY (7D)', pct: params.dxy7d, sign: -1 },
    { labelVi: 'VIX (7D)', pct: params.vix7d, sign: -1 },
  ];
  const momItems = m.filter(x => typeof x.pct === 'number' && Number.isFinite(x.pct as number)) as { labelVi: string; pct: number; sign: 1 | -1 }[];
  const mom = momItems.length
    ? momItems.reduce((a, b) => a + b.sign * clamp(b.pct, -10, 10) * 5, 0) / momItems.length
    : 0;

  const score = clamp(0.65 * smartPct + 0.15 * mom + 0.20 * news.netPct, -100, 100);
  const labelVi =
    score >= 25 ? 'RISK-ON' :
    score <= -25 ? 'RISK-OFF' :
    'TRUNG LẬP';

  const confidence = clamp(
    35 +
      Math.min(35, Math.abs(score) * 0.45) +
      Math.min(15, Math.abs(news.netPct) * 0.15) +
      Math.min(15, momItems.length * 4),
    0,
    100
  );

  const drivers: Driver[] = [
    { labelVi: `Smart Money (${params.marketVi})`, value: `${smartPct.toFixed(0)}%`, tone: toneFromPct(smartPct) },
    { labelVi: 'News sentiment (gần đây)', value: `${news.netPct.toFixed(0)}%`, tone: toneFromPct(news.netPct) },
    ...(params.extraDrivers ?? []),
  ];
  for (const x of momItems) drivers.push({ labelVi: x.labelVi, value: `${x.pct.toFixed(2)}%`, tone: toneFromPct(x.sign * x.pct) });
  drivers.push({ labelVi: 'Độ tin cậy (heuristic)', value: `${confidence.toFixed(0)}%`, tone: confidence >= 70 ? 'pos' : confidence <= 45 ? 'neg' : 'neu' });

  return { scorePct: score, labelVi, confidence, drivers };
}

export function computeOverallSignal(params: {
  newsItems: RssItem[];
  // pct changes (7D) for some core proxies if available
  spx7d?: number | null;
  btc7d?: number | null;
  dxy7d?: number | null;
  vix7d?: number | null;
  windowDays?: number;
  baselineDays?: number;
}) : OverallSignal {
  const windowDays = params.windowDays ?? 7;
  const baselineDays = params.baselineDays ?? 180;

  // Smart money scores per asset class (mock but structured)
  const assetClasses: AssetClass[] = ['Stocks', 'Crypto', 'Forex', 'Commodities', 'Futures', 'Agriculture'];
  const weights: Record<AssetClass, number> = {
    Stocks: 1.0,
    Crypto: 0.8,
    Forex: 0.55,
    Commodities: 0.6,
    Futures: 0.5,
    Agriculture: 0.4,
  };

  const smart: { ac: AssetClass; pct: number }[] = assetClasses.map((ac) => {
    const res = buildSmartMoneyWindow({ assetClass: ac, windowDays, baselineDays });
    return { ac, pct: res.scorePct };
  });

  const smartWeightedDen = smart.reduce((a, b) => a + Math.abs(weights[b.ac]), 0);
  const smartPct = smartWeightedDen
    ? smart.reduce((a, b) => a + weights[b.ac] * b.pct, 0) / smartWeightedDen
    : 0;

  const news = summarizeNews(params.newsItems);

  // Momentum proxies: SPX (+), BTC (+), DXY (-), VIX (-)
  const m: { labelVi: string; pct?: number | null; sign: 1 | -1 }[] = [
    { labelVi: 'S&P 500 (7D)', pct: params.spx7d, sign: 1 },
    { labelVi: 'BTC (7D)', pct: params.btc7d, sign: 1 },
    { labelVi: 'DXY (7D)', pct: params.dxy7d, sign: -1 },
    { labelVi: 'VIX (7D)', pct: params.vix7d, sign: -1 },
  ];
  const momItems = m.filter(x => typeof x.pct === 'number' && Number.isFinite(x.pct as number)) as { labelVi: string; pct: number; sign: 1 | -1 }[];
  const mom = momItems.length
    ? momItems.reduce((a, b) => a + b.sign * clamp(b.pct, -10, 10) * 5, 0) / momItems.length // scale to roughly -50..50
    : 0;

  // Overall score
  // smartPct already -100..100 (approx)
  // mom ~ -50..50
  // news.netPct -100..100 but usually smaller
  const score = clamp(0.55 * smartPct + 0.25 * mom + 0.20 * news.netPct, -100, 100);

  const labelVi =
    score >= 25 ? 'RISK-ON' :
    score <= -25 ? 'RISK-OFF' :
    'TRUNG LẬP';

  const confidence = clamp(
    40 +
      Math.min(30, Math.abs(score) * 0.4) +
      Math.min(15, Math.abs(news.netPct) * 0.15) +
      Math.min(15, momItems.length * 4),
    0,
    100
  );

  const drivers: Driver[] = [
    { labelVi: 'Smart Money (tổng)', value: `${smartPct.toFixed(0)}%`, tone: toneFromPct(smartPct) },
    { labelVi: 'News sentiment (gần đây)', value: `${news.netPct.toFixed(0)}%`, tone: toneFromPct(news.netPct) },
  ];
  for (const x of momItems) {
    drivers.push({ labelVi: x.labelVi, value: `${x.pct.toFixed(2)}%`, tone: toneFromPct(x.sign * x.pct) });
  }
  drivers.push({ labelVi: 'Độ tin cậy (heuristic)', value: `${confidence.toFixed(0)}%`, tone: confidence >= 70 ? 'pos' : confidence <= 45 ? 'neg' : 'neu' });

  return { scorePct: score, labelVi, confidence, drivers };
}
