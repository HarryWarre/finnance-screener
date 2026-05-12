// Forex pairs to include in matrix
export const FOREX_PAIRS = [
  'EUR/USD', 'GBP/USD', 'AUD/USD', 'NZD/USD',
  'USD/CHF', 'USD/JPY', 'USD/CAD', 'AUD/NZD', 'EUR/GBP'
];

// Correlation lookup table: [row][col] = { value, type, timeframe, strategy, reason }
// value: -1..+1 (estimated), type: 'positive' | 'negative' | 'neutral' | 'cross'
type CorrType = 'strong_pos' | 'pos' | 'neutral' | 'neg' | 'strong_neg' | 'cross';

interface CorrData {
  value: number;
  label: string;
  type: CorrType;
  timeframe: string;
  strategy: string;
  reason: string;
}

const CORR_MAP: Record<string, Record<string, CorrData>> = {
  'EUR/USD': {
    'GBP/USD': { value: 0.90, label: '+90%', type: 'strong_pos', timeframe: 'H4, Daily', strategy: 'Trend Following', reason: 'Cùng chịu áp lực từ sức mạnh USD và kinh tế Châu Âu' },
    'AUD/USD': { value: 0.80, label: '+80%', type: 'pos', timeframe: 'Daily', strategy: 'Sentiment-based', reason: 'Cùng là đồng tiền rủi ro (Risk-on). Khi thị trường lạc quan, cả hai tăng vs USD' },
    'NZD/USD': { value: 0.72, label: '+72%', type: 'pos', timeframe: 'Daily', strategy: 'Trend Following', reason: 'Đồng tiền rủi ro, cùng đi ngược chiều sức mạnh USD' },
    'USD/CHF': { value: -0.90, label: '-90%', type: 'strong_neg', timeframe: 'H4, Daily', strategy: 'Hedging', reason: 'CHF là đồng tiền trú ẩn. Khi EUR mạnh, dòng tiền rời hầm trú ẩn Thụy Sĩ về EU' },
    'USD/JPY': { value: -0.55, label: '-55%', type: 'neg', timeframe: 'H4', strategy: 'Risk-on/off', reason: 'Cùng phản ánh khẩu vị rủi ro thị trường nhưng mức độ tương quan không ổn định' },
    'USD/CAD': { value: -0.65, label: '-65%', type: 'neg', timeframe: 'Daily', strategy: 'Trend Following', reason: 'USD mạnh → EUR/USD giảm và USD/CAD tăng (cùng chiều vs USD)' },
    'EUR/GBP': { value: 0.40, label: '+40%', type: 'neutral', timeframe: 'H4', strategy: 'Monitor', reason: 'EUR/GBP phụ thuộc vào sức mạnh tương đối EUR vs GBP, không phải USD' },
  },
  'GBP/USD': {
    'AUD/USD': { value: 0.75, label: '+75%', type: 'pos', timeframe: 'H4', strategy: 'Trend Following', reason: 'Cùng đi ngược chiều USD, đều là đồng tiền rủi ro' },
    'NZD/USD': { value: 0.70, label: '+70%', type: 'pos', timeframe: 'H4', strategy: 'Trend Following', reason: 'Cùng xu hướng Risk-on/Risk-off với USD' },
    'USD/CHF': { value: -0.80, label: '-80%', type: 'strong_neg', timeframe: 'H4, Daily', strategy: 'Hedging', reason: 'GBP mạnh thường đi kèm CHF yếu (dòng tiền rời trú ẩn)' },
    'USD/JPY': { value: -0.75, label: '-75%', type: 'strong_neg', timeframe: 'H1, H4', strategy: 'Risk-on/off', reason: 'JPY tài sản trú ẩn cực hạn. Risk-on → bán JPY để mua GBP (lãi suất cao hơn)' },
    'USD/CAD': { value: -0.60, label: '-60%', type: 'neg', timeframe: 'Daily', strategy: 'Trend Following', reason: 'GBP/USD và USD/CAD đều ngược chiều với sức mạnh USD' },
    'EUR/GBP': { value: -0.50, label: '-50%', type: 'neg', timeframe: 'H4', strategy: 'Monitor', reason: 'GBP mạnh → EUR/GBP giảm (EUR so sánh bất lợi với GBP)' },
  },
  'AUD/USD': {
    'NZD/USD': { value: 0.95, label: '+95%', type: 'strong_pos', timeframe: 'H1, H4', strategy: 'Pair Trade / Hedge', reason: 'Hai đồng tiền hàng hóa cùng khu vực, chạy theo quặng sắt và sữa' },
    'USD/CHF': { value: -0.70, label: '-70%', type: 'neg', timeframe: 'H4', strategy: 'Hedging', reason: 'AUD Risk-on, CHF Risk-off — nghịch chiều khẩu vị rủi ro' },
    'USD/JPY': { value: -0.60, label: '-60%', type: 'neg', timeframe: 'H4', strategy: 'Risk-on/off', reason: 'Phiên Á: AUD và JPY thường phản ứng ngược chiều nhau với sentiment' },
    'AUD/NZD': { value: 0.20, label: '+20%', type: 'cross', timeframe: 'M30, H1', strategy: 'Range Trading', reason: 'Cặp tiền "anh em" — kinh tế Úc và NZ gắn kết. AUD/NZD thường Mean Revert quanh biên độ hẹp' },
  },
  'NZD/USD': {
    'USD/CHF': { value: -0.65, label: '-65%', type: 'neg', timeframe: 'H4', strategy: 'Hedging', reason: 'NZD Risk-on, CHF Risk-off — cùng phản ánh sentiment thị trường' },
    'USD/JPY': { value: -0.55, label: '-55%', type: 'neg', timeframe: 'H4', strategy: 'Risk-on/off', reason: 'Phiên Á và Thái Bình Dương, NZD và JPY thường phản ứng ngược sentiment' },
    'AUD/NZD': { value: -0.30, label: '-30%', type: 'cross', timeframe: 'M30, H1', strategy: 'Range Trading', reason: 'NZD/USD tăng → NZD mạnh hơn AUD → AUD/NZD giảm' },
  },
  'USD/CHF': {
    'USD/JPY': { value: 0.65, label: '+65%', type: 'pos', timeframe: 'H4', strategy: 'Safe Haven Basket', reason: 'Cả hai đều là đồng tiền trú ẩn (Safe Haven). Khi thị trường lo ngại, cả hai tăng vs USD' },
    'USD/CAD': { value: 0.50, label: '+50%', type: 'neutral', timeframe: 'Daily', strategy: 'Monitor', reason: 'Cùng chiều với sức mạnh USD nhưng CAD bị ảnh hưởng nhiều từ giá dầu' },
  },
  'USD/JPY': {
    'USD/CAD': { value: 0.55, label: '+55%', type: 'neutral', timeframe: 'Daily', strategy: 'Monitor', reason: 'Cùng nhóm USD mạnh nhưng CAD phụ thuộc dầu, JPY phụ thuộc lãi suất carry trade' },
  },
  'USD/CAD': {
    'AUD/NZD': { value: 0.10, label: '~0%', type: 'neutral', timeframe: '-', strategy: 'Independent', reason: 'Tương quan thấp. USD/CAD phụ thuộc dầu, AUD/NZD phụ thuộc kinh tế Oceania' },
  },
  'AUD/NZD': {
    'EUR/GBP': { value: 0.25, label: '+25%', type: 'cross', timeframe: 'H4, Daily', strategy: 'Mean Reversion', reason: 'Cả hai là cặp chéo Mean Reversion. Không liên quan trực tiếp nhưng cùng chiến lược giao dịch' },
  },
  'EUR/GBP': {}
};

export function getCorrelation(pair1: string, pair2: string): CorrData | null {
  if (pair1 === pair2) return null;
  if (CORR_MAP[pair1]?.[pair2]) return CORR_MAP[pair1][pair2];
  if (CORR_MAP[pair2]?.[pair1]) {
    const c = CORR_MAP[pair2][pair1];
    return { ...c, value: c.value }; // symmetric
  }
  return null;
}

export type { CorrData, CorrType };
