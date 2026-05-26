export const MARKETS = ["US Stocks", "VN Stocks"] as const;
export type MarketType = typeof MARKETS[number];

export const SECTORS = {
  // GICS 11 sectors (S&P 500)
  "US Stocks": [
    "Energy",
    "Materials",
    "Industrials",
    "Utilities",
    "Health Care",
    "Financials",
    "Consumer Discretionary",
    "Consumer Staples",
    "Information Technology",
    "Communication Services",
    "Real Estate",
  ],
  "VN Stocks": ["Finance (Banks & Securities)", "Real Estate", "Industrials & Materials", "Consumer"]
};

export const SYMBOLS: Record<MarketType, Record<string, string[]>> = {
  "US Stocks": {
    // US Top 20 by Sector (GICS)
    "Energy": [
      "XOM", "CVX", "COP", "SLB", "EOG", "MPC", "VLO", "PSX", "KMI", "OXY",
      "WMB", "HAL", "DVN", "APA", "TRGP", "OKE", "HES", "BKR", "EQT", "FANG"
    ],
    "Materials": [
      "LIN", "SHW", "APD", "ECL", "NEM", "FCX", "DOW", "DD", "NUE", "VMC",
      "MLM", "PPG", "ALB", "CF", "IFF", "IP", "EMN", "MOS", "STLD", "LYB"
    ],
    "Industrials": [
      "GE", "CAT", "RTX", "BA", "UNP", "ETN", "UBER", "DE", "HON", "LMT",
      "GD", "NOC", "UPS", "CSX", "NSC", "PH", "TT", "PWR", "EMR", "CARR"
    ],
    "Utilities": [
      "NEE", "CEG", "SO", "DUK", "AEP", "SRE", "EXC", "XEL", "PCG", "PEG",
      "ED", "WEC", "ETR", "PPL", "D", "AES", "CMS", "NI", "ATO", "AWK"
    ],
    "Health Care": [
      "LLY", "UNH", "JNJ", "MRK", "ABBV", "TMO", "ABT", "DHR", "PFE", "AMGN",
      "ISRG", "SYK", "MDT", "VRTX", "ELV", "BSX", "REGN", "ZTS", "COR", "CI"
    ],
    "Financials": [
      "BRK-B", "JPM", "V", "MA", "BAC", "WFC", "SPGI", "AXP", "GS", "MS",
      "BLK", "C", "CB", "MMC", "PGR", "SCHW", "CME", "FI", "AON", "ICE"
    ],
    "Consumer Discretionary": [
      "AMZN", "TSLA", "HD", "MCD", "NKE", "SBUX", "LOW", "BKNG", "TJX", "CMG",
      "MAR", "ORLY", "ABNB", "LVS", "ROST", "HLT", "YUM", "TSCO", "DHI", "LEN"
    ],
    "Consumer Staples": [
      "WMT", "COST", "PG", "KO", "PM", "PEP", "MO", "MDLZ", "CL", "MNST",
      "KMB", "GIS", "KHC", "HSY", "SYY", "DG", "KR", "CHD", "KDP", "ADM"
    ],
    "Information Technology": [
      "AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "CSCO", "CRM", "AMD", "QCOM", "TXN",
      "IBM", "INTC", "INTU", "NOW", "AMAT", "MU", "PANW", "SNPS", "CDNS", "ADBE"
    ],
    "Communication Services": [
      "GOOGL", "GOOG", "META", "NFLX", "TMUS", "VZ", "T", "DIS", "CMCSA", "CHTR",
      "EA", "TTWO", "WBD", "PARA", "FOXA", "FOX", "NWSA", "NWS", "LYV", "IPG"
    ],
    "Real Estate": [
      "PLD", "AMT", "EQIX", "SPG", "DLR", "O", "PSA", "CBRE", "CCI", "WELL",
      "VICI", "AVB", "EQR", "INVH", "SBAC", "WY", "HST", "ESS", "KIM", "BXP"
    ],
  },
  "VN Stocks": {
    // VN Top 20 by Sector (using Yahoo Finance suffixes: .HM for HOSE)
    "Finance (Banks & Securities)": [
      "VCB.HM", "BID.HM", "CTG.HM", "TCB.HM", "VPB.HM", "MBB.HM", "ACB.HM", "STB.HM", "SSI.HM", "VND.HM",
      "HDB.HM", "VIB.HM", "SHB.HM", "SSB.HM", "EIB.HM", "MSB.HM", "LPB.HM", "TPB.HM", "OCB.HM", "HCM.HM"
    ],
    "Real Estate": [
      "VHM.HM", "VIC.HM", "VRE.HM", "NVL.HM", "KDH.HM", "NLG.HM", "PDR.HM", "DIG.HM", "DXG.HM", "HDG.HM",
      "KBC.HM", "SZC.HM", "IDC.HN", "CEO.HN", "TCH.HM", "CRE.HM", "IJC.HM", "NBB.HM", "HDC.HM", "SJS.HM"
    ],
    "Industrials & Materials": [
      "HPG.HM", "GEX.HM", "PC1.HM", "HSG.HM", "NKG.HM", "VGC.HM", "DGC.HM", "DCM.HM", "DPM.HM", "REE.HM",
      "CII.HM", "HHV.HM", "VCG.HM", "LCG.HM", "FCN.HM", "BMP.HM", "NTP.HN", "VCS.HN", "PTB.HM", "AAA.HM"
    ],
    "Consumer": [
      "VNM.HM", "MSN.HM", "SAB.HM", "PNJ.HM", "MWG.HM", "FRT.HM", "DGW.HM", "PET.HM", "KDC.HM", "DBC.HM",
      "BAF.HM", "HAG.HM", "VHC.HM", "ANV.HM", "IDI.HM", "FMC.HM", "VPI.HM", "TLG.HM", "RAL.HM", "SBT.HM"
    ],
  },
};

