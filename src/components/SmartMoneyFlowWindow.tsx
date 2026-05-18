import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import styles from '../App.module.css';

import { buildSmartMoneyWindow, type AssetClass } from '../lib/smartMoney';

const WINDOW_SET = [7, 30, 90] as const;
const BASELINE_BY_WINDOW: Record<(typeof WINDOW_SET)[number], number> = {
  7: 180,
  30: 365,
  90: 365,
};
const AUTO_REFRESH_MS = 24 * 60 * 60 * 1000;

const ASSET_ORDER: { ac: AssetClass; label: string }[] = [
  { ac: 'Crypto', label: 'Crypto' },
  { ac: 'Stocks', label: 'Cổ phiếu' },
  { ac: 'Forex', label: 'Forex (FX)' },
  { ac: 'Commodities', label: 'Commodities' },
  { ac: 'Futures', label: 'Futures' },
  { ac: 'Agriculture', label: 'Nông sản' },
];

const BUCKET_ORDER: { key: string; label: string }[] = [
  { key: 'Tổng hợp', label: 'Tổng' },
  { key: 'Dòng tiền', label: 'Flow' },
  { key: 'Thanh khoản', label: 'Thanh khoản' },
  { key: 'Vị thế', label: 'Vị thế' },
  { key: 'Phái sinh', label: 'Phái sinh' },
  { key: 'Options', label: 'Options' },
  { key: 'On-chain', label: 'On-chain' },
  { key: 'Vật chất', label: 'Vật chất' },
  { key: 'Vĩ mô', label: 'Vĩ mô' },
  { key: 'Tâm lý', label: 'Tâm lý' },
];

function toneClass(pct: number) {
  if (pct >= 20) return styles.flowBull;
  if (pct <= -20) return styles.flowBear;
  return styles.flowNeutral;
}

function biasVi(scorePct: number) {
  if (scorePct >= 25) return 'Tích lũy';
  if (scorePct <= -25) return 'Phân phối';
  return 'Trung lập';
}

function tooltipVi(scorePct: number) {
  if (scorePct >= 25) return 'Khuyến nghị: thiên về BUY/Long. Ưu tiên canh mua pullback, tránh FOMO khi quá nóng.';
  if (scorePct <= -25) return 'Khuyến nghị: thiên về SELL/Short. Ưu tiên giảm rủi ro, chờ xác nhận đảo chiều.';
  return 'Khuyến nghị: TRUNG LẬP/WAIT. Ưu tiên quản trị vị thế, chờ tín hiệu rõ hơn.';
}

