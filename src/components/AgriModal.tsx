import { useEffect, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
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
