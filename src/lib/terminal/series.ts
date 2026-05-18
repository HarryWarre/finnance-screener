import type { StoredSeries, TimeSeriesPoint } from './types';

export function seriesId(securityId: string, provider: string, interval: string, field: string) {
  return `${securityId}:${provider}:${interval}:${field}`;
}

export function latestPoint(points: TimeSeriesPoint[]) {
  if (!points.length) return null;
  return points[points.length - 1];
}

export function valueAtOrBefore(points: TimeSeriesPoint[], t: number) {
  // points assumed sorted by t asc
  if (!points.length) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const mt = points[mid].t;
    if (mt === t) return points[mid];
    if (mt < t) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi >= 0 ? points[hi] : null;
}

export function pctChange(series: StoredSeries | undefined, daysBack: number) {
  if (!series?.points?.length) return null;
  const last = latestPoint(series.points);
  if (!last) return null;
  const tBack = last.t - daysBack * 24 * 60 * 60 * 1000;
  const prev = valueAtOrBefore(series.points, tBack);
  if (!prev || prev.v === 0) return null;
  return ((last.v - prev.v) / prev.v) * 100;
}

export function computeMissingPct(points: TimeSeriesPoint[]) {
  if (points.length < 2) return 0;
  const first = points[0].t;
  const last = points[points.length - 1].t;
  const spanDays = Math.max(1, Math.round((last - first) / (24 * 60 * 60 * 1000)));
  const expected = spanDays + 1;
  const missing = Math.max(0, expected - points.length);
  return (missing / expected) * 100;
}

