import { useEffect, useMemo, useRef } from 'react';
import { Copy, ExternalLink, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { createChart, ColorType, LineSeries } from 'lightweight-charts';
import styles from '../App.module.css';

export interface AgriInstrument {
  key: string;
  name: string;
  yahooSymbol: string;
}

interface AgriModalProps {
  instrument: AgriInstrument;
  close: number[];
  timestamp: number[];
  cotZ?: number | null;
  stocksToUse?: number | null;
  vol20?: number | null;
  seasonalMed20d?: number | null;
  seasonalWin20d?: number | null;
  recLabel?: string;
  recReason?: string;
  confidence?: number;
  onClose: () => void;
}

function pct(a: number, b: number) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return ((a - b) / b) * 100;
}

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const baseVal = sorted[base]!;
  const nextVal = sorted[Math.min(sorted.length - 1, base + 1)]!;
  return baseVal + rest * (nextVal - baseVal);
}

export default function AgriModal({
  instrument,
  close,
  timestamp,
  cotZ = null,
  stocksToUse = null,
  vol20 = null,
  seasonalMed20d = null,
  seasonalWin20d = null,
  recLabel,
  recReason,
  confidence,
  onClose,
}: AgriModalProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const stats = useMemo(() => {
    const last = close.at(-1) ?? 0;
    const w = close.length > 5 ? close.at(-6) ?? last : last;
    const m = close.length > 21 ? close.at(-22) ?? last : last;
    const q = close.length > 63 ? close.at(-64) ?? last : last;
    return {
      last,
      pct1w: pct(last, w),
      pct1m: pct(last, m),
      pct3m: pct(last, q),
    };
  }, [close]);

  const seasonalityByMonth = useMemo(() => {
    const horizon = 20; // ~1 month trading days
    if (!timestamp.length || timestamp.length !== close.length || close.length < horizon + 120) return null;

    const bucket: number[][] = Array.from({ length: 12 }, () => []);
    for (let i = 0; i < close.length - horizon; i++) {
      const ts = timestamp[i];
      const a = close[i];
      const b = close[i + horizon];
      if (!Number.isFinite(ts) || !Number.isFinite(a) || !Number.isFinite(b) || a === 0) continue;
      const month = new Date(ts * 1000).getUTCMonth();
      bucket[month]!.push(((b - a) / a) * 100);
    }

    const series = bucket.map((arr) => {
      if (arr.length < 15) return { n: arr.length, med: null as number | null, win: null as number | null, p25: null as number | null, p75: null as number | null };
      const sorted = [...arr].sort((a, b) => a - b);
      const med = quantile(sorted, 0.5);
      const p25 = quantile(sorted, 0.25);
      const p75 = quantile(sorted, 0.75);
      const win = (arr.filter((v) => v > 0).length / arr.length) * 100;
      return { n: arr.length, med, win, p25, p75 };
    });

    const lastMonth = new Date((timestamp.at(-1) ?? 0) * 1000).getUTCMonth();
    const maxAbs = Math.max(
      1,
      ...series
        .map((s) => (s.med === null ? 0 : Math.abs(s.med)))
        .filter((v) => Number.isFinite(v)),
    );

    return { series, lastMonth, maxAbs };
  }, [close, timestamp]);

  useEffect(() => {
    if (!chartContainerRef.current) return;
    if (!close.length) return;

    const chartData = close.map((v, i) => {
      const ts = timestamp[i];
      const d = new Date((ts ?? 0) * 1000);
      return { time: d.toISOString().split('T')[0], value: v };
    });

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 420,
    });

    const line = chart.addSeries(LineSeries, { color: '#a78bfa', lineWidth: 2 });
    line.setData(chartData);
    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [close, timestamp, instrument.yahooSymbol]);

  const colorPct = (v: number) => (v >= 0 ? '#10b981' : '#ef4444');

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <motion.div
        className={styles.modalContent}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className={styles.closeButton} onClick={onClose}>
          <X />
        </button>

        <div className={styles.modalHeader}>
          <h2>
            {instrument.name}{' '}
            <span style={{ color: '#8b949e', fontSize: '1.1rem', marginLeft: 8 }}>
              {instrument.yahooSymbol}
            </span>
          </h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              className={styles.badge + ' ' + styles.badgeNeutral}
              style={{ cursor: 'pointer' }}
              title="Copy tóm tắt"
              onClick={async () => {
                const text = [
                  `${instrument.name} (${instrument.yahooSymbol})`,
                  recLabel && recReason ? `Summary: ${recLabel} — ${recReason}` : '',
                ]
                  .filter(Boolean)
                  .join('\n');
                try {
                  await navigator.clipboard.writeText(text);
                } catch {
                  // ignore
                }
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Copy size={14} /> Copy
              </span>
            </button>
            <button
              className={styles.badge + ' ' + styles.badgeNeutral}
              style={{ cursor: 'pointer' }}
              title="Mở TradingView (search)"
              onClick={() => {
                const q = encodeURIComponent(instrument.yahooSymbol);
                window.open(`https://www.tradingview.com/symbols/?search=${q}`, '_blank', 'noopener,noreferrer');
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ExternalLink size={14} /> TradingView
              </span>
            </button>
          </div>
        </div>

        <div className={styles.modalStats}>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Last</span>
            <span className={styles.statValue}>{stats.last.toFixed(4)}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>COT Z (MM)</span>
            <span className={styles.statValue} style={{ color: cotZ === null ? '#8b949e' : cotZ >= 0 ? '#10b981' : '#ef4444' }}>
              {cotZ === null ? '-' : `${cotZ >= 0 ? '+' : ''}${cotZ.toFixed(2)}`}
            </span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Stocks/Use</span>
            <span className={styles.statValue} style={{ color: stocksToUse === null ? '#8b949e' : stocksToUse < 12 ? '#ef4444' : stocksToUse < 18 ? '#f59e0b' : '#10b981' }}>
              {stocksToUse === null ? '-' : `${stocksToUse.toFixed(1)}%`}
            </span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Vol(20d)</span>
            <span className={styles.statValue} style={{ color: vol20 === null ? '#8b949e' : '#fff' }}>
              {vol20 === null ? '-' : `${vol20.toFixed(1)}%`}
            </span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Seasonal(1M)</span>
            <span className={styles.statValue} style={{ color: seasonalMed20d === null ? '#8b949e' : seasonalMed20d >= 0 ? '#10b981' : '#ef4444' }}>
              {seasonalMed20d === null ? '-' : `${seasonalMed20d >= 0 ? '+' : ''}${seasonalMed20d.toFixed(2)}%`}
              {seasonalWin20d === null ? '' : ` (${seasonalWin20d.toFixed(0)}%)`}
            </span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Confidence</span>
            <span className={styles.statValue} style={{ color: confidence === undefined ? '#8b949e' : confidence >= 70 ? '#10b981' : confidence >= 55 ? '#f59e0b' : '#8b949e' }}>
              {confidence === undefined ? '-' : confidence}
            </span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>1W</span>
            <span className={styles.statValue} style={{ color: colorPct(stats.pct1w) }}>
              {stats.pct1w >= 0 ? '+' : ''}
              {stats.pct1w.toFixed(2)}%
            </span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>1M</span>
            <span className={styles.statValue} style={{ color: colorPct(stats.pct1m) }}>
              {stats.pct1m >= 0 ? '+' : ''}
              {stats.pct1m.toFixed(2)}%
            </span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>3M</span>
            <span className={styles.statValue} style={{ color: colorPct(stats.pct3m) }}>
              {stats.pct3m >= 0 ? '+' : ''}
              {stats.pct3m.toFixed(2)}%
            </span>
          </div>
        </div>

        {seasonalityByMonth && (
          <div className={styles.seasonalityPanel}>
            <div className={styles.seasonalityHeader}>
              <div style={{ fontWeight: 900 }}>Seasonality (12 tháng)</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                Median forward ~20 phiên theo từng tháng (kèm win-rate & sample).
              </div>
            </div>

            <div className={styles.seasonalityBars}>
              {seasonalityByMonth.series.map((s, idx) => {
                const isCurrent = idx === seasonalityByMonth.lastMonth;
                const med = s.med;
                const heightPct = med === null ? 0 : Math.min(48, (Math.abs(med) / seasonalityByMonth.maxAbs) * 48);
                const color = med === null ? 'rgba(255,255,255,0.08)' : med >= 0 ? 'rgba(16,185,129,0.85)' : 'rgba(239,68,68,0.85)';
                const title =
                  med === null || s.win === null
                    ? `Tháng ${idx + 1}: sample ${s.n} (chưa đủ dữ liệu)`
                    : `Tháng ${idx + 1}: median ${med >= 0 ? '+' : ''}${med.toFixed(2)}% · win ${s.win.toFixed(0)}% · n=${s.n}\nIQR: ${s.p25?.toFixed(2)}% → ${s.p75?.toFixed(2)}%`;

                return (
                  <div key={idx} className={styles.seasonalityCol} title={title}>
                    <div className={styles.seasonalityBarWrap} data-current={isCurrent ? '1' : '0'}>
                      <div className={styles.seasonalityZero} />
                      <div
                        className={styles.seasonalityBar}
                        style={{
                          height: `${heightPct}%`,
                          background: color,
                          ...(med === null
                            ? { bottom: '50%' }
                            : med >= 0
                              ? { bottom: '50%' }
                              : { top: '50%' }),
                        }}
                      />
                    </div>
                    <div className={styles.seasonalityMonth}>{idx + 1}</div>
                    <div className={styles.seasonalityMeta}>
                      {med === null ? '—' : `${med >= 0 ? '+' : ''}${med.toFixed(1)}%`}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={styles.seasonalityLegend}>
              <span><b>Tip:</b> Tháng hiện tại có viền sáng; hover để xem win-rate & sample size.</span>
            </div>
          </div>
        )}

        <div>
          <h3 style={{ marginTop: 0, fontSize: '1rem', color: '#8b949e' }}>Daily close</h3>
          <div ref={chartContainerRef} className={styles.chartContainer} />
        </div>

        {recLabel && recReason && (
          <div style={{ marginTop: 14, padding: '0.9rem 1rem', borderRadius: 12, border: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.2)' }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Tóm tắt: {recLabel === 'WAIT' ? 'WAIT / Quan sát' : recLabel}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.55 }}>{recReason}</div>
          </div>
        )}

        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 800, color: 'var(--text-main)' }}>
            Giải thích (đọc nhanh)
          </summary>
          <div style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.6 }}>
            <div><b>Seasonal(1M)</b>: thống kê lịch sử nếu mua hôm nay và giữ ~20 phiên trong <b>tháng hiện tại</b>.</div>
            <div><b>Vol(20d)</b>: dùng để scale size; vol cao = dễ bị “quét” nếu stop quá chặt.</div>
            <div><b>COT Z</b>: đo vị thế đầu cơ đang “crowded” không; |Z| lớn ⇒ rủi ro đảo chiều tăng.</div>
            <div><b>Stocks/Use</b>: càng thấp càng “tight” (nhạy tin thời tiết/báo cáo) – chỉ áp dụng grains.</div>
          </div>
        </details>
      </motion.div>
    </div>
  );
}
