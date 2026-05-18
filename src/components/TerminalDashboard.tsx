import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import styles from '../App.module.css';

import { dbGetSeries } from '../lib/terminal/idb';
import { addToWatchlist, loadTerminalSnapshot, removeFromWatchlist } from '../lib/terminal/store';
import { seriesId, pctChange, latestPoint } from '../lib/terminal/series';
import { syncYahooDailyOHLCV } from '../lib/terminal/ingest';
import { fmtAgoVi } from '../lib/terminal/utils';
import type { Security, StoredSeries, WatchlistItem } from '../lib/terminal/types';
import { seedDefaultUniverseAuto } from '../lib/terminal/universe';
import { startAutoScheduler } from '../lib/terminal/scheduler';
import { fetchRssFeed, type RssItem } from '../lib/rss';
import { computeMarketSignal } from '../lib/terminal/signalEngine';

type Row = {
  item: WatchlistItem;
  sec: Security;
  close?: StoredSeries;
  last?: number;
  chg1d?: number | null;
  chg7d?: number | null;
  updatedAt?: number;
};

type NewsKey = 'crypto' | 'stocks' | 'forex' | 'commodities' | 'agri';

const NEWS_FEEDS: Record<NewsKey, { titleVi: string; url: string }> = {
  crypto: {
    titleVi: 'News Crypto',
    url: 'https://news.google.com/rss/search?q=bitcoin+ethereum+crypto+market&hl=en-US&gl=US&ceid=US:en',
  },
  stocks: {
    titleVi: 'News Cổ phiếu',
    url: 'https://news.google.com/rss/search?q=US+stock+market+S%26P500+earnings&hl=en-US&gl=US&ceid=US:en',
  },
  forex: {
    titleVi: 'News Forex',
    url: 'https://news.google.com/rss/search?q=forex+Fed+inflation+dollar&hl=en-US&gl=US&ceid=US:en',
  },
  commodities: {
    titleVi: 'News Commodities',
    url: 'https://news.google.com/rss/search?q=commodities+oil+gold+inventory&hl=en-US&gl=US&ceid=US:en',
  },
  agri: {
    titleVi: 'News Nông sản',
    url: 'https://news.google.com/rss/search?q=agricultural+futures+corn+wheat+soybean+USDA&hl=en-US&gl=US&ceid=US:en',
  },
};

const NEWS_INTERVAL_PRESETS: { label: string; sec: number }[] = [
  { label: '10s', sec: 10 },
  { label: '20s', sec: 20 },
  { label: '30s', sec: 30 },
  { label: '1p', sec: 60 },
];

function countSentiment(items: RssItem[]) {
  let pos = 0;
  let neg = 0;
  let neu = 0;
  let buy = 0;
  let sell = 0;
  for (const it of items) {
    if (it.sentiment === 'BUY') pos += 1;
    else if (it.sentiment === 'SELL') neg += 1;
    else neu += 1;
    buy += it.score.buy;
    sell += it.score.sell;
  }
  const total = buy + sell;
  const net = total ? ((buy - sell) / total) * 100 : 0;
  return { pos, neg, neu, netPct: Math.max(-100, Math.min(100, net)) };
}

function SentimentBar({ pos, neg, neu }: { pos: number; neg: number; neu: number }) {
  const total = Math.max(1, pos + neg + neu);
  const wPos = (pos / total) * 100;
  const wNeg = (neg / total) * 100;
  const wNeu = (neu / total) * 100;
  return (
    <div className={styles.termSentBar} title={`Tích cực: ${pos} · Tiêu cực: ${neg} · Trung lập: ${neu}`}>
      <div className={clsx(styles.termSentSeg, styles.termSentPos)} style={{ width: `${wPos}%` }} />
      <div className={clsx(styles.termSentSeg, styles.termSentNeu)} style={{ width: `${wNeu}%` }} />
      <div className={clsx(styles.termSentSeg, styles.termSentNeg)} style={{ width: `${wNeg}%` }} />
    </div>
  );
}

