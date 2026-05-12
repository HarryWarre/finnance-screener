import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Activity, RefreshCw } from 'lucide-react';

import { fetchChartData } from '../lib/api';
import styles from '../App.module.css';

// Yahoo Finance tickers for Forex pairs
const FOREX_TICKERS: Record<string, string> = {
  'EUR/USD': 'EURUSD=X',
  'GBP/USD': 'GBPUSD=X',
  'AUD/USD': 'AUDUSD=X',
  'NZD/USD': 'NZDUSD=X',
  'USD/CHF': 'USDCHF=X',
  'USD/JPY': 'USDJPY=X',
  'USD/CAD': 'USDCAD=X',
  'AUD/NZD': 'AUDNZD=X',
  'EUR/GBP': 'EURGBP=X',
  'EUR/JPY': 'EURJPY=X',
  'GBP/JPY': 'GBPJPY=X',
  'USD/SGD': 'USDSGD=X',
};

interface ForexStat {
  pair: string;
  ticker: string;
  currentPrice: number;
  mean: number;
  stdDev: number;
  zScore: number;
  pctFromMean: number;
  high52w: number;
  low52w: number;
  signal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
}

function calcStats(prices: number[], lookback: number): { mean: number; std: number; zScore: number } {
  const window = prices.slice(-lookback);
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  const variance = window.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / window.length;
  const std = Math.sqrt(variance);
  const current = prices[prices.length - 1];
  const zScore = std > 0 ? (current - mean) / std : 0;
  return { mean, std, zScore };
}

function getSignal(z: number): ForexStat['signal'] {
  if (z <= -2.0) return 'STRONG_BUY';
  if (z <= -1.0) return 'BUY';
  if (z >= 2.0) return 'STRONG_SELL';
  if (z >= 1.0) return 'SELL';
  return 'NEUTRAL';
}

const SIGNAL_META: Record<ForexStat['signal'], { label: string; color: string; bg: string }> = {
  STRONG_BUY:  { label: '🔥 STRONG BUY',  color: '#10b981', bg: 'rgba(16,185,129,0.2)' },
  BUY:         { label: '🟢 BUY',          color: '#34d399', bg: 'rgba(16,185,129,0.1)' },
  NEUTRAL:     { label: '⚪ NEUTRAL',       color: '#8b949e', bg: 'rgba(139,148,158,0.1)' },
  SELL:        { label: '🔴 SELL',          color: '#f87171', bg: 'rgba(239,68,68,0.1)' },
  STRONG_SELL: { label: '🔥 STRONG SELL',  color: '#ef4444', bg: 'rgba(239,68,68,0.2)' },
};

interface ForexStatsPanelProps {
  lookback: number;
}

