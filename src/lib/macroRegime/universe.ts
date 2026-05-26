import type { MacroAssetClass } from './types';

export type MacroCurrency = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CHF' | 'CAD' | 'AUD' | 'NZD' | 'CNY';

export interface MacroAssetDef {
  assetId: string;
  assetClass: MacroAssetClass;
  displayName: string;
  homeCurrency?: MacroCurrency;
  // Yahoo ticker used only for market-confirmation layer.
  yahooTicker?: string;
}

export const FX_PAIRS: MacroAssetDef[] = [
  // Majors
  { assetId: 'EUR/USD', assetClass: 'FX', displayName: 'EUR/USD', yahooTicker: 'EURUSD=X' },
  { assetId: 'GBP/USD', assetClass: 'FX', displayName: 'GBP/USD', yahooTicker: 'GBPUSD=X' },
  { assetId: 'USD/JPY', assetClass: 'FX', displayName: 'USD/JPY', yahooTicker: 'USDJPY=X' },
  { assetId: 'USD/CHF', assetClass: 'FX', displayName: 'USD/CHF', yahooTicker: 'USDCHF=X' },
  { assetId: 'USD/CAD', assetClass: 'FX', displayName: 'USD/CAD', yahooTicker: 'USDCAD=X' },
  { assetId: 'AUD/USD', assetClass: 'FX', displayName: 'AUD/USD', yahooTicker: 'AUDUSD=X' },
  { assetId: 'NZD/USD', assetClass: 'FX', displayName: 'NZD/USD', yahooTicker: 'NZDUSD=X' },

  // Cross pairs
  { assetId: 'EUR/GBP', assetClass: 'FX', displayName: 'EUR/GBP', yahooTicker: 'EURGBP=X' },
  { assetId: 'EUR/JPY', assetClass: 'FX', displayName: 'EUR/JPY', yahooTicker: 'EURJPY=X' },
  { assetId: 'EUR/CHF', assetClass: 'FX', displayName: 'EUR/CHF', yahooTicker: 'EURCHF=X' },
  { assetId: 'EUR/CAD', assetClass: 'FX', displayName: 'EUR/CAD', yahooTicker: 'EURCAD=X' },
  { assetId: 'EUR/AUD', assetClass: 'FX', displayName: 'EUR/AUD', yahooTicker: 'EURAUD=X' },
  { assetId: 'EUR/NZD', assetClass: 'FX', displayName: 'EUR/NZD', yahooTicker: 'EURNZD=X' },
  { assetId: 'GBP/JPY', assetClass: 'FX', displayName: 'GBP/JPY', yahooTicker: 'GBPJPY=X' },
  { assetId: 'GBP/CHF', assetClass: 'FX', displayName: 'GBP/CHF', yahooTicker: 'GBPCHF=X' },
  { assetId: 'GBP/CAD', assetClass: 'FX', displayName: 'GBP/CAD', yahooTicker: 'GBPCAD=X' },
  { assetId: 'GBP/AUD', assetClass: 'FX', displayName: 'GBP/AUD', yahooTicker: 'GBPAUD=X' },
  { assetId: 'GBP/NZD', assetClass: 'FX', displayName: 'GBP/NZD', yahooTicker: 'GBPNZD=X' },
  { assetId: 'AUD/JPY', assetClass: 'FX', displayName: 'AUD/JPY', yahooTicker: 'AUDJPY=X' },
  { assetId: 'AUD/CHF', assetClass: 'FX', displayName: 'AUD/CHF', yahooTicker: 'AUDCHF=X' },
  { assetId: 'AUD/CAD', assetClass: 'FX', displayName: 'AUD/CAD', yahooTicker: 'AUDCAD=X' },
  { assetId: 'AUD/NZD', assetClass: 'FX', displayName: 'AUD/NZD', yahooTicker: 'AUDNZD=X' },
  { assetId: 'NZD/JPY', assetClass: 'FX', displayName: 'NZD/JPY', yahooTicker: 'NZDJPY=X' },
  { assetId: 'NZD/CHF', assetClass: 'FX', displayName: 'NZD/CHF', yahooTicker: 'NZDCHF=X' },
  { assetId: 'NZD/CAD', assetClass: 'FX', displayName: 'NZD/CAD', yahooTicker: 'NZDCAD=X' },
  { assetId: 'CAD/JPY', assetClass: 'FX', displayName: 'CAD/JPY', yahooTicker: 'CADJPY=X' },
  { assetId: 'CAD/CHF', assetClass: 'FX', displayName: 'CAD/CHF', yahooTicker: 'CADCHF=X' },
  { assetId: 'CHF/JPY', assetClass: 'FX', displayName: 'CHF/JPY', yahooTicker: 'CHFJPY=X' },
];

export const COMMODITIES: MacroAssetDef[] = [
  { assetId: 'XAUUSD', assetClass: 'Commodity', displayName: 'Gold (XAUUSD)', yahooTicker: 'XAUUSD=X' },
  { assetId: 'XAGUSD', assetClass: 'Commodity', displayName: 'Silver (XAGUSD)', yahooTicker: 'XAGUSD=X' },
  { assetId: 'WTI', assetClass: 'Commodity', displayName: 'Crude Oil (WTI)', yahooTicker: 'CL=F' },
];

export const INDICES: MacroAssetDef[] = [
  { assetId: 'SPX', assetClass: 'Index', displayName: 'S&P 500', homeCurrency: 'USD', yahooTicker: '^GSPC' },
  { assetId: 'NDX', assetClass: 'Index', displayName: 'Nasdaq 100', homeCurrency: 'USD', yahooTicker: '^NDX' },
  { assetId: 'DJI', assetClass: 'Index', displayName: 'Dow Jones', homeCurrency: 'USD', yahooTicker: '^DJI' },
  { assetId: 'RUT', assetClass: 'Index', displayName: 'Russell 2000', homeCurrency: 'USD', yahooTicker: '^RUT' },
  { assetId: 'DAX', assetClass: 'Index', displayName: 'DAX', homeCurrency: 'EUR', yahooTicker: '^GDAXI' },
  { assetId: 'FTSE', assetClass: 'Index', displayName: 'FTSE 100', homeCurrency: 'GBP', yahooTicker: '^FTSE' },
  { assetId: 'NIKKEI', assetClass: 'Index', displayName: 'Nikkei 225', homeCurrency: 'JPY', yahooTicker: '^N225' },
  { assetId: 'HSI', assetClass: 'Index', displayName: 'Hang Seng', homeCurrency: 'CNY', yahooTicker: '^HSI' },
  { assetId: 'ASX200', assetClass: 'Index', displayName: 'ASX 200', homeCurrency: 'AUD', yahooTicker: '^AXJO' },
  { assetId: 'EUROSTOXX50', assetClass: 'Index', displayName: 'Euro Stoxx 50', homeCurrency: 'EUR', yahooTicker: '^STOXX50E' },
];

export const MACRO_ASSETS: MacroAssetDef[] = [...FX_PAIRS, ...COMMODITIES, ...INDICES];

export function fxPairCurrencies(pair: string): { base: MacroCurrency; quote: MacroCurrency } | null {
  const parts = pair.split('/');
  if (parts.length !== 2) return null;
  const base = parts[0]?.trim().toUpperCase() as MacroCurrency;
  const quote = parts[1]?.trim().toUpperCase() as MacroCurrency;
  if (!base || !quote) return null;
  return { base, quote };
}

