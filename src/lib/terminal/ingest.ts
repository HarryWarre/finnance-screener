import { fetchChartData } from '../api';
import type { Security, StoredSeries } from './types';
import { dbPutSeries } from './idb';
import { computeMissingPct, seriesId } from './series';

const YAHOO_SOURCE = {
  id: 'yahoo_chart' as const,
  nameVi: 'Yahoo Finance (qua proxy)',
  cadence: 'daily' as const,
  latencyHintVi: 'Intraday thường bị giới hạn; 1d ổn định hơn.',
};

function toPoints(timestamps: number[], values: number[]) {
  const out: { t: number; v: number }[] = [];
  for (let i = 0; i < Math.min(timestamps.length, values.length); i++) {
    const ts = timestamps[i];
    const v = values[i];
    if (!Number.isFinite(ts) || !Number.isFinite(v)) continue;
    out.push({ t: ts * 1000, v });
  }
  out.sort((a, b) => a.t - b.t);
  // dedupe by timestamp
  const dedup: typeof out = [];
  for (const p of out) {
    if (!dedup.length || dedup[dedup.length - 1].t !== p.t) dedup.push(p);
  }
  return dedup;
}

export async function syncYahooDailyOHLCV(security: Security, range: '3mo' | '6mo' | '1y' | '2y' | '5y' = '1y') {
  const symbol = security.providerSymbols.yahoo_chart ?? security.symbol;
  const data = await fetchChartData(symbol, '1d', range);
  if (!data) return { ok: false as const, reasonVi: 'Không fetch được chart data.' };

  const now = Date.now();

  const makeSeries = (field: StoredSeries['key']['field'], raw: number[]) => {
    const points = toPoints(data.timestamp, raw);
    const missingPct = computeMissingPct(points);
    const isStale = points.length ? (now - points[points.length - 1].t > 7 * 24 * 60 * 60 * 1000) : true;
    const series: StoredSeries = {
      id: seriesId(security.id, 'yahoo_chart', '1d', field),
      key: { securityId: security.id, provider: 'yahoo_chart', interval: '1d', field },
      points,
      updatedAt: now,
      source: YAHOO_SOURCE,
      quality: {
        missingPct,
        isStale,
        notesVi: isStale ? 'Dữ liệu có thể bị trễ.' : undefined,
      },
    };
    return series;
  };

  const seriesList: StoredSeries[] = [];
  if (data.open?.length) seriesList.push(makeSeries('open', data.open));
  if (data.high?.length) seriesList.push(makeSeries('high', data.high));
  if (data.low?.length) seriesList.push(makeSeries('low', data.low));
  seriesList.push(makeSeries('close', data.close));

  for (const s of seriesList) await dbPutSeries(s);
  return { ok: true as const, updated: seriesList.length };
}
