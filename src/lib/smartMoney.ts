export type AssetClass =
  | 'Forex'
  | 'Stocks'
  | 'Crypto'
  | 'Commodities'
  | 'Agriculture'
  | 'Futures';

export type MetricDirection = 'bullish_when_high' | 'bearish_when_high' | 'neutral';
export type MetricUnit = 'USD' | '%' | 'contracts' | 'index' | 'tokens' | 'bps' | 'ratio';
export type MetricWindowMethod = 'sum' | 'change' | 'level';
export type MetricCategory =
  | 'Demand'
  | 'Supply'
  | 'Liquidity'
  | 'Positioning'
  | 'Exchange'
  | 'On-chain'
  | 'Derivatives'
  | 'Options'
  | 'Volatility'
  | 'Macro'
  | 'Physical'
  | 'Seasonality'
  | 'Breadth'
  | 'Sentiment';

export type ScoreBucket =
  | 'Tổng hợp'
  | 'Thanh khoản'
  | 'Vị thế'
  | 'Phái sinh'
  | 'Options'
  | 'On-chain'
  | 'Dòng tiền'
  | 'Vật chất'
  | 'Vĩ mô'
  | 'Tâm lý';

export type MetricDefinition = {
  id: string;
  name: string; // fallback EN
  nameVi: string;
  meaning: string; // fallback EN
  meaningVi: string;
  unit: MetricUnit;
  direction: MetricDirection;
  applicableTo: AssetClass[];
  windowMethod: MetricWindowMethod;
  defaultWindowDays: number;
  defaultWeight: number;
  category: MetricCategory;
  bucket: ScoreBucket;
  cadence: 'realtime' | 'daily' | 'weekly' | 'monthly' | 'quarterly';
  caveatVi?: string;
  notes?: string;
};

export type FlowPoint = { t: number; v: number }; // t = epoch ms

export type MetricSnapshot = {
  metric: MetricDefinition;
  windowValue: number;
  z: number;
  signedZ: number;
  spark: number[]; // recent window-aggregated history
  hasHistory: boolean;
};

export type SmartMoneyWindowResult = {
  assetClass: AssetClass;
  windowDays: number;
  baselineDays: number;
  asOf: number;
  scoreZ: number; // composite signed z-score
  scorePct: number; // -100..100
  biasLabel: 'Accumulation' | 'Distribution' | 'Neutral';
  bucketScores: Record<ScoreBucket, { z: number; pct: number; coverage: number; total: number }>;
  snapshots: MetricSnapshot[];
};