// ── Crypto Universe (CoinGecko IDs) ─────────────────────────────────────────
// IDs follow CoinGecko's `id` field (e.g. "bitcoin", "ethereum").
export const CRYPTO_SECTORS = [
  'Majors',
  'Layer 1',
  'Layer 2',
  'DeFi',
  'CeFi/Exchange',
  'Stablecoins',
  'Meme',
  'AI',
  'Gaming',
  'RWA',
  'Oracles',
  'Infra',
] as const;

export type CryptoSector = typeof CRYPTO_SECTORS[number];

export const CRYPTO_UNIVERSE: Record<CryptoSector, string[]> = {
  Majors: [
    'bitcoin',
    'ethereum',
    'tether',
    'usd-coin',
    'binancecoin',
    'solana',
    'ripple',
    'dogecoin',
    'tron',
    'cardano',
    'avalanche-2',
    'polkadot',
    'chainlink',
    'polygon-ecosystem-token',
    'litecoin',
    'bitcoin-cash',
  ],
  'Layer 1': [
    'ethereum',
    'solana',
    'avalanche-2',
    'cardano',
    'polkadot',
    'cosmos',
    'near',
    'aptos',
    'sui',
    'algorand',
    'tezos',
    'fantom',
    'hedera-hashgraph',
    'injective-protocol',
    'internet-computer',
  ],
  'Layer 2': [
    'arbitrum',
    'optimism',
    'polygon-ecosystem-token',
    'immutable-x',
    'loopring',
    'skale',
    'zksync',
    'starknet',
    'metis-token',
  ],
  DeFi: [
    'uniswap',
    'aave',
    'maker',
    'curve-dao-token',
    'compound-governance-token',
    'sushiswap',
    'pancakeswap-token',
    'yearn-finance',
    'synthetix-network-token',
    '1inch',
    'frax',
  ],
  'CeFi/Exchange': [
    'binancecoin',
    'okb',
    'crypto-com-chain',
    'bitget-token',
    'gatechain-token',
    'whitebit',
    'mx-token',
    'kucoin-shares',
    'leo-token',
  ],
  Stablecoins: [
    'tether',
    'usd-coin',
    'dai',
    'true-usd',
    'frax',
    'first-digital-usd',
    'paypal-usd',
  ],
  Meme: [
    'dogecoin',
    'shiba-inu',
    'pepe',
    'bonk',
    'dogwifcoin',
    'floki',
    'mog-coin',
  ],
  AI: [
    'bittensor',
    'render-token',
    'fetch-ai',
    'singularitynet',
    'ocean-protocol',
    'akash-network',
  ],
  Gaming: [
    'immutable-x',
    'the-sandbox',
    'decentraland',
    'axie-infinity',
    'gala',
    'enjincoin',
    'illuvium',
    'ronin',
  ],
  RWA: [
    'ondo-finance',
    'maker',
    'centrifuge',
    'polymesh',
    'maple',
    'plume',
  ],
  Oracles: [
    'chainlink',
    'band-protocol',
    'tellor',
    'api3',
  ],
  Infra: [
    'chainlink',
    'filecoin',
    'the-graph',
    'arweave',
    'theta-token',
    'helium',
    'quant-network',
    'internet-computer',
  ],
};

export const INTERVALS = ['1d', '1h', '60m', '30m', '15m', '5m', '1m'] as const;
export type Interval = typeof INTERVALS[number];

export const DEFAULT_PARAMS = {
  lookback: 100,
  zScoreThreshold: 2.0,
  hurstThreshold: 0.5,
  interval: '1d' as Interval,
  useCustomSymbols: false,
  customSymbols: '',
  customSymbolsLimit: 50,
  useFundamental: true,
  maxPe: 25.0,
  minRoe: 10.0
};
