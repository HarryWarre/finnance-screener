export type MacroPair = 'EUR/USD' | 'GBP/USD' | 'USD/JPY' | 'AUD/USD';
export type EventTier = 'S' | 'A' | 'B';
export type EventFamily = 'usd_data' | 'central_bank' | 'domestic_data';
export type SurpriseState = 'bullish' | 'bearish' | 'none';
export type ConfirmationState = 'strong' | 'weak' | 'none';
export type OverlapState = 'none' | 'tier_a' | 'tier_s';
export type SpreadState = 'normal' | 'wide';
export type StrategyStatus = 'TRADE' | 'REDUCE' | 'WAIT' | 'SKIP';

export interface MacroEventConfig {
  id: string;
  title: string;
  currency: 'USD' | 'EUR' | 'GBP' | 'JPY' | 'AUD';
  tier: EventTier;
  family: EventFamily;
  setup: string;
  entryWindow: string;
  pairs: MacroPair[];
  thesis: string;
}

export interface PairPlaybook {
  pair: MacroPair;
  drivers: string;
  preferredEvents: string;
  bestUse: string;
  avoidWhen: string;
}

export interface StrategyInputs {
  pair: MacroPair;
  eventId: string;
  surprise: SurpriseState;
  confirmation: ConfirmationState;
  overlap: OverlapState;
  spread: SpreadState;
  preMove: boolean;
}

export interface StrategyResult {
  status: StrategyStatus;
  confidence: number;
  direction: string;
  bias: string;
  entryWindow: string;
  positionSize: string;
  stopRule: string;
  targetRule: string;
  reasons: string[];
  event: MacroEventConfig;
}

export const MACRO_EVENTS: MacroEventConfig[] = [
  {
    id: 'fomc',
    title: 'FOMC rate decision / press conference',
    currency: 'USD',
    tier: 'S',
    family: 'central_bank',
    setup: 'USD continuation after policy shock',
    entryWindow: 'T+30 to T+120',
    pairs: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD'],
    thesis: 'Chỉ trade khi nến H1 đầu tiên xác nhận được narrative chính sách.'
  },
  {
    id: 'us_cpi',
    title: 'US CPI',
    currency: 'USD',
    tier: 'S',
    family: 'usd_data',
    setup: 'USD breakout after inflation surprise',
    entryWindow: 'T+15 to T+60',
    pairs: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD'],
    thesis: 'Lạm phát chỉ đáng trade khi giá thật sự thoát khỏi pre-event range.'
  },
  {
    id: 'us_nfp',
    title: 'US Nonfarm Payrolls',
    currency: 'USD',
    tier: 'S',
    family: 'usd_data',
    setup: 'USD breakout after labor shock',
    entryWindow: 'T+15 to T+60',
    pairs: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD'],
    thesis: 'NFP chỉ đáng trade khi động lượng H1 sống sót sau cú spike đầu tiên.'
  },
  {
    id: 'us_retail',
    title: 'US Retail Sales',
    currency: 'USD',
    tier: 'A',
    family: 'usd_data',
    setup: 'USD continuation on growth surprise',
    entryWindow: 'T+15 to T+60',
    pairs: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD'],
    thesis: 'Chỉ đáng kể khi retail sales làm thay đổi kỳ vọng về đường đi của Fed.'
  },
  {
    id: 'ecb',
    title: 'ECB rate decision',
    currency: 'EUR',
    tier: 'A',
    family: 'central_bank',
    setup: 'EUR continuation after ECB repricing',
    entryWindow: 'T+30 to T+120',
    pairs: ['EUR/USD'],
    thesis: 'Biểu hiện sạch nhất là qua EUR/USD sau khi phản ứng đầu tiên được giá chấp nhận.'
  },
  {
    id: 'boe',
    title: 'BoE rate decision',
    currency: 'GBP',
    tier: 'A',
    family: 'central_bank',
    setup: 'GBP continuation after BoE repricing',
    entryWindow: 'T+30 to T+120',
    pairs: ['GBP/USD'],
    thesis: 'Tốt nhất khi lợi suất UK, GBP và statement cùng chỉ về một hướng.'
  },
  {
    id: 'rba',
    title: 'RBA rate decision',
    currency: 'AUD',
    tier: 'A',
    family: 'central_bank',
    setup: 'AUD continuation after RBA surprise',
    entryWindow: 'T+30 to T+120',
    pairs: ['AUD/USD'],
    thesis: 'Đáng tin nhất khi surprise đủ rõ và risk sentiment không đi ngược.'
  },
  {
    id: 'boj',
    title: 'BoJ policy decision',
    currency: 'JPY',
    tier: 'A',
    family: 'central_bank',
    setup: 'JPY continuation after policy shift',
    entryWindow: 'T+30 to T+120',
    pairs: ['USD/JPY'],
    thesis: 'USD/JPY cần lợi suất xác nhận, không chỉ một cú spike theo headline.'
  },
  {
    id: 'au_jobs',
    title: 'Australia employment data',
    currency: 'AUD',
    tier: 'A',
    family: 'domestic_data',
    setup: 'AUD breakout after labor surprise',
    entryWindow: 'T+15 to T+60',
    pairs: ['AUD/USD'],
    thesis: 'Đáng trade trên H1 khi số liệu lao động làm thay đổi kỳ vọng RBA.'
  },
  {
    id: 'minor',
    title: 'Minor releases / speeches',
    currency: 'USD',
    tier: 'B',
    family: 'usd_data',
    setup: 'Context only',
    entryWindow: 'Avoid direct H1 trades',
    pairs: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD'],
    thesis: 'Dùng để lấy bối cảnh, không dùng làm catalyst H1 độc lập.'
  }
];

