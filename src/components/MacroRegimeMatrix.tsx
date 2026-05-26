import { useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, Search } from 'lucide-react';
import clsx from 'clsx';

import styles from '../App.module.css';
import { fetchChartData, fetchMacroCalendarRange, type InvestingCalendarEvent } from '../lib/api';
import { assetsInUniverse, computeConflict, computeMacroRegimeCells } from '../lib/macroRegime/engine';
import type { MacroAssetClass, MacroCellComputed, MacroTimeframe } from '../lib/macroRegime/types';
import { loadMacroThresholdArtifact } from '../lib/macroRegime/thresholds';

type SortTf = MacroTimeframe;

const TF_LIST: MacroTimeframe[] = ['7D', '30D', '180D'];

function isoDateUtc(ms: number) {
  const d = new Date(ms);
  return d.toISOString().slice(0, 10);
}

function addDaysUtc(ms: number, days: number) {
  return ms + days * 24 * 3600 * 1000;
}

function biasTone(bias: string) {
  if (bias === 'BUY') return styles.badgeBuy;
  if (bias === 'SELL') return styles.badgeSell;
  return styles.badgeNeutral;
}

function qualityTone(q: string) {
  if (q === 'good') return styles.badgeBuy;
  if (q === 'partial') return styles.badgeWarn;
  return styles.badgeDanger;
}

function viBias(bias: string) {
  if (bias === 'BUY') return 'MUA';
  if (bias === 'SELL') return 'BÁN';
  return 'TRUNG LẬP';
}

function viQuality(q: string) {
  if (q === 'good') return 'tốt';
  if (q === 'partial') return 'thiếu';
  return 'cũ';
}

function viFamily(f: string) {
  switch (f) {
    case 'Policy':
      return 'Chính sách';
    case 'Inflation':
      return 'Lạm phát';
    case 'Labor':
      return 'Lao động';
    case 'Growth':
      return 'Tăng trưởng';
    case 'Survey':
      return 'Khảo sát';
    case 'Demand':
      return 'Cầu';
    default:
      return f;
  }
}

function marketClassLabel(c: MacroAssetClass) {
  if (c === 'FX') return 'Forex';
  if (c === 'Commodity') return 'Commodities';
  return 'Indices';
}

function formatPct(v: number | null) {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = v > 0 ? '+' : '';
  return `${s}${v.toFixed(2)}%`;
}

function computeMomentumPct(series: { close: number[] } | null, pointsBack = 30) {
  const closes = series?.close ?? [];
  if (closes.length < pointsBack + 2) return null;
  const start = closes.at(-(pointsBack + 1));
  const end = closes.at(-1);
  if (!start || !end || start === 0) return null;
  return ((end / start) - 1) * 100;
}

function cellKey(assetId: string, tf: MacroTimeframe) {
  return `${assetId}::${tf}`;
}

