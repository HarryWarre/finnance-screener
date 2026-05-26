import type { InvestingCalendarEvent } from '../api';
import type {
  MacroBias,
  MacroCellComputed,
  MacroCellEventContribution,
  MacroDriver,
  MacroRegimeLabel,
  MacroThresholdArtifactV1,
  MacroTimeframe,
} from './types';
import { fxPairCurrencies, MACRO_ASSETS, type MacroCurrency, type MacroAssetDef } from './universe';
import { thresholdForSeries } from './thresholds';

type EventFamily = 'Policy' | 'Inflation' | 'Labor' | 'Growth' | 'Survey' | 'Demand';

const TIMEFRAMES: Array<{ tf: MacroTimeframe; days: number }> = [
  { tf: '7D', days: 7 },
  { tf: '30D', days: 30 },
  { tf: '180D', days: 180 },
];

const FAMILY_WEIGHTS: Record<EventFamily, number> = {
  Policy: 1.2,
  Inflation: 1.0,
  Labor: 0.8,
  Growth: 0.7,
  Survey: 0.6,
  Demand: 0.6,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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

function parseInvestingDatetime(dt: string): number {
  // Investing attribute like "2026/05/29 00:00:00" (timezone depends on request).
  const normalized = dt.replaceAll('/', '-');
  const ts = Date.parse(normalized);
  return Number.isFinite(ts) ? ts : 0;
}

function tierWeight(importance: number): number {
  if (importance >= 3) return 1.0;
  if (importance === 2) return 0.7;
  if (importance === 1) return 0.4;
  return 0.3;
}

function classifyFamily(currency: string, titleRaw: string): { family: EventFamily; invert: boolean } | null {
  const title = titleRaw.toLowerCase();
  const c = currency.toUpperCase();
  if (!c) return null;

  if (/interest rate decision|official cash rate|refinancing rate|deposit rate|rate decision|fed|fomc|ecb|boe|boj|rba|rbnz|central bank/.test(title)) {
    return { family: 'Policy', invert: false };
  }
  if (/(?:\bcore\b\s*)?(?:cpi|consumer price index)|pce|inflation/.test(title)) {
    return { family: 'Inflation', invert: false };
  }
  if (/nonfarm|payroll|employment change|jobless claims|unemployment rate|average hourly earnings/.test(title)) {
    const invert = /unemployment rate|jobless claims/.test(title);
    return { family: 'Labor', invert };
  }
  if (/\bgdp\b|industrial production|trade balance|current account|goods trade balance|wholesale inventories/.test(title)) {
    return { family: 'Growth', invert: false };
  }
  if (/\bpmi\b|\bism\b|business confidence|consumer confidence|sentiment|leading index|economic expectations|kof|richmond|chicago pmi/.test(title)) {
    return { family: 'Survey', invert: false };
  }
  if (/retail sales|personal spending|durable goods|housing starts|building permits|home sales|hpi|house price|inventories|crude oil inventories|oil inventories|natural gas storage/.test(title)) {
    const invert = /inventories|crude oil inventories|oil inventories|natural gas storage/.test(title);
    return { family: 'Demand', invert };
  }
  if (/retail sales|personal spending|durable goods|housing starts|building permits/.test(title)) {
    return { family: 'Demand', invert: false };
  }
  return null;
}

function seriesKey(currency: string, family: EventFamily, titleRaw: string) {
  const c = currency.toUpperCase().trim();
  const t = titleRaw
    .toUpperCase()
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  const slug = t.replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return `${c}::${family}::${slug}`;
}

function timeDecayWeight(ageDays: number, tfDays: number) {
  const halfLifeDays = tfDays / 2;
  const lambda = Math.log(2) / halfLifeDays;
  return Math.exp(-lambda * ageDays);
}

function biasFromScore(score: number): MacroBias {
  // No-key mode tends to have fewer events / proxy signals; use a slightly more sensitive threshold
  // so the matrix doesn't stay Neutral for most assets.
  if (score >= 1.2) return 'BUY';
  if (score <= -1.2) return 'SELL';
  if (score >= 0.6) return 'READY_BUY';
  if (score <= -0.6) return 'READY_SELL';
  return 'NEUTRAL';
}

function regimeFromBuckets(buckets: Record<EventFamily, number>, score: number): MacroRegimeLabel {
  const policy = buckets.Policy;
  const infl = buckets.Inflation;
  const growth = buckets.Growth + buckets.Survey + buckets.Demand + buckets.Labor;

  const abs = (v: number) => Math.abs(v);
  const top = [
    { k: 'Policy', v: abs(policy) },
    { k: 'Inflation', v: abs(infl) },
    { k: 'Growth', v: abs(growth) },
  ].sort((a, b) => b.v - a.v);

  if (!Number.isFinite(score) || top[0].v < 0.6) return 'Mixed/Transition';
  if (top[0].v > 0 && top[1].v > 0 && top[1].v / top[0].v >= 0.85) return 'Mixed/Transition';

  // First: explicit policy/inflation/growth regimes.
  if (top[0].k === 'Policy') return policy >= 0 ? 'Policy tightening' : 'Policy easing';
  if (top[0].k === 'Inflation') return infl >= 0 ? 'Inflationary' : 'Disinflationary';
  if (top[0].k === 'Growth') return growth >= 0 ? 'Growth up' : 'Growth down';

  // Risk-on/off as a fallback using growth vs policy impulse.
  const risk = growth - policy;
  if (risk >= 1.2) return 'Risk-on';
  if (risk <= -1.2) return 'Risk-off';
  return 'Mixed/Transition';
}

function normalizeDriverWeight(w: number) {
  if (!Number.isFinite(w) || w <= 0) return 0;
  return clamp(w, 0, 1);
}

function driverDirection(v: number): 'pos' | 'neg' | 'neu' {
  if (!Number.isFinite(v) || Math.abs(v) < 0.25) return 'neu';
  return v > 0 ? 'pos' : 'neg';
}

function buildCurrencyCellDrivers(buckets: Record<EventFamily, number>, confirmDelta: number, confirmMode: 'align' | 'diverge' | 'none'): { drivers: MacroDriver[]; signature: Record<string, MacroDriver['direction']> } {
  const entries: Array<{ label: string; v: number; note: string }> = [
    { label: 'Policy', v: buckets.Policy, note: 'Surprise từ rate decision / central bank.' },
    { label: 'Inflation', v: buckets.Inflation, note: 'Surprise từ CPI / inflation prints.' },
    { label: 'Growth', v: buckets.Growth, note: 'Surprise từ GDP / industrial production.' },
    { label: 'Survey', v: buckets.Survey, note: 'Surprise từ PMI / sentiment surveys.' },
    { label: 'Demand', v: buckets.Demand, note: 'Surprise từ retail/housing/demand.' },
    { label: 'Labor', v: buckets.Labor, note: 'Surprise từ jobs/unemployment.' },
  ];

  entries.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const top = entries.filter((e) => Math.abs(e.v) > 0.15).slice(0, 4);

  const drivers: MacroDriver[] = top.map((e) => ({
    label: e.label,
    direction: driverDirection(e.v),
    weight: normalizeDriverWeight(Math.min(1, Math.abs(e.v) / 4)),
    note: e.note,
  }));

  if (confirmMode !== 'none') {
    drivers.push({
      label: 'Market confirmation',
      direction: confirmDelta > 0 ? 'pos' : confirmDelta < 0 ? 'neg' : 'neu',
      weight: normalizeDriverWeight(Math.abs(confirmDelta) / 20),
      note: confirmMode === 'align' ? 'Giá đang xác nhận narrative.' : 'Giá đang đi ngược narrative (giảm confidence).',
    });
  }

  const signature: Record<string, MacroDriver['direction']> = {};
  for (const d of drivers) signature[d.label] = d.direction;
  return { drivers, signature };
}

function computeConfidence(score: number, eventCount: number, confirmDelta: number): number {
  let c = 50;
  c += Math.min(35, Math.abs(score) * 10);
  c += Math.min(10, Math.log1p(eventCount) * 3);
  if (eventCount < 3) c -= 15;
  c += clamp(confirmDelta, -20, 20);
  return Math.round(clamp(c, 0, 100));
}

function assetHeadline(assetId: string, bias: MacroBias, regime: MacroRegimeLabel, tf: MacroTimeframe) {
  const b =
    bias === 'BUY'
      ? 'Mua'
      : bias === 'SELL'
        ? 'Bán'
        : bias === 'READY_BUY'
          ? 'Sắp mua'
          : bias === 'READY_SELL'
            ? 'Sắp bán'
            : 'Trung lập';
  return `${assetId}: ${b} (${tf}) · ${regime}`;
}

function eventToContribution(input: {
  event: InvestingCalendarEvent;
  currency: string;
  family: EventFamily;
  z: number;
  weight: number;
  signedImpact: number;
  note?: string;
}): MacroCellEventContribution {
  const ts = parseInvestingDatetime(input.event.datetime);
  return {
    eventId: String(input.event.id || `${input.currency}-${ts}-${input.event.title}`),
    when: ts ? new Date(ts).toISOString() : '',
    currency: input.currency,
    family: input.family,
    title: input.event.title,
    actual: input.event.actual,
    forecast: input.event.forecast,
    importance: input.event.importance,
    z: input.z,
    weight: input.weight,
    signedImpact: input.signedImpact,
    url: input.event.url || undefined,
    note: input.note,
  };
}

function currencyUniverse(): MacroCurrency[] {
  return ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'CNY'];
}