export const SMART_MONEY_METRICS: MetricDefinition[] = [
  {
    id: 'etf_inflow',
    name: 'ETF inflow',
    nameVi: 'Dòng tiền ETF',
    meaning: 'Institutional demand (vehicles / wrappers)',
    meaningVi: 'Nhu cầu tổ chức qua ETF/vehicle',
    unit: 'USD',
    direction: 'bullish_when_high',
    applicableTo: ['Stocks', 'Crypto', 'Commodities'],
    windowMethod: 'sum',
    defaultWindowDays: 7,
    defaultWeight: 1.0,
    category: 'Demand',
    bucket: 'Dòng tiền',
    cadence: 'daily',
    notes: 'Best for large ETFs / spot crypto ETFs; proxy for allocator demand.',
    caveatVi: 'Có thể méo tín hiệu khi có rebalance/quỹ mới; nên so sánh theo lịch sử (z-score).',
  },
  {
    id: 'stablecoin_inflow',
    name: 'Stablecoin inflow',
    nameVi: 'Dòng tiền Stablecoin',
    meaning: 'Buying power / dry powder entering ecosystem',
    meaningVi: '“Tiền mua” đi vào hệ sinh thái crypto',
    unit: 'USD',
    direction: 'bullish_when_high',
    applicableTo: ['Crypto'],
    windowMethod: 'sum',
    defaultWindowDays: 7,
    defaultWeight: 1.1,
    category: 'Liquidity',
    bucket: 'Thanh khoản',
    cadence: 'daily',
  },
  {
    id: 'exchange_net_outflow',
    name: 'Exchange net outflow',
    nameVi: 'Rút ròng khỏi sàn',
    meaning: 'Holding behavior (withdrawal > deposits)',
    meaningVi: 'Hành vi nắm giữ: rút > nạp (giảm áp lực bán ngắn hạn)',
    unit: 'USD',
    direction: 'bullish_when_high',
    applicableTo: ['Crypto'],
    windowMethod: 'sum',
    defaultWindowDays: 7,
    defaultWeight: 1.0,
    category: 'Exchange',
    bucket: 'Dòng tiền',
    cadence: 'daily',
    notes: 'Outflow tends to reduce immediate sell pressure; can be noisy around rebalances.',
    caveatVi: 'Nhiễu khi có chuyển ví nội bộ/sàn đổi cold wallet; nên xem xu hướng nhiều ngày.',
  },
  {
    id: 'whale_accumulation',
    name: 'Whale accumulation',
    nameVi: 'Tích luỹ cá voi',
    meaning: 'Large positioning / smart wallets adding exposure',
    meaningVi: 'Ví lớn/tay to tăng vị thế',
    unit: 'index',
    direction: 'bullish_when_high',
    applicableTo: ['Crypto'],
    windowMethod: 'change',
    defaultWindowDays: 14,
    defaultWeight: 1.0,
    category: 'On-chain',
    bucket: 'On-chain',
    cadence: 'daily',
  },
  {
    id: 'coin_days_destroyed',
    name: 'Coin days destroyed',
    nameVi: 'Coin Days Destroyed',
    meaning: 'Dormant supply waking up (spend pressure proxy)',
    meaningVi: 'Supply “ngủ đông” di chuyển (proxy áp lực bán)',
    unit: 'index',
    direction: 'bearish_when_high',
    applicableTo: ['Crypto'],
    windowMethod: 'sum',
    defaultWindowDays: 7,
    defaultWeight: 0.8,
    category: 'On-chain',
    bucket: 'On-chain',
    cadence: 'daily',
    caveatVi: 'Có thể tăng vì chuyển ví kỹ thuật; nên kết hợp với exchange inflow.',
  },
  {
    id: 'exchange_inflow',
    name: 'Exchange inflow',
    nameVi: 'Nạp vào sàn',
    meaning: 'Potential sell pressure (deposits to exchanges)',
    meaningVi: 'Khả năng tăng áp lực bán (nạp vào sàn)',
    unit: 'USD',
    direction: 'bearish_when_high',
    applicableTo: ['Crypto'],
    windowMethod: 'sum',
    defaultWindowDays: 7,
    defaultWeight: 0.9,
    category: 'Exchange',
    bucket: 'Dòng tiền',
    cadence: 'daily',
  },
  {
    id: 'funding_rate',
    name: 'Funding rate',
    nameVi: 'Funding rate',
    meaning: 'Perp funding; crowded longs vs shorts (regime)',
    meaningVi: 'Funding perp: thị trường nghiêng long/short (regime)',
    unit: 'bps',
    direction: 'neutral',
    applicableTo: ['Crypto'],
    windowMethod: 'level',
    defaultWindowDays: 7,
    defaultWeight: 0.5,
    category: 'Derivatives',
    bucket: 'Phái sinh',
    cadence: 'daily',
    caveatVi: 'Funding quá dương có thể là rủi ro long crowded; không nên đọc 1 chiều.',
  },
  {
    id: 'perp_open_interest_change',
    name: 'Perp open interest change',
    nameVi: 'Thay đổi Open Interest (perp)',
    meaning: 'Leverage and new positioning entering derivatives',
    meaningVi: 'Đòn bẩy/vị thế mới đi vào phái sinh',
    unit: 'USD',
    direction: 'neutral',
    applicableTo: ['Crypto'],
    windowMethod: 'change',
    defaultWindowDays: 7,
    defaultWeight: 0.6,
    category: 'Derivatives',
    bucket: 'Phái sinh',
    cadence: 'daily',
  },
  {
    id: 'miner_net_position_change',
    name: 'Miner net position change',
    nameVi: 'Miner bán/mua ròng',
    meaning: 'Miner distribution/accumulation (sell pressure proxy)',
    meaningVi: 'Miner phân phối/tích luỹ (proxy áp lực bán)',
    unit: 'USD',
    direction: 'bearish_when_high',
    applicableTo: ['Crypto'],
    windowMethod: 'change',
    defaultWindowDays: 14,
    defaultWeight: 0.7,
    category: 'Supply',
    bucket: 'Dòng tiền',
    cadence: 'daily',
  },
  {
    id: 'mvrv_z',
    name: 'MVRV Z-score',
    nameVi: 'MVRV Z-score',
    meaning: 'Valuation vs realized cap (over/under valuation proxy)',
    meaningVi: 'Định giá so với realized cap (proxy đắt/rẻ)',
    unit: 'index',
    direction: 'bearish_when_high',
    applicableTo: ['Crypto'],
    windowMethod: 'level',
    defaultWindowDays: 90,
    defaultWeight: 0.4,
    category: 'Sentiment',
    bucket: 'Tâm lý',
    cadence: 'daily',
    caveatVi: 'Thiên về định giá/chu kỳ, không phải flow thuần; dùng như chỉ báo chế độ.',
  },
  {
    id: 'stablecoin_supply_change',
    name: 'Stablecoin supply change',
    nameVi: 'Thay đổi cung Stablecoin',
    meaning: 'Stablecoin supply growth (liquidity proxy)',
    meaningVi: 'Cung stablecoin tăng (proxy thanh khoản)',
    unit: 'USD',
    direction: 'bullish_when_high',
    applicableTo: ['Crypto'],
    windowMethod: 'change',
    defaultWindowDays: 30,
    defaultWeight: 0.7,
    category: 'Liquidity',
    bucket: 'Thanh khoản',
    cadence: 'daily',
    caveatVi: 'Tăng cung có thể do đổi cấu trúc phát hành; xem theo xu hướng 30–90 ngày.',
  },
  {
    id: 'exchange_reserve_change',
    name: 'Exchange reserve change',
    nameVi: 'Thay đổi dự trữ trên sàn',
    meaning: 'On-exchange reserves (sell pressure potential)',
    meaningVi: 'Dự trữ trên sàn (tiềm năng áp lực bán)',
    unit: 'USD',
    direction: 'bearish_when_high',
    applicableTo: ['Crypto'],
    windowMethod: 'change',
    defaultWindowDays: 14,
    defaultWeight: 0.8,
    category: 'Exchange',
    bucket: 'Dòng tiền',
    cadence: 'daily',
    caveatVi: 'Một số sàn thay ví lưu trữ gây nhiễu; ưu tiên dữ liệu đã “entity adjusted”.',
  },
  {
    id: 'new_addresses_growth',
    name: 'New addresses growth',
    nameVi: 'Tăng trưởng địa chỉ mới',
    meaning: 'Network growth / adoption proxy',
    meaningVi: 'Tăng trưởng mạng lưới / adoption (proxy)',
    unit: 'index',
    direction: 'bullish_when_high',
    applicableTo: ['Crypto'],
    windowMethod: 'change',
    defaultWindowDays: 30,
    defaultWeight: 0.5,
    category: 'On-chain',
    bucket: 'On-chain',
    cadence: 'daily',
    caveatVi: 'Dễ bị “spam” địa chỉ; nên kết hợp active addresses/fees.',
  },
  {
    id: 'realized_profit_loss',
    name: 'Realized profit/loss',
    nameVi: 'Lãi/lỗ thực hiện (Realized P/L)',
    meaning: 'Distribution intensity proxy',
    meaningVi: 'Cường độ chốt lời/cắt lỗ (proxy phân phối)',
    unit: 'USD',
    direction: 'bearish_when_high',
    applicableTo: ['Crypto'],
    windowMethod: 'sum',
    defaultWindowDays: 7,
    defaultWeight: 0.6,
    category: 'On-chain',
    bucket: 'On-chain',
    cadence: 'daily',
    caveatVi: 'Realized P/L cao có thể là chốt lời mạnh ở đỉnh; đọc theo bối cảnh trend.',
  },
  {
    id: 'liquidations_volume',
    name: 'Liquidations volume',
    nameVi: 'Khối lượng thanh lý',
    meaning: 'Forced deleveraging proxy (regime/turning points)',
    meaningVi: 'Proxy “rũ đòn bẩy” (regime/điểm đảo chiều)',
    unit: 'USD',
    direction: 'neutral',
    applicableTo: ['Crypto'],
    windowMethod: 'sum',
    defaultWindowDays: 3,
    defaultWeight: 0.4,
    category: 'Derivatives',
    bucket: 'Phái sinh',
    cadence: 'realtime',
    caveatVi: 'Thanh lý cao thường xảy ra ở cực trị; dùng như tín hiệu biến động, không gắn dấu 1 chiều.',
  },
  {
    id: 'iv_rank',
    name: 'Implied volatility rank',
    nameVi: 'Xếp hạng IV (IV Rank)',
    meaning: 'Options implied volatility regime',
    meaningVi: 'Chế độ biến động kỳ vọng (options IV)',
    unit: 'index',
    direction: 'neutral',
    applicableTo: ['Crypto', 'Stocks', 'Commodities', 'Forex'],
    windowMethod: 'level',
    defaultWindowDays: 30,
    defaultWeight: 0.35,
    category: 'Volatility',
    bucket: 'Tâm lý',
    cadence: 'daily',
    caveatVi: 'IV cao = rủi ro cao; phù hợp để điều chỉnh size và kỳ vọng hơn là buy/sell.',
  },
  {
    id: 'insider_buying',
    name: 'Insider buying',
    nameVi: 'Mua ròng nội bộ',
    meaning: 'Corporate insider confidence / informational edge',
    meaningVi: 'Niềm tin nội bộ doanh nghiệp / lợi thế thông tin',
    unit: 'USD',
    direction: 'bullish_when_high',
    applicableTo: ['Stocks'],
    windowMethod: 'sum',
    defaultWindowDays: 30,
    defaultWeight: 0.9,
    category: 'Demand',
    bucket: 'Dòng tiền',
    cadence: 'daily',
  },
  {
    id: 'insider_selling',
    name: 'Insider selling',
    nameVi: 'Bán ròng nội bộ',
    meaning: 'Insider distribution proxy',
    meaningVi: 'Nội bộ bán ra (proxy phân phối)',
    unit: 'USD',
    direction: 'bearish_when_high',
    applicableTo: ['Stocks'],
    windowMethod: 'sum',
    defaultWindowDays: 30,
    defaultWeight: 0.6,
    category: 'Supply',
    bucket: 'Dòng tiền',
    cadence: 'daily',
    caveatVi: 'Insider bán có nhiều lý do (thuế/đa dạng hoá); nên đọc theo mức “bất thường” (z-score).',
  },
  {
    id: 'buyback_intensity',
    name: 'Buyback intensity',
    nameVi: 'Cường độ mua lại cổ phiếu',
    meaning: 'Corporate bid / equity demand via repurchases',
    meaningVi: 'Lực cầu doanh nghiệp qua buyback',
    unit: 'USD',
    direction: 'bullish_when_high',
    applicableTo: ['Stocks'],
    windowMethod: 'sum',
    defaultWindowDays: 30,
    defaultWeight: 0.9,
    category: 'Demand',
    bucket: 'Dòng tiền',
    cadence: 'quarterly',
  },
  {
    id: 'darkpool_share',
    name: 'Dark pool share',
    nameVi: 'Tỷ lệ dark pool',
    meaning: 'Institutional execution footprint / off-exchange activity',
    meaningVi: 'Dấu chân giao dịch tổ chức / hoạt động off-exchange',
    unit: '%',
    direction: 'neutral',
    applicableTo: ['Stocks'],
    windowMethod: 'level',
    defaultWindowDays: 7,
    defaultWeight: 0.4,
    category: 'Liquidity',
    bucket: 'Thanh khoản',
    cadence: 'daily',
    notes: 'Interpretation depends on context; use as regime feature, not direct buy/sell.',
    caveatVi: 'Không phải lúc nào cũng bullish/bearish; nên xem như tín hiệu “chế độ” thanh khoản.',
  },
  {
    id: 'short_interest_change',
    name: 'Short interest change',
    nameVi: 'Thay đổi short interest',
    meaning: 'Crowding in shorts / squeeze risk proxy',
    meaningVi: 'Mức độ đông short / rủi ro squeeze',
    unit: '%',
    direction: 'neutral',
    applicableTo: ['Stocks'],
    windowMethod: 'change',
    defaultWindowDays: 30,
    defaultWeight: 0.5,
    category: 'Positioning',
    bucket: 'Vị thế',
    cadence: 'weekly',
    caveatVi: 'Short interest tăng có thể bearish, nhưng cũng tăng xác suất squeeze nếu catalyst tốt.',
  },
  {
    id: 'put_call_ratio',
    name: 'Put/Call ratio',
    nameVi: 'Put/Call ratio',
    meaning: 'Options sentiment / hedging intensity',
    meaningVi: 'Tâm lý options / cường độ phòng hộ',
    unit: 'ratio',
    direction: 'neutral',
    applicableTo: ['Stocks'],
    windowMethod: 'level',
    defaultWindowDays: 7,
    defaultWeight: 0.5,
    category: 'Options',
    bucket: 'Options',
    cadence: 'daily',
    caveatVi: 'Đọc theo cực trị và bối cảnh volatility; không nên dùng 1 mình.',
  },
  {
    id: 'market_breadth_adv_dec',
    name: 'Advance/Decline breadth',
    nameVi: 'Độ rộng thị trường (A/D)',
    meaning: 'Participation: how broad the rally/selloff is',
    meaningVi: 'Mức lan toả: tăng/giảm có rộng hay chỉ vài mã kéo',
    unit: 'index',
    direction: 'bullish_when_high',
    applicableTo: ['Stocks'],
    windowMethod: 'change',
    defaultWindowDays: 14,
    defaultWeight: 0.6,
    category: 'Breadth',
    bucket: 'Tâm lý',
    cadence: 'daily',
  },
  {
    id: 'credit_spread_proxy',
    name: 'Credit spread proxy',
    nameVi: 'Proxy credit spread',
    meaning: 'Risk appetite / funding stress proxy',
    meaningVi: 'Khẩu vị rủi ro / căng thẳng vốn (proxy)',
    unit: 'bps',
    direction: 'bearish_when_high',
    applicableTo: ['Stocks', 'Crypto'],
    windowMethod: 'change',
    defaultWindowDays: 14,
    defaultWeight: 0.45,
    category: 'Macro',
    bucket: 'Vĩ mô',
    cadence: 'daily',
    caveatVi: 'Credit spread nở rộng thường risk-off; tác động mạnh lên asset rủi ro.',
  },
  {
    id: 'vix_level',
    name: 'VIX level',
    nameVi: 'Chỉ số VIX',
    meaning: 'Equity implied volatility / fear gauge',
    meaningVi: 'Biến động kỳ vọng của chứng khoán / thước đo “sợ hãi”',
    unit: 'index',
    direction: 'bearish_when_high',
    applicableTo: ['Stocks'],
    windowMethod: 'level',
    defaultWindowDays: 7,
    defaultWeight: 0.55,
    category: 'Volatility',
    bucket: 'Tâm lý',
    cadence: 'daily',
    caveatVi: 'VIX tăng mạnh thường đi kèm selloff; đôi khi lại là tín hiệu “capitulation” (đáy ngắn hạn).',
  },
  {
    id: 'mutual_fund_flow',
    name: 'Mutual fund flow',
    nameVi: 'Dòng tiền quỹ mở',
    meaning: 'Retail/allocator flow proxy',
    meaningVi: 'Proxy dòng tiền retail/allocator',
    unit: 'USD',
    direction: 'bullish_when_high',
    applicableTo: ['Stocks'],
    windowMethod: 'sum',
    defaultWindowDays: 30,
    defaultWeight: 0.55,
    category: 'Demand',
    bucket: 'Dòng tiền',
    cadence: 'weekly',
    caveatVi: 'Dữ liệu thường có độ trễ; phù hợp xác nhận xu hướng hơn là timing.',
  },
  {
    id: 'earnings_revision',
    name: 'Earnings revisions',
    nameVi: 'Điều chỉnh dự báo lợi nhuận',
    meaning: 'Analyst revisions / fundamental momentum proxy',
    meaningVi: 'Proxy “động lượng cơ bản” (analyst nâng/hạ dự báo)',
    unit: 'index',
    direction: 'bullish_when_high',
    applicableTo: ['Stocks'],
    windowMethod: 'change',
    defaultWindowDays: 60,
    defaultWeight: 0.4,
    category: 'Sentiment',
    bucket: 'Tâm lý',
    cadence: 'weekly',
    caveatVi: 'Không phải dòng tiền trực tiếp; dùng như xác nhận xu hướng theo cơ bản.',
  },
  {
    id: 'cftc_managed_money_net',
    name: 'COT managed money net',
    nameVi: 'COT: Managed Money (ròng)',
    meaning: 'Speculator positioning in futures (CFTC COT)',
    meaningVi: 'Vị thế nhóm managed money trong futures (CFTC COT)',
    unit: 'contracts',
    direction: 'bullish_when_high',
    applicableTo: ['Futures', 'Commodities', 'Agriculture', 'Forex'],
    windowMethod: 'change',
    defaultWindowDays: 28,
    defaultWeight: 1.0,
    category: 'Positioning',
    bucket: 'Vị thế',
    cadence: 'weekly',
    notes: 'Weekly data; window is expressed in days but sampled weekly in reality.',
    caveatVi: 'Dữ liệu weekly và có độ trễ; phù hợp swing/position hơn là intraday.',
  },
  {
    id: 'cftc_dealer_net',
    name: 'COT dealer net',
    nameVi: 'COT: Dealer (ròng)',
    meaning: 'Dealer hedging positioning proxy',
    meaningVi: 'Proxy vị thế phòng hộ của dealer',
    unit: 'contracts',
    direction: 'neutral',
    applicableTo: ['Futures', 'Commodities', 'Agriculture', 'Forex'],
    windowMethod: 'change',
    defaultWindowDays: 28,
    defaultWeight: 0.35,
    category: 'Positioning',
    bucket: 'Vị thế',
    cadence: 'weekly',
    caveatVi: 'Dealer thường hedging ngược với spec; đọc theo cấu trúc thị trường.',
  },
  {
    id: 'cftc_producer_net',
    name: 'COT producer/merchant net',
    nameVi: 'COT: Producer/Merchant (ròng)',
    meaning: 'Commercial hedger positioning proxy',
    meaningVi: 'Proxy vị thế hedger thương mại',
    unit: 'contracts',
    direction: 'neutral',
    applicableTo: ['Futures', 'Commodities', 'Agriculture'],
    windowMethod: 'change',
    defaultWindowDays: 28,
    defaultWeight: 0.35,
    category: 'Positioning',
    bucket: 'Vị thế',
    cadence: 'weekly',
    caveatVi: 'Commercial thường hedge theo hoạt động vật chất; không phải tín hiệu buy/sell đơn giản.',
  },
  {
    id: 'open_interest_change',
    name: 'Open interest change',
    nameVi: 'Thay đổi Open Interest',
    meaning: 'New positioning / leverage entering market',
    meaningVi: 'Vị thế mới/đòn bẩy đi vào thị trường',
    unit: 'contracts',
    direction: 'neutral',
    applicableTo: ['Futures', 'Commodities', 'Agriculture', 'Crypto'],
    windowMethod: 'change',
    defaultWindowDays: 7,
    defaultWeight: 0.6,
    category: 'Derivatives',
    bucket: 'Phái sinh',
    cadence: 'daily',
  },
  {
    id: 'options_skew',
    name: 'Options skew / risk reversal',
    nameVi: 'Options skew / risk reversal',
    meaning: 'Demand for upside vs downside protection (positioning proxy)',
    meaningVi: 'Nhu cầu phòng hộ: thiên lệch bảo hiểm lên/xuống (proxy vị thế)',
    unit: 'bps',
    direction: 'neutral',
    applicableTo: ['Forex', 'Stocks', 'Crypto', 'Commodities'],
    windowMethod: 'level',
    defaultWindowDays: 7,
    defaultWeight: 0.5,
    category: 'Options',
    bucket: 'Options',
    cadence: 'daily',
  },
  {
    id: 'fx_reserve_change',
    name: 'FX reserve change',
    nameVi: 'Thay đổi dự trữ ngoại hối',
    meaning: 'Central bank intervention / macro liquidity signal',
    meaningVi: 'Can thiệp NHTW / tín hiệu thanh khoản vĩ mô',
    unit: 'USD',
    direction: 'neutral',
    applicableTo: ['Forex'],
    windowMethod: 'change',
    defaultWindowDays: 90,
    defaultWeight: 0.4,
    category: 'Macro',
    bucket: 'Vĩ mô',
    cadence: 'monthly',
  },
  {
    id: 'inventory_draw',
    name: 'Inventory draw',
    nameVi: 'Tồn kho giảm',
    meaning: 'Physical tightness (drawdown supports price)',
    meaningVi: 'Thắt chặt vật chất: tồn kho giảm thường hỗ trợ giá',
    unit: 'index',
    direction: 'bullish_when_high',
    applicableTo: ['Commodities', 'Agriculture'],
    windowMethod: 'change',
    defaultWindowDays: 30,
    defaultWeight: 0.8,
    category: 'Physical',
    bucket: 'Vật chất',
    cadence: 'weekly',
  },
  {
    id: 'term_structure_backwardation',
    name: 'Term structure (backwardation)',
    nameVi: 'Kỳ hạn (backwardation)',
    meaning: 'Spot tightness / convenience yield proxy',
    meaningVi: 'Độ “căng” spot / convenience yield (proxy)',
    unit: 'index',
    direction: 'bullish_when_high',
    applicableTo: ['Futures', 'Commodities', 'Agriculture'],
    windowMethod: 'level',
    defaultWindowDays: 14,
    defaultWeight: 0.7,
    category: 'Physical',
    bucket: 'Vật chất',
    cadence: 'daily',
    caveatVi: 'Kỳ hạn bị ảnh hưởng bởi lãi suất/chi phí lưu kho; nên đọc theo bối cảnh.',
  },
  {
    id: 'basis_strength',
    name: 'Cash-futures basis strength',
    nameVi: 'Basis spot-futures',
    meaning: 'Physical demand proxy (cash vs futures)',
    meaningVi: 'Proxy cầu vật chất (cash vs futures)',
    unit: 'index',
    direction: 'bullish_when_high',
    applicableTo: ['Commodities', 'Agriculture'],
    windowMethod: 'level',
    defaultWindowDays: 14,
    defaultWeight: 0.6,
    category: 'Physical',
    bucket: 'Vật chất',
    cadence: 'daily',
    caveatVi: 'Basis phụ thuộc vùng/điểm giao hàng; dùng tốt nhất khi có dữ liệu chuẩn hoá.',
  },
  {
    id: 'export_sales_change',
    name: 'Export sales change',
    nameVi: 'Thay đổi xuất khẩu (nông sản)',
    meaning: 'Export demand proxy (agri)',
    meaningVi: 'Proxy nhu cầu xuất khẩu (nông sản)',
    unit: 'index',
    direction: 'bullish_when_high',
    applicableTo: ['Agriculture'],
    windowMethod: 'change',
    defaultWindowDays: 30,
    defaultWeight: 0.55,
    category: 'Demand',
    bucket: 'Vật chất',
    cadence: 'weekly',
    caveatVi: 'Dữ liệu USDA/CBOT có mùa vụ; nên so sánh YoY hoặc z-score theo mùa.',
  },
  {
    id: 'weather_risk_index',
    name: 'Weather risk index',
    nameVi: 'Chỉ số rủi ro thời tiết',
    meaning: 'Weather-driven supply risk proxy',
    meaningVi: 'Proxy rủi ro cung do thời tiết',
    unit: 'index',
    direction: 'bullish_when_high',
    applicableTo: ['Agriculture'],
    windowMethod: 'level',
    defaultWindowDays: 14,
    defaultWeight: 0.35,
    category: 'Physical',
    bucket: 'Vật chất',
    cadence: 'daily',
    caveatVi: 'Chỉ là proxy; cần gắn với giai đoạn gieo trồng/ra hoa/thu hoạch của từng mặt hàng.',
  },
  {
    id: 'shipping_congestion_proxy',
    name: 'Shipping congestion proxy',
    nameVi: 'Proxy tắc nghẽn vận tải',
    meaning: 'Logistics friction proxy (commodities)',
    meaningVi: 'Proxy ma sát logistics (hàng hoá)',
    unit: 'index',
    direction: 'neutral',
    applicableTo: ['Commodities', 'Agriculture'],
    windowMethod: 'change',
    defaultWindowDays: 30,
    defaultWeight: 0.25,
    category: 'Physical',
    bucket: 'Vật chất',
    cadence: 'weekly',
    caveatVi: 'Tắc nghẽn có thể làm tăng giá cục bộ; nhưng ảnh hưởng phụ thuộc tuyến/vùng.',
  },
  {
    id: 'rate_differential_proxy',
    name: 'Rate differential proxy',
    nameVi: 'Chênh lệch lãi suất (proxy)',
    meaning: 'Carry attractiveness proxy (FX)',
    meaningVi: 'Proxy hấp dẫn carry (FX)',
    unit: 'bps',
    direction: 'bullish_when_high',
    applicableTo: ['Forex'],
    windowMethod: 'level',
    defaultWindowDays: 30,
    defaultWeight: 0.5,
    category: 'Macro',
    bucket: 'Vĩ mô',
    cadence: 'daily',
    caveatVi: 'Carry trade phụ thuộc risk-on/off; khi risk-off, FX high yield dễ bị bán mạnh.',
  },
  {
    id: 'risk_appetite_proxy',
    name: 'Risk appetite proxy',
    nameVi: 'Proxy khẩu vị rủi ro',
    meaning: 'Global risk-on/off proxy (FX/commodities)',
    meaningVi: 'Proxy risk-on/off toàn cầu (FX/commodities)',
    unit: 'index',
    direction: 'bullish_when_high',
    applicableTo: ['Forex', 'Commodities'],
    windowMethod: 'change',
    defaultWindowDays: 14,
    defaultWeight: 0.35,
    category: 'Macro',
    bucket: 'Vĩ mô',
    cadence: 'daily',
    caveatVi: 'Ví dụ proxy: equity breadth, credit spread, volatility. Dùng để xác định bối cảnh.',
  },
  {
    id: 'seasonality_strength',
    name: 'Seasonality strength',
    nameVi: 'Sức mạnh mùa vụ',
    meaning: 'Seasonal tailwind/headwind proxy',
    meaningVi: 'Gió mùa vụ thuận/ngược (proxy)',
    unit: 'index',
    direction: 'neutral',
    applicableTo: ['Agriculture', 'Commodities'],
    windowMethod: 'level',
    defaultWindowDays: 30,
    defaultWeight: 0.3,
    category: 'Seasonality',
    bucket: 'Tâm lý',
    cadence: 'daily',
    caveatVi: 'Mùa vụ không phải “dòng tiền”, nhưng giúp đặt kỳ vọng theo chu kỳ sản xuất/thu hoạch.',
  },
  {
    id: 'usd_liquidity_proxy',
    name: 'USD liquidity proxy',
    nameVi: 'Proxy thanh khoản USD',
    meaning: 'Global USD liquidity risk-on/off proxy',
    meaningVi: 'Proxy thanh khoản USD toàn cầu (risk-on/off)',
    unit: 'index',
    direction: 'bullish_when_high',
    applicableTo: ['Crypto', 'Stocks', 'Forex', 'Commodities', 'Futures', 'Agriculture'],
    windowMethod: 'change',
    defaultWindowDays: 30,
    defaultWeight: 0.4,
    category: 'Macro',
    bucket: 'Vĩ mô',
    cadence: 'daily',
    caveatVi: 'Đây là tín hiệu vĩ mô tổng quát (ví dụ DXY, real yield, điều kiện tài chính).',
  },
];

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function meanStd(values: number[]) {
  const clean = values.filter(v => Number.isFinite(v));
  if (clean.length < 2) return { mean: 0, std: 0, n: clean.length };
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  let sumSq = 0;
  for (const v of clean) sumSq += (v - mean) * (v - mean);
  const std = Math.sqrt(sumSq / clean.length);
  return { mean, std, n: clean.length };
}