export default function SmartMoneyFlowWindow({ isActive }: { isActive: boolean }) {
  const [asOf, setAsOf] = useState(() => Date.now());
  const [activeWindow, setActiveWindow] = useState<(typeof WINDOW_SET)[number]>(30);

  useEffect(() => {
    if (!isActive) return;
    const id = window.setInterval(() => setAsOf(Date.now()), AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [isActive]);

  const results = useMemo(() => {
    if (!isActive) return null;
    const out = ASSET_ORDER.map(({ ac, label }) => {
      const byWindow = Object.fromEntries(
        WINDOW_SET.map((w) => [
          w,
          buildSmartMoneyWindow({
            assetClass: ac,
            windowDays: w,
            baselineDays: BASELINE_BY_WINDOW[w],
            asOf,
          }),
        ])
      ) as Record<(typeof WINDOW_SET)[number], ReturnType<typeof buildSmartMoneyWindow>>;
      return { ac, label, byWindow };
    });
    return out;
  }, [isActive, asOf]);

  if (!isActive) return null;
  if (!results) return null;

  return (
    <motion.div className={styles.flowAutoRoot} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className={clsx(styles.glassPanel, styles.flowAutoHeader)}>
        <div className={styles.flowAutoHeaderRow}>
          <div>
            <div className={styles.flowAutoTitle}>Smart Money Flow (Auto)</div>
            <div className={styles.flowAutoSub}>
              Fetch/compute tất cả thị trường 1 lần · Multi-window {WINDOW_SET.join('/')}D · Refresh mỗi ngày
            </div>
          </div>
          <div className={styles.flowAutoTime}>
            {new Date(asOf).toLocaleString('vi-VN')}
          </div>
        </div>

        <div className={styles.flowAutoWindowRow}>
          <div className={styles.flowAutoWindowLabel}>Khung quan sát:</div>
          <div className={styles.flowAutoWindowBtns}>
            {WINDOW_SET.map((w) => (
              <button
                key={w}
                type="button"
                className={clsx(styles.flowAutoWindowBtn, activeWindow === w && styles.flowAutoWindowBtnActive)}
                onClick={() => setActiveWindow(w)}
                title={`Dùng window ${w}D để hiển thị bucket + top tín hiệu`}
              >
                {w}D
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.flowAutoGrid}>
        {results.map(({ ac, label, byWindow }) => {
          const res = byWindow[activeWindow];
          const pct = res.scorePct;
          const bias = biasVi(pct);
          const coverage = res.snapshots.filter(s => s.hasHistory).length;
          return (
            <div key={ac} className={clsx(styles.glassPanel, styles.flowAutoPanel)} title={tooltipVi(pct)}>
              <div className={styles.flowAutoPanelTop}>
                <div className={styles.flowAutoMarket}>{label}</div>
                <div className={clsx(styles.flowBiasPill, toneClass(pct))}>{bias}</div>
              </div>

              <div className={styles.flowAutoScoreRow}>
                <div className={styles.flowAutoScorePct}>{pct.toFixed(0)}%</div>
                <div className={styles.flowAutoScoreMeta}>
                  {activeWindow}D · z={res.scoreZ.toFixed(2)} · dữ liệu {coverage}/{res.snapshots.length}
                </div>
              </div>

              <div className={styles.flowAutoMiniRow}>
                {WINDOW_SET.map((w) => {
                  const r = byWindow[w];
                  return (
                    <div key={w} className={clsx(styles.flowAutoMiniCard, toneClass(r.scorePct))} title={tooltipVi(r.scorePct)}>
                      <div className={styles.flowAutoMiniLabel}>{w}D</div>
                      <div className={styles.flowAutoMiniVal}>{r.scorePct.toFixed(0)}%</div>
                    </div>
                  );
                })}
              </div>

              <div className={styles.flowAutoBuckets}>
                {BUCKET_ORDER.map((b) => {
                  const s = res.bucketScores[b.key as keyof typeof res.bucketScores];
                  if (!s) return null;
                  return (
                    <div
                      key={b.key}
                      className={clsx(styles.flowAutoBucketCard, toneClass(s.pct))}
                      title={`${b.label}: ${s.pct.toFixed(0)}% (z=${s.z.toFixed(2)}) · coverage ${s.coverage}/${s.total}`}
                    >
                      <div className={styles.flowAutoBucketName}>{b.label}</div>
                      <div className={styles.flowAutoBucketVal}>{s.pct.toFixed(0)}%</div>
                    </div>
                  );
                })}
              </div>

              <div className={styles.flowAutoTop10}>
                <div className={styles.flowAutoTop10Title}>Top tín hiệu (|signed z|)</div>
                <div className={styles.flowAutoTop10List}>
                  {res.snapshots
                    .filter(s => s.metric.direction !== 'neutral' && s.hasHistory)
                    .sort((a, b) => Math.abs(b.signedZ) - Math.abs(a.signedZ))
                    .slice(0, 10)
                    .map((s) => (
                      <div key={s.metric.id} className={styles.flowAutoTop10Row} title={s.metric.caveatVi ?? ''}>
                        <div className={styles.flowAutoTop10Name}>{s.metric.nameVi}</div>
                        <div className={clsx(styles.flowAutoTop10Z, s.signedZ >= 0 ? styles.flowBull : styles.flowBear)}>
                          {s.signedZ.toFixed(2)}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
