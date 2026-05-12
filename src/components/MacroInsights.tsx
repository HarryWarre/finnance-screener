import { useState, useEffect } from 'react';
import { Activity } from 'lucide-react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { fetchRssFeed } from '../lib/rss';
import type { RssItem } from '../lib/rss';
import TradingViewTimeline from './TradingViewTimeline';
import EconomicCalendar from './EconomicCalendar';
import styles from '../App.module.css';

export const RSS_SOURCES = {
  "🇺🇸 US Stocks (EN)": "https://news.google.com/rss/search?q=US+stock+market+S%26P500+earnings&hl=en-US&gl=US&ceid=US:en",
  "🇻🇳 Cổ phiếu Việt Nam (VI)": "https://news.google.com/rss/search?q=ch%E1%BB%A9ng+kho%C3%A1n+vi%E1%BB%87t+nam+vnindex&hl=vi&gl=VN&ceid=VN:vi",
  "💱 Forex (EN)": "https://news.google.com/rss/search?q=forex+currency+Fed+interest+rate+dollar&hl=en-US&gl=US&ceid=US:en",
  "🌾 Nông sản Futures (EN)": "https://news.google.com/rss/search?q=agricultural+futures+corn+wheat+soybean+commodity&hl=en-US&gl=US&ceid=US:en",
  "📰 FXStreet Market News": "https://www.fxstreet.com/rss",
  "📰 Investing.com Forex": "https://www.investing.com/rss/news_1.rss",
  "📰 Investing.com Commodities": "https://www.investing.com/rss/news_11.rss",
  "📰 ING THINK (FX & Macro)": "https://think.ing.com/rss"
};

interface MacroInsightsProps {
  isActive: boolean;
}

export default function MacroInsights({ isActive }: MacroInsightsProps) {
  const [rssUrl, setRssUrl] = useState(RSS_SOURCES["🇺🇸 US Stocks (EN)"]);
  const [news, setNews] = useState<RssItem[]>([]);
  const [loadingRss, setLoadingRss] = useState(false);

  useEffect(() => {
    if (!isActive) return;
    
    let isMounted = true;
    const loadRss = async () => {
      setLoadingRss(true);
      const data = await fetchRssFeed(rssUrl);
      if (isMounted) {
        setNews(data);
        setLoadingRss(false);
      }
    };
    loadRss();

    return () => { isMounted = false; };
  }, [rssUrl, isActive]);

  if (!isActive) return null;

  return (
    <motion.div 
      className={styles.macroDashboard}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
        {/* LEFT COLUMN: RSS News */}
        <div className={clsx(styles.glassPanel, styles.macroLeft)}>
          <div className={styles.controlGrid} style={{ marginBottom: '1.5rem' }}>
            <div className={styles.controlGroup}>
              <label>Nguồn Tin (RSS Source)</label>
              <select value={rssUrl} onChange={e => setRssUrl(e.target.value)}>
                {Object.entries(RSS_SOURCES).map(([name, url]) => (
                  <option key={name} value={url}>{name}</option>
                ))}
              </select>
            </div>
          </div>

          {loadingRss ? (
            <div style={{ textAlign: 'center', padding: '3rem' }}>
              <Activity className="animate-spin" style={{ margin: '0 auto 1rem', width: 32, height: 32, color: 'var(--accent)' }} />
              <p>Đang tải tin tức Vĩ mô...</p>
            </div>
          ) : (
            <div className={styles.newsGrid} style={{ flex: 1, overflowY: 'auto' }}>
              {news.map((item, idx) => (
                <a key={idx} href={item.link} target="_blank" rel="noopener noreferrer" className={styles.newsCard}>
                  <div className={styles.newsHeader}>
                    <h3 className={styles.newsTitle}>{item.title}</h3>
                  </div>
                  <div className={styles.newsDesc}>{item.description}</div>
                  
                  <div className={styles.newsFooter}>
                    <span className={styles.newsDate}>
                      {new Date(item.pubDate).toLocaleDateString('vi-VN', {
                        year: 'numeric', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                      })}
                    </span>
                    <span className={clsx(
                      styles.badge,
                      item.sentiment === 'BUY' ? styles.badgeBuy : 
                      item.sentiment === 'SELL' ? styles.badgeSell : styles.badgeNeutral
                    )}>
                      {item.sentiment}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Widgets */}
        <div className={styles.macroRight}>
          <div className={styles.widgetContainer} style={{ height: '400px' }}>
            <TradingViewTimeline />
          </div>
          <div className={styles.widgetContainer} style={{ height: '500px' }}>
            <EconomicCalendar />
          </div>
      </div>
    </motion.div>
  );
}
