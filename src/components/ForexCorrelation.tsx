import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { FOREX_PAIRS, getCorrelation } from '../lib/correlations';
import type { CorrData, CorrType } from '../lib/correlations';
import styles from '../App.module.css';

function getCellStyle(type: CorrType): string {
  switch (type) {
    case 'strong_pos': return styles.corrCellStrongPos;
    case 'pos':        return styles.corrCellPos;
    case 'strong_neg': return styles.corrCellStrongNeg;
    case 'neg':        return styles.corrCellNeg;
    case 'cross':      return styles.corrCellCross;
    default:           return styles.corrCellNeutral;
  }
}

interface DetailPanelProps {
  pair1: string;
  pair2: string;
  data: CorrData;
  onClose: () => void;
}

function DetailPanel({ pair1, pair2, data, onClose }: DetailPanelProps) {
  const isPos = data.value > 0;
  const color = data.type === 'cross' ? '#8b5cf6' : isPos ? '#10b981' : '#ef4444';
  const dirLabel = data.type === 'cross' ? '⇄ Mean Revert'
    : Math.abs(data.value) > 0.8 ? (isPos ? '↑↑ Mạnh Cùng Chiều' : '↓↓ Mạnh Nghịch Chiều')
    : (isPos ? '↑ Cùng Chiều' : '↓ Nghịch Chiều');

  return (
    <motion.div
      className={styles.corrDetailPanel}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
    >
      <button className={styles.corrDetailClose} onClick={onClose}><X size={16} /></button>
      <div className={styles.corrDetailHeader}>
        <span className={styles.corrPair} style={{ fontSize: '1.3rem' }}>{pair1}</span>
        <span style={{ color, fontSize: '1.5rem', fontWeight: 700, margin: '0 0.5rem' }}>
          {isPos ? '≈' : '↔'}
        </span>
        <span className={styles.corrPair} style={{ fontSize: '1.3rem' }}>{pair2}</span>
      </div>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', margin: '1rem 0' }}>
        <div className={styles.corrDetailStat}>
          <span className={styles.statLabel}>Tương quan</span>
          <span className={styles.statValue} style={{ color, fontSize: '1.5rem' }}>{data.label}</span>
        </div>
        <div className={styles.corrDetailStat}>
          <span className={styles.statLabel}>Hướng</span>
          <span className={styles.statValue} style={{ color }}>{dirLabel}</span>
        </div>
        <div className={styles.corrDetailStat}>
          <span className={styles.statLabel}>Timeframe</span>
          <span className={styles.statValue}>{data.timeframe}</span>
        </div>
        <div className={styles.corrDetailStat}>
          <span className={styles.statLabel}>Chiến lược</span>
          <span className={styles.statValue}>{data.strategy}</span>
        </div>
      </div>

      <div style={{
        background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '0.75rem 1rem',
        fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.6,
        borderLeft: `3px solid ${color}`
      }}>
        💡 {data.reason}
      </div>
    </motion.div>
  );
}

export default function ForexCorrelation() {
  const [selected, setSelected] = useState<{ pair1: string; pair2: string; data: CorrData } | null>(null);

  const handleCellClick = (pair1: string, pair2: string) => {
    if (pair1 === pair2) return;
    const data = getCorrelation(pair1, pair2);
    if (!data) return;
    if (selected?.pair1 === pair1 && selected?.pair2 === pair2) {
      setSelected(null);
    } else {
      setSelected({ pair1, pair2, data });
    }
  };

  return (
    <div className={styles.glassPanel}>
      <div style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          🔗 Forex Correlation Matrix
        </h2>
        <p style={{ margin: '0.4rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Bấm vào ô để xem chi tiết. Đỏ = Nghịch chiều · Xanh = Cùng chiều · Tím = Mean Revert
        </p>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem', fontSize: '0.8rem' }}>
        {[
          { cls: styles.corrCellStrongPos, label: 'Rất mạnh (+)' },
          { cls: styles.corrCellPos,       label: 'Cùng chiều' },
          { cls: styles.corrCellNeutral,   label: 'Trung lập' },
          { cls: styles.corrCellNeg,       label: 'Nghịch chiều' },
          { cls: styles.corrCellStrongNeg, label: 'Rất mạnh (-)' },
          { cls: styles.corrCellCross,     label: 'Mean Revert' },
        ].map(({ cls, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <div className={cls} style={{ width: 16, height: 16, borderRadius: 3, display: 'inline-block' }} />
            <span style={{ color: 'var(--text-muted)' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Matrix */}
      <div className={styles.corrMatrixWrapper}>
        <table className={styles.corrMatrix}>
          <thead>
            <tr>
              <th className={styles.corrMatrixCorner}>Y \ X</th>
              {FOREX_PAIRS.map(p => (
                <th key={p} className={styles.corrMatrixHead}>{p}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FOREX_PAIRS.map(row => (
              <tr key={row}>
                <th className={styles.corrMatrixRowHead}>{row}</th>
                {FOREX_PAIRS.map(col => {
                  if (row === col) {
                    return (
                      <td key={col} className={styles.corrCellDiag}>
                        <div className={styles.corrCellInner}>—</div>
                      </td>
                    );
                  }
                  const data = getCorrelation(row, col);
                  if (!data) {
                    return (
                      <td key={col} className={styles.corrCellEmpty}>
                        <div className={styles.corrCellInner}>·</div>
                      </td>
                    );
                  }
                  const isActive = selected?.pair1 === row && selected?.pair2 === col;
                  return (
                    <td key={col}
                      className={`${styles.corrCellClickable} ${getCellStyle(data.type)} ${isActive ? styles.corrCellActive : ''}`}
                      onClick={() => handleCellClick(row, col)}
                      title={`${row} vs ${col}: ${data.label}`}
                    >
                      <div className={styles.corrCellInner}>
                        <span className={styles.corrCellValue}>{data.label}</span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail Panel */}
      <AnimatePresence>
        {selected && (
          <DetailPanel
            pair1={selected.pair1}
            pair2={selected.pair2}
            data={selected.data}
            onClose={() => setSelected(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