export function computeMacroRegimeCells(opts: {
  nowMs: number;
  events: InvestingCalendarEvent[];
  thresholds: MacroThresholdArtifactV1;
  marketMomentumPctByAssetId: Record<string, number>; // e.g. +3.2 means +3.2% over ~30D
}): MacroCellComputed[] {
  const { nowMs, events, thresholds, marketMomentumPctByAssetId } = opts;
  const now = nowMs || Date.now();

  // Pre-normalize event timestamps to speed up filtering.
  const normalized = events
    .map((e) => {
      const ts = parseInvestingDatetime(e.datetime);
      if (!ts) return null;
      return { e, ts };
    })
    .filter(Boolean) as Array<{ e: InvestingCalendarEvent; ts: number }>;

  const out: MacroCellComputed[] = [];

  for (const { tf, days } of TIMEFRAMES) {
    const windowStart = now - days * 24 * 3600 * 1000;

    const byCurrency: Record<string, { buckets: Record<EventFamily, number>; events: MacroCellEventContribution[]; totalScore: number; n: number }> = {};
    for (const c of currencyUniverse()) {
      byCurrency[c] = {
        buckets: { Policy: 0, Inflation: 0, Labor: 0, Growth: 0, Survey: 0, Demand: 0 },
        events: [],
        totalScore: 0,
        n: 0,
      };
    }

    for (const { e, ts } of normalized) {
      // Allow a small forward window to include scheduled events when `actual` is missing (free feeds),
      // but keep it tight to avoid turning this into a forward-looking "signals" engine.
      const isFuture = ts > now;
      const allowFutureUntil = now + 2 * 24 * 3600 * 1000; // 48h
      if (ts < windowStart) continue;
      if (!isFuture && ts > now + 10 * 60 * 1000) continue;
      if (isFuture && ts > allowFutureUntil) continue;
      const currency = (e.currency || '').toUpperCase();
      if (!currency) continue;
      const cls = classifyFamily(currency, e.title);
      if (!cls) continue;

      const actual = parseMetricValue(e.actual);
      const forecast = parseMetricValue(e.forecast);
      const previous = parseMetricValue(e.previous);
      // Prefer real surprise (actual - forecast). If `actual` is missing (common in free feeds),
      // fall back to an "expected change" proxy (forecast - previous) with a heavy down-weight.
      let raw: number | null = null;
      let proxyMode: 'none' | 'forecast_vs_previous' | 'forecast_vs_previous_upcoming' | 'actual_vs_previous' = 'none';
      if (actual != null && forecast != null) {
        raw = actual - forecast;
      } else if (actual != null && previous != null && forecast == null) {
        raw = actual - previous;
        proxyMode = 'actual_vs_previous';
      } else if (actual == null && forecast != null && previous != null) {
        raw = forecast - previous;
        proxyMode = isFuture ? 'forecast_vs_previous_upcoming' : 'forecast_vs_previous';
      }
      if (raw == null) continue;

      const family = cls.family;
      const key = seriesKey(currency, family, e.title);
      const th = thresholdForSeries(thresholds, key, family);
      if (!th || !Number.isFinite(th) || th <= 0) continue;

      if (cls.invert) raw = -raw;
      const z = clamp(raw / th, -3, 3);
      if (!Number.isFinite(z) || Math.abs(z) < 0.05) continue;

      const ageDays = (now - ts) / (24 * 3600 * 1000);
      const proxyWeight =
        proxyMode === 'none'
          ? 1
          : proxyMode === 'actual_vs_previous'
            ? 0.5
            : proxyMode === 'forecast_vs_previous'
              ? 0.35
              : 0.2;
      const w = tierWeight(e.importance) * timeDecayWeight(ageDays, days) * FAMILY_WEIGHTS[family] * proxyWeight;
      const signedImpact = z * w;

      const bucket = byCurrency[currency];
      if (!bucket) continue;

      bucket.buckets[family] += signedImpact;
      bucket.totalScore += signedImpact;
      bucket.n += 1;

      bucket.events.push(
        eventToContribution({
          event: e,
          currency,
          family,
          z,
          weight: w,
          signedImpact,
          note:
            proxyMode === 'none'
              ? undefined
              : proxyMode === 'actual_vs_previous'
                ? 'proxy: actual vs previous (no forecast)'
              : proxyMode === 'forecast_vs_previous'
                ? 'proxy: forecast vs previous (no actual)'
                : 'proxy: scheduled (forecast vs previous; no actual yet)',
        })
      );
    }

    // For each asset in universe, build a MacroCellComputed.
    for (const asset of MACRO_ASSETS) {
      const momentumPct = Number(marketMomentumPctByAssetId[asset.assetId] ?? 0);

      let score = 0;
      let buckets: Record<EventFamily, number> = { Policy: 0, Inflation: 0, Labor: 0, Growth: 0, Survey: 0, Demand: 0 };
      let contributions: MacroCellEventContribution[] = [];
      let eventCount = 0;
      let dataQuality: 'good' | 'partial' | 'stale' = 'good';

      if (asset.assetClass === 'FX') {
        const cc = fxPairCurrencies(asset.assetId);
        if (!cc) continue;
        const base = byCurrency[cc.base];
        const quote = byCurrency[cc.quote];
        if (!base || !quote) {
          dataQuality = 'partial';
        }
        score = (base?.totalScore ?? 0) - (quote?.totalScore ?? 0);
        for (const f of Object.keys(buckets) as EventFamily[]) {
          buckets[f] = (base?.buckets[f] ?? 0) - (quote?.buckets[f] ?? 0);
        }
        contributions = [...(base?.events ?? []), ...(quote?.events ?? [])].sort((a, b) => Math.abs(b.signedImpact) - Math.abs(a.signedImpact));
        eventCount = (base?.n ?? 0) + (quote?.n ?? 0);
      } else if (asset.assetClass === 'Index') {
        const home = asset.homeCurrency;
        if (!home) {
          dataQuality = 'partial';
        }
        const src = home ? byCurrency[home] : null;
        eventCount = src?.n ?? 0;
        buckets = src?.buckets ?? buckets;
        // Indices: prefer growth/risk; policy+inflation are headwinds.
        score =
          (buckets.Growth * 0.9 + buckets.Survey * 0.7 + buckets.Demand * 0.7 + buckets.Labor * 0.7) -
          (buckets.Policy * 1.0 + buckets.Inflation * 0.7);
        contributions = (src?.events ?? []).slice().sort((a, b) => Math.abs(b.signedImpact) - Math.abs(a.signedImpact));
      } else if (asset.assetClass === 'Commodity') {
        const usd = byCurrency.USD;
        eventCount = usd?.n ?? 0;
        const usdBuckets = usd?.buckets ?? buckets;
        const usdEvents = usd?.events ?? [];
        if (asset.assetId === 'XAUUSD' || asset.assetId === 'XAGUSD') {
          // Simple macro proxy: strong USD surprises => headwind for USD-priced metals.
          score = -usd.totalScore;
          for (const f of Object.keys(buckets) as EventFamily[]) buckets[f] = -(usdBuckets[f] ?? 0);
          contributions = usdEvents.slice().sort((a, b) => Math.abs(b.signedImpact) - Math.abs(a.signedImpact));
        } else if (asset.assetId === 'WTI') {
          // WTI: growth/demand tailwind, tighter policy headwind (proxy via USD).
          buckets = usdBuckets;
          score = (buckets.Growth * 0.8 + buckets.Demand * 0.9 + buckets.Survey * 0.6) - (buckets.Policy * 0.6 + buckets.Inflation * 0.3);
          contributions = usdEvents.slice().sort((a, b) => Math.abs(b.signedImpact) - Math.abs(a.signedImpact));
        } else {
          buckets = usdBuckets;
          score = usd.totalScore;
          contributions = usdEvents.slice().sort((a, b) => Math.abs(b.signedImpact) - Math.abs(a.signedImpact));
        }
      }

      if (eventCount === 0) dataQuality = 'stale';
      else if (eventCount < 4) dataQuality = 'partial';

      const bias = biasFromScore(score);
      const macroSign = Math.sign(score);
      const momSign = Math.sign(momentumPct);
      const confirmDelta =
        macroSign === 0 || momSign === 0
          ? 0
          : macroSign === momSign
            ? Math.min(20, 6 + Math.abs(momentumPct) * 2)
            : -Math.min(20, 8 + Math.abs(momentumPct) * 2);
      const confirmMode: 'align' | 'diverge' | 'none' = confirmDelta >= 4 ? 'align' : confirmDelta <= -4 ? 'diverge' : 'none';

      const regime = regimeFromBuckets(buckets, score);
      const { drivers, signature } = buildCurrencyCellDrivers(buckets, confirmDelta, confirmMode);
      const confidence = computeConfidence(score, eventCount, confirmDelta);

      const topEvents = contributions.slice(0, 5);
      const headline = assetHeadline(asset.assetId, bias, regime, tf);

      out.push({
        assetId: asset.assetId,
        assetClass: asset.assetClass,
        timeframe: tf,
        bias,
        confidence,
        regime,
        drivers,
        headline,
        lastUpdated: new Date(now).toISOString(),
        dataQuality,
        score,
        topEvents,
        driverSignature: signature,
      });
    }
  }

  return out;
}

