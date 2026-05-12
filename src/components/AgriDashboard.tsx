import { useEffect, useMemo, useState } from 'react';
import { Activity, Star } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { fetchChartData, fetchCot, fetchEnso, fetchWasde } from '../lib/api';
import styles from '../App.module.css';
import AgriModal, { type AgriInstrument } from './AgriModal';

const AGRI: AgriInstrument[] = [
  { key: 'cocoa', name: 'Cocoa', yahooSymbol: 'CC=F' },
  { key: 'coffee', name: 'Coffee', yahooSymbol: 'KC=F' },
  { key: 'corn', name: 'Corn', yahooSymbol: 'ZC=F' },
  { key: 'soybean', name: 'Soybean', yahooSymbol: 'ZS=F' },
  { key: 'wheat', name: 'Wheat', yahooSymbol: 'ZW=F' },
  { key: 'oj', name: 'Orange Juice', yahooSymbol: 'OJ=F' },
];

const SORT_KEYS = ['confidence', 'seasonal', 'cot', 'vol', '1m', 'name'] as const;
type SortKey = (typeof SORT_KEYS)[number];

function pct(a: number, b: number) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return ((a - b) / b) * 100;
}

function cotBadge(z: number | null) {
  if (z === null) return { label: 'N/A', cls: styles.badgeNeutral };
  if (z <= -1.5) return { label: 'Crowded Short', cls: styles.badgeBuy };
  if (z >= 1.5) return { label: 'Crowded Long', cls: styles.badgeSell };
  return { label: 'Normal', cls: styles.badgeNeutral };
}

function stocksUseBadge(v: number | null) {
  if (v === null) return { label: 'N/A', cls: styles.badgeNeutral };
  if (v < 12) return { label: 'Tight', cls: styles.badgeDanger };
  if (v < 18) return { label: 'Balanced', cls: styles.badgeWarn };
  return { label: 'Loose', cls: styles.badgeBuy };
}

function seasonalBadge(med: number | null, win: number | null) {
  if (med === null || win === null) return { label: 'N/A', cls: styles.badgeNeutral };
  if (med >= 0 && win >= 55) return { label: 'Seasonal Bull', cls: styles.badgeBuy };
  if (med <= 0 && win >= 55) return { label: 'Seasonal Bear', cls: styles.badgeSell };
  return { label: 'Mixed', cls: styles.badgeNeutral };
}

function recommendation(input: {
  seasonalMed20d: number | null;
  seasonalWin20d: number | null;
  cotZ: number | null;
  vol20: number | null;
  pct1m: number;
}) {
  const { seasonalMed20d, seasonalWin20d, cotZ, vol20, pct1m } = input;

  let score = 0;
  const reasons: string[] = [];

  if (seasonalMed20d !== null && seasonalWin20d !== null) {
    score += seasonalMed20d >= 0 ? 1 : -1;
    if (seasonalWin20d >= 58) score += 1;
    else if (seasonalWin20d <= 42) score -= 1;
    reasons.push(`Seasonal(1M) ${seasonalMed20d >= 0 ? '+' : ''}${seasonalMed20d.toFixed(2)}% (${seasonalWin20d.toFixed(0)}%)`);
  } else {
    reasons.push('Seasonal(1M) N/A');
  }

  if (cotZ !== null) {
    if (cotZ <= -1.5) {
      score += 1;
      reasons.push(`COT crowded short (Z ${cotZ.toFixed(2)})`);
    } else if (cotZ >= 1.5) {
      score -= 1;
      reasons.push(`COT crowded long (Z ${cotZ.toFixed(2)})`);
    } else {
      reasons.push(`COT normal (Z ${cotZ.toFixed(2)})`);
    }
  } else {
    reasons.push('COT N/A');
  }

  if (seasonalMed20d !== null && Math.sign(seasonalMed20d) !== 0 && Math.sign(pct1m) !== 0 && Math.sign(seasonalMed20d) !== Math.sign(pct1m)) {
    score *= 0.7;
    reasons.push(`Trend diverge (1M ${pct1m >= 0 ? '+' : ''}${pct1m.toFixed(2)}%)`);
  }

  const highVol = vol20 !== null && vol20 >= 55;
  if (highVol) reasons.push(`High vol (${vol20!.toFixed(1)}%)`);

  let recAction: 'BUY' | 'SELL' | 'WAIT' = 'WAIT';
  if (score >= 1.6) recAction = 'BUY';
  else if (score <= -1.6) recAction = 'SELL';
  if (highVol && Math.abs(score) < 2.2) recAction = 'WAIT';

  const recLabel = recAction === 'BUY' ? 'BUY' : recAction === 'SELL' ? 'SELL' : 'WAIT';
  return { recAction, recLabel, recReason: reasons.join(' • ') };
}

