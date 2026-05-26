import { useMemo, useState, useEffect, useCallback } from 'react';
import { Play, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { MARKETS, SECTORS, SYMBOLS, DEFAULT_PARAMS, INTERVALS, CRYPTO_SECTORS, CRYPTO_UNIVERSE } from './lib/config';
import type { MarketType, Interval, CryptoSector } from './lib/config';
import { fetchChartData, fetchFundamentals, fetchSp500Symbols, fetchCryptoTopMarketCap, fetchCryptoMarketChart, fetchCryptoTopSymbolsBinance, fetchCryptoKlinesBinance } from './lib/api';
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
  const [statarbMode, setStatarbMode] = useState<'stocks' | 'crypto' | 'forex'>('stocks');
  const [cryptoProvider, setCryptoProvider] = useState<'coingecko' | 'binance_spot'>('binance_spot');
  const [cryptoView, setCryptoView] = useState<'sectors' | 'top'>('top');
  const [cryptoSector, setCryptoSector] = useState<string>('Majors');
  const [cryptoTopN, setCryptoTopN] = useState<number>(20);
  const [cryptoLabelMap, setCryptoLabelMap] = useState<Record<string, string>>({});
  const [cryptoSymbolToId, setCryptoSymbolToId] = useState<Record<string, string>>({});
  const [cryptoUniverseLoading, setCryptoUniverseLoading] = useState(false);
  const [cryptoUniverseError, setCryptoUniverseError] = useState<string | null>(null);
  const [cryptoLastAction, setCryptoLastAction] = useState<string>('');
  const [cryptoLastUpdatedAt, setCryptoLastUpdatedAt] = useState<number | null>(null);
  
  // StatArb State
  const [symbols, setSymbols] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, number[]>>({});
  const [matrix, setMatrix] = useState<Record<string, Record<string, PairResult>>>({});
  const [selectedPair, setSelectedPair] = useState<PairResult | null>(null);
  const [compareY, setCompareY] = useState('');
  const [compareX, setCompareX] = useState('');

  // Update symbols when market/sector changes (stocks only)
  useEffect(() => {
    if (statarbMode !== 'stocks') return;
    if (config.useCustomSymbols) {
      setSymbols(parsedCustomSymbols);
      setMatrix({});
      return;
    }
    const list = SYMBOLS[config.market]?.[config.sector] || [];
    setSymbols(list);
    // Clear matrix on change
    setMatrix({});
  }, [statarbMode, config.market, config.sector, config.useCustomSymbols, parsedCustomSymbols]);

  // Update available sectors when market changes
  useEffect(() => {
    if (statarbMode !== 'stocks') return;
    const availableSectors = SECTORS[config.market];
    if (!availableSectors.includes(config.sector)) {
      setConfig(prev => ({ ...prev, sector: availableSectors[0] }));
    }
  }, [statarbMode, config.market, config.sector]);

  const hydrateCryptoLabels = useCallback(async (ids: string[]) => {
    const uniq = Array.from(new Set(ids.map((s) => s.trim()).filter(Boolean)));
    if (!uniq.length) {
      setCryptoLabelMap({});
      setCryptoSymbolToId({});
      return;
    }
    if (cryptoProvider !== 'coingecko') {
      // Binance mode: build labels locally (no metadata fetch).
      const map: Record<string, string> = {};
      const symToId: Record<string, string> = {};
      for (const symRaw of uniq) {
        const sym = symRaw.trim().toUpperCase();
        if (!sym) continue;
        // Display base asset for USDT pairs (fallback to full symbol).
        const base = sym.endsWith('USDT') ? sym.slice(0, -4) : sym;
        map[sym] = base;
        symToId[base] = sym;
        symToId[sym] = sym;
      }
      setCryptoLabelMap(map);
      setCryptoSymbolToId(symToId);
      return;
    }
    const meta = await fetchCryptoTopMarketCap({ ids: uniq, perPage: Math.min(250, uniq.length), page: 1 });
    const map: Record<string, string> = {};
    const symToId: Record<string, string> = {};
    for (const c of meta) {
      const label = c.symbol ? c.symbol.toUpperCase() : c.id.toUpperCase();
      map[c.id] = label;
      if (c.symbol) symToId[c.symbol.toUpperCase()] = c.id;
    }
    // fallback: ensure every id has a label
    for (const id of uniq) {
      if (!map[id]) map[id] = id.toUpperCase();
    }
    setCryptoLabelMap(map);
    setCryptoSymbolToId(symToId);
  }, [cryptoProvider]);

  const loadCryptoTop = useCallback(async () => {
    setCryptoUniverseLoading(true);
    setCryptoUniverseError(null);
    setCryptoLastAction('Đang tải universe…');
    try {
      const n = Math.max(5, Math.min(250, Math.round(Number(cryptoTopN) || 50)));
      if (cryptoProvider === 'binance_spot') {
        const rows = await fetchCryptoTopSymbolsBinance({ topN: n, quoteAsset: 'USDT' });
        if (!rows.length) {
          setCryptoUniverseError('Không tải được Top Volume từ Binance (proxy/network lỗi).');
          return;
        }
        const syms = rows.map((r) => r.symbol);
        setSymbols(syms);
        setMatrix({});
        await hydrateCryptoLabels(syms);
        setCryptoLastUpdatedAt(Date.now());
        setCryptoLastAction(`Đã tải ${syms.length} symbols (Binance).`);
      } else {
        const list = await fetchCryptoTopMarketCap({ perPage: n, page: 1, vsCurrency: 'usd' });
        if (!list.length) {
          setCryptoUniverseError('Không tải được Top Market Cap. Có thể do CoinGecko bị rate-limit hoặc proxy.php lỗi (thử refresh / giảm Top N).');
          return;
        }
        const ids = list.map((c) => c.id).filter(Boolean);
        setSymbols(ids);
        setMatrix({});
        const map: Record<string, string> = {};
        const symToId: Record<string, string> = {};
        for (const c of list) {
          const label = c.symbol ? c.symbol.toUpperCase() : c.id.toUpperCase();
          map[c.id] = label;
          if (c.symbol) symToId[c.symbol.toUpperCase()] = c.id;
        }
        setCryptoLabelMap(map);
        setCryptoSymbolToId(symToId);
        setCryptoLastUpdatedAt(Date.now());
        setCryptoLastAction(`Đã tải ${ids.length} ids (CoinGecko).`);
      }
    } finally {
      setCryptoUniverseLoading(false);
    }
  }, [cryptoTopN, cryptoProvider, hydrateCryptoLabels]);

  const loadCryptoSector = useCallback(async (sectorRaw: string) => {
    setCryptoUniverseLoading(true);
    setCryptoUniverseError(null);
    setCryptoLastAction('Đang tải sector…');
    try {
      if (cryptoProvider !== 'coingecko') {
        setCryptoUniverseError('Sectors hiện chỉ hỗ trợ CoinGecko. Hãy chuyển nguồn dữ liệu sang CoinGecko để dùng.');
        return;
      }
      const sector = sectorRaw as CryptoSector;
      const ids = (CRYPTO_UNIVERSE[sector] || []).slice(0, 40);
      if (!ids.length) {
        setCryptoUniverseError('Sector crypto trống.');
        return;
      }
      setSymbols(ids);
      setMatrix({});
      await hydrateCryptoLabels(ids);
      setCryptoLastUpdatedAt(Date.now());
      setCryptoLastAction(`Đã nạp sector ${sector} (${ids.length} ids).`);
    } finally {
      setCryptoUniverseLoading(false);
    }
  }, [hydrateCryptoLabels, cryptoProvider]);

  // Auto seed crypto universe when switching mode/view
  useEffect(() => {
    if (statarbMode !== 'crypto') return;
    if (symbols.length) return;
    if (cryptoView === 'top') {
      void loadCryptoTop();
      return;
    }
    if (cryptoProvider !== 'coingecko') {
      void loadCryptoTop();
      return;
    }
    void loadCryptoSector(cryptoSector);
  }, [statarbMode, cryptoView, cryptoSector, symbols.length, loadCryptoSector, loadCryptoTop, cryptoProvider]);

  // When entering crypto mode, reset symbols so auto-seed runs (stocks list would otherwise carry over)
  useEffect(() => {
    if (statarbMode !== 'crypto') return;
    setSymbols([]);
    setMatrix({});
    // Crypto mode only supports a small set of intervals (CoinGecko limits)
    setConfig((prev) => ({
      ...prev,
      interval: (['1d', '1h', '60m'].includes(prev.interval) ? prev.interval : '1d') as Interval,
    }));
  }, [statarbMode]);

  // Switching provider should reload universe.
  useEffect(() => {
    if (statarbMode !== 'crypto') return;
    setSymbols([]);
    setMatrix({});
  }, [statarbMode, cryptoProvider]);

  const handleRun = async () => {
    setLoading(true);
    setMatrix({});
    const fetchedPrices: Record<string, number[]> = {};
    const fetchedFunds: Record<string, Fundamentals> = {};

    try {
      if (statarbMode === 'crypto') {
        setCryptoLastAction('Đang fetch price series…');
        if (cryptoProvider === 'binance_spot') {
          const wantsDaily = config.interval === '1d';
          const interval = wantsDaily ? '1d' : '1h';
          const limit = wantsDaily
            ? Math.max(60, Math.min(1000, Math.round(config.lookback + 60)))
            : Math.max(120, Math.min(1000, Math.round(config.lookback + 120)));

          // Fetch sequentially (Binance still has per-IP limits; keep it smooth)
          for (const sym of symbols) {
            try {
              const chart = await fetchCryptoKlinesBinance({ symbol: sym, interval, limit });
              if (chart) fetchedPrices[sym] = chart.close;
              fetchedFunds[sym] = { pe: 0, roe: 100 };
            } catch (e) {
              console.error(`Error fetching crypto ${sym}:`, e);
            }
          }
        } else {
          // CoinGecko: daily by default; hourly if user picked intraday (best-effort)
          const wantsDaily = config.interval === '1d';
          const interval = wantsDaily ? 'daily' : 'hourly';
          const days = wantsDaily
            ? Math.max(30, Math.min(3650, Math.round(config.lookback + 30)))
            : Math.max(2, Math.min(90, Math.round(Math.ceil(config.lookback / 24) + 7)));

          // Fetch data sequentially (proxy + CoinGecko also has limits)
          for (const id of symbols) {
            try {
              const chart = await fetchCryptoMarketChart({ id, vsCurrency: 'usd', days, interval });
              if (chart) fetchedPrices[id] = chart.close;
              fetchedFunds[id] = { pe: 0, roe: 100 }; // not used; keep compatible
            } catch (e) {
              console.error(`Error fetching crypto ${id}:`, e);
            }
          }
        }
        const okCount = Object.keys(fetchedPrices).length;
        setCryptoLastAction(okCount ? `Fetch xong: ${okCount}/${symbols.length} series.` : 'Không fetch được series nào (xem Network/Console).');
      } else {
        // Yahoo: Fetch sequentially to avoid rate-limiting
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
          if (statarbMode !== 'crypto' && config.useFundamental) {
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
    const yRaw = compareY.trim();
    const xRaw = compareX.trim();
    const y = statarbMode === 'crypto'
      ? (cryptoProvider === 'binance_spot'
        ? (cryptoSymbolToId[yRaw.toUpperCase()] || yRaw.toUpperCase())
        : (cryptoSymbolToId[yRaw.toUpperCase()] || yRaw.trim().toLowerCase()))
      : yRaw.toUpperCase();
    const x = statarbMode === 'crypto'
      ? (cryptoProvider === 'binance_spot'
        ? (cryptoSymbolToId[xRaw.toUpperCase()] || xRaw.toUpperCase())
        : (cryptoSymbolToId[xRaw.toUpperCase()] || xRaw.trim().toLowerCase()))
      : xRaw.toUpperCase();
    if (!y || !x) return;
    if (y === x) {
      alert('Vui lòng nhập 2 mã khác nhau.');
      return;
    }

    setLoading(true);
    try {
      if (statarbMode === 'crypto') {
        if (cryptoProvider === 'binance_spot') {
          const wantsDaily = config.interval === '1d';
          const interval = wantsDaily ? '1d' : '1h';
          const limit = wantsDaily
            ? Math.max(60, Math.min(1000, Math.round(config.lookback + 60)))
            : Math.max(120, Math.min(1000, Math.round(config.lookback + 120)));
          const [cy, cx] = await Promise.all([
            fetchCryptoKlinesBinance({ symbol: y, interval, limit }),
            fetchCryptoKlinesBinance({ symbol: x, interval, limit }),
          ]);

          if (!cy || !cx) {
            alert('Không fetch được dữ liệu cho 1 trong 2 coin. Nhập symbol Binance (vd: BTCUSDT) hoặc base (vd: BTC nếu có trong Top).');
            return;
          }

          setPrices((prev) => ({ ...prev, [y]: cy.close, [x]: cx.close }));

          const res = calculateStatArb(cy.close, cx.close, config.lookback, config.zScoreThreshold, true);
          setSelectedPair({ ...res, y, x });
          return;
        }

        const days = Math.max(30, Math.min(3650, Math.round(config.lookback + 30)));
        const [cy, cx] = await Promise.all([
          fetchCryptoMarketChart({ id: y, vsCurrency: 'usd', days, interval: 'daily' }),
          fetchCryptoMarketChart({ id: x, vsCurrency: 'usd', days, interval: 'daily' }),
        ]);

        if (!cy || !cx) {
          alert('Không fetch được dữ liệu cho 1 trong 2 coin. Nhập CoinGecko id (vd: bitcoin) hoặc symbol nếu có trong Top/sector.');
          return;
        }

        setPrices((prev) => ({ ...prev, [y]: cy.close, [x]: cx.close }));

        const res = calculateStatArb(cy.close, cx.close, config.lookback, config.zScoreThreshold, true);
        setSelectedPair({ ...res, y, x });
      } else {
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
      }
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

  const displaySymbol = (sym: string) => {
    if (statarbMode === 'crypto') return cryptoLabelMap[sym] ?? sym.toUpperCase();
    return sym.split('.')[0];
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
          {/* Sub-tabs: Stocks / Crypto / Forex */}
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
              onClick={() => setStatarbMode('crypto')}
              style={{
                padding: '0.4rem 1.2rem', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem',
                background: statarbMode === 'crypto' ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                color: statarbMode === 'crypto' ? '#fff' : 'var(--text-muted)',
                transition: 'all 0.2s'
              }}
            >
              🪙 Crypto Pair Matrix
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
          ) : statarbMode === 'crypto' ? (
            <>
              <div className={styles.glassPanel}>
                <div className={styles.controlGrid}>
                  <div className={styles.controlGroup}>
                    <label>Universe</label>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => setCryptoView('top')}
                        style={{
                          padding: '0.45rem 0.85rem',
                          borderRadius: 10,
                          border: '1px solid rgba(255,255,255,0.10)',
                          background: cryptoView === 'top' ? 'rgba(59,130,246,0.18)' : 'rgba(255,255,255,0.06)',
                          color: 'var(--text-main)',
                          cursor: 'pointer',
                          fontWeight: 800,
                        }}
                        title={cryptoProvider === 'binance_spot' ? 'Tự động lấy danh sách top volume (Binance Spot USDT)' : 'Tự động lấy danh sách coin Market Cap lớn nhất'}
                      >
                        {cryptoProvider === 'binance_spot' ? 'Top Volume' : 'Top Market Cap'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCryptoView('sectors')}
                        disabled={cryptoProvider !== 'coingecko'}
                        style={{
                          padding: '0.45rem 0.85rem',
                          borderRadius: 10,
                          border: '1px solid rgba(255,255,255,0.10)',
                          background: cryptoView === 'sectors' ? 'rgba(59,130,246,0.18)' : 'rgba(255,255,255,0.06)',
                          color: 'var(--text-main)',
                          cursor: cryptoProvider !== 'coingecko' ? 'not-allowed' : 'pointer',
                          fontWeight: 800,
                          opacity: cryptoProvider !== 'coingecko' ? 0.55 : 1,
                        }}
                        title={cryptoProvider !== 'coingecko' ? 'Sectors chỉ hỗ trợ CoinGecko' : 'Chọn nhóm crypto (CoinGecko IDs) theo sector'}
                      >
                        Sectors
                      </button>
                    </div>
                  </div>

                  <div className={styles.controlGroup}>
                    <label>Nguồn dữ liệu</label>
                    <select
                      value={cryptoProvider}
                      onChange={(e) => {
                        const next = e.target.value as 'coingecko' | 'binance_spot';
                        setCryptoProvider(next);
                        if (next !== 'coingecko' && cryptoView === 'sectors') setCryptoView('top');
                      }}
                      title="CoinGecko dễ bị 429; Binance Spot thường thoáng hơn cho nhiều coin"
                    >
                      <option value="binance_spot">Binance Spot (USDT, top volume)</option>
                      <option value="coingecko">CoinGecko (market cap, sectors)</option>
                    </select>
                  </div>

                  {cryptoView === 'top' ? (
                    <div className={styles.controlGroup}>
                      <label>{cryptoProvider === 'binance_spot' ? 'Top N (Volume USDT)' : 'Top N (Market Cap)'}</label>
                      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                          type="number"
                          min={5}
                          max={250}
                          value={cryptoTopN}
                          onChange={(e) => setCryptoTopN(Number(e.target.value))}
                          style={{ width: 140 }}
                        />
                        <button
                          type="button"
                          onClick={loadCryptoTop}
                          disabled={cryptoUniverseLoading}
                          style={{
                            padding: '0.5rem 0.9rem',
                            borderRadius: 10,
                            border: '1px solid rgba(59,130,246,0.35)',
                            background: 'rgba(59,130,246,0.15)',
                            color: 'var(--text-main)',
                            cursor: cryptoUniverseLoading ? 'not-allowed' : 'pointer',
                            fontWeight: 800,
                          }}
                        >
                          {cryptoUniverseLoading ? 'Đang tải...' : (cryptoProvider === 'binance_spot' ? 'Tải Top Volume' : 'Tải Top Market Cap')}
                        </button>
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 6 }}>
                        {cryptoProvider === 'binance_spot'
                          ? 'Dùng Binance Spot (USDT) · seed universe theo volume để chạy StatArb'
                          : 'Dùng CoinGecko · tự seed watchlist để chạy StatArb'}
                      </div>
                    </div>
                  ) : (
                    <div className={styles.controlGroup}>
                      <label>Crypto Sector</label>
                      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <select
                          value={cryptoSector}
                          onChange={(e) => setCryptoSector(e.target.value)}
                        >
                          {CRYPTO_SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <button
                          type="button"
                          onClick={() => loadCryptoSector(cryptoSector)}
                          disabled={cryptoUniverseLoading}
                          style={{
                            padding: '0.5rem 0.9rem',
                            borderRadius: 10,
                            border: '1px solid rgba(59,130,246,0.35)',
                            background: 'rgba(59,130,246,0.15)',
                            color: 'var(--text-main)',
                            cursor: cryptoUniverseLoading ? 'not-allowed' : 'pointer',
                            fontWeight: 800,
                          }}
                        >
                          {cryptoUniverseLoading ? 'Đang tải...' : 'Nạp Sector'}
                        </button>
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 6 }}>
                        Sector list là preset (CoinGecko IDs) · có thể mở rộng thêm sau
                      </div>
                    </div>
                  )}

                  <div className={clsx(styles.controlGroup, styles.span2)}>
                    <label>So sánh nhanh (A vs B)</label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type="text"
                        placeholder={cryptoProvider === 'binance_spot' ? 'Coin A (BTC hoặc BTCUSDT)' : 'Coin A (id hoặc symbol)'}
                        value={compareY}
                        onChange={(e) => setCompareY(e.target.value)}
                      />
                      <input
                        type="text"
                        placeholder={cryptoProvider === 'binance_spot' ? 'Coin B (ETH hoặc ETHUSDT)' : 'Coin B (id hoặc symbol)'}
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
                      title={cryptoProvider === 'binance_spot'
                        ? 'Crypto (Binance): nhập symbol (vd: BTCUSDT) hoặc base (vd: BTC nếu đã có trong Top)'
                        : 'Crypto (CoinGecko): nhập id (vd: bitcoin) hoặc symbol nếu đã có trong universe'}
                    >
                      {loading ? 'Đang fetch...' : 'So sánh & Mở Modal'}
                    </button>
                  </div>

                  <div className={styles.controlGroup}>
                    <label>Interval</label>
                    <select
                      value={config.interval}
                      onChange={e => setConfig({ ...config, interval: e.target.value as Interval })}
                      title="Crypto mode: 1d (daily) ổn định nhất; intraday là best-effort"
                    >
                      {['1d', '1h', '60m'].map((itv) => (
                        <option key={itv} value={itv}>{itv}</option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.controlGroup}>
                    <label>Lookback</label>
                    <input
                      type="number"
                      value={config.lookback}
                      onChange={e => setConfig({ ...config, lookback: Number(e.target.value) })}
                    />
                  </div>

                  <div className={styles.controlGroup}>
                    <label>Z-Score Threshold</label>
                    <input
                      type="number" step="0.1"
                      value={config.zScoreThreshold}
                      onChange={e => setConfig({ ...config, zScoreThreshold: Number(e.target.value) })}
                    />
                  </div>

                  <div className={styles.controlGroup}>
                    <label>Hurst Threshold</label>
                    <input
                      type="number" step="0.05"
                      value={config.hurstThreshold}
                      onChange={e => setConfig({ ...config, hurstThreshold: Number(e.target.value) })}
                    />
                  </div>

                  <div className={styles.controlGroup}>
                    <label>Đang dùng</label>
                    <div style={{ fontWeight: 800 }}>
                      {symbols.length} coins
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      Gợi ý: 20–80 coins để tránh fetch quá lâu
                    </div>
                  </div>
                </div>

                {cryptoUniverseError ? (
                  <div style={{ marginTop: 10, color: '#ef4444', fontWeight: 700 }}>{cryptoUniverseError}</div>
                ) : null}
                {cryptoLastAction ? (
                  <div style={{ marginTop: 8, color: 'var(--text-muted)', fontWeight: 700 }}>
                    {cryptoLastAction}
                    {cryptoLastUpdatedAt ? (
                      <span style={{ marginLeft: 8, opacity: 0.7 }}>
                        ({new Date(cryptoLastUpdatedAt).toLocaleTimeString()})
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <button
                  className={styles.runButton}
                  onClick={handleRun}
                  disabled={loading || cryptoUniverseLoading || symbols.length < 2}
                  title={symbols.length < 2 ? 'Cần ít nhất 2 coins' : 'Fetch series + compute ma trận'}
                >
                  {loading ? <Activity className="animate-spin" /> : <Play />}
                  {loading ? "Đang xử lý..." : "Chạy Thuật Toán"}
                </button>
              </div>
            </>
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

        </>
          )}

          {/* MATRIX TABLE (Stocks + Crypto) */}
          {statarbMode !== 'forex' && Object.keys(matrix).length > 0 && (
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
                      {symbols.map((sym) => (
                        <th key={sym}>{displaySymbol(sym)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {symbols.map((symY, i) => (
                      <tr key={symY}>
                        <th>{displaySymbol(symY)}</th>
                        {symbols.map((symX, j) => {
                          if (i === j) return <td key={symX} className={styles.cellEmpty}>-</td>;

                          const res = matrix[symY]?.[symX];
                          if (!res) return <td key={symX}></td>;

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
                labelMap={cryptoLabelMap}
                onClose={() => setSelectedPair(null)}
              />
            )}
          </AnimatePresence>
        </>
      )}



      <MacroInsights isActive={activeTab === 'macro'} />

      {activeTab === 'correlation' && <ForexCorrelation />}

    </div>
  );
}
