import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { Activity, RefreshCw } from 'lucide-react';

import styles from '../App.module.css';
import {
  fetchChartData,
  fetchMacroCalendar,
  fetchMacroTrendSnapshot,
  type CurrencyMacroTrend,
  type MacroTrendBias,
  type OHLCV,
} from '../lib/api';
import {
  buildAutoRecommendations,
  buildRecentMacroTape,
  buildUpcomingWatchlist,
  FOREX_PAIR_TICKERS,
  normalizeMacroCalendar,
  type AutoRecommendation,
  type MacroTapeItem,
  type UpcomingMacroWatch,
} from '../lib/macroAutomation';
import {
  MACRO_EVENTS,
  PAIR_PLAYBOOKS,
  evaluateMacroStrategy,
  type ConfirmationState,
  type MacroPair,
  type OverlapState,
  type SpreadState,
  type StrategyStatus,
  type SurpriseState,
} from '../lib/macroStrategy';

const STATUS_COPY: Record<StrategyStatus, { label: string; className: string; summary: string }> = {
  TRADE: {
    label: 'TRADE',
    className: styles.badgeBuy,
    summary: 'Setup khớp với playbook nghiên cứu và có thể thực thi.'
  },
  REDUCE: {
    label: 'REDUCE',
    className: styles.badgeWarn,
    summary: 'Setup hợp lệ nhưng một hoặc vài bộ lọc rủi ro yêu cầu giảm size.'
  },
  WAIT: {
    label: 'WAIT',
    className: styles.badgeNeutral,
    summary: 'Narrative có thể đúng nhưng xác nhận H1 vẫn chưa đủ tốt.'
  },
  SKIP: {
    label: 'SKIP',
    className: styles.badgeDanger,
    summary: 'Framework cho thấy edge yếu hoặc rủi ro thực thi quá cao.'
  }
};