function confidenceScore(input: {
  seasonalMed20d: number | null;
  seasonalWin20d: number | null;
  cotZ: number | null;
  vol20: number | null;
  pct1m: number;
}) {
  const { seasonalMed20d, seasonalWin20d, cotZ, vol20, pct1m } = input;

  // 0..100, explainable weighting
  let score = 50;

  if (seasonalMed20d !== null && seasonalWin20d !== null) {
    // Seasonal strength
    score += Math.max(-20, Math.min(20, seasonalMed20d * 2)); // cap impact
    score += (seasonalWin20d - 50) * 0.8; // +/- 40 max
  } else {
    score -= 10;
  }

  // Positioning extremes are useful but risky
  if (cotZ !== null) {
    if (Math.abs(cotZ) >= 2) score += 6;
    else if (Math.abs(cotZ) >= 1.5) score += 3;
  } else {
    score -= 5;
  }

  // Trend alignment with seasonal bias improves confidence
  if (seasonalMed20d !== null && Math.sign(seasonalMed20d) !== 0 && Math.sign(pct1m) !== 0) {
    if (Math.sign(seasonalMed20d) === Math.sign(pct1m)) score += 6;
    else score -= 6;
  }

  // High vol reduces reliability for swing entries
  if (vol20 !== null) {
    if (vol20 >= 70) score -= 18;
    else if (vol20 >= 55) score -= 12;
    else if (vol20 >= 40) score -= 6;
  }

  score = Math.max(0, Math.min(100, score));
  return Math.round(score);
}

type Row = {
  instrument: AgriInstrument;
  close: number[];
  timestamp: number[];
  last: number;
  pct1w: number;
  pct1m: number;
  pct3m: number;
  cotZ: number | null;
  stocksToUse: number | null;
  vol20: number | null;
  seasonalMed20d: number | null;
  seasonalWin20d: number | null;
  recAction: 'BUY' | 'SELL' | 'WAIT';
  recLabel: string;
  recReason: string;
  confidence: number;
};