export default function MacroRegimeMatrix({ isActive }: { isActive: boolean }) {
  const assets = useMemo(() => assetsInUniverse(), []);

  const [assetClass, setAssetClass] = useState<MacroAssetClass | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [biasFilterTf, setBiasFilterTf] = useState<SortTf>('30D');
  const [biasFilter, setBiasFilter] = useState<'ALL' | 'BUY' | 'SELL' | 'NEUTRAL'>('ALL');
  const [sortTf, setSortTf] = useState<SortTf>('30D');
  const [conflictOnly, setConflictOnly] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');

  const [cells, setCells] = useState<MacroCellComputed[]>([]);
  const [selected, setSelected] = useState<MacroCellComputed | null>(null);

  const [momentumPct, setMomentumPct] = useState<Record<string, number | null>>({});

  const loadMatrix = async () => {
    setLoading(true);
    setError('');

    try {
      const now = Date.now();
      const fromMs = addDaysUtc(now, -190); // include a small buffer beyond 180D
      const toMs = now;

      // No-key mode: accumulate a rolling history in localStorage so 30D/180D becomes meaningful over time.
      const historyKey = 'macro_regime_event_history_v1';
      const cachedRaw = typeof localStorage !== 'undefined' ? localStorage.getItem(historyKey) : null;
      let history: InvestingCalendarEvent[] = [];
      if (cachedRaw) {
        try {
          const parsed = JSON.parse(cachedRaw) as { events?: InvestingCalendarEvent[] };
          if (Array.isArray(parsed.events)) history = parsed.events;
        } catch {
          // ignore cache parse errors
        }
      }

      const dateFrom = isoDateUtc(fromMs);
      const dateTo = isoDateUtc(toMs);
      const resp = await fetchMacroCalendarRange({ dateFrom, dateTo });
      const acc: InvestingCalendarEvent[] = resp.events;

      // Merge + dedup by (currency + datetime + title). Keep newest fields when re-seen.
      const dedup = new Map<string, InvestingCalendarEvent>();
      for (const e of history) {
        const k = `${e.currency}::${e.datetime}::${e.title}`;
        dedup.set(k, e);
      }
      for (const e of acc) {
        const k = `${e.currency}::${e.datetime}::${e.title}`;
        const prev = dedup.get(k);
        dedup.set(k, prev ? { ...prev, ...e } : e);
      }

      const minTs = fromMs;
      history = Array.from(dedup.values())
        .filter((e) => {
          const t = Date.parse(e.datetime);
          return Number.isFinite(t) && t >= minTs;
        })
        .sort((a, b) => a.datetime.localeCompare(b.datetime));

      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(historyKey, JSON.stringify({ events: history }));
      }

      const events = history;

      // Market confirmation layer: best-effort 30D momentum (cached)
      const momoCacheKey = 'macro_regime_momentum_cache_v1';
      const momoCachedRaw = typeof localStorage !== 'undefined' ? localStorage.getItem(momoCacheKey) : null;
      let momo: Record<string, number | null> = {};
      let momoFresh = false;
      if (momoCachedRaw) {
        try {
          const parsed = JSON.parse(momoCachedRaw) as { cachedAt?: number; data?: Record<string, number | null> };
          const ageMs = typeof parsed.cachedAt === 'number' ? now - parsed.cachedAt : Infinity;
          if (ageMs < 6 * 60 * 60 * 1000 && parsed.data && typeof parsed.data === 'object') {
            momo = parsed.data;
            momoFresh = true;
          }
        } catch {
          // ignore
        }
      }

      if (!momoFresh) {
        momo = {};
        // Fetch sequentially to reduce Yahoo throttling. This is secondary.
        for (const a of assets) {
          if (!a.yahooTicker) continue;
          try {
            const series = await fetchChartData(a.yahooTicker, '1d', '3mo');
            momo[a.assetId] = computeMomentumPct(series, 30);
          } catch {
            momo[a.assetId] = null;
          }
        }
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(momoCacheKey, JSON.stringify({ cachedAt: now, data: momo }));
        }
      }
      setMomentumPct(momo);

      const thresholds = await loadMacroThresholdArtifact();
      const computed = computeMacroRegimeCells({
        nowMs: now,
        events,
        thresholds,
        marketMomentumPctByAssetId: Object.fromEntries(Object.entries(momo).map(([k, v]) => [k, v ?? 0])),
      });
      setCells(computed);
      setLastUpdated(new Date().toLocaleString('vi-VN'));
    } catch (e: unknown) {
      let msg = e instanceof Error ? e.message : 'Không load được Macro Regime Matrix.';
      if (msg.includes('Missing local macro calendar dataset')) {
        msg =
          'Thiếu dataset local cho Macro Regime Matrix. Thêm file `public/data/macro_calendar.v1.json` (format { events: InvestingCalendarEvent[] }) hoặc đổi lại sang provider API.';
      }
      setError(msg);
      setCells([]);
      setMomentumPct({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isActive) return;
    void loadMatrix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  const byKey = useMemo(() => {
    const m = new Map<string, MacroCellComputed>();
    for (const c of cells) m.set(cellKey(c.assetId, c.timeframe), c);
    return m;
  }, [cells]);

  const filteredAssets = useMemo(() => {
    const query = q.trim().toLowerCase();
    const base = assets.filter((a) => (assetClass === 'ALL' ? true : a.assetClass === assetClass));
    let rows = base;
    if (query) {
      rows = rows.filter((a) => a.assetId.toLowerCase().includes(query) || a.displayName.toLowerCase().includes(query));
    }
    if (biasFilter !== 'ALL') {
      rows = rows.filter((a) => byKey.get(cellKey(a.assetId, biasFilterTf))?.bias === biasFilter);
    }
    if (conflictOnly) {
      rows = rows.filter((a) => computeConflict(cells, a.assetId));
    }

    rows = rows.slice().sort((a, b) => {
      const ca = byKey.get(cellKey(a.assetId, sortTf));
      const cb = byKey.get(cellKey(b.assetId, sortTf));
      const da = ca?.confidence ?? -1;
      const db = cb?.confidence ?? -1;
      return db - da;
    });

    return rows;
  }, [assets, assetClass, q, biasFilter, biasFilterTf, conflictOnly, sortTf, byKey, cells]);

  if (!isActive) return null;

  return (
    <div className={styles.glassPanel} style={{ padding: '1.25rem' }}>
      <div className={styles.strategyHeader} style={{ marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Ma trận Regime Vĩ mô</h2>
          <p className={styles.strategyIntro} style={{ marginTop: 6 }}>
            Tổng hợp “surprise” từ lịch kinh tế theo 7D / 30D / 180D. Giá thị trường chỉ dùng để chỉnh độ tin cậy (không đảo bias).
          </p>
        </div>
        <div className={styles.strategyKeyRow}>
          <button className={styles.strategyButtonSecondary} onClick={loadMatrix} disabled={loading}>
            <RefreshCw style={{ width: 16, height: 16 }} /> Làm mới
          </button>
        </div>
      </div>

      <div className={styles.strategyToolbar} style={{ marginBottom: '1rem' }}>
        <div className={styles.strategyKeyRow}>
          <div className={styles.strategyInput} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Search style={{ width: 16, height: 16, opacity: 0.7 }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search asset (EUR/USD, XAUUSD, SPX...)"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'inherit' }}
            />
          </div>

          <select className={styles.strategyInput} value={assetClass} onChange={(e) => setAssetClass(e.target.value as MacroAssetClass | 'ALL')}>
            <option value="ALL">All asset classes</option>
            <option value="FX">{marketClassLabel('FX')}</option>
            <option value="Commodity">{marketClassLabel('Commodity')}</option>
            <option value="Index">{marketClassLabel('Index')}</option>
          </select>

          <select className={styles.strategyInput} value={biasFilterTf} onChange={(e) => setBiasFilterTf(e.target.value as SortTf)}>
            <option value="7D">Bias filter timeframe: 7D</option>
            <option value="30D">Bias filter timeframe: 30D</option>
            <option value="180D">Bias filter timeframe: 180D</option>
          </select>

          <select className={styles.strategyInput} value={biasFilter} onChange={(e) => setBiasFilter(e.target.value as typeof biasFilter)}>
            <option value="ALL">Bias: All</option>
            <option value="BUY">Bias: Buy</option>
            <option value="SELL">Bias: Sell</option>
            <option value="NEUTRAL">Bias: Neutral</option>
          </select>

          <select className={styles.strategyInput} value={sortTf} onChange={(e) => setSortTf(e.target.value as SortTf)}>
            <option value="7D">Sort by Confidence: 7D</option>
            <option value="30D">Sort by Confidence: 30D</option>
            <option value="180D">Sort by Confidence: 180D</option>
          </select>

          <label className={styles.strategyInput} style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={conflictOnly} onChange={(e) => setConflictOnly(e.target.checked)} />
            Conflict only
          </label>
        </div>

        <div className={styles.strategyToolbarMeta}>
          {lastUpdated ? `Cập nhật: ${lastUpdated}` : 'Chưa có dữ liệu.'}
          {Object.keys(momentumPct).length ? ` · Market momentum(30D) cached` : ''}
        </div>
      </div>

      {loading ? (
        <div className={styles.strategyLoading}>
          <Activity className="animate-spin" style={{ width: 24, height: 24, color: 'var(--accent)' }} />
          <span>Đang tải calendar và tính Macro Regime Matrix…</span>
        </div>
      ) : error ? (
        <div className={styles.strategyErrorBox}>
          <strong>Macro Regime Matrix đang gặp lỗi nguồn dữ liệu.</strong>
          <p>{error}</p>
        </div>
      ) : (
        <div className={styles.macroMatrixTable}>
          <div className={clsx(styles.macroMatrixRow, styles.macroMatrixHeader)}>
            <div className={styles.macroMatrixAsset}>Asset</div>
            {TF_LIST.map((tf) => (
              <div key={tf} className={styles.macroMatrixColHead}>
                {tf}
              </div>
            ))}
          </div>

          {filteredAssets.map((a) => {
            const isConflict = computeConflict(cells, a.assetId);
            return (
              <div key={a.assetId} className={clsx(styles.macroMatrixRow, isConflict && styles.macroMatrixRowConflict)}>
                <div className={styles.macroMatrixAsset}>
                  <div style={{ fontWeight: 800 }}>{a.assetId}</div>
                  <div className={styles.terminalMuted}>{a.displayName}</div>
                  <div className={styles.terminalMuted}>
                    Momo30D: {formatPct(momentumPct[a.assetId] ?? null)}
                    {isConflict ? ' · conflict' : ''}
                  </div>
                </div>

                {TF_LIST.map((tf) => {
                  const c = byKey.get(cellKey(a.assetId, tf));
                  if (!c) {
                    return (
                      <div key={tf} className={styles.macroMatrixCellEmpty}>
                        —
                      </div>
                    );
                  }
                  return (
                    <button
                      key={tf}
                      className={clsx(styles.macroMatrixCell, biasTone(c.bias))}
                      onClick={() => setSelected(c)}
                      title={`${c.headline} · score ${c.score.toFixed(2)}`}
                    >
                      <div className={styles.macroMatrixCellTop}>
                        <span className={clsx(styles.badge, biasTone(c.bias))}>{c.bias}</span>
                        <span className={clsx(styles.badge, qualityTone(c.dataQuality))}>{c.dataQuality}</span>
                        <span className={styles.macroMatrixConf}>{c.confidence}/100</span>
                      </div>
                      <div className={styles.macroMatrixRegime}>{c.regime}</div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {selected ? (
        <div className={styles.modalOverlay} onClick={() => setSelected(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <button className={styles.closeButton} onClick={() => setSelected(null)}>✕</button>

            <div className={styles.modalHeader}>
              <div>
                <h2 style={{ margin: 0 }}>{selected.assetId} · {selected.timeframe}</h2>
                <div className={styles.terminalMuted}>{selected.headline}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span className={clsx(styles.badge, biasTone(selected.bias))}>{viBias(selected.bias)}</span>
                <span className={clsx(styles.badge, qualityTone(selected.dataQuality))}>{viQuality(selected.dataQuality)}</span>
                <span className={clsx(styles.badge, styles.badgeNeutral)}>Điểm {selected.score.toFixed(2)}</span>
                <span className={clsx(styles.badge, styles.badgeNeutral)}>Tin cậy {selected.confidence}/100</span>
              </div>
            </div>

            <div className={styles.strategySection} style={{ marginTop: 0 }}>
              <div className={styles.strategySectionHeader}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>Yếu tố chính</h3>
                <span className={styles.strategySectionNote}>Các yếu tố ảnh hưởng (đã tóm tắt, không hiển thị dữ liệu thô).</span>
              </div>
              <div className={styles.strategyCards}>
                {selected.drivers.map((d) => (
                  <div key={d.label} className={styles.strategyCard}>
                    <div className={styles.strategyCardTop}>
                      <span className={clsx(styles.badge, d.direction === 'pos' ? styles.badgeBuy : d.direction === 'neg' ? styles.badgeDanger : styles.badgeNeutral)}>
                        {d.label === 'Market confirmation' ? 'Xác nhận thị trường' : viFamily(d.label)}
                      </span>
                      <span className={clsx(styles.badge, styles.badgeNeutral)}>{Math.round(d.weight * 100)}%</span>
                    </div>
                    <p className={styles.strategyCardBody}>{d.note}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.strategySection}>
              <div className={styles.strategySectionHeader}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>Sự kiện nổi bật</h3>
                <span className={styles.strategySectionNote}>Top 5 sự kiện đóng góp nhiều nhất (theo |tác động|).</span>
              </div>

              {selected.topEvents.length === 0 ? (
                <div className={styles.strategyEmpty}>Chưa đủ dữ liệu sự kiện trong khung thời gian này.</div>
              ) : (
                <div className={styles.strategyCards}>
                  {selected.topEvents.map((e) => (
                    <div key={e.eventId} className={styles.strategyCard}>
                      <div className={styles.strategyCardTop}>
                        <span className={clsx(styles.badge, styles.badgeNeutral)}>{e.currency}</span>
                        <span className={clsx(styles.badge, styles.badgeNeutral)}>{viFamily(e.family)}</span>
                        <span className={clsx(styles.badge, e.z >= 0 ? styles.badgeBuy : styles.badgeDanger)}>
                          z {e.z.toFixed(2)}
                        </span>
                      </div>
                      <strong className={styles.strategyCardTitle}>{e.title}</strong>
                      <p className={styles.strategyCardBody}>
                        Thực tế: <strong>{e.actual || '—'}</strong> · Dự báo: <strong>{e.forecast || '—'}</strong> · Mức độ: {e.importance || 0}
                      </p>
                      <div className={styles.strategyCardMeta}>{e.when ? new Date(e.when).toLocaleString('vi-VN') : 'N/A'}</div>
                      {e.note ? <div className={styles.terminalMuted} style={{ marginTop: 6 }}>{e.note}</div> : null}
                      {e.url ? (
                        <a className={styles.strategySourceLink} href={e.url} target="_blank" rel="noopener noreferrer">
                          Nguồn sự kiện
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