export function computeConflict(cells: MacroCellComputed[], assetId: string): boolean {
  const byTf: Partial<Record<MacroTimeframe, MacroCellComputed>> = {};
  for (const c of cells) {
    if (c.assetId !== assetId) continue;
    byTf[c.timeframe] = c;
  }
  const a7 = byTf['7D'];
  const a30 = byTf['30D'];
  const a180 = byTf['180D'];
  if (!a7 || !a30 || !a180) return false;

  const biases = [a7.bias, a30.bias, a180.bias];
  const hasBuy = biases.includes('BUY') || biases.includes('READY_BUY');
  const hasSell = biases.includes('SELL') || biases.includes('READY_SELL');
  if (hasBuy && hasSell) return true; // (A)

  if (a7.regime === 'Mixed/Transition' || a30.regime === 'Mixed/Transition' || a180.regime === 'Mixed/Transition') return true; // (B)

  const d7 = a7.driverSignature['Policy'] ?? 'neu';
  const d180 = a180.driverSignature['Policy'] ?? 'neu';
  if (d7 !== 'neu' && d180 !== 'neu' && d7 !== d180) return true;

  const g7 = a7.driverSignature['Growth'] ?? 'neu';
  const g180 = a180.driverSignature['Growth'] ?? 'neu';
  if (g7 !== 'neu' && g180 !== 'neu' && g7 !== g180) return true;

  return false;
}

export function assetsInUniverse(): MacroAssetDef[] {
  return MACRO_ASSETS;
}