function zScoreOfLatest(history: number[], baselineLen: number) {
  if (!history.length) return { z: 0, hasHistory: false };
  const tail = history.slice(Math.max(0, history.length - baselineLen));
  const { mean, std, n } = meanStd(tail);
  if (n < Math.min(20, baselineLen) || std === 0) return { z: 0, hasHistory: false };
  const latest = history[history.length - 1];
  return { z: (latest - mean) / std, hasHistory: true };
}

function directionToSign(direction: MetricDirection) {
  if (direction === 'bullish_when_high') return 1;
  if (direction === 'bearish_when_high') return -1;
  return 0;
}

function rollingWindow(values: number[], windowDays: number, method: MetricWindowMethod) {
  if (values.length === 0) return [];
  const w = Math.max(1, Math.floor(windowDays));

  if (method === 'level') return values.slice();

  if (method === 'change') {
    const out = new Array(values.length).fill(NaN);
    for (let i = 0; i < values.length; i++) {
      const j = i - w;
      if (j < 0) continue;
      out[i] = values[i] - values[j];
    }
    return out;
  }

  // sum
  const prefix: number[] = new Array(values.length + 1).fill(0);
  for (let i = 0; i < values.length; i++) prefix[i + 1] = prefix[i] + values[i];
  const out = new Array(values.length).fill(NaN);
  for (let i = 0; i < values.length; i++) {
    const j = i + 1 - w;
    if (j < 0) continue;
    out[i] = prefix[i + 1] - prefix[j];
  }
  return out;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function genMockDailyValues(metric: MetricDefinition, days: number, seed: number) {
  const rand = mulberry32(seed);
  const out: number[] = [];

  // Rough scale per unit (just for display realism; scoring uses z-scores anyway)
  const scale =
    metric.unit === 'USD' ? 1_000_000 :
    metric.unit === 'contracts' ? 25_000 :
    metric.unit === 'tokens' ? 10_000 :
    metric.unit === 'bps' ? 20 :
    metric.unit === '%' ? 5 :
    metric.unit === 'ratio' ? 0.5 :
    100;

  let level = (rand() - 0.5) * scale;
  for (let i = 0; i < days; i++) {
    // Mean-reverting-ish random walk + occasional spikes
    const shock = (rand() - 0.5) * scale * 0.35;
    const revert = -level * 0.02;
    const spike = rand() < 0.03 ? (rand() - 0.5) * scale * 4 : 0;
    level = level + shock + revert + spike;

    if (metric.windowMethod === 'sum') {
      // flow-like series: centered around 0
      out.push(level * 0.15 + (rand() - 0.5) * scale * 0.25);
    } else {
      // level-like series
      out.push(level);
    }
  }
  return out;
}

function defaultBaselineDays(windowDays: number) {
  return clamp(Math.round(windowDays * 12), 90, 365);
}

export function buildSmartMoneyWindow(params: {
  assetClass: AssetClass;
  windowDays: number;
  baselineDays?: number;
  asOf?: number;
}) : SmartMoneyWindowResult {
  const { assetClass, windowDays } = params;
  const baselineDays = params.baselineDays ?? defaultBaselineDays(windowDays);
  const asOf = params.asOf ?? Date.now();

  const metrics = SMART_MONEY_METRICS.filter(m => m.applicableTo.includes(assetClass));
  const days = Math.max(400, baselineDays + windowDays + 30);

  const snapshots: MetricSnapshot[] = metrics.map((metric) => {
    const seed = hashString(`${assetClass}:${metric.id}`);
    const daily = genMockDailyValues(metric, days, seed);
    const windowed = rollingWindow(daily, windowDays, metric.windowMethod);
    const { z, hasHistory } = zScoreOfLatest(windowed, baselineDays);
    const signedZ = directionToSign(metric.direction) * z;
    const spark = windowed
      .filter(v => Number.isFinite(v))
      .slice(-60);

    const windowValue = Number.isFinite(windowed[windowed.length - 1]) ? windowed[windowed.length - 1] : 0;
    return { metric, windowValue, z, signedZ, spark, hasHistory };
  });

  const weighted = snapshots
    .filter(s => s.metric.direction !== 'neutral' && s.hasHistory)
    .map(s => ({ w: s.metric.defaultWeight, z: s.signedZ }));

  const denom = weighted.reduce((a, b) => a + Math.abs(b.w), 0);
  const scoreZ = denom > 0 ? (weighted.reduce((a, b) => a + b.w * b.z, 0) / denom) : 0;
  const scorePct = clamp(scoreZ, -3, 3) / 3 * 100;

  const biasLabel: SmartMoneyWindowResult['biasLabel'] =
    scoreZ >= 0.6 ? 'Accumulation' :
    scoreZ <= -0.6 ? 'Distribution' :
    'Neutral';

  const buckets: ScoreBucket[] = [
    'Tổng hợp',
    'Dòng tiền',
    'Thanh khoản',
    'Vị thế',
    'Phái sinh',
    'Options',
    'On-chain',
    'Vật chất',
    'Vĩ mô',
    'Tâm lý',
  ];

  const bucketScores: SmartMoneyWindowResult['bucketScores'] = Object.fromEntries(
    buckets.map((b) => [b, { z: 0, pct: 0, coverage: 0, total: 0 }])
  ) as SmartMoneyWindowResult['bucketScores'];

  for (const bucket of buckets) {
    if (bucket === 'Tổng hợp') continue;
    const items = snapshots.filter(s => s.metric.bucket === bucket);
    const usable = items.filter(s => s.metric.direction !== 'neutral' && s.hasHistory);
    const denomB = usable.reduce((a, s) => a + Math.abs(s.metric.defaultWeight), 0);
    const zB = denomB > 0
      ? usable.reduce((a, s) => a + s.metric.defaultWeight * s.signedZ, 0) / denomB
      : 0;
    bucketScores[bucket] = {
      z: zB,
      pct: clamp(zB, -3, 3) / 3 * 100,
      coverage: usable.length,
      total: items.length,
    };
  }

  bucketScores['Tổng hợp'] = {
    z: scoreZ,
    pct: scorePct,
    coverage: weighted.length,
    total: snapshots.length,
  };

  return {
    assetClass,
    windowDays,
    baselineDays,
    asOf,
    scoreZ,
    scorePct,
    biasLabel,
    bucketScores,
    snapshots,
  };
}

export function formatMetricValue(value: number, unit: MetricUnit) {
  if (!Number.isFinite(value)) return '-';

  if (unit === 'USD') {
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`;
    return `${sign}$${abs.toFixed(0)}`;
  }

  if (unit === '%') return `${value.toFixed(2)}%`;
  if (unit === 'bps') return `${value.toFixed(0)} bps`;
  if (unit === 'contracts') return `${Math.round(value).toLocaleString('en-US')} ct`;
  if (unit === 'tokens') return `${Math.round(value).toLocaleString('en-US')} tok`;
  if (unit === 'ratio') return value.toFixed(3);
  return value.toFixed(2);
}
