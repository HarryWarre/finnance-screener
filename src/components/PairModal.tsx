import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { motion } from 'framer-motion';
import { createChart, ColorType, LineSeries } from 'lightweight-charts';
import type { StatArbResult } from '../lib/math';
import styles from '../App.module.css';

export type PairResult = StatArbResult & {
  y: string;
  x: string;
};

interface PairModalProps {
  pair: PairResult;
  prices: Record<string, number[]>;
  labelMap?: Record<string, string>;
  onClose: () => void;
}

export default function PairModal({ pair, prices, labelMap, onClose }: PairModalProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [volY, setVolY] = useState<string>('1');
  const [volX, setVolX] = useState<string>('');
  const yLabel = labelMap?.[pair.y] ?? pair.y;
  const xLabel = labelMap?.[pair.x] ?? pair.x;

  const beta = pair.beta;
  const invBeta = useMemo(() => (beta !== 0 ? 1 / beta : null), [beta]);

  const formatVol = (value: number) => {
    if (!Number.isFinite(value)) return '';
    // Keep it readable for quick manual entry
    const s = value.toFixed(6);
    return s.replace(/\.?0+$/, '');
  };

  const parseVol = (raw: string) => {
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  };

  useEffect(() => {
    if (!chartContainerRef.current) return;
    
    // Build Spread Chart Data
    const py = prices[pair.y];
    const px = prices[pair.x];
    const minLen = Math.min(py.length, px.length);
    const truncY = py.slice(py.length - minLen);
    const truncX = px.slice(px.length - minLen);
    
    const chartData = [];
    const today = new Date();
    
    // Spread = Y - Beta * X
    for (let i = 0; i < minLen; i++) {
      const spreadVal = truncY[i] - pair.beta * truncX[i];
      // Generate mock dates backwards
      const d = new Date(today);
      d.setDate(d.getDate() - (minLen - i - 1));
      
      chartData.push({
        time: d.toISOString().split('T')[0],
        value: spreadVal
      });
    }

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
      height: 400,
    });

    const lineSeries = chart.addSeries(LineSeries, {
      color: '#3b82f6',
      lineWidth: 2,
    });
    
    lineSeries.setData(chartData);
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
  }, [pair, prices]);

  useEffect(() => {
    // Pair changed => reset helper to a sane default.
    setVolY('1');
    setVolX(beta === 0 ? '' : formatVol(beta));
  }, [beta]);

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <motion.div 
        className={styles.modalContent}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={e => e.stopPropagation()}
      >
        <button className={styles.closeButton} onClick={onClose}><X /></button>
        
        <div className={styles.modalHeader}>
          <h2>{yLabel} <span style={{color: '#8b949e', fontSize: '1.2rem', margin: '0 10px'}}>vs</span> {xLabel}</h2>
        </div>

        <div className={styles.modalStats}>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Z-Score</span>
            <span className={styles.statValue} style={{color: Math.abs(pair.zScore) > 2 ? '#ef4444' : '#fff'}}>
              {pair.zScore.toFixed(2)}
            </span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Beta (Hệ số Y/X)</span>
            <span className={styles.statValue}>{pair.beta.toFixed(3)}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Hurst Exponent</span>
            <span className={styles.statValue} style={{color: pair.hurst < 0.5 ? '#10b981' : '#f59e0b'}}>
              {pair.hurst.toFixed(2)}
            </span>
          </div>
        </div>

        <div className={styles.ratioPanel}>
          <div className={styles.ratioHeader}>Quy đổi / Hedge ratio</div>
          <div className={styles.ratioLines}>
            <div className={styles.ratioLine}>
              1 {yLabel} ≈ {beta.toFixed(3)} {xLabel}
            </div>
            {invBeta !== null && (
              <div className={styles.ratioLine}>
                1 {xLabel} ≈ {invBeta.toFixed(3)} {yLabel}
              </div>
            )}
          </div>

          <div className={styles.ratioInputs}>
            <div className={styles.ratioInputGroup}>
              <label className={styles.ratioLabel}>Vol {yLabel}</label>
              <input
                className={styles.ratioInput}
                inputMode="decimal"
                type="number"
                placeholder="0"
                value={volY}
                onChange={(e) => {
                  const raw = e.target.value;
                  setVolY(raw);
                  const y = parseVol(raw);
                  if (y === null || beta === 0) {
                    setVolX('');
                    return;
                  }
                  setVolX(formatVol(y * beta));
                }}
              />
            </div>
            <div className={styles.ratioInputGroup}>
              <label className={styles.ratioLabel}>Vol {xLabel}</label>
              <input
                className={styles.ratioInput}
                inputMode="decimal"
                type="number"
                placeholder="0"
                value={volX}
                onChange={(e) => {
                  const raw = e.target.value;
                  setVolX(raw);
                  const x = parseVol(raw);
                  if (x === null || beta === 0) {
                    setVolY('');
                    return;
                  }
                  setVolY(formatVol(x / beta));
                }}
              />
            </div>
          </div>

          <div className={styles.ratioHint}>
            Gợi ý vào lệnh: Short/Long theo spread ⇒ khối lượng hedge thường lấy <span style={{ fontWeight: 700 }}>X = Beta × Y</span>
          </div>
        </div>

        <div>
          <h3 style={{marginTop: 0, fontSize: '1rem', color: '#8b949e'}}>Spread = {yLabel} - {pair.beta.toFixed(3)} * {xLabel}</h3>
          <div ref={chartContainerRef} className={styles.chartContainer} />
        </div>
      </motion.div>
    </div>
  );
}