function signalTooltip(scorePct: number) {
  if (scorePct >= 25) return 'Khuyến nghị: thiên về BUY/Long. Ưu tiên canh mua pullback, tránh FOMO khi quá nóng.';
  if (scorePct <= -25) return 'Khuyến nghị: thiên về SELL/Short. Ưu tiên giảm rủi ro, chờ xác nhận đảo chiều.';
  return 'Khuyến nghị: TRUNG LẬP/WAIT. Ưu tiên quản trị vị thế, chờ tín hiệu rõ hơn.';
}

function PanelTitle({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className={styles.termPanelTitleRow}>
      <div className={styles.termPanelTitle}>{title}</div>
      {right ? <div className={styles.termPanelRight}>{right}</div> : null}
    </div>
  );
}

function formatPct(x: number | null | undefined) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return `${x.toFixed(2)}%`;
}

function isVietnam(sec: Security) {
  const s = sec.symbol.toUpperCase();
  return s.endsWith('.VN') || s.includes('VNINDEX');
}

export default function TerminalDashboard({ isActive }: { isActive: boolean }) {
  const [busy, setBusy] = useState(false);
  const [compact, setCompact] = useState(true);

  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);

  const [rowsWithData, setRowsWithData] = useState<Row[]>([]);

  const [newsByKey, setNewsByKey] = useState<Record<NewsKey, RssItem[]>>({
    crypto: [],
    stocks: [],
    forex: [],
    commodities: [],
    agri: [],
  });
  const [newsUpdatedAt, setNewsUpdatedAt] = useState<Record<NewsKey, number | null>>({
    crypto: null,
    stocks: null,
    forex: null,
    commodities: null,
    agri: null,
  });
  const [newsLoading, setNewsLoading] = useState<Record<NewsKey, boolean>>({
    crypto: false,
    stocks: false,
    forex: false,
    commodities: false,
    agri: false,
  });
  const [newsError, setNewsError] = useState<Record<NewsKey, string | null>>({
    crypto: null,
    stocks: null,
    forex: null,
    commodities: null,
    agri: null,
  });
  const [newsIntervalSec, setNewsIntervalSec] = useState<Record<NewsKey, number>>({
    crypto: 60,
    stocks: 60,
    forex: 60,
    commodities: 60,
    agri: 60,
  });

  const refreshState = useCallback(async () => {
    const snap = await loadTerminalSnapshot();
    setWatchlist(snap.watchlist);
    return snap;
  }, []);

  const loadSeriesForRows = useCallback(async (items: Row[]) => {
    const out: Row[] = [];
    for (const r of items) {
      const sid = seriesId(r.sec.id, 'yahoo_chart', '1d', 'close');
      const close = await dbGetSeries(sid);
      const last = close?.points?.length ? latestPoint(close.points)?.v : undefined;
      out.push({
        ...r,
        close,
        last,
        chg1d: close ? pctChange(close, 1) : null,
        chg7d: close ? pctChange(close, 7) : null,
        updatedAt: close?.updatedAt,
      });
    }
    return out;
  }, []);

  const fetchNews = useCallback(async (key: NewsKey) => {
    setNewsLoading((p) => ({ ...p, [key]: true }));
    setNewsError((p) => ({ ...p, [key]: null }));
    try {
      const src = NEWS_FEEDS[key];
      const items = await fetchRssFeed(src.url);
      const dedup = new Map<string, RssItem>();
      for (const it of items) {
        const k = it.link || `${it.title}:${it.pubDate}`;
        if (!dedup.has(k)) dedup.set(k, it);
      }
      const list = Array.from(dedup.values())
        .sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0))
        .slice(0, 120);
      setNewsByKey((p) => ({ ...p, [key]: list }));
      setNewsUpdatedAt((p) => ({ ...p, [key]: Date.now() }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Fetch news thất bại';
      setNewsError((p) => ({ ...p, [key]: msg }));
    } finally {
      setNewsLoading((p) => ({ ...p, [key]: false }));
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    void (async () => {
      await seedDefaultUniverseAuto();
      const snap = await refreshState();
      const baseRows: Row[] = snap.watchlist
        .map((item) => {
          const sec = snap.securitiesById[item.securityId];
          return sec ? { item, sec } : null;
        })
        .filter(Boolean) as Row[];
      const enriched = await loadSeriesForRows(baseRows);
      setRowsWithData(enriched);
      await Promise.all((Object.keys(NEWS_FEEDS) as NewsKey[]).map(k => fetchNews(k)));
    })();
  }, [isActive, fetchNews, loadSeriesForRows, refreshState]);

  useEffect(() => {
    if (!isActive) return;
    if (watchlist.length === 0) return;

    const scheduler = startAutoScheduler({
      getSecurities: async () => {
        const snap = await loadTerminalSnapshot();
        setWatchlist(snap.watchlist);
        return { securitiesById: snap.securitiesById };
      },
      onCycle: async () => {
        const snap = await refreshState();
        const baseRows: Row[] = snap.watchlist
          .map((item) => {
            const sec = snap.securitiesById[item.securityId];
            return sec ? { item, sec } : null;
          })
          .filter(Boolean) as Row[];
        const enriched = await loadSeriesForRows(baseRows);
        setRowsWithData(enriched);
      },
      config: {
        enabled: true,
        intervalMinutes: 15,
        maxPerCycle: 10,
        minRefreshMinutesPerSymbol: 20,
      },
    });

    scheduler.start();
    return () => scheduler.stop();
  }, [isActive, loadSeriesForRows, refreshState, watchlist.length]);

  useEffect(() => {
    if (!isActive) return;
    const keys = Object.keys(NEWS_FEEDS) as NewsKey[];
    const timers = keys.map((k) => {
      const ms = Math.max(10, Math.floor(newsIntervalSec[k])) * 1000;
      return window.setInterval(() => { void fetchNews(k); }, ms);
    });
    return () => timers.forEach(id => window.clearInterval(id));
  }, [isActive, fetchNews, newsIntervalSec]);

  const byAsset = useMemo(() => {
    const buckets: Record<string, Row[]> = {
      Crypto: [],
      Forex: [],
      Commodities: [],
      Futures: [],
      Agriculture: [],
      StocksUS: [],
      Vietnam: [],
    };

    for (const r of rowsWithData) {
      if (isVietnam(r.sec)) buckets.Vietnam.push(r);
      else if (r.sec.assetClass === 'Stocks') buckets.StocksUS.push(r);
      else if (r.sec.assetClass === 'Crypto') buckets.Crypto.push(r);
      else if (r.sec.assetClass === 'Forex') buckets.Forex.push(r);
      else if (r.sec.assetClass === 'Agriculture') buckets.Agriculture.push(r);
      else if (r.sec.assetClass === 'Commodities') buckets.Commodities.push(r);
      else if (r.sec.assetClass === 'Futures') buckets.Futures.push(r);
    }

    const sortFn = (a: Row, b: Row) => Math.abs((b.chg7d ?? 0)) - Math.abs((a.chg7d ?? 0));
    for (const k of Object.keys(buckets)) buckets[k].sort(sortFn);
    return buckets;
  }, [rowsWithData]);

  const rowBySymbol = useMemo(() => {
    const map = new Map<string, Row>();
    for (const r of rowsWithData) map.set(r.sec.symbol.toUpperCase(), r);
    return map;
  }, [rowsWithData]);

  const signals = useMemo(() => {
    const spx7d = rowBySymbol.get('^GSPC')?.chg7d ?? null;
    const vix7d = rowBySymbol.get('^VIX')?.chg7d ?? null;
    const btc7d = rowBySymbol.get('BTC-USD')?.chg7d ?? null;
    const dxy7d = rowBySymbol.get('DX-Y.NYB')?.chg7d ?? null;
    const gold7d = rowBySymbol.get('GC=F')?.chg7d ?? null;
    const oil7d = rowBySymbol.get('CL=F')?.chg7d ?? null;
    const corn7d = rowBySymbol.get('ZC=F')?.chg7d ?? null;

    const sStocks = computeMarketSignal({
      marketVi: 'Cổ phiếu',
      assetClass: 'Stocks',
      newsItems: newsByKey.stocks,
      spx7d,
      vix7d,
      dxy7d,
    });
    const sCrypto = computeMarketSignal({
      marketVi: 'Crypto',
      assetClass: 'Crypto',
      newsItems: newsByKey.crypto,
      btc7d,
      dxy7d,
    });
    const sFx = computeMarketSignal({
      marketVi: 'Forex',
      assetClass: 'Forex',
      newsItems: newsByKey.forex,
      dxy7d,
      spx7d,
      vix7d,
    });
    const sCom = computeMarketSignal({
      marketVi: 'Commodities',
      assetClass: 'Commodities',
      newsItems: newsByKey.commodities,
      dxy7d,
      spx7d,
      vix7d,
      extraDrivers: [
        { labelVi: 'Dầu (7D)', value: formatPct(oil7d), tone: (oil7d ?? 0) >= 0 ? 'pos' : 'neg' },
        { labelVi: 'Vàng (7D)', value: formatPct(gold7d), tone: (gold7d ?? 0) >= 0 ? 'pos' : 'neg' },
      ],
    });
    const sAgri = computeMarketSignal({
      marketVi: 'Nông sản',
      assetClass: 'Agriculture',
      newsItems: newsByKey.agri,
      dxy7d,
      spx7d,
      vix7d,
      extraDrivers: [
        { labelVi: 'Ngô (7D)', value: formatPct(corn7d), tone: (corn7d ?? 0) >= 0 ? 'pos' : 'neg' },
      ],
    });

    return {
      stocks: sStocks,
      crypto: sCrypto,
      forex: sFx,
      commodities: sCom,
      agri: sAgri,
    };
  }, [newsByKey, rowBySymbol]);

  const syncAll = async () => {
    setBusy(true);
    try {
      const snap = await loadTerminalSnapshot();
      for (const item of snap.watchlist) {
        const sec = snap.securitiesById[item.securityId];
        if (!sec) continue;
        await syncYahooDailyOHLCV(sec, '1y');
      }
      const snap2 = await refreshState();
      const baseRows: Row[] = snap2.watchlist
        .map((item) => {
          const sec = snap2.securitiesById[item.securityId];
          return sec ? { item, sec } : null;
        })
        .filter(Boolean) as Row[];
      const enriched = await loadSeriesForRows(baseRows);
      setRowsWithData(enriched);
    } finally {
      setBusy(false);
    }
  };

  const removeItem = async (id: string) => {
    await removeFromWatchlist(id);
    const snap = await refreshState();
    const baseRows: Row[] = snap.watchlist
      .map((item) => {
        const sec = snap.securitiesById[item.securityId];
        return sec ? { item, sec } : null;
      })
      .filter(Boolean) as Row[];
    const enriched = await loadSeriesForRows(baseRows);
    setRowsWithData(enriched);
  };

  const [manualQuery, setManualQuery] = useState('');
  const addManual = async () => {
    const q = manualQuery.trim();
    if (!q) return;
    setBusy(true);
    try {
      const res = await addToWatchlist(q);
      if (res.ok) await syncYahooDailyOHLCV(res.security, '1y');
      setManualQuery('');
      const snap = await refreshState();
      const baseRows: Row[] = snap.watchlist
        .map((item) => {
          const sec = snap.securitiesById[item.securityId];
          return sec ? { item, sec } : null;
        })
        .filter(Boolean) as Row[];
      const enriched = await loadSeriesForRows(baseRows);
      setRowsWithData(enriched);
    } finally {
      setBusy(false);
    }
  };

  if (!isActive) return null;

  const renderSignalCard = (title: string, key: NewsKey) => {
    const s = signals[key];
    const tone =
      s.labelVi === 'RISK-ON' ? styles.terminalPos :
      s.labelVi === 'RISK-OFF' ? styles.terminalNeg :
      styles.terminalMuted;
    return (
      <div className={styles.termSignalCard} title={signalTooltip(s.scorePct)}>
        <div className={styles.termSignalTop}>
          <div className={styles.termSignalMarket}>{title}</div>
          <div className={clsx(styles.termSignalBadge, tone)}>{s.labelVi}</div>
        </div>
        <div className={styles.termSignalScoreRow}>
          <div className={styles.termSignalScore}>{s.scorePct.toFixed(0)}%</div>
          <div className={styles.terminalMuted}>tin cậy {s.confidence.toFixed(0)}%</div>
        </div>
        <div className={styles.termSignalDrivers}>
          {s.drivers.slice(0, 6).map((d, idx) => (
            <div key={idx} className={styles.termDriver}>
              <div className={styles.terminalMuted}>{d.labelVi}</div>
              <div className={clsx(
                styles.terminalNum,
                d.tone === 'pos' ? styles.terminalPos : d.tone === 'neg' ? styles.terminalNeg : styles.terminalMuted
              )}>
                {d.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderWatchTable = (title: string, rows: Row[]) => {
    return (
      <div className={clsx(styles.glassPanel, styles.termPanel, compact && styles.termCompact)}>
        <PanelTitle
          title={`${title} (${rows.length})`}
          right={
            <label className={styles.checkboxLabel} title="Giảm padding/font để nhìn được nhiều dòng hơn">
              <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} />
              Compact
            </label>
          }
        />
        <div className={styles.termTableHead}>
          <div>Mã</div>
          <div>Giá</div>
          <div>7D%</div>
          <div>Cập nhật</div>
          <div />
        </div>
        <div className={styles.termTableBody}>
          {rows.slice(0, 120).map((r) => (
            <div key={r.item.id} className={styles.termTableRow}>
              <div className={styles.terminalMono}>{r.sec.symbol}</div>
              <div className={styles.terminalNum}>{r.last !== undefined ? r.last.toFixed(2) : '—'}</div>
              <div className={clsx(styles.terminalNum, (r.chg7d ?? 0) >= 0 ? styles.terminalPos : styles.terminalNeg)}>
                {formatPct(r.chg7d)}
              </div>
              <div className={styles.terminalMuted}>{r.updatedAt ? fmtAgoVi(r.updatedAt) : '—'}</div>
              <div className={styles.termRowActions}>
                <button className={styles.terminalMiniBtnDanger} type="button" onClick={() => removeItem(r.item.id)}>Xoá</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderNewsPanel = (key: NewsKey) => {
    const items = newsByKey[key];
    const st = countSentiment(items.slice(0, 50));
    return (
      <div className={clsx(styles.glassPanel, styles.termPanel, compact && styles.termCompact)}>
        <PanelTitle
          title={NEWS_FEEDS[key].titleVi}
          right={
            <div className={styles.termNewsControls}>
              <select
                value={newsIntervalSec[key]}
                onChange={(e) => setNewsIntervalSec((p) => ({ ...p, [key]: Number(e.target.value) }))}
                title="Tần suất fetch"
              >
                {NEWS_INTERVAL_PRESETS.map(p => <option key={p.sec} value={p.sec}>{p.label}</option>)}
              </select>
              <button className={styles.terminalMiniBtn} type="button" onClick={() => fetchNews(key)}>
                Refresh
              </button>
            </div>
          }
        />

        <div className={styles.termNewsStats}>
          <div className={styles.termStat}>
            <div className={styles.terminalMuted}>Net sentiment</div>
            <div className={clsx(styles.terminalNum, st.netPct >= 0 ? styles.terminalPos : styles.terminalNeg)}>{st.netPct.toFixed(0)}%</div>
          </div>
          <div className={styles.termStatWide}>
            <div className={styles.terminalMuted}>Tích cực / Trung lập / Tiêu cực (50 tin gần nhất)</div>
            <SentimentBar pos={st.pos} neu={st.neu} neg={st.neg} />
          </div>
          <div className={styles.termStat}>
            <div className={styles.terminalMuted}>Cập nhật</div>
            <div className={styles.terminalNum}>{newsUpdatedAt[key] ? fmtAgoVi(newsUpdatedAt[key] as number) : '—'}</div>
          </div>
        </div>

        {newsError[key] ? <div className={styles.terminalError}>{newsError[key]}</div> : null}
        {newsLoading[key] ? <div className={styles.terminalMuted}>Đang tải news...</div> : null}

        <div className={styles.termNewsList}>
          {items.slice(0, 30).map((n, idx) => (
            <a
              key={`${n.link}-${idx}`}
              href={n.link}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.termNewsItem}
              title={n.description}
            >
              <div className={styles.termNewsTop}>
                <span className={styles.terminalMuted}>
                  {n.pubDate ? new Date(n.pubDate).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : ''}
                </span>
                <span className={clsx(
                  styles.termNewsBadge,
                  n.sentiment === 'BUY' ? styles.terminalPos :
                  n.sentiment === 'SELL' ? styles.terminalNeg :
                  styles.terminalMuted
                )}>
                  {n.sentiment === 'BUY' ? 'TÍCH CỰC' : n.sentiment === 'SELL' ? 'TIÊU CỰC' : 'TRUNG LẬP'}
                </span>
              </div>
              <div className={styles.termNewsTitle}>{n.title}</div>
            </a>
          ))}
        </div>
      </div>
    );
  };

  return (
    <motion.div className={styles.termRoot} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className={clsx(styles.glassPanel, styles.termHeader)}>
        <div className={styles.termHeaderRow}>
          <div>
            <div className={styles.termH1}>Terminal Pro (Auto)</div>
            <div className={styles.termSub}>Universe 50–100 · Auto sync · News windows (10s–1p) · Signals theo thị trường</div>
          </div>
          <button className={styles.terminalSyncBtn} type="button" onClick={syncAll} disabled={busy} title="Sync toàn bộ (tốn thời gian)">
            {busy ? 'Đang đồng bộ...' : 'Đồng bộ tất cả'}
          </button>
        </div>

        <div className={styles.termHeaderTools}>
          <div className={styles.termAddInline}>
            <span className={styles.terminalMuted}>Thêm mã (tuỳ chọn)</span>
            <input
              value={manualQuery}
              onChange={(e) => setManualQuery(e.target.value)}
              placeholder="VD: VNINDEX, VCB.VN, EURUSD, BTC..."
              onKeyDown={(e) => e.key === 'Enter' && addManual()}
            />
            <button className={styles.terminalAddBtn} type="button" onClick={addManual} disabled={busy || !manualQuery.trim()}>
              Thêm
            </button>
          </div>
        </div>
      </div>

      <div className={styles.termGrid}>
        <div className={styles.termCol}>
          {renderSignalCard('Cổ phiếu', 'stocks')}
          {renderWatchTable('US Stocks', byAsset.StocksUS)}
        </div>
        <div className={styles.termCol}>
          {renderSignalCard('Crypto', 'crypto')}
          {renderWatchTable('Crypto', byAsset.Crypto)}
        </div>
        <div className={styles.termCol}>
          {renderSignalCard('Forex', 'forex')}
          {renderWatchTable('Forex', byAsset.Forex)}
        </div>
        <div className={styles.termCol}>
          {renderSignalCard('Commodities', 'commodities')}
          {renderWatchTable('Futures/Commodities', byAsset.Futures)}
          {renderWatchTable('Nông sản', byAsset.Agriculture)}
          {renderWatchTable('Việt Nam', byAsset.Vietnam)}
        </div>
      </div>

      <div className={styles.termNewsGrid}>
        {renderNewsPanel('crypto')}
        {renderNewsPanel('stocks')}
        {renderNewsPanel('forex')}
        {renderNewsPanel('commodities')}
        {renderNewsPanel('agri')}
      </div>
    </motion.div>
  );
}