export const PAIR_PLAYBOOKS: PairPlaybook[] = [
  {
    pair: 'EUR/USD',
    drivers: 'Fed path, ECB path, US real yields, DXY impulse.',
    preferredEvents: 'FOMC, US CPI, US NFP, ECB.',
    bestUse: 'Breakout USD sạch hoặc continuation sau ECB khi H1 đã xác nhận.',
    avoidWhen: 'Ngày ECB nhưng cú move chính lại do broad USD repricing dẫn dắt.'
  },
  {
    pair: 'GBP/USD',
    drivers: 'Fed path, BoE path, UK rates and growth surprise.',
    preferredEvents: 'FOMC, US CPI, US NFP, BoE.',
    bestUse: 'Continuation sau BoE hoặc shock dữ liệu Mỹ đủ mạnh và có broad USD follow-through.',
    avoidWhen: 'Event UK chồng quá sát với một tin tier-S của Mỹ.'
  },
  {
    pair: 'USD/JPY',
    drivers: 'US-JP rate differential, risk sentiment, BoJ policy shifts.',
    preferredEvents: 'FOMC, US CPI, US NFP, BoJ.',
    bestUse: 'Tốt nhất khi lợi suất và giá chạy cùng chiều sau xác nhận.',
    avoidWhen: 'Spike theo headline nhưng lợi suất không xác nhận và giá nhanh chóng fade.'
  },
  {
    pair: 'AUD/USD',
    drivers: 'Fed path, RBA path, China and risk-on sentiment.',
    preferredEvents: 'US CPI, FOMC, RBA, Australia jobs.',
    bestUse: 'Catalyst nội địa của AUD hoặc shock USD sạch trong giờ thanh khoản tốt.',
    avoidWhen: 'Gap ở phiên Á hoặc headline China-risk xung đột.'
  }
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getPairDirection(pair: MacroPair, currency: MacroEventConfig['currency'], surprise: SurpriseState) {
  if (surprise === 'none') return '';

  const [base, quote] = pair.split('/') as [string, string];

  if (currency === base) {
    return surprise === 'bullish' ? `BUY ${pair}` : `SELL ${pair}`;
  }

  if (currency === quote) {
    return surprise === 'bullish' ? `SELL ${pair}` : `BUY ${pair}`;
  }

  return '';
}

function getBiasText(pair: MacroPair, event: MacroEventConfig, surprise: SurpriseState) {
  if (surprise === 'none') return 'Chưa có surprise vĩ mô rõ ràng.';

  const direction = getPairDirection(pair, event.currency, surprise);
  const surpriseText = surprise === 'bullish'
    ? `${event.currency} mạnh hơn kỳ vọng`
    : `${event.currency} yếu hơn kỳ vọng`;

  return direction ? `${surpriseText} -> ${direction}` : `${surpriseText}, nhưng cặp này không phải biểu hiện sạch nhất.`;
}

export function getEventConfig(eventId: string) {
  return MACRO_EVENTS.find((event) => event.id === eventId) ?? MACRO_EVENTS[0];
}

export function evaluateMacroStrategy(inputs: StrategyInputs): StrategyResult {
  const event = getEventConfig(inputs.eventId);
  const relevant = event.pairs.includes(inputs.pair);
  const direction = getPairDirection(inputs.pair, event.currency, inputs.surprise);
  const reasons: string[] = [];

  let confidence = event.tier === 'S' ? 48 : event.tier === 'A' ? 36 : 14;

  if (!relevant) {
    reasons.push(`Cặp đã chọn không phải biểu hiện sạch nhất cho ${event.title}.`);
  } else {
    confidence += 10;
    reasons.push(`${inputs.pair} là một trong các cặp ưu tiên cho ${event.title}.`);
  }

  if (event.tier === 'B') {
    reasons.push('Tin tier B chỉ dùng làm bối cảnh trong framework này.');
  } else {
    reasons.push(`Sự kiện tier ${event.tier} chỉ được trade sau khi H1 xác nhận.`);
  }

  if (inputs.surprise === 'none') {
    confidence -= 30;
    reasons.push('Không có surprise rõ so với consensus.');
  } else {
    confidence += 18;
    reasons.push(getBiasText(inputs.pair, event, inputs.surprise));
  }

  if (inputs.confirmation === 'strong') {
    confidence += 22;
    reasons.push('H1-1 đóng ngoài pre-event range với thân nến đủ mạnh.');
  } else if (inputs.confirmation === 'weak') {
    confidence += 8;
    reasons.push('Giá đi đúng hướng nhưng xác nhận H1 vẫn chưa đủ sạch.');
  } else {
    confidence -= 22;
    reasons.push('Giá H1 chưa xác nhận narrative.');
  }

  if (inputs.preMove) {
    confidence -= 10;
    reasons.push('Giá đã chạy trước tin nên edge kém sạch hơn.');
  }

  if (inputs.overlap === 'tier_a') {
    confidence -= 8;
    reasons.push('Có một tin tier A đủ gần để phải giảm size.');
  } else if (inputs.overlap === 'tier_s') {
    confidence -= 18;
    reasons.push('Có overlap tier S nên nên giảm mạnh size hoặc bỏ qua.');
  } else {
    confidence += 6;
    reasons.push('Không có overlap lớn trong vài giờ tới.');
  }

  if (inputs.spread === 'wide') {
    confidence -= 35;
    reasons.push('Spread và điều kiện khớp lệnh đang bất thường.');
  } else {
    confidence += 5;
    reasons.push('Spread đủ bình thường để thực thi trên H1.');
  }

  confidence = clamp(confidence, 0, 95);

  let status: StrategyStatus = 'TRADE';

  if (!relevant || event.tier === 'B' || inputs.spread === 'wide') {
    status = 'SKIP';
  } else if (inputs.surprise === 'none') {
    status = 'SKIP';
  } else if (inputs.confirmation === 'none') {
    status = 'WAIT';
  } else if (inputs.confirmation === 'weak' || inputs.overlap !== 'none' || inputs.preMove) {
    status = 'REDUCE';
  }

  let positionSize = '0R';
  if (status === 'TRADE') {
    positionSize = event.family === 'central_bank' ? '0.75R' : '0.5R';
  } else if (status === 'REDUCE') {
    positionSize = '0.25R';
  }

  const stopRule = event.family === 'central_bank'
    ? '1.0 x ATR14_H1 or beyond the last H1 swing'
    : 'max(0.75 x ATR14_H1, 0.5 x event range)';

  const targetRule = event.family === 'central_bank'
    ? 'TP1 1.2R, TP2 2.2R, then trail the rest'
    : 'TP1 1R, TP2 2R, then trail below/above H1-1';

  return {
    status,
    confidence,
    direction: direction || 'Chưa có hướng pair đủ sạch',
    bias: getBiasText(inputs.pair, event, inputs.surprise),
    entryWindow: event.entryWindow,
    positionSize,
    stopRule,
    targetRule,
    reasons,
    event
  };
}
