import { useMemo, useState, useEffect } from 'react';
import { Play, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { MARKETS, SECTORS, SYMBOLS, DEFAULT_PARAMS, INTERVALS } from './lib/config';
import type { MarketType, Interval } from './lib/config';
import { fetchChartData, fetchFundamentals, fetchSp500Symbols } from './lib/api';
import type { Fundamentals } from './lib/api';
import { calculateStatArb } from './lib/math';
import styles from './App.module.css';

import PairModal from './components/PairModal';
import type { PairResult } from './components/PairModal';
import MacroInsights from './components/MacroInsights';
import ForexCorrelation from './components/ForexCorrelation';
import ForexStatsPanel from './components/ForexStatsPanel';
import AgriDashboard from './components/AgriDashboard';
import SmartMoneyFlowWindow from './components/SmartMoneyFlowWindow';
import TerminalDashboard from './components/TerminalDashboard';

// --- Types ---
type Config = typeof DEFAULT_PARAMS & {
  market: MarketType;
  sector: string;
  interval: Interval;
};

// --- Main Component ---
export default function App() {
  const [config, setConfig] = useState<Config>({
    ...DEFAULT_PARAMS,
    market: "US Stocks",
    sector: "Information Technology"
  });

  const parsedCustomSymbols = useMemo(() => {
    if (!config.useCustomSymbols) return [];
    const raw = config.customSymbols || '';
    const parts = raw
      .split(/[\s,;]+/g)
      .map(s => s.trim())
      .filter(Boolean);
    const deduped = Array.from(new Set(parts.map(s => s.toUpperCase())));
    return deduped.slice(0, Math.max(1, Number(config.customSymbolsLimit) || 1));
  }, [config.useCustomSymbols, config.customSymbols, config.customSymbolsLimit]);

  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'statarb' | 'terminal' | 'flow' | 'macro' | 'correlation' | 'agri'>('statarb');
  const [statarbMode, setStatarbMode] = useState<'stocks' | 'forex'>('stocks');
  
  // StatArb State
  const [symbols, setSymbols] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, number[]>>({});
  const [matrix, setMatrix] = useState<Record<string, Record<string, PairResult>>>({});
  const [selectedPair, setSelectedPair] = useState<PairResult | null>(null);
  const [compareY, setCompareY] = useState('');
  const [compareX, setCompareX] = useState('');

  // Update symbols when market/sector changes
  useEffect(() => {
    if (config.useCustomSymbols) {
      setSymbols(parsedCustomSymbols);
      setMatrix({});
      return;
    }
    const list = SYMBOLS[config.sector] || [];
    setSymbols(list);
    // Clear matrix on change
    setMatrix({});
  }, [config.market, config.sector, config.useCustomSymbols, parsedCustomSymbols]);

  // Update available sectors when market changes
  useEffect(() => {
    const availableSectors = SECTORS[config.market];
    if (!availableSectors.includes(config.sector)) {
      setConfig(prev => ({ ...prev, sector: availableSectors[0] }));
    }
  }, [config.market]);

  const handleRun = async () => {
    setLoading(true);
    setMatrix({});
    const fetchedPrices: Record<string, number[]> = {};
    const fetchedFunds: Record<string, Fundamentals> = {};

    try {
      // Fetch data sequentially to avoid rate-limiting from Yahoo Finance
      for (const sym of symbols) {
        try {
          const [chart, fund] = await Promise.all([
            fetchChartData(sym, config.interval),
            config.useFundamental ? fetchFundamentals(sym) : Promise.resolve({ pe: 0, roe: 100 })
          ]);
          if (chart) fetchedPrices[sym] = chart.close;
          fetchedFunds[sym] = fund || { pe: 0, roe: 0 };
        } catch (e) {
          console.error(`Error fetching ${sym}:`, e);
        }
      }
      
      setPrices(fetchedPrices);

      // Compute Matrix
      const newMatrix: Record<string, Record<string, PairResult>> = {};
      
      for (let i = 0; i < symbols.length; i++) {
        const symY = symbols[i];
        newMatrix[symY] = {};
        
        for (let j = 0; j < symbols.length; j++) {
          const symX = symbols[j];
          if (i === j) continue;

          const py = fetchedPrices[symY];
          const px = fetchedPrices[symX];
          const fy = fetchedFunds[symY];
          const fx = fetchedFunds[symX];

          let fundPass = true;
          if (config.useFundamental) {
            const yPass = fy.pe > 0 && fy.pe <= config.maxPe && fy.roe >= config.minRoe;
            const xPass = fx.pe > 0 && fx.pe <= config.maxPe && fx.roe >= config.minRoe;
            fundPass = yPass && xPass;
          }

          const res = calculateStatArb(py, px, config.lookback, config.zScoreThreshold, fundPass);
          newMatrix[symY][symX] = { ...res, y: symY, x: symX };
        }
      }

      setMatrix(newMatrix);
    } catch (err) {
      console.error(err);
      alert("Error fetching data. Check console.");
    } finally {
      setLoading(false);
    }
  };

  const handleCompare = async () => {
    const y = compareY.trim().toUpperCase();
    const x = compareX.trim().toUpperCase();
    if (!y || !x) return;
    if (y === x) {
      alert('Vui lòng nhập 2 mã khác nhau.');
      return;
    }

    setLoading(true);
    try {
      const [cy, cx] = await Promise.all([
        fetchChartData(y, config.interval),
        fetchChartData(x, config.interval),
      ]);

      if (!cy || !cx) {
        alert('Không fetch được dữ liệu cho 1 trong 2 mã. Kiểm tra lại ticker.');
        return;
      }

      setPrices((prev) => ({ ...prev, [y]: cy.close, [x]: cx.close }));

      const res = calculateStatArb(cy.close, cx.close, config.lookback, config.zScoreThreshold, true);
      setSelectedPair({ ...res, y, x });
    } catch (e) {
      console.error(e);
      alert('Lỗi khi fetch/compute pair. Xem console.');
    } finally {
      setLoading(false);
    }
  };

  const getCellClass = (res: PairResult) => {
    if (res.signal === 99) return styles.cellExcluded;
    if (res.zScore === 0) return styles.cellEmpty;
    
    if (res.hurst <= config.hurstThreshold) {
      if (res.signal === -1) return styles.cellShortStrong;
      if (res.signal === -2) return styles.cellShort;
      if (res.signal === 1) return styles.cellLongStrong;
      if (res.signal === 2) return styles.cellLong;
    } else {
      if (res.signal !== 0) return styles.cellTrend;
    }
    return '';
  };

  const getCellText = (res: PairResult) => {
    if (res.signal === 99) return "⛔ Bỏ (Cơ bản)";
    if (res.zScore === 0) return "-";
    
    const base = res.zScore.toFixed(2);
    let label = "";
    if (res.hurst <= config.hurstThreshold) {
      if (res.signal === -1) label = "🔥 SHORT";
      if (res.signal === -2) label = "⏳ Căng";
      if (res.signal === 1) label = "🔥 LONG";
      if (res.signal === 2) label = "⏳ Căng";
    } else {
      if (res.signal !== 0) label = "❌ Trend";
    }
    
    return (
      <>
        <span className={styles.valZ}>{base}</span>
        {label && <span className={styles.valLabel}>{label}</span>}
      </>
    );
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>10x10 StatArb + Fundamental</h1>
        <p>Quantitative Pair Trading & Macro Sentiment Engine</p>
      </header>

      <div className={styles.tabsContainer}>
        <button 
          className={clsx(styles.tabButton, activeTab === 'statarb' && styles.tabButtonActive)}
          onClick={() => setActiveTab('statarb')}
        >
          📊 StatArb Matrix
        </button>
        <button
          className={clsx(styles.tabButton, activeTab === 'terminal' && styles.tabButtonActive)}
          onClick={() => setActiveTab('terminal')}
        >
          🖥️ Terminal
        </button>
        <button
          className={clsx(styles.tabButton, activeTab === 'flow' && styles.tabButtonActive)}
          onClick={() => setActiveTab('flow')}
        >
          💸 Smart Money Flow
        </button>
        <button
          className={clsx(styles.tabButton, activeTab === 'agri' && styles.tabButtonActive)}
          onClick={() => setActiveTab('agri')}
        >
          🌾 Nông sản
        </button>
        <button 
          className={clsx(styles.tabButton, activeTab === 'macro' && styles.tabButtonActive)}
          onClick={() => setActiveTab('macro')}
        >
          📰 Macro News
        </button>
        <button 
          className={clsx(styles.tabButton, activeTab === 'correlation' && styles.tabButtonActive)}
          onClick={() => setActiveTab('correlation')}
        >
          🔗 Forex Correlation
        </button>
      </div>

      {activeTab === 'agri' && <AgriDashboard isActive />}

      <TerminalDashboard isActive={activeTab === 'terminal'} />

      <SmartMoneyFlowWindow isActive={activeTab === 'flow'} />

      {activeTab === 'statarb' && (
        <>
          {/* Sub-tabs: Stocks vs Forex */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <button
              onClick={() => setStatarbMode('stocks')}
              style={{
                padding: '0.4rem 1.2rem', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem',
                background: statarbMode === 'stocks' ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                color: statarbMode === 'stocks' ? '#fff' : 'var(--text-muted)',
                transition: 'all 0.2s'
              }}
            >
              📈 Stocks Pair Matrix
            </button>
            <button
              onClick={() => setStatarbMode('forex')}
              style={{
                padding: '0.4rem 1.2rem', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem',
                background: statarbMode === 'forex' ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                color: statarbMode === 'forex' ? '#fff' : 'var(--text-muted)',
                transition: 'all 0.2s'
              }}
            >
              💱 Forex Z-Score
            </button>
          </div>

          {statarbMode === 'forex' ? (
            <ForexStatsPanel lookback={config.lookback} />
          ) : (
            <>
          <div className={styles.glassPanel}>
        <div className={styles.controlGrid}>
          <div className={styles.controlGroup}>
            <label>Thị Trường</label>
            <select 
              value={config.market} 
              onChange={e => setConfig({...config, market: e.target.value as MarketType})}
            >
              {MARKETS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          
          <div className={styles.controlGroup}>
            <label>Nhóm Ngành (Sector)</label>
            <select 
              value={config.sector} 
              onChange={e => setConfig({...config, sector: e.target.value})}
            >
              {SECTORS[config.market].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className={clsx(styles.controlGroup, styles.span2)}>
            <label>So sánh nhanh (A vs B)</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                placeholder="Mã A (Y)"
                value={compareY}
                onChange={(e) => setCompareY(e.target.value)}
              />
              <input
                type="text"
                placeholder="Mã B (X)"
                value={compareX}
                onChange={(e) => setCompareX(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={handleCompare}
              disabled={loading || !compareY.trim() || !compareX.trim()}
              style={{
                marginTop: 8,
                padding: '0.65rem 0.9rem',
                borderRadius: 10,
                border: '1px solid rgba(59,130,246,0.35)',
                background: loading ? 'rgba(255,255,255,0.08)' : 'rgba(59,130,246,0.15)',
                color: loading ? 'var(--text-muted)' : 'var(--text-main)',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 800,
              }}
              title="Fetch riêng 2 mã và mở modal (không phụ thuộc bảng)"
            >
              {loading ? 'Đang fetch...' : 'So sánh & Mở Modal'}
            </button>
          </div>

          <div className={styles.controlGroup}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={config.useCustomSymbols}
                onChange={e => setConfig({ ...config, useCustomSymbols: e.target.checked })}
              />
              Dùng danh sách Symbols (ví dụ S&P 500)
            </label>
            {config.useCustomSymbols && (
              <>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={async () => {
                      const list = await fetchSp500Symbols({
                        sector: config.sector,
                        limit: config.customSymbolsLimit,
                      });
                      if (!list.length) {
                        alert('Không tải được danh sách S&P 500 (proxy/wiki lỗi).');
                        return;
                      }
                      setConfig((prev) => ({
                        ...prev,
                        market: 'US Stocks',
                        customSymbols: list.join(' '),
                      }));
                    }}
                    style={{
                      padding: '0.5rem 0.9rem',
                      borderRadius: 10,
                      border: '1px solid rgba(59,130,246,0.35)',
                      background: 'rgba(59,130,246,0.15)',
                      color: 'var(--text-main)',
                      cursor: 'pointer',
                      fontWeight: 700,
                    }}
                    title="Tự động lấy danh sách constituents từ Wikipedia (có thể thay đổi theo thời gian)"
                  >
                    Tải danh sách S&P 500
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 700 }}>Giới hạn</span>
                    <input
                      type="number"
                      min={1}
                      max={503}
                      value={config.customSymbolsLimit}
                      onChange={(e) => setConfig({ ...config, customSymbolsLimit: Number(e.target.value) })}
                      style={{ width: 110 }}
                      title="Chạy 503 symbols sẽ rất lâu và dễ bị rate-limit; nên giới hạn 30–100"
                    />
                  </div>
                </div>

                <textarea
                  rows={4}
                  placeholder="Dán list ticker, ví dụ: AAPL MSFT NVDA ... (cách nhau bằng dấu cách hoặc dấu phẩy)"
                  value={config.customSymbols}
                  onChange={e => setConfig({ ...config, customSymbols: e.target.value })}
                />
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Đang dùng: <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>{parsedCustomSymbols.length}</span> symbols
                </div>
              </>
            )}
          </div>

          <div className={styles.controlGroup}>
            <label>Khung Giá (Interval)</label>
            <select
              value={config.interval}
              onChange={e => setConfig({ ...config, interval: e.target.value as Interval })}
              title="Intraday thường chỉ lấy được dữ liệu gần đây; dùng 1d nếu muốn dài hơn"
            >
              {INTERVALS.map((itv) => (
                <option key={itv} value={itv}>{itv}</option>
              ))}
            </select>
          </div>

          <div className={styles.controlGroup}>
            <label>Lookback (Cửa sổ quan sát)</label>
            <input 
              type="number" 
              value={config.lookback} 
              onChange={e => setConfig({...config, lookback: Number(e.target.value)})}
            />
          </div>

          <div className={styles.controlGroup}>
            <label>Z-Score Threshold</label>
            <input 
              type="number" step="0.1" 
              value={config.zScoreThreshold} 
              onChange={e => setConfig({...config, zScoreThreshold: Number(e.target.value)})}
            />
          </div>

          <div className={styles.controlGroup}>
            <label>Hurst Threshold</label>
            <input 
              type="number" step="0.05" 
              value={config.hurstThreshold} 
              onChange={e => setConfig({...config, hurstThreshold: Number(e.target.value)})}
            />
          </div>

          <div className={styles.controlGroup}>
            <label className={styles.checkboxLabel}>
              <input 
                type="checkbox" 
                checked={config.useFundamental} 
                onChange={e => setConfig({...config, useFundamental: e.target.checked})}
              />
              Bật Lọc Cơ Bản (Fundamental)
            </label>
            {config.useFundamental && (
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <input 
                  type="number" placeholder="Max PE" title="Max PE" style={{ width: '100%' }}
                  value={config.maxPe} onChange={e => setConfig({...config, maxPe: Number(e.target.value)})}
                />
                <input 
                  type="number" placeholder="Min ROE" title="Min ROE" style={{ width: '100%' }}
                  value={config.minRoe} onChange={e => setConfig({...config, minRoe: Number(e.target.value)})}
                />
              </div>
            )}
          </div>
        </div>

        <button 
          className={styles.runButton} 
          onClick={handleRun} 
          disabled={loading}
        >
          {loading ? <Activity className="animate-spin" /> : <Play />}
          {loading ? "Đang xử lý..." : "Chạy Thuật Toán"}
        </button>
      </div>

      {/* MATRIX TABLE */}
      {Object.keys(matrix).length > 0 && (
        <motion.div 
          className={styles.glassPanel}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className={styles.matrixWrapper}>
            <table className={styles.matrixTable}>
              <thead>
                <tr>
                  <th>Y \ X</th>
                  {symbols.map(sym => (
                    <th key={sym}>{sym.split('.')[0]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {symbols.map((symY, i) => (
                  <tr key={symY}>
                    <th>{symY.split('.')[0]}</th>
                    {symbols.map((symX, j) => {
                      if (i === j) return <td key={symX} className={styles.cellEmpty}>-</td>;
                      
                      const res = matrix[symY]?.[symX];
                      if (!res) return <td key={symX}></td>;

                      // Removed unused isFailFund variables
                      
                      return (
                        <td key={symX}>
                          <div 
                            className={clsx(styles.cell, getCellClass(res))}
                            onClick={() => res.signal !== 99 && setSelectedPair(res)}
                            title={`Z-Score: ${res.zScore.toFixed(2)}\nBeta: ${res.beta.toFixed(2)}\nHurst: ${res.hurst.toFixed(2)}`}
                          >
                            {getCellText(res)}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* PAIR DETAIL MODAL */}
      <AnimatePresence>
        {selectedPair && (
          <PairModal 
            pair={selectedPair} 
            prices={prices}
            onClose={() => setSelectedPair(null)} 
          />
        )}
      </AnimatePresence>
        </>
          )}
        </>
      )}



      <MacroInsights isActive={activeTab === 'macro'} />

      {activeTab === 'correlation' && <ForexCorrelation />}

    </div>
  );
}
