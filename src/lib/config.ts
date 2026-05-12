export const MARKETS = ["US Stocks", "VN Stocks"] as const;
export type MarketType = typeof MARKETS[number];

export const SECTORS = {
  "US Stocks": ["Information Technology", "Financials", "Health Care", "Consumer Discretionary"],
  "VN Stocks": ["Finance (Banks & Securities)", "Real Estate", "Industrials & Materials", "Consumer"]
};

export const SYMBOLS: Record<string, string[]> = {
  // US Top 20 by Sector
  "Information Technology": [
    "AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "CSCO", "CRM", "AMD", "QCOM", "TXN",
    "IBM", "INTC", "INTU", "NOW", "AMAT", "UBER", "MU", "PANW", "SNPS", "CDNS"
  ],
  "Financials": [
    "BRK-B", "JPM", "V", "MA", "BAC", "WFC", "SPGI", "AXP", "GS", "MS",
    "BLK", "C", "CB", "MMC", "PGR", "SCHW", "CME", "FI", "AON", "ICE"
  ],
  "Health Care": [
    "LLY", "UNH", "JNJ", "MRK", "ABBV", "TMO", "ABT", "DHR", "PFE", "AMGN",
    "ISRG", "SYK", "MDT", "VRTX", "ELV", "BSX", "REGN", "ZTS", "COR", "CI"
  ],
  "Consumer Discretionary": [
    "AMZN", "TSLA", "HD", "MCD", "NKE", "SBUX", "LOW", "BKNG", "TJX", "CMG",
    "MAR", "ORLY", "ABNB", "LVS", "ROST", "HLT", "YUM", "TSCO", "DHI", "LEN"
  ],

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
  ]
};

export const DEFAULT_PARAMS = {
  lookback: 100,
  zScoreThreshold: 2.0,
  hurstThreshold: 0.5,
  useFundamental: true,
  maxPe: 25.0,
  minRoe: 10.0
};