export default function MacroForexStrategy() {
  const [pair, setPair] = useState<MacroPair>('EUR/USD');
  const [eventId, setEventId] = useState('us_cpi');
  const [surprise, setSurprise] = useState<SurpriseState>('bullish');
  const [confirmation, setConfirmation] = useState<ConfirmationState>('strong');
  const [overlap, setOverlap] = useState<OverlapState>('none');
  const [spread, setSpread] = useState<SpreadState>('normal');
  const [preMove, setPreMove] = useState(false);
  const [autoRecommendations, setAutoRecommendations] = useState<AutoRecommendation[]>([]);
  const [upcomingWatchlist, setUpcomingWatchlist] = useState<UpcomingMacroWatch[]>([]);
  const [macroTrends, setMacroTrends] = useState<CurrencyMacroTrend[]>([]);
  const [recentMacroTape, setRecentMacroTape] = useState<MacroTapeItem[]>([]);
  const [loadingAuto, setLoadingAuto] = useState(false);
  const [autoError, setAutoError] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');
  const [showScenarioBuilder, setShowScenarioBuilder] = useState(false);

  const result = evaluateMacroStrategy({
    pair,
    eventId,
    surprise,
    confirmation,
    overlap,
    spread,
    preMove,
  });

  const statusMeta = STATUS_COPY[result.status];
  const trendBadgeClass = (bias: MacroTrendBias) =>
    bias === 'bullish' ? styles.badgeBuy : bias === 'bearish' ? styles.badgeDanger : styles.badgeNeutral;
  const trendLabel = (bias: MacroTrendBias) =>
    bias === 'bullish' ? 'Bullish' : bias === 'bearish' ? 'Bearish' : 'Neutral';
  const surpriseBadgeClass = (surpriseState: SurpriseState) =>
    surpriseState === 'bullish' ? styles.badgeBuy : surpriseState === 'bearish' ? styles.badgeDanger : styles.badgeNeutral;

  const loadAutoRecommendations = async () => {
    setLoadingAuto(true);
    setAutoError('');
    try {
      const [calendar, trendSnapshot] = await Promise.all([
        fetchMacroCalendar(),
        fetchMacroTrendSnapshot(),
      ]);
      const normalized = normalizeMacroCalendar(calendar.events);
      const chartEntries = await Promise.all(
        (Object.entries(FOREX_PAIR_TICKERS) as Array<[MacroPair, string]>).map(async ([macroPair, ticker]) => {
          const chart = await fetchChartData(ticker, '1h', '5d');
          return [macroPair, chart] as const;
        })
      );

      const charts = Object.fromEntries(chartEntries) as Partial<Record<MacroPair, OHLCV | null>>;
      setAutoRecommendations(buildAutoRecommendations(normalized, charts));
      setUpcomingWatchlist(buildUpcomingWatchlist(normalized));
      setMacroTrends(trendSnapshot.trends);
      setRecentMacroTape(buildRecentMacroTape(normalized));
      setLastUpdated(new Date().toLocaleString('vi-VN'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không load được dữ liệu macro.';
      setAutoRecommendations([]);
      setUpcomingWatchlist([]);
      setMacroTrends([]);
      setRecentMacroTape([]);
      setAutoError(message);
    } finally {
      setLoadingAuto(false);
    }
  };

  useEffect(() => {
    void loadAutoRecommendations();
  }, []);

  const formatEventTime = (isoTime: string) =>
    new Date(isoTime).toLocaleString('vi-VN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <motion.div
      className={styles.glassPanel}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className={styles.strategyHeader}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Macro Forex Strategy Engine</h2>
          <p className={styles.strategyIntro}>
            Khung H1 theo research, giờ có thêm lớp macro context để nhìn bias của từng đồng trước khi quyết định trade ngắn hạn.
          </p>
        </div>
        <div className={styles.strategyRuleBox}>
          <div className={styles.strategyRuleLabel}>Free auto mode</div>
          <div className={styles.strategyRuleText}>
            Vừa đọc setup mới ra tin, vừa xem macro regime vài tuần gần đây để tránh trade ngược bối cảnh lớn.
          </div>
        </div>
      </div>

      <div className={styles.strategyToolbar}>
        <div className={styles.strategyKeyRow}>
          <button className={styles.strategyButton} onClick={() => void loadAutoRecommendations()} disabled={loadingAuto}>
            {loadingAuto ? 'Đang đồng bộ...' : 'Đồng bộ free sources'}
          </button>
          <button className={styles.strategyButtonSecondary} onClick={() => void loadAutoRecommendations()} disabled={loadingAuto}>
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
        <div className={styles.strategyToolbarMeta}>
          {lastUpdated ? `Cập nhật: ${lastUpdated}` : 'Chưa có dữ liệu đồng bộ.'}
        </div>
      </div>

      {loadingAuto ? (
        <div className={styles.strategyLoading}>
          <Activity className="animate-spin" style={{ width: 24, height: 24, color: 'var(--accent)' }} />
          <span>Đang tải calendar miễn phí, actual vĩ mô và tính khuyến nghị...</span>
        </div>
      ) : autoError ? (
        <div className={styles.strategyErrorBox}>
          <strong>Free auto mode đang gặp lỗi nguồn dữ liệu.</strong>
          <p>{autoError}</p>
        </div>
      ) : (
        <>
          <div className={styles.strategySection}>
            <div className={styles.strategySectionHeader}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>Macro context</h3>
              <span className={styles.strategySectionNote}>Bias nền của từng đồng để bạn biết đang trade thuận hay nghịch bối cảnh vĩ mô.</span>
            </div>
            {macroTrends.length === 0 ? (
              <div className={styles.strategyEmpty}>Chưa dựng được macro regime cards từ nguồn free.</div>
            ) : (
              <div className={styles.strategyCards}>
                {macroTrends.map((trend) => (
                  <div key={trend.currency} className={styles.strategyCard}>
                    <div className={styles.strategyCardTop}>
                      <span className={clsx(styles.badge, trendBadgeClass(trend.bias))}>{trend.currency}</span>
                      <span className={clsx(styles.badge, trendBadgeClass(trend.bias))}>{trendLabel(trend.bias)}</span>
                    </div>
                    <strong className={styles.strategyCardTitle}>{trend.headline}</strong>
                    <p className={styles.strategyCardBody}>Score: <strong>{trend.score > 0 ? `+${trend.score}` : trend.score}</strong></p>
                    <p className={styles.strategyCardBody}>{trend.signals[0]}</p>
                    <p className={styles.strategyCardBody}>{trend.signals[1] ?? 'Đang đợi thêm xác nhận từ dữ liệu mới.'}</p>
                    <div className={styles.strategyCardMeta}>Updated: {trend.updated || 'N/A'}</div>
                    {trend.sourceUrls[0] ? (
                      <a className={styles.strategySourceLink} href={trend.sourceUrls[0]} target="_blank" rel="noopener noreferrer">
                        Data source
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.strategySection}>
            <div className={styles.strategySectionHeader}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>Recent macro tape</h3>
              <span className={styles.strategySectionNote}>Các tin đã ra gần đây để đọc flow hiện tại trước khi bạn nhảy vào trade tiếp theo.</span>
            </div>
            {recentMacroTape.length === 0 ? (
              <div className={styles.strategyEmpty}>Chưa có tape đã phát hành trong cửa sổ dữ liệu hiện tại.</div>
            ) : (
              <div className={styles.strategyCards}>
                {recentMacroTape.map((item) => (
                  <div key={item.id} className={styles.strategyCard}>
                    <div className={styles.strategyCardTop}>
                      <span className={clsx(styles.badge, item.tier === 'S' ? styles.badgeBuy : item.tier === 'A' ? styles.badgeWarn : styles.badgeNeutral)}>
                        Tier {item.tier}
                      </span>
                      <span className={clsx(styles.badge, surpriseBadgeClass(item.surprise))}>
                        {item.surprise === 'bullish' ? `${item.currency}+` : item.surprise === 'bearish' ? `${item.currency}-` : 'Mixed'}
                      </span>
                    </div>
                    <strong className={styles.strategyCardTitle}>{item.eventTitle}</strong>
                    <p className={styles.strategyCardBody}>
                      Actual: <strong>{item.actualText || 'N/A'}</strong>
                      {' · '}
                      Forecast: <strong>{item.forecastText || 'N/A'}</strong>
                    </p>
                    <p className={styles.strategyCardBody}>{item.surpriseNote}</p>
                    <p className={styles.strategyCardBody}>Pairs liên quan: {item.pairs.join(', ')}</p>
                    <div className={styles.strategyCardMeta}>{formatEventTime(item.eventTime)}</div>
                    {item.sourceUrl ? (
                      <a className={styles.strategySourceLink} href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
                        Event source
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.strategySection}>
            <div className={styles.strategySectionHeader}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>Khuyến nghị tự động hiện tại</h3>
              <span className={styles.strategySectionNote}>Hệ thống chọn setup tốt nhất cho từng cặp từ các tin lớn mới ra.</span>
            </div>
            {autoRecommendations.length === 0 ? (
              <div className={styles.strategyEmpty}>Chưa có setup đủ mạnh sau khi lọc theo research. Theo dõi watchlist bên dưới.</div>
            ) : (
              <div className={styles.strategyCards}>
                {autoRecommendations.map((recommendation) => {
                  const meta = STATUS_COPY[recommendation.status];
                  return (
                    <div key={`${recommendation.pair}-${recommendation.eventTitle}`} className={styles.strategyCard}>
                      <div className={styles.strategyCardTop}>
                        <span className={clsx(styles.badge, meta.className)}>{meta.label}</span>
                        <span className={styles.strategyConfidence}>{recommendation.confidence}/100</span>
                      </div>
                      <strong className={styles.strategyCardTitle}>{recommendation.pair}</strong>
                      <div className={styles.strategyAutoHeadline}>{recommendation.direction}</div>
                      <p className={styles.strategyCardBody}>{recommendation.eventTitle}</p>
                      <p className={styles.strategyCardBody}>
                        Actual: <strong>{recommendation.actualText || 'N/A'}</strong>
                        {' · '}
                        Forecast: <strong>{recommendation.forecastText || 'N/A'}</strong>
                      </p>
                      <p className={styles.strategyCardBody}>
                        Size: <strong>{recommendation.positionSize}</strong>
                        {' · '}
                        Window: <strong>{recommendation.entryWindow}</strong>
                      </p>
                      <p className={styles.strategyCardBody}>{recommendation.reasons.slice(0, 2).join(' ')}</p>
                      <div className={styles.strategyCardMeta}>{formatEventTime(recommendation.eventTime)}</div>
                      {recommendation.sourceUrl ? (
                        <a className={styles.strategySourceLink} href={recommendation.sourceUrl} target="_blank" rel="noopener noreferrer">
                          Official source
                        </a>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className={styles.strategySection}>
            <div className={styles.strategySectionHeader}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>Watchlist sắp tới</h3>
              <span className={styles.strategySectionNote}>Các event lớn trong 24 giờ tới để chuẩn bị trước, chưa có actual nên chưa khuyến nghị hướng.</span>
            </div>
            {upcomingWatchlist.length === 0 ? (
              <div className={styles.strategyEmpty}>Không có event tier S/A nào trong 24 giờ tới.</div>
            ) : (
              <div className={styles.strategyCards}>
                {upcomingWatchlist.map((item) => (
                  <div key={item.id} className={styles.strategyCard}>
                    <div className={styles.strategyCardTop}>
                      <span className={clsx(
                        styles.badge,
                        item.tier === 'S' ? styles.badgeBuy : item.tier === 'A' ? styles.badgeWarn : styles.badgeNeutral
                      )}>
                        Tier {item.tier}
                      </span>
                      <span className={styles.strategyCardCurrency}>{item.currency}</span>
                    </div>
                    <strong className={styles.strategyCardTitle}>{item.eventTitle}</strong>
                    <p className={styles.strategyCardBody}>Pairs: {item.pairs.join(', ')}</p>
                    <div className={styles.strategyCardMeta}>{formatEventTime(item.eventTime)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className={styles.strategyBuilderHeader}>
        <button className={styles.strategyButtonSecondary} onClick={() => setShowScenarioBuilder((current) => !current)}>
          {showScenarioBuilder ? 'Ẩn scenario builder' : 'Mở scenario builder'}
        </button>
        <span className={styles.strategySectionNote}>Dùng khi bạn muốn test tay một kịch bản cụ thể.</span>
      </div>

      {showScenarioBuilder ? (
        <div className={styles.strategyGrid}>
          <div className={styles.strategyForm}>
            <div className={styles.controlGrid}>
              <div className={styles.controlGroup}>
                <label>Pair</label>
                <select value={pair} onChange={(event) => setPair(event.target.value as MacroPair)}>
                  {PAIR_PLAYBOOKS.map((playbook) => (
                    <option key={playbook.pair} value={playbook.pair}>
                      {playbook.pair}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.controlGroup}>
                <label>Event</label>
                <select value={eventId} onChange={(event) => setEventId(event.target.value)}>
                  {MACRO_EVENTS.map((macroEvent) => (
                    <option key={macroEvent.id} value={macroEvent.id}>
                      {macroEvent.tier} · {macroEvent.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.controlGroup}>
                <label>Surprise</label>
                <select value={surprise} onChange={(event) => setSurprise(event.target.value as SurpriseState)}>
                  <option value="bullish">Bullish cho đồng tiền sự kiện</option>
                  <option value="bearish">Bearish cho đồng tiền sự kiện</option>
                  <option value="none">Không có surprise rõ</option>
                </select>
              </div>

              <div className={styles.controlGroup}>
                <label>H1 confirmation</label>
                <select value={confirmation} onChange={(event) => setConfirmation(event.target.value as ConfirmationState)}>
                  <option value="strong">Đóng mạnh ngoài range</option>
                  <option value="weak">Đúng hướng nhưng nến chưa đẹp</option>
                  <option value="none">Vẫn còn trong pre-event range</option>
                </select>
              </div>

              <div className={styles.controlGroup}>
                <label>Event overlap</label>
                <select value={overlap} onChange={(event) => setOverlap(event.target.value as OverlapState)}>
                  <option value="none">Không có trong 2-3h tới</option>
                  <option value="tier_a">Có tier A gần đó</option>
                  <option value="tier_s">Có tier S gần đó</option>
                </select>
              </div>

              <div className={styles.controlGroup}>
                <label>Spread / liquidity</label>
                <select value={spread} onChange={(event) => setSpread(event.target.value as SpreadState)}>
                  <option value="normal">Bình thường</option>
                  <option value="wide">Bất thường / spread rộng</option>
                </select>
              </div>
            </div>

            <label className={styles.strategyToggle}>
              <input type="checkbox" checked={preMove} onChange={(event) => setPreMove(event.target.checked)} />
              Giá đã chạy trước thời điểm công bố
            </label>
          </div>

          <div className={styles.strategyOutput}>
            <div className={styles.strategyOutputTop}>
              <span className={clsx(styles.badge, statusMeta.className)}>{statusMeta.label}</span>
              <span className={styles.strategyConfidence}>{result.confidence}/100</span>
            </div>

            <div className={styles.strategyHeadline}>{result.direction}</div>
            <div className={styles.strategySummary}>{statusMeta.summary}</div>
            <div className={styles.strategyBias}>{result.bias}</div>

            <div className={styles.strategyMetrics}>
              <div className={styles.strategyMetricCard}>
                <span className={styles.strategyMetricLabel}>Setup</span>
                <strong>{result.event.setup}</strong>
              </div>
              <div className={styles.strategyMetricCard}>
                <span className={styles.strategyMetricLabel}>Entry window</span>
                <strong>{result.entryWindow}</strong>
              </div>
              <div className={styles.strategyMetricCard}>
                <span className={styles.strategyMetricLabel}>Size</span>
                <strong>{result.positionSize}</strong>
              </div>
              <div className={styles.strategyMetricCard}>
                <span className={styles.strategyMetricLabel}>Tier</span>
                <strong>{result.event.tier}</strong>
              </div>
            </div>

            <div className={styles.strategyExecutionBox}>
              <div>
                <span className={styles.strategyMetricLabel}>Stop</span>
                <p>{result.stopRule}</p>
              </div>
              <div>
                <span className={styles.strategyMetricLabel}>Targets</span>
                <p>{result.targetRule}</p>
              </div>
            </div>

            <ul className={styles.strategyReasons}>
              {result.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className={styles.strategyFootnote}>
        Module này giả định bạn đã có `actual vs consensus`, đã quan sát `H1-1`, và đang dùng nó như decision framework chứ chưa phải auto-trading engine.
      </div>

      <div className={styles.strategySection}>
        <div className={styles.strategySectionHeader}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Bản đồ tier sự kiện</h3>
          <span className={styles.strategySectionNote}>Chỉ tier S/A mới nên kích hoạt playbook H1.</span>
          </div>
        <div className={styles.strategyCards}>
          {MACRO_EVENTS.map((macroEvent) => (
            <div key={macroEvent.id} className={styles.strategyCard}>
              <div className={styles.strategyCardTop}>
                <span className={clsx(
                  styles.badge,
                  macroEvent.tier === 'S' ? styles.badgeBuy : macroEvent.tier === 'A' ? styles.badgeWarn : styles.badgeNeutral
                )}>
                  Tier {macroEvent.tier}
                </span>
                <span className={styles.strategyCardCurrency}>{macroEvent.currency}</span>
              </div>
              <strong className={styles.strategyCardTitle}>{macroEvent.title}</strong>
              <p className={styles.strategyCardBody}>{macroEvent.thesis}</p>
              <div className={styles.strategyCardMeta}>{macroEvent.entryWindow}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.strategySection}>
        <div className={styles.strategySectionHeader}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Hard filters</h3>
          <span className={styles.strategySectionNote}>Một trong các điều kiện này xảy ra thì ưu tiên bỏ lệnh.</span>
        </div>
        <div className={styles.strategyCards}>
          {[
            'Không có surprise rõ so với consensus.',
            'H1-1 vẫn nằm trong pre-event range.',
            'Spread bất thường hoặc thanh khoản mỏng.',
            'Có một event tier S khác chồng trong 2-3 giờ tới.',
          ].map((item) => (
            <div key={item} className={styles.strategyCard}>
              <span className={clsx(styles.badge, styles.badgeDanger)}>SKIP</span>
              <p className={styles.strategyCardBody} style={{ marginTop: '0.85rem' }}>{item}</p>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.strategySection}>
        <div className={styles.strategySectionHeader}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Pair playbooks</h3>
          <span className={styles.strategySectionNote}>Bắt đầu từ 4 cặp sạch nhất theo research.</span>
        </div>
        <div className={styles.strategyCards}>
          {PAIR_PLAYBOOKS.map((playbook) => (
            <div key={playbook.pair} className={styles.strategyCard}>
              <strong className={styles.strategyCardTitle}>{playbook.pair}</strong>
              <p className={styles.strategyCardBody}><strong>Drivers:</strong> {playbook.drivers}</p>
              <p className={styles.strategyCardBody}><strong>Best events:</strong> {playbook.preferredEvents}</p>
              <p className={styles.strategyCardBody}><strong>Dùng khi:</strong> {playbook.bestUse}</p>
              <p className={styles.strategyCardBody}><strong>Tránh khi:</strong> {playbook.avoidWhen}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
