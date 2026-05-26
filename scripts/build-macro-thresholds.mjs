import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (const raw of argv) {
    const m = raw.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2];
  }
  return out;
}

function isoDate(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysUTC(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function parseMetricValue(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const upper = text.toUpperCase().replace(/,/g, '');
  const m = upper.match(/-?\\d+(?:\\.\\d+)?/);
  if (!m) return null;
  let v = Number(m[0]);
  if (!Number.isFinite(v)) return null;
  if (upper.includes('B')) v *= 1_000_000_000;
  else if (upper.includes('M')) v *= 1_000_000;
  else if (upper.includes('K')) v *= 1_000;
  return v;
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  const idx = (sortedValues.length - 1) * clamp(p, 0, 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  const w = idx - lo;
  return sortedValues[lo] * (1 - w) + sortedValues[hi] * w;
}

function classifyFamily(currency, titleRaw) {
  const title = String(titleRaw ?? '').toLowerCase();
  const c = String(currency ?? '').toUpperCase();
  if (!c) return null;

  // Policy
  if (/interest rate decision|official cash rate|refinancing rate|deposit rate|fed|fomc|ecb|boe|boj|rba|rbnz/.test(title)) {
    return { family: 'Policy', invert: false };
  }
  // Inflation
  if (/(\\bcore\\b\\s*)?(cpi|consumer price index)|pce|inflation/.test(title)) {
    return { family: 'Inflation', invert: false };
  }
  // Labor
  if (/nonfarm|payroll|employment change|jobless claims|unemployment rate|average hourly earnings/.test(title)) {
    const invert = /unemployment rate|jobless claims/.test(title);
    return { family: 'Labor', invert };
  }
  // Growth
  if (/\\bgdp\\b|industrial production|retail sales|trade balance|current account/.test(title)) {
    // trade balance: direction ambiguous, keep as growth-ish and let threshold handle it; no invert
    return { family: 'Growth', invert: false };
  }
  // Survey
  if (/\\bpmi\\b|\\bism\\b|business confidence|consumer confidence|sentiment/.test(title)) {
    return { family: 'Survey', invert: false };
  }
  // Demand
  if (/retail sales|personal spending|durable goods|housing starts|building permits/.test(title)) {
    return { family: 'Demand', invert: false };
  }

  // Not in v1 families
  return null;
}

function seriesKey(currency, family, titleRaw) {
  const c = String(currency).toUpperCase().trim();
  const t = String(titleRaw ?? '')
    .toUpperCase()
    .replace(/\\(.*?\\)/g, '') // strip periods like (Apr)
    .replace(/\\s+/g, ' ')
    .trim()
    .slice(0, 80);
  const slug = t
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return `${c}::${family}::${slug}`;
}

function inferCurrencyFromCountry(country) {
  const c = String(country ?? '').trim().toLowerCase();
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

async function fetchTradingEconomicsRange(dateFrom, dateTo, apiKey) {
  const countries = 'united%20states,euro%20area,united%20kingdom,japan,switzerland,canada,australia,new%20zealand,china,hong%20kong';
  const url =
    `https://api.tradingeconomics.com/calendar/country/${countries}/${encodeURIComponent(dateFrom)}/${encodeURIComponent(dateTo)}` +
    `?c=${encodeURIComponent(apiKey)}&f=json`;
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0',
      accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`TradingEconomics HTTP ${res.status}`);
  return await res.json();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const windowYears = Math.max(1, Math.min(10, Number(args.windowYears ?? '2')));
  const minSamples = Math.max(5, Math.min(500, Number(args.minSamples ?? '30')));
  const stepDays = Math.max(1, Math.min(31, Number(args.stepDays ?? '7')));
  const outPath = args.out ?? 'public/data/macro_thresholds.v1.json';

  const apiKey = String(process.env.TE_API_KEY || process.env.VITE_TE_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Missing TE_API_KEY (set in environment or .env, not committed).');
  }

  const to = args.to ? new Date(`${args.to}T00:00:00Z`) : new Date();
  const from = args.from
    ? new Date(`${args.from}T00:00:00Z`)
    : addDaysUTC(to, -Math.round(windowYears * 365));

  const seriesAbs = new Map(); // key -> number[]
  const familyDefaults = {
    Policy: 0.25,
    Inflation: 0.1,
    Labor: 20000,
    Growth: 0.3,
    Survey: 1.0,
    Demand: 0.3,
  };

  let cursor = new Date(from.getTime());
  let windows = 0;
  while (cursor <= to) {
    const end = addDaysUTC(cursor, stepDays - 1);
    const dateFrom = isoDate(cursor);
    const dateTo = isoDate(end > to ? to : end);
    windows += 1;

    console.log(`[macro-thresholds] fetch ${dateFrom}..${dateTo}`);
    let rows = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        rows = await fetchTradingEconomicsRange(dateFrom, dateTo, apiKey);
        break;
      } catch (e) {
        if (attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }

    for (const e of Array.isArray(rows) ? rows : []) {
      const country = String(e?.Country ?? '');
      const currency = String(e?.Currency ?? '').trim().toUpperCase() || inferCurrencyFromCountry(country);
      const title = String(e?.Event ?? '').trim();
      if (!currency || !title) continue;

      const cls = classifyFamily(currency, title);
      if (!cls) continue;
      const a = parseMetricValue(String(e?.Actual ?? ''));
      const f = parseMetricValue(String((e?.Forecast ?? '').trim() ? e.Forecast : e?.TEForecast ?? ''));
      if (a == null || f == null) continue;
      let raw = a - f;
      if (cls.invert) raw = -raw;
      const absRaw = Math.abs(raw);
      if (!Number.isFinite(absRaw) || absRaw <= 0) continue;

      const key = seriesKey(currency, cls.family, title);
      const arr = seriesAbs.get(key) ?? [];
      arr.push(absRaw);
      seriesAbs.set(key, arr);
    }

    cursor = addDaysUTC(cursor, stepDays);
  }

  const seriesStats = {};
  for (const [key, values] of seriesAbs.entries()) {
    if (values.length < minSamples) continue;
    values.sort((a, b) => a - b);
    const p70 = percentile(values, 0.7);
    if (p70 == null || !Number.isFinite(p70) || p70 <= 0) continue;
    seriesStats[key] = {
      threshold: p70,
      n: values.length,
      p70AbsRaw: p70,
    };
  }

  const artifact = {
    version: 'v1',
    generatedAt: new Date().toISOString(),
    windowYears,
    minSamples,
    method: 'p70_abs_raw',
    familyDefaults,
    seriesStats,
    meta: {
      source: 'investing_getCalendarFilteredData',
      windowsFetched: windows,
      stepDays,
    },
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(artifact, null, 2) + '\n', 'utf8');
  console.log(`[macro-thresholds] wrote ${outPath} (${Object.keys(seriesStats).length} series)`);
}

main().catch((e) => {
  console.error('[macro-thresholds] failed:', e);
  process.exitCode = 1;
});
