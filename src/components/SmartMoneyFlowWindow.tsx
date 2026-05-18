import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import styles from '../App.module.css';

import {
  buildSmartMoneyWindow,
  formatMetricValue,
  type AssetClass,
  type MetricSnapshot,
} from '../lib/smartMoney';

const ASSET_CLASSES: { value: AssetClass; label: string }[] = [
  { value: 'Crypto', label: 'Crypto' },
  { value: 'Stocks', label: 'Cổ phiếu' },
  { value: 'Forex', label: 'Ngoại hối (FX)' },
  { value: 'Commodities', label: 'Hàng hoá' },
  { value: 'Agriculture', label: 'Nông sản' },
  { value: 'Futures', label: 'Phái sinh (Futures)' },
];
const WINDOW_PRESETS: { label: string; days: number }[] = [
  { label: '1D', days: 1 },
  { label: '7D', days: 7 },
  { label: '14D', days: 14 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
];

function Sparkline({ values }: { values: number[] }) {
  const { d } = useMemo(() => {
    const clean = values.filter(v => Number.isFinite(v));
    if (clean.length < 2) return { d: '' };

    const w = 120;
    const h = 28;
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const span = max - min || 1;

    const pts = clean.map((v, i) => {
      const x = (i / (clean.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return [x, y] as const;
    });

    const d = pts
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
      .join(' ');
    return { d };
  }, [values]);

  return (
    <svg width="120" height="28" viewBox="0 0 120 28" className={styles.flowSpark}>
      {d ? <path d={d} fill="none" stroke="currentColor" strokeWidth="1.7" /> : null}
    </svg>
  );
}

function signalFromZ(signedZ: number) {
  if (signedZ >= 0.6) return { label: 'Tăng', cls: styles.flowBull };
  if (signedZ <= -0.6) return { label: 'Giảm', cls: styles.flowBear };
  return { label: 'Trung lập', cls: styles.flowNeutral };
}

function sortSnapshots(a: MetricSnapshot, b: MetricSnapshot) {
  const ai = (a.metric.direction === 'neutral' ? 0 : 1) * (a.metric.defaultWeight || 0);
  const bi = (b.metric.direction === 'neutral' ? 0 : 1) * (b.metric.defaultWeight || 0);
  if (bi !== ai) return bi - ai;
  return Math.abs(b.signedZ) - Math.abs(a.signedZ);
}

function categoryVi(cat: string) {
  switch (cat) {
    case 'Demand': return 'Cầu';
    case 'Supply': return 'Cung';
    case 'Liquidity': return 'Thanh khoản';
    case 'Positioning': return 'Vị thế';
    case 'Exchange': return 'Sàn';
    case 'On-chain': return 'On-chain';
    case 'Derivatives': return 'Phái sinh';
    case 'Options': return 'Options';
    case 'Volatility': return 'Biến động';
    case 'Macro': return 'Vĩ mô';
    case 'Physical': return 'Vật chất';
    case 'Seasonality': return 'Mùa vụ';
    case 'Breadth': return 'Độ rộng';
    case 'Sentiment': return 'Tâm lý';
    default: return cat;
  }
}

function cadenceVi(c: string) {
  switch (c) {
    case 'realtime': return 'Realtime';
    case 'daily': return 'Ngày';
    case 'weekly': return 'Tuần';
    case 'monthly': return 'Tháng';
    case 'quarterly': return 'Quý';
    default: return c;
  }
}

export default function SmartMoneyFlowWindow({ isActive }: { isActive: boolean }) {
  const [assetClass, setAssetClass] = useState<AssetClass>('Crypto');
  const [windowDays, setWindowDays] = useState<number>(7);
  const [baselineDays, setBaselineDays] = useState<number>(180);
  const [asOf, setAsOf] = useState<number>(() => Date.now());
  const [bucketFilter, setBucketFilter] = useState<string>('Tất cả');
  const [query, setQuery] = useState<string>('');
  const [showDetails, setShowDetails] = useState<boolean>(false);

  useEffect(() => {
    if (!isActive) return;
    const id = window.setInterval(() => setAsOf(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [isActive]);

  const result = useMemo(() => {
    if (!isActive) return null;
    return buildSmartMoneyWindow({ assetClass, windowDays, baselineDays, asOf });
  }, [assetClass, windowDays, baselineDays, asOf, isActive]);

  if (!isActive) return null;
  if (!result) return null;

  const scoreTone =
    result.biasLabel === 'Accumulation' ? styles.flowBull :
    result.biasLabel === 'Distribution' ? styles.flowBear :
    styles.flowNeutral;

  const scoreBar = Math.round((result.scorePct + 100) / 2); // 0..100

  const snapshots = [...result.snapshots].sort(sortSnapshots);
  const coverage = snapshots.filter(s => s.hasHistory).length;

  const biasLabelVi =
    result.biasLabel === 'Accumulation' ? 'Tích lũy' :
    result.biasLabel === 'Distribution' ? 'Phân phối' :
    'Trung lập';

  const buckets = Object.keys(result.bucketScores).filter(b => b !== 'Tổng hợp');

  const filteredSnapshots = snapshots.filter((s) => {
    if (bucketFilter !== 'Tất cả' && s.metric.bucket !== bucketFilter) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const hay = `${s.metric.nameVi} ${s.metric.name} ${s.metric.meaningVi} ${s.metric.meaning} ${s.metric.category} ${s.metric.bucket}`.toLowerCase();
    return hay.includes(q);
  });

  return (
    <motion.div className={styles.flowStack} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className={styles.flowDashboard}>
        <div className={clsx(styles.glassPanel, styles.flowLeft)}>
            <div className={styles.controlGrid}>
            <div className={styles.controlGroup}>
              <label>Loại tài sản</label>
              <select value={assetClass} onChange={e => setAssetClass(e.target.value as AssetClass)}>
                {ASSET_CLASSES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>

            <div className={styles.controlGroup}>
              <label>Cửa sổ dòng tiền</label>
              <select value={windowDays} onChange={e => setWindowDays(Number(e.target.value))}>
                {WINDOW_PRESETS.map(w => <option key={w.days} value={w.days}>{w.label}</option>)}
              </select>
            </div>

            <div className={styles.controlGroup}>
              <label>Baseline (ngày)</label>
              <input
                type="number"
                min={60}
                max={365}
                value={baselineDays}
                onChange={e => setBaselineDays(Number(e.target.value))}
                title="Dùng để tính z-score (chuẩn hoá theo lịch sử). Ví dụ: baseline 180 ngày."
              />
            </div>
            </div>

          <div className={styles.flowSummary}>
            <div className={styles.flowScoreRow}>
              <div>
                <div className={styles.flowScoreTitle}>Điểm Dòng Tiền Thông Minh</div>
                <div className={styles.flowScoreMeta}>
                  Window: <span className={styles.flowMono}>{result.windowDays}D</span> · Baseline:{' '}
                  <span className={styles.flowMono}>{result.baselineDays}D</span> · Đủ dữ liệu:{' '}
                  <span className={styles.flowMono}>{coverage}/{snapshots.length}</span>
                </div>
              </div>

              <div className={clsx(styles.flowBiasPill, scoreTone)}>
                {biasLabelVi}
              </div>
            </div>

            <div className={styles.flowScoreValue}>
              <span className={styles.flowScorePct}>{result.scorePct.toFixed(0)}%</span>
              <span className={styles.flowScoreZ}>z={result.scoreZ.toFixed(2)}</span>
            </div>

            <div className={styles.flowBar}>
              <div className={styles.flowBarTrack} />
              <div className={styles.flowBarFill} style={{ width: `${scoreBar}%` }} />
              <div className={styles.flowBarMid} />
            </div>

            <div className={styles.flowHint}>
              Điểm = trung bình có trọng số của z-score (đã gắn dấu theo “bullish/bearish_when_high”). Dương → thiên về tích lũy; âm → thiên về phân phối. (Hiện đang dùng mock data.)
            </div>

            <div className={styles.flowBuckets}>
              <div className={styles.flowBucketsTitle}>Điểm theo nhóm tín hiệu</div>
              <div className={styles.flowBucketGrid}>
                {buckets.map((b) => {
                  const s = result.bucketScores[b as keyof typeof result.bucketScores];
                  const tone = s.z >= 0.6 ? styles.flowBull : s.z <= -0.6 ? styles.flowBear : styles.flowNeutral;
                  return (
                    <div key={b} className={clsx(styles.flowBucketCard, tone)} title={`Coverage: ${s.coverage}/${s.total} · z=${s.z.toFixed(2)}`}>
                      <div className={styles.flowBucketName}>{b}</div>
                      <div className={styles.flowBucketVal}>{s.pct.toFixed(0)}%</div>
                      <div className={styles.flowBucketMeta}>{s.coverage}/{s.total}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className={clsx(styles.glassPanel, styles.flowRight)}>
          <div className={styles.flowTopControls}>
            <div className={styles.flowTopLeft}>
              <div className={styles.flowControlInline}>
                <label>Lọc theo nhóm</label>
                <select value={bucketFilter} onChange={(e) => setBucketFilter(e.target.value)}>
                  <option value="Tất cả">Tất cả</option>
                  {buckets.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div className={styles.flowControlInline}>
                <label>Tìm kiếm</label>
                <input
                  type="text"
                  placeholder="VD: stablecoin, COT, tồn kho..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>

            <button
              type="button"
              className={styles.flowDetailsBtn}
              onClick={() => setShowDetails(v => !v)}
              title="Bật để xem thêm category, cadence và lưu ý"
            >
              {showDetails ? 'Ẩn chi tiết' : 'Hiện chi tiết'}
            </button>
          </div>

          <div className={styles.flowTableHeader}>
            <div className={styles.flowThMetric}>Chỉ số</div>
            <div className={styles.flowThMeaning}>Ý nghĩa</div>
            <div className={styles.flowThValue}>Giá trị</div>
            <div className={styles.flowThZ}>Z</div>
            <div className={styles.flowThSignal}>Tín hiệu</div>
            <div className={styles.flowThSpark}>Xu hướng</div>
          </div>

          <div className={styles.flowRows}>
            {filteredSnapshots.map((s) => {
              const sig = signalFromZ(s.signedZ);
              const zText = s.hasHistory ? s.z.toFixed(2) : '—';
              const directionVi =
                s.metric.direction === 'bullish_when_high' ? 'cao → tích cực' :
                s.metric.direction === 'bearish_when_high' ? 'cao → tiêu cực' :
                'trung tính';
              return (
                <div key={s.metric.id} className={styles.flowRow}>
                  <div className={styles.flowTdMetric}>
                    <div className={styles.flowMetricName}>{s.metric.nameVi}</div>
                    <div className={styles.flowMetricSub}>
                      w={s.metric.defaultWeight.toFixed(2)} · {directionVi}
                    </div>
                    {showDetails && (
                      <div className={styles.flowMetricMeta}>
                        <span className={styles.flowTag}>{categoryVi(s.metric.category)}</span>
                        <span className={styles.flowTag}>{s.metric.bucket}</span>
                        <span className={styles.flowTag}>{cadenceVi(s.metric.cadence)}</span>
                      </div>
                    )}
                  </div>
                  <div className={styles.flowTdMeaning}>
                    {s.metric.meaningVi}
                    {showDetails && s.metric.caveatVi && (
                      <div className={styles.flowCaveat}>{s.metric.caveatVi}</div>
                    )}
                  </div>
                  <div className={styles.flowTdValue}>{formatMetricValue(s.windowValue, s.metric.unit)}</div>
                  <div className={styles.flowTdZ}>{zText}</div>
                  <div className={styles.flowTdSignal}>
                    <span className={clsx(styles.flowSignalPill, sig.cls)}>{sig.label}</span>
                  </div>
                  <div className={styles.flowTdSpark}>
                    <Sparkline values={s.spark} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