type OverviewSnapshot = {
  savedAt: number;
  sortKey: SortKey;
  filters: { onlySeasonalStrong: boolean; onlyCrowded: boolean; hideHighVol: boolean };
  enso: { state: string; oni: number } | null;
  rows: Array<{
    commodity: string;
    symbol: string;
    last: number;
    pct1w: number;
    pct1m: number;
    pct3m: number;
    vol20: number | null;
    seasonalMed20d: number | null;
    seasonalWin20d: number | null;
    confidence: number;
    rec: string;
    cotZ: number | null;
    stocksToUse: number | null;
  }>;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export default function AgriDashboard({ isActive }: { isActive: boolean }) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [enso, setEnso] = useState<{ state: string; oni: number } | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('confidence');
  const [onlySeasonalStrong, setOnlySeasonalStrong] = useState(false);
  const [onlyCrowded, setOnlyCrowded] = useState(false);
  const [hideHighVol, setHideHighVol] = useState(false);
  const [watchOnly, setWatchOnly] = useState(false);
  const [watch, setWatch] = useState<Set<string>>(() => new Set());
  const [snapshotCount, setSnapshotCount] = useState<number>(0);
  const [lastSnapshotAt, setLastSnapshotAt] = useState<number | null>(null);
  const [snapshots, setSnapshots] = useState<OverviewSnapshot[]>([]);
  const [activeSnapshot, setActiveSnapshot] = useState<OverviewSnapshot | null>(null);
  const [customSymbol, setCustomSymbol] = useState('');
  const [customLoading, setCustomLoading] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const ensoData = await fetchEnso();
        if (!cancelled) {
          setEnso(ensoData ? { state: ensoData.state, oni: ensoData.oni } : null);
        }

        const buildRow = async (instrument: AgriInstrument): Promise<Row | null> => {
          const chart = await fetchChartData(instrument.yahooSymbol, '1d', '5y');
          if (!chart || chart.close.length < 300) return null;

          const close = chart.close;
          const timestamp = chart.timestamp;
          const last = close.at(-1) ?? 0;
          const w = close.length > 5 ? close.at(-6) ?? last : last;
          const m = close.length > 21 ? close.at(-22) ?? last : last;
          const q = close.length > 63 ? close.at(-64) ?? last : last;

          const calcVol20 = () => {
            const n = 20;
            if (close.length < n + 1) return null;
            const rets: number[] = [];
            for (let i = close.length - n; i < close.length; i++) {
              const prev = close[i - 1];
              const cur = close[i];
              if (!Number.isFinite(prev) || !Number.isFinite(cur) || prev <= 0 || cur <= 0) continue;
              rets.push(Math.log(cur / prev));
            }
            if (rets.length < 10) return null;
            const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
            const varSum = rets.reduce((a, v) => a + (v - mean) ** 2, 0);
            const std = Math.sqrt(varSum / rets.length);
            return std * Math.sqrt(252) * 100;
          };

          const calcSeasonal = () => {
            if (!timestamp.length || timestamp.length !== close.length) return { med: null, win: null };
            const horizon = 20; // ~1 month trading days
            if (close.length < horizon + 50) return { med: null, win: null };
            const lastTs = timestamp.at(-1)!;
            const lastMonth = new Date(lastTs * 1000).getUTCMonth(); // 0-11
            const fwd: number[] = [];
            for (let i = 0; i < close.length - horizon; i++) {
              const month = new Date(timestamp[i] * 1000).getUTCMonth();
              if (month !== lastMonth) continue;
              const a = close[i];
              const b = close[i + horizon];
              if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) continue;
              fwd.push(((b - a) / a) * 100);
            }
            if (fwd.length < 20) return { med: null, win: null };
            const sorted = [...fwd].sort((a, b) => a - b);
            const med = sorted[Math.floor(sorted.length / 2)];
            const win = (fwd.filter((v) => v > 0).length / fwd.length) * 100;
            return { med, win };
          };

          const vol20 = calcVol20();
          const seasonal = calcSeasonal();

          const cotInstrument =
            instrument.key === 'corn' ? '002602' :
            instrument.key === 'soybean' ? '005602' :
            instrument.key === 'wheat' ? '001602' :
            instrument.key === 'coffee' ? '083731' :
            instrument.key === 'cocoa' ? '073732' :
            instrument.key === 'oj' ? '040701' :
            '';
          const wasdeCommodity =
            instrument.key === 'corn' ? 'corn' :
            instrument.key === 'soybean' ? 'soybean' :
            instrument.key === 'wheat' ? 'wheat' :
            null;

          const [cot, wasde] = await Promise.all([
            cotInstrument ? fetchCot(cotInstrument) : Promise.resolve(null),
            wasdeCommodity ? fetchWasde(wasdeCommodity) : Promise.resolve(null),
          ]);

          const pct1mVal = pct(last, m);
          const rec = recommendation({
            seasonalMed20d: seasonal.med,
            seasonalWin20d: seasonal.win,
            cotZ: cot ? cot.nonCommercialZ52w : null,
            vol20,
            pct1m: pct1mVal,
          });
          const confidence = confidenceScore({
            seasonalMed20d: seasonal.med,
            seasonalWin20d: seasonal.win,
            cotZ: cot ? cot.nonCommercialZ52w : null,
            vol20,
            pct1m: pct1mVal,
          });

          return {
            instrument,
            close,
            timestamp,
            last,
            pct1w: pct(last, w),
            pct1m: pct1mVal,
            pct3m: pct(last, q),
            cotZ: cot ? cot.nonCommercialZ52w : null,
            stocksToUse: wasde ? wasde.stocksToUse : null,
            vol20,
            seasonalMed20d: seasonal.med,
            seasonalWin20d: seasonal.win,
            recAction: rec.recAction,
            recLabel: rec.recLabel,
            recReason: rec.recReason,
            confidence,
          };
        };

        const settled = await Promise.allSettled(AGRI.map(buildRow));
        const results = settled
          .map((s) => (s.status === 'fulfilled' ? s.value : null))
          .filter(Boolean) as Row[];
        if (!cancelled) setRows(results);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [isActive]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('agri_overview_snapshots');
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const list = parsed
        .filter((v): v is OverviewSnapshot => {
          if (!isRecord(v)) return false;
          return typeof v.savedAt === 'number' && isRecord(v.filters) && Array.isArray(v.rows);
        })
        .slice(-20);
      setSnapshots(list);
      setSnapshotCount(list.length);
      const last = list.at(-1);
      if (last) setLastSnapshotAt(last.savedAt);
    } catch {
      // ignore
    }
  }, [isActive]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('agri_watchlist');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      setWatch(new Set(parsed.filter((v) => typeof v === 'string')));
    } catch {
      // ignore
    }
  }, [isActive]);

  const toggleWatch = (instrumentKey: string) => {
    setWatch((prev) => {
      const next = new Set(prev);
      if (next.has(instrumentKey)) next.delete(instrumentKey);
      else next.add(instrumentKey);
      try {
        localStorage.setItem('agri_watchlist', JSON.stringify([...next]));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (watchOnly && !watch.has(r.instrument.key)) return false;
      if (onlySeasonalStrong) {
        const med = r.seasonalMed20d;
        const win = r.seasonalWin20d;
        const ok = med !== null && win !== null && win >= 55;
        if (!ok) return false;
      }
      if (onlyCrowded) {
        const z = r.cotZ;
        const ok = z !== null && Math.abs(z) >= 1.5;
        if (!ok) return false;
      }
      if (hideHighVol) {
        const v = r.vol20;
        if (v !== null && v >= 60) return false;
      }
      return true;
    });
  }, [rows, watchOnly, watch, onlySeasonalStrong, onlyCrowded, hideHighVol]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    const num = (v: number | null) => (v === null ? -Infinity : v);
    list.sort((a, b) => {
      if (sortKey === 'name') return a.instrument.name.localeCompare(b.instrument.name);
      if (sortKey === 'confidence') return b.confidence - a.confidence;
      if (sortKey === 'seasonal') return num(b.seasonalMed20d) - num(a.seasonalMed20d);
      if (sortKey === 'cot') return Math.abs(num(b.cotZ)) - Math.abs(num(a.cotZ));
      if (sortKey === 'vol') return num(a.vol20) - num(b.vol20); // lower vol first
      return b.pct1m - a.pct1m;
    });
    return list;
  }, [filtered, sortKey]);

  const colorPct = (v: number) => (v >= 0 ? '#10b981' : '#ef4444');

  const openCustomSymbol = async () => {
    const symbol = customSymbol.trim().toUpperCase();
    if (!symbol) return;
    setCustomError(null);
    setCustomLoading(true);
    try {
      const chart = await fetchChartData(symbol, '1d', '5y');
      if (!chart || chart.close.length < 120) {
        setCustomError('Symbol không hợp lệ hoặc không đủ dữ liệu (Yahoo).');
        return;
      }
      const close = chart.close;
      const timestamp = chart.timestamp;
      const last = close.at(-1) ?? 0;
      const w = close.length > 5 ? close.at(-6) ?? last : last;
      const m = close.length > 21 ? close.at(-22) ?? last : last;
      const q = close.length > 63 ? close.at(-64) ?? last : last;

      const calcVol20 = () => {
        const n = 20;
        if (close.length < n + 1) return null;
        const rets: number[] = [];
        for (let i = close.length - n; i < close.length; i++) {
          const prev = close[i - 1];
          const cur = close[i];
          if (!Number.isFinite(prev) || !Number.isFinite(cur) || prev <= 0 || cur <= 0) continue;
          rets.push(Math.log(cur / prev));
        }
        if (rets.length < 10) return null;
        const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
        const varSum = rets.reduce((a, v) => a + (v - mean) ** 2, 0);
        const std = Math.sqrt(varSum / rets.length);
        return std * Math.sqrt(252) * 100;
      };

      const calcSeasonal = () => {
        if (!timestamp.length || timestamp.length !== close.length) return { med: null, win: null };
        const horizon = 20;
        if (close.length < horizon + 50) return { med: null, win: null };
        const lastTs = timestamp.at(-1)!;
        const lastMonth = new Date(lastTs * 1000).getUTCMonth();
        const fwd: number[] = [];
        for (let i = 0; i < close.length - horizon; i++) {
          const month = new Date(timestamp[i] * 1000).getUTCMonth();
          if (month !== lastMonth) continue;
          const a = close[i];
          const b = close[i + horizon];
          if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) continue;
          fwd.push(((b - a) / a) * 100);
        }
        if (fwd.length < 20) return { med: null, win: null };
        const sortedVals = [...fwd].sort((a, b) => a - b);
        const med = sortedVals[Math.floor(sortedVals.length / 2)];
        const win = (fwd.filter((v) => v > 0).length / fwd.length) * 100;
        return { med, win };
      };

      const vol20 = calcVol20();
      const seasonal = calcSeasonal();
      const pct1mVal = pct(last, m);
      const rec = recommendation({
        seasonalMed20d: seasonal.med,
        seasonalWin20d: seasonal.win,
        cotZ: null,
        vol20,
        pct1m: pct1mVal,
      });
      const confidence = confidenceScore({
        seasonalMed20d: seasonal.med,
        seasonalWin20d: seasonal.win,
        cotZ: null,
        vol20,
        pct1m: pct1mVal,
      });

      const custom: Row = {
        instrument: { key: `custom:${symbol}`, name: symbol, yahooSymbol: symbol },
        close,
        timestamp,
        last,
        pct1w: pct(last, w),
        pct1m: pct1mVal,
        pct3m: pct(last, q),
        cotZ: null,
        stocksToUse: null,
        vol20,
        seasonalMed20d: seasonal.med,
        seasonalWin20d: seasonal.win,
        recAction: rec.recAction,
        recLabel: rec.recLabel,
        recReason: `Custom symbol (no COT/WASDE) • ${rec.recReason}`,
        confidence,
      };
      setSelected(custom);
    } finally {
      setCustomLoading(false);
    }
  };

  const exportCsv = () => {
    const headers = [
      'commodity',
      'symbol',
      'last',
      'pct_1w',
      'pct_1m',
      'pct_3m',
      'vol_20d',
      'seasonal_med_20d',
      'seasonal_win_20d',
      'confidence',
      'rec',
      'cot_z',
      'stocks_to_use',
    ];
    const lines = [headers.join(',')];
    for (const r of sorted) {
      const row = [
        r.instrument.name,
        r.instrument.yahooSymbol,
        r.last.toFixed(6),
        r.pct1w.toFixed(4),
        r.pct1m.toFixed(4),
        r.pct3m.toFixed(4),
        r.vol20 === null ? '' : r.vol20.toFixed(4),
        r.seasonalMed20d === null ? '' : r.seasonalMed20d.toFixed(4),
        r.seasonalWin20d === null ? '' : r.seasonalWin20d.toFixed(2),
        String(r.confidence),
        r.recLabel,
        r.cotZ === null ? '' : r.cotZ.toFixed(4),
        r.stocksToUse === null ? '' : r.stocksToUse.toFixed(4),
      ].map((v) => {
        const s = String(v);
        return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      });
      lines.push(row.join(','));
    }
    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.download = `agri_overview_${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const saveSnapshot = () => {
    try {
      const savedAt = Date.now();
      const payload: OverviewSnapshot = {
        savedAt,
        sortKey,
        filters: { onlySeasonalStrong, onlyCrowded, hideHighVol },
        enso,
        rows: sorted.map((r) => ({
          commodity: r.instrument.name,
          symbol: r.instrument.yahooSymbol,
          last: r.last,
          pct1w: r.pct1w,
          pct1m: r.pct1m,
          pct3m: r.pct3m,
          vol20: r.vol20,
          seasonalMed20d: r.seasonalMed20d,
          seasonalWin20d: r.seasonalWin20d,
          confidence: r.confidence,
          rec: r.recLabel,
          cotZ: r.cotZ,
          stocksToUse: r.stocksToUse,
        })),
      };
      const raw = localStorage.getItem('agri_overview_snapshots');
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      const arr = Array.isArray(parsed) ? parsed : [];
      const next = [...arr, payload].slice(-20);
      localStorage.setItem('agri_overview_snapshots', JSON.stringify(next));
      setSnapshotCount(next.length);
      setLastSnapshotAt(savedAt);
      const coerced = next
        .filter((v): v is OverviewSnapshot => isRecord(v) && typeof v.savedAt === 'number' && Array.isArray((v as { rows?: unknown }).rows))
        .slice(-20);
      setSnapshots(coerced);
    } catch {
      // ignore
    }
  };

  const applySnapshot = (s: OverviewSnapshot) => {
    setSortKey(s.sortKey);
    setOnlySeasonalStrong(!!s.filters.onlySeasonalStrong);
    setOnlyCrowded(!!s.filters.onlyCrowded);
    setHideHighVol(!!s.filters.hideHighVol);
  };

  const deleteSnapshot = (savedAt: number) => {
    try {
      const next = snapshots.filter((s) => s.savedAt !== savedAt);
      localStorage.setItem('agri_overview_snapshots', JSON.stringify(next));
      setSnapshots(next);
      setSnapshotCount(next.length);
      setLastSnapshotAt(next.at(-1)?.savedAt ?? null);
      if (activeSnapshot?.savedAt === savedAt) setActiveSnapshot(null);
    } catch {
      // ignore
    }
  };

  const clearSnapshots = () => {
    try {
      localStorage.removeItem('agri_overview_snapshots');
    } catch {
      // ignore
    }
    setSnapshots([]);
    setSnapshotCount(0);
    setLastSnapshotAt(null);
    setActiveSnapshot(null);
  };

  return (
    <>
      <div className={styles.glassPanel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Agri Overview (Daily Swing)</h2>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Click 1 hàng để xem chi tiết. Đây là bảng “bối cảnh” (context) cho swing mùa vụ.
            </p>
            {enso && (
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                ENSO: <span style={{ fontWeight: 800, color: 'var(--text-main)' }}>{enso.state}</span> (ONI {enso.oni.toFixed(2)})
              </p>
            )}

            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-main)', fontWeight: 800 }}>
                Cách đọc bảng (gợi ý)
              </summary>
              <div style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.55 }}>
                <div><b>Seasonal(1M)</b>: median forward return ~20 phiên trong <b>tháng hiện tại</b> + win-rate.</div>
                <div><b>Vol(20d)</b>: dùng để scale khối lượng (vol cao → giảm size).</div>
                <div><b>COT Z</b>: cực trị positioning (±1.5 trở lên là crowded).</div>
                <div><b>Stocks/Use</b> (corn/soy/wheat): thấp = thị trường “tight” (nhạy thời tiết).</div>
                <div style={{ marginTop: 8 }}>
                  <b>Rule đơn giản:</b> ưu tiên theo Seasonal; dùng COT/Stocks-Use/Vol để lọc rủi ro & timing.
                </div>
              </div>
            </details>
          </div>
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontWeight: 700 }}>
              <Activity className="animate-spin" size={16} /> Loading...
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 800 }}>Sort</span>
            <select
              value={sortKey}
              onChange={(e) => {
                const v = e.target.value;
                if ((SORT_KEYS as readonly string[]).includes(v)) setSortKey(v as SortKey);
              }}
              style={{
                padding: '0.45rem 0.7rem',
                borderRadius: 10,
                border: '1px solid var(--panel-border)',
                background: 'rgba(0,0,0,0.25)',
                color: 'var(--text-main)',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              <option value="confidence">Confidence</option>
              <option value="seasonal">Seasonal</option>
              <option value="cot">|COT Z|</option>
              <option value="vol">Low Vol</option>
              <option value="1m">1M Return</option>
              <option value="name">Name</option>
            </select>
          </div>

          <button
            onClick={exportCsv}
            className={styles.badge + ' ' + styles.badgeNeutral}
            style={{ cursor: 'pointer', userSelect: 'none' }}
            title="Export CSV của bảng hiện tại (đã áp filter/sort)"
          >
            Export CSV
          </button>
          <button
            onClick={saveSnapshot}
            className={styles.badge + ' ' + styles.badgeNeutral}
            style={{ cursor: 'pointer', userSelect: 'none' }}
            title="Lưu snapshot (tối đa 20) vào localStorage để bạn xem lại sau"
          >
            Save snapshot{snapshotCount ? ` (${snapshotCount})` : ''}
          </button>
          {lastSnapshotAt && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 700 }}>
              Last saved: {new Date(lastSnapshotAt).toLocaleString()}
            </span>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 800 }}>Search</span>
            <input
              value={customSymbol}
              onChange={(e) => setCustomSymbol(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') openCustomSymbol();
              }}
              placeholder="VD: CL=F, AAPL, BTC-USD..."
              style={{
                padding: '0.45rem 0.7rem',
                borderRadius: 10,
                border: '1px solid var(--panel-border)',
                background: 'rgba(0,0,0,0.25)',
                color: 'var(--text-main)',
                fontWeight: 800,
                minWidth: 220,
              }}
            />
            <button
              onClick={openCustomSymbol}
              className={styles.badge + ' ' + styles.badgeNeutral}
              style={{ cursor: 'pointer', userSelect: 'none', opacity: customLoading ? 0.7 : 1 }}
              title="Fetch riêng 1 symbol (không thuộc bảng) và mở modal"
              disabled={customLoading}
            >
              {customLoading ? 'Loading…' : 'Open modal'}
            </button>
            {customError && <span style={{ color: '#ef4444', fontWeight: 800, fontSize: '0.85rem' }}>{customError}</span>}
          </div>

          <label className={styles.checkboxLabel} style={{ fontSize: '0.9rem' }}>
            <input type="checkbox" checked={onlySeasonalStrong} onChange={(e) => setOnlySeasonalStrong(e.target.checked)} />
            Seasonal mạnh (Win ≥ 55%)
          </label>
          <label className={styles.checkboxLabel} style={{ fontSize: '0.9rem' }}>
            <input type="checkbox" checked={onlyCrowded} onChange={(e) => setOnlyCrowded(e.target.checked)} />
            Chỉ crowded (|COT Z| ≥ 1.5)
          </label>
          <label className={styles.checkboxLabel} style={{ fontSize: '0.9rem' }}>
            <input type="checkbox" checked={hideHighVol} onChange={(e) => setHideHighVol(e.target.checked)} />
            Ẩn vol rất cao (≥ 60%)
          </label>
          <label className={styles.checkboxLabel} style={{ fontSize: '0.9rem' }}>
            <input type="checkbox" checked={watchOnly} onChange={(e) => setWatchOnly(e.target.checked)} />
            Watchlist only{watch.size ? ` (${watch.size})` : ''}
          </label>
        </div>

        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 900, color: 'var(--text-main)' }}>
            Snapshots ({snapshots.length})
          </summary>
          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) 2fr', gap: 14 }}>
            <div style={{ border: '1px solid var(--panel-border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '0.75rem 0.9rem', borderBottom: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 900, color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase' }}>Saved</div>
                <button
                  onClick={clearSnapshots}
                  className={styles.badge + ' ' + styles.badgeNeutral}
                  style={{ cursor: 'pointer' }}
                  title="Xoá toàn bộ snapshots"
                >
                  Clear all
                </button>
              </div>
              <div style={{ maxHeight: 260, overflow: 'auto' }}>
                {snapshots.length === 0 && (
                  <div style={{ padding: '0.9rem', color: 'var(--text-muted)' }}>Chưa có snapshot. Bấm “Save snapshot”.</div>
                )}
                {snapshots
                  .slice()
                  .sort((a, b) => b.savedAt - a.savedAt)
                  .map((s) => (
                    <button
                      key={s.savedAt}
                      onClick={() => setActiveSnapshot(s)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '0.75rem 0.9rem',
                        background: activeSnapshot?.savedAt === s.savedAt ? 'rgba(167,139,250,0.10)' : 'transparent',
                        border: 'none',
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                        cursor: 'pointer',
                        color: 'var(--text-main)',
                      }}
                      title="Click để xem chi tiết snapshot"
                    >
                      <div style={{ fontWeight: 900 }}>{new Date(s.savedAt).toLocaleString()}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 2 }}>
                        rows: {s.rows.length} · sort: {s.sortKey} · filters: {Object.entries(s.filters).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}
                      </div>
                    </button>
                  ))}
              </div>
            </div>

            <div style={{ border: '1px solid var(--panel-border)', borderRadius: 12, padding: '0.9rem' }}>
              {!activeSnapshot ? (
                <div style={{ color: 'var(--text-muted)' }}>Chọn 1 snapshot để xem (hoặc restore filters).</div>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 1000, fontSize: '1.05rem' }}>{new Date(activeSnapshot.savedAt).toLocaleString()}</div>
                      <div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                        ENSO: {activeSnapshot.enso ? `${activeSnapshot.enso.state} (ONI ${activeSnapshot.enso.oni.toFixed(2)})` : 'N/A'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => applySnapshot(activeSnapshot)}
                        className={styles.badge + ' ' + styles.badgeNeutral}
                        style={{ cursor: 'pointer' }}
                        title="Apply sort + filters của snapshot vào bảng hiện tại"
                      >
                        Restore filters
                      </button>
                      <button
                        onClick={() => deleteSnapshot(activeSnapshot.savedAt)}
                        className={styles.badge + ' ' + styles.badgeNeutral}
                        style={{ cursor: 'pointer' }}
                        title="Xoá snapshot này"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <div style={{ marginTop: 12, overflow: 'auto', maxHeight: 260, borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                          {['Commodity', 'Symbol', '1M', 'Seasonal', 'Conf', 'Rec', 'COT', 'Stocks/Use'].map((h) => (
                            <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {activeSnapshot.rows.map((r) => (
                          <tr key={r.symbol} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                            <td style={{ padding: '0.55rem 0.75rem', fontWeight: 900 }}>{r.commodity}</td>
                            <td style={{ padding: '0.55rem 0.75rem', color: 'var(--text-muted)', fontFamily: 'Courier New, monospace' }}>{r.symbol}</td>
                            <td style={{ padding: '0.55rem 0.75rem', fontWeight: 800, color: colorPct(r.pct1m) }}>{r.pct1m >= 0 ? '+' : ''}{r.pct1m.toFixed(2)}%</td>
                            <td style={{ padding: '0.55rem 0.75rem', fontWeight: 800, color: r.seasonalMed20d === null ? 'var(--text-muted)' : r.seasonalMed20d >= 0 ? '#10b981' : '#ef4444' }}>
                              {r.seasonalMed20d === null ? '-' : `${r.seasonalMed20d >= 0 ? '+' : ''}${r.seasonalMed20d.toFixed(2)}%`}{r.seasonalWin20d === null ? '' : ` (${r.seasonalWin20d.toFixed(0)}%)`}
                            </td>
                            <td style={{ padding: '0.55rem 0.75rem' }}>
                              <span className={styles.badge + ' ' + (r.confidence >= 70 ? styles.badgeBuy : r.confidence >= 55 ? styles.badgeWarn : styles.badgeNeutral)} style={{ width: 'fit-content' }}>
                                {r.confidence}
                              </span>
                            </td>
                            <td style={{ padding: '0.55rem 0.75rem' }}>
                              <span className={styles.badge + ' ' + (r.rec === 'BUY' ? styles.badgeBuy : r.rec === 'SELL' ? styles.badgeSell : styles.badgeNeutral)} style={{ width: 'fit-content' }}>
                                {r.rec}
                              </span>
                            </td>
                            <td style={{ padding: '0.55rem 0.75rem', color: 'var(--text-main)', fontWeight: 800 }}>{r.cotZ === null ? '-' : `${r.cotZ >= 0 ? '+' : ''}${r.cotZ.toFixed(2)}`}</td>
                            <td style={{ padding: '0.55rem 0.75rem', color: 'var(--text-main)', fontWeight: 800 }}>{r.stocksToUse === null ? '-' : `${r.stocksToUse.toFixed(1)}%`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </details>

        <div
          style={{
            overflow: 'auto',
            marginTop: '1rem',
            maxHeight: '70vh',
            borderRadius: 12,
            border: '1px solid var(--panel-border)',
          }}
        >
          <table style={{ width: '100%', minWidth: 1310, borderCollapse: 'separate', borderSpacing: 0, fontSize: '0.95rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--panel-border)' }}>
                {[
                  { h: '★', t: 'Watchlist: bấm để ghim/bỏ ghim' },
                  { h: 'Commodity', t: 'Hàng hoá' },
                  { h: 'Symbol', t: 'Yahoo futures ticker' },
                  { h: 'Last', t: 'Giá đóng cửa gần nhất' },
                  { h: '1W', t: '% thay đổi ~1 tuần' },
                  { h: '1M', t: '% thay đổi ~1 tháng' },
                  { h: '3M', t: '% thay đổi ~3 tháng' },
                  { h: 'Vol(20d)', t: 'Biến động annualized 20 phiên (dùng scale size)' },
                  { h: 'Seasonal(1M)', t: 'Median forward 20d trong tháng hiện tại + win-rate' },
                  { h: 'Confidence', t: '0–100: độ “chắc” của bối cảnh (seasonal + trend + vol + COT)' },
                  { h: 'Tóm tắt', t: 'Gợi ý ưu tiên BUY/SELL/WAIT từ các chỉ số (không phải khuyến nghị đầu tư)' },
                  { h: 'COT Z', t: 'Z-score vị thế Non-commercial (mirror) ~52w' },
                  { h: 'Stocks/Use', t: 'Tồn kho/tiêu thụ (%), corn/soy/wheat' },
                ].map(({ h, t }) => (
                  <th
                    key={h}
                    title={t}
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 2,
                      background: 'rgba(15, 17, 21, 0.95)',
                      padding: '0.6rem 1rem',
                      textAlign: 'left',
                      color: 'var(--text-muted)',
                      fontWeight: 700,
                      fontSize: '0.78rem',
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr
                  key={r.instrument.key}
                  onClick={() => setSelected(r)}
                  style={{
                    cursor: 'pointer',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    background: i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent')
                  }
                >
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleWatch(r.instrument.key);
                      }}
                      aria-label="Toggle watchlist"
                      title={watch.has(r.instrument.key) ? 'Bỏ ghim' : 'Ghim vào watchlist'}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 34,
                        height: 34,
                        borderRadius: 10,
                        border: '1px solid var(--panel-border)',
                        background: 'rgba(0,0,0,0.15)',
                        color: watch.has(r.instrument.key) ? '#fbbf24' : 'var(--text-muted)',
                        cursor: 'pointer',
                      }}
                    >
                      <Star size={16} fill={watch.has(r.instrument.key) ? '#fbbf24' : 'transparent'} />
                    </button>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 800, color: '#e2e8f0' }}>{r.instrument.name}</td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)', fontFamily: 'Courier New, monospace' }}>
                    {r.instrument.yahooSymbol}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>{r.last.toFixed(4)}</td>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 800, color: colorPct(r.pct1w) }}>
                    {r.pct1w >= 0 ? '+' : ''}
                    {r.pct1w.toFixed(2)}%
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 800, color: colorPct(r.pct1m) }}>
                    {r.pct1m >= 0 ? '+' : ''}
                    {r.pct1m.toFixed(2)}%
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 800, color: colorPct(r.pct3m) }}>
                    {r.pct3m >= 0 ? '+' : ''}
                    {r.pct3m.toFixed(2)}%
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 800, color: 'var(--text-main)' }}>
                    {r.vol20 === null ? '-' : `${r.vol20.toFixed(1)}%`}
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontWeight: 800, color: r.seasonalMed20d === null ? 'var(--text-muted)' : r.seasonalMed20d >= 0 ? '#10b981' : '#ef4444' }}>
                        {r.seasonalMed20d === null ? '-' : `${r.seasonalMed20d >= 0 ? '+' : ''}${r.seasonalMed20d.toFixed(2)}%`}
                        {r.seasonalWin20d === null ? '' : ` (${r.seasonalWin20d.toFixed(0)}%)`}
                      </div>
                      <span className={styles.badge + ' ' + seasonalBadge(r.seasonalMed20d, r.seasonalWin20d).cls} style={{ width: 'fit-content' }}>
                        {seasonalBadge(r.seasonalMed20d, r.seasonalWin20d).label}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span
                      className={
                        styles.badge +
                        ' ' +
                        (r.confidence >= 70 ? styles.badgeBuy : r.confidence >= 55 ? styles.badgeWarn : styles.badgeNeutral)
                      }
                      style={{ width: 'fit-content' }}
                      title="Confidence dùng để ưu tiên focus nghiên cứu: cao = bối cảnh rõ hơn."
                    >
                      {r.confidence}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', overflow: 'hidden' }} title={r.recReason}>
                    <span
                      className={
                        styles.badge +
                        ' ' +
                        (r.recAction === 'BUY' ? styles.badgeBuy : r.recAction === 'SELL' ? styles.badgeSell : styles.badgeNeutral)
                      }
                      style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}
                    >
                      {r.recLabel}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 800, color: 'var(--text-main)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div>
                        {r.cotZ === null ? '-' : `${r.cotZ >= 0 ? '+' : ''}${r.cotZ.toFixed(2)}`}
                      </div>
                      <span className={styles.badge + ' ' + cotBadge(r.cotZ).cls} style={{ width: 'fit-content' }}>
                        {cotBadge(r.cotZ).label}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 800, color: 'var(--text-main)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div>
                        {r.stocksToUse === null ? '-' : `${r.stocksToUse.toFixed(1)}%`}
                      </div>
                      <span className={styles.badge + ' ' + stocksUseBadge(r.stocksToUse).cls} style={{ width: 'fit-content' }}>
                        {stocksUseBadge(r.stocksToUse).label}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && sorted.length === 0 && (
                <tr>
                  <td colSpan={13} style={{ padding: '1.25rem 1rem', color: 'var(--text-muted)' }}>
                    Không có kết quả (do filter). Tắt filter hoặc reload.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {selected && (
          <AgriModal
            instrument={selected.instrument}
            close={selected.close}
            timestamp={selected.timestamp}
            cotZ={selected.cotZ}
            stocksToUse={selected.stocksToUse}
            vol20={selected.vol20}
            seasonalMed20d={selected.seasonalMed20d}
            seasonalWin20d={selected.seasonalWin20d}
            recLabel={selected.recLabel}
            recReason={selected.recReason}
            confidence={selected.confidence}
            onClose={() => setSelected(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