export default function ForexStatsPanel({ lookback }: ForexStatsPanelProps) {
  const [stats, setStats] = useState<ForexStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [sortKey, setSortKey] = useState<'pair' | 'zScore' | 'pctFromMean'>('zScore');

  const loadData = async () => {
    setLoading(true);
    const results: ForexStat[] = [];

    for (const [pair, ticker] of Object.entries(FOREX_TICKERS)) {
      try {
        const chart = await fetchChartData(ticker);
        if (!chart || chart.close.length < lookback) continue;

        const prices = chart.close;
        const { mean, std, zScore } = calcStats(prices, lookback);
        const current = prices[prices.length - 1];
        const pctFromMean = ((current - mean) / mean) * 100;
        const high52w = Math.max(...prices.slice(-252));
        const low52w = Math.min(...prices.slice(-252));

        results.push({
          pair, ticker,
          currentPrice: current,
          mean,
          stdDev: std,
          zScore,
          pctFromMean,
          high52w,
          low52w,
          signal: getSignal(zScore),
        });
      } catch (e) {
        console.warn(`Failed to fetch ${ticker}:`, e);
      }
    }

    setStats(results);
    setLastUpdated(new Date().toLocaleTimeString('vi-VN'));
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [lookback]);

  const sorted = [...stats].sort((a, b) => {
    if (sortKey === 'pair') return a.pair.localeCompare(b.pair);
    if (sortKey === 'zScore') return a.zScore - b.zScore; // most oversold first
    return a.pctFromMean - b.pctFromMean;
  });

  const zBar = (z: number) => {
    const clamped = Math.max(-3, Math.min(3, z));
    const pct = ((clamped + 3) / 6) * 100;
    const color = z < -1 ? '#10b981' : z > 1 ? '#ef4444' : '#8b949e';
    return (
      <div style={{ position: 'relative', height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, width: '100%' }}>
        <div style={{
          position: 'absolute', top: 0, left: `${pct}%`,
          width: 3, height: 6, background: color, borderRadius: 2,
          transform: 'translateX(-50%)'
        }} />
        {/* Center line */}
        <div style={{ position: 'absolute', top: 0, left: '50%', width: 1, height: 6, background: 'rgba(255,255,255,0.2)' }} />
      </div>
    );
  };

  return (
    <motion.div
      className={styles.glassPanel}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Forex Z-Score Monitor</h2>
          <p style={{ margin: '0.3rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Z = (Giá hiện tại − Trung bình {lookback} ngày) / Độ lệch chuẩn · Âm = Oversold (BUY) · Dương = Overbought (SELL)
            {lastUpdated && <> · Cập nhật: {lastUpdated}</>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.8rem' }}>
            {(['pair', 'zScore', 'pctFromMean'] as const).map(k => (
              <button key={k} onClick={() => setSortKey(k)}
                style={{
                  padding: '0.3rem 0.75rem', borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: sortKey === k ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                  color: sortKey === k ? '#fff' : 'var(--text-muted)', fontWeight: 600
                }}>
                {k === 'pair' ? 'A→Z' : k === 'zScore' ? 'Z-Score' : '% từ MA'}
              </button>
            ))}
          </div>
          <button onClick={loadData} disabled={loading}
            style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', color: 'var(--accent)', borderRadius: 8, padding: '0.4rem 0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', fontWeight: 600 }}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem' }}>
          <Activity className="animate-spin" style={{ margin: '0 auto 1rem', width: 32, height: 32, color: 'var(--accent)' }} />
          <p style={{ color: 'var(--text-muted)' }}>Đang tải dữ liệu Forex từ Yahoo Finance...</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--panel-border)' }}>
                {['Cặp tiền', 'Giá hiện tại', `MA${lookback}`, 'Z-Score', '% từ MA', 'Biên độ (52W)', 'Nhận định'].map(h => (
                  <th key={h} style={{ padding: '0.6rem 1rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.78rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((s, i) => {
                const meta = SIGNAL_META[s.signal];
                const decimals = s.currentPrice < 10 ? 5 : s.currentPrice < 100 ? 4 : 2;
                return (
                  <tr key={s.pair} style={{
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    background: i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent',
                    transition: 'background 0.15s',
                  }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                    onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent')}
                  >
                    <td style={{ padding: '0.75rem 1rem', fontWeight: 700, fontFamily: 'Courier New, monospace', color: '#e2e8f0' }}>
                      {s.pair}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#f0f0f0' }}>
                      {s.currentPrice.toFixed(decimals)}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)' }}>
                      {s.mean.toFixed(decimals)}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontWeight: 700, color: s.zScore < -1 ? '#10b981' : s.zScore > 1 ? '#ef4444' : '#8b949e', fontSize: '1rem' }}>
                          {s.zScore > 0 ? '+' : ''}{s.zScore.toFixed(2)}
                        </span>
                        <div style={{ width: 80 }}>{zBar(s.zScore)}</div>
                      </div>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: s.pctFromMean > 0 ? '#f87171' : '#34d399', fontWeight: 600 }}>
                      {s.pctFromMean > 0 ? '+' : ''}{s.pctFromMean.toFixed(2)}%
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        <span style={{ color: '#f87171' }}>H: {s.high52w.toFixed(decimals)}</span>
                        {' · '}
                        <span style={{ color: '#34d399' }}>L: {s.low52w.toFixed(decimals)}</span>
                      </div>
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span style={{
                        padding: '0.3rem 0.8rem', borderRadius: 20, fontSize: '0.8rem',
                        fontWeight: 700, background: meta.bg, color: meta.color,
                        border: `1px solid ${meta.color}40`, whiteSpace: 'nowrap'
                      }}>
                        {meta.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {stats.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              Chưa có dữ liệu. Nhấn Refresh để tải.
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
