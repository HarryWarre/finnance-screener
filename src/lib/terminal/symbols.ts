import type { AssetClass } from '../smartMoney';
import type { Security, SecurityType } from './types';
import { uuid } from './utils';

type ResolveResult = {
  ok: true;
  security: Omit<Security, 'id' | 'createdAt' | 'updatedAt'>;
} | {
  ok: false;
  reasonVi: string;
};

const INDEX_ALIASES: Record<string, { symbol: string; nameVi: string }> = {
  SPX: { symbol: '^GSPC', nameVi: 'S&P 500' },
  SP500: { symbol: '^GSPC', nameVi: 'S&P 500' },
  NDX: { symbol: '^NDX', nameVi: 'Nasdaq 100' },
  DJI: { symbol: '^DJI', nameVi: 'Dow Jones' },
  VIX: { symbol: '^VIX', nameVi: 'VIX' },
  DXY: { symbol: 'DX-Y.NYB', nameVi: 'US Dollar Index' },
};

const FUTURE_ALIASES: Record<string, { symbol: string; nameVi: string; securityType: SecurityType; assetClass: AssetClass }> = {
  GOLD: { symbol: 'GC=F', nameVi: 'Vàng (Gold Futures)', securityType: 'Future', assetClass: 'Futures' },
  GC: { symbol: 'GC=F', nameVi: 'Vàng (Gold Futures)', securityType: 'Future', assetClass: 'Futures' },
  OIL: { symbol: 'CL=F', nameVi: 'Dầu WTI (Crude Futures)', securityType: 'Future', assetClass: 'Futures' },
  CL: { symbol: 'CL=F', nameVi: 'Dầu WTI (Crude Futures)', securityType: 'Future', assetClass: 'Futures' },
  NG: { symbol: 'NG=F', nameVi: 'Khí tự nhiên (NatGas Futures)', securityType: 'Future', assetClass: 'Futures' },
  SILVER: { symbol: 'SI=F', nameVi: 'Bạc (Silver Futures)', securityType: 'Future', assetClass: 'Futures' },
  SI: { symbol: 'SI=F', nameVi: 'Bạc (Silver Futures)', securityType: 'Future', assetClass: 'Futures' },

  CORN: { symbol: 'ZC=F', nameVi: 'Ngô (Corn Futures)', securityType: 'Agriculture', assetClass: 'Agriculture' },
  ZC: { symbol: 'ZC=F', nameVi: 'Ngô (Corn Futures)', securityType: 'Agriculture', assetClass: 'Agriculture' },
  WHEAT: { symbol: 'ZW=F', nameVi: 'Lúa mì (Wheat Futures)', securityType: 'Agriculture', assetClass: 'Agriculture' },
  ZW: { symbol: 'ZW=F', nameVi: 'Lúa mì (Wheat Futures)', securityType: 'Agriculture', assetClass: 'Agriculture' },
  SOY: { symbol: 'ZS=F', nameVi: 'Đậu tương (Soybean Futures)', securityType: 'Agriculture', assetClass: 'Agriculture' },
  ZS: { symbol: 'ZS=F', nameVi: 'Đậu tương (Soybean Futures)', securityType: 'Agriculture', assetClass: 'Agriculture' },
  COFFEE: { symbol: 'KC=F', nameVi: 'Cà phê (Coffee Futures)', securityType: 'Agriculture', assetClass: 'Agriculture' },
  KC: { symbol: 'KC=F', nameVi: 'Cà phê (Coffee Futures)', securityType: 'Agriculture', assetClass: 'Agriculture' },
  SUGAR: { symbol: 'SB=F', nameVi: 'Đường (Sugar Futures)', securityType: 'Agriculture', assetClass: 'Agriculture' },
  SB: { symbol: 'SB=F', nameVi: 'Đường (Sugar Futures)', securityType: 'Agriculture', assetClass: 'Agriculture' },
  COTTON: { symbol: 'CT=F', nameVi: 'Bông (Cotton Futures)', securityType: 'Agriculture', assetClass: 'Agriculture' },
  CT: { symbol: 'CT=F', nameVi: 'Bông (Cotton Futures)', securityType: 'Agriculture', assetClass: 'Agriculture' },
  COCOA: { symbol: 'CC=F', nameVi: 'Ca cao (Cocoa Futures)', securityType: 'Agriculture', assetClass: 'Agriculture' },
  CC: { symbol: 'CC=F', nameVi: 'Ca cao (Cocoa Futures)', securityType: 'Agriculture', assetClass: 'Agriculture' },
};

function normalizeQuery(q: string) {
  return q.trim().replaceAll(/\s+/g, '').toUpperCase();
}

function parseFx(q: string): { symbol: string; base: string; quote: string } | null {
  // EURUSD, EUR/USD, EURUSD=X
  const raw = normalizeQuery(q).replaceAll('/', '');
  if (raw.endsWith('=X')) {
    const p = raw.slice(0, -2);
    if (p.length !== 6) return null;
    return { symbol: `${p}=X`, base: p.slice(0, 3), quote: p.slice(3) };
  }
  if (raw.length === 6) return { symbol: `${raw}=X`, base: raw.slice(0, 3), quote: raw.slice(3) };
  return null;
}

function parseCrypto(q: string): { symbol: string; base: string } | null {
  // BTC, BTCUSD, BTC-USD, BTCUSDT
  const raw = q.trim().toUpperCase();
  const cleaned = raw.replaceAll('/', '').replaceAll('-', '');
  if (cleaned.length < 3) return null;
  if (cleaned.endsWith('USDT')) return { symbol: `${cleaned.slice(0, -4)}-USD`, base: cleaned.slice(0, -4) };
  if (cleaned.endsWith('USD') && cleaned.length > 3) return { symbol: `${cleaned.slice(0, -3)}-USD`, base: cleaned.slice(0, -3) };
  if (/^[A-Z0-9]{3,10}$/.test(cleaned) && cleaned.length <= 6) return { symbol: `${cleaned}-USD`, base: cleaned };
  if (/^[A-Z0-9]{3,10}-USD$/.test(raw)) return { symbol: raw, base: raw.replace('-USD', '') };
  return null;
}

function detectSecurityType(assetClass: AssetClass, symbol: string): SecurityType {
  if (assetClass === 'Crypto') return 'Crypto';
  if (assetClass === 'Forex') return 'FX';
  if (assetClass === 'Agriculture') return 'Agriculture';
  if (assetClass === 'Futures') return 'Future';
  if (assetClass === 'Commodities') return 'Commodity';
  if (symbol.startsWith('^') || symbol.includes('.NYB')) return 'Index';
  return 'Stock';
}

export function resolveSymbolQuery(query: string): ResolveResult {
  const raw = query.trim();
  if (!raw) return { ok: false, reasonVi: 'Vui lòng nhập mã (ví dụ AAPL, BTC, EURUSD, GC, ZC, SPX).' };

  const norm = normalizeQuery(raw);

  // Pass-through Yahoo symbols (futures, indices, Vietnam suffix, etc.)
  // Examples: GC=F, ^VNINDEX.VN, VIC.VN, DX-Y.NYB, ^GSPC
  if (/^[\^A-Z0-9.-]+=F$/.test(norm) || norm.startsWith('^') || norm.endsWith('.VN') || norm.includes('.NYB')) {
    const symbol = norm;
    const isVn = symbol.endsWith('.VN') || symbol.includes('VNINDEX');
    const assetClass: AssetClass =
      isVn ? 'Stocks' :
      symbol.endsWith('=F') ? 'Futures' :
      symbol.includes('DX-Y') ? 'Forex' :
      'Stocks';
    const securityType = detectSecurityType(assetClass, symbol);
    return {
      ok: true,
      security: {
        query: raw,
        symbol,
        nameVi: isVn ? `Việt Nam ${symbol}` : symbol,
        assetClass,
        securityType,
        providerSymbols: { yahoo_chart: symbol },
      },
    };
  }

  // known indices
  if (INDEX_ALIASES[norm]) {
    const m = INDEX_ALIASES[norm];
    const assetClass: AssetClass = 'Stocks';
    return {
      ok: true,
      security: {
        query: raw,
        symbol: m.symbol,
        nameVi: m.nameVi,
        assetClass,
        securityType: 'Index',
        providerSymbols: { yahoo_chart: m.symbol },
      },
    };
  }

  // known futures/commodities/agri shorthands
  if (FUTURE_ALIASES[norm]) {
    const m = FUTURE_ALIASES[norm];
    return {
      ok: true,
      security: {
        query: raw,
        symbol: m.symbol,
        nameVi: m.nameVi,
        assetClass: m.assetClass,
        securityType: m.securityType,
        providerSymbols: { yahoo_chart: m.symbol },
      },
    };
  }

  // FX
  const fx = parseFx(raw);
  if (fx) {
    return {
      ok: true,
      security: {
        query: raw,
        symbol: fx.symbol,
        nameVi: `FX ${fx.base}/${fx.quote}`,
        assetClass: 'Forex',
        securityType: 'FX',
        providerSymbols: { yahoo_chart: fx.symbol },
      },
    };
  }

  // Crypto
  const cr = parseCrypto(raw);
  if (cr) {
    return {
      ok: true,
      security: {
        query: raw,
        symbol: cr.symbol,
        nameVi: `Crypto ${cr.base}`,
        assetClass: 'Crypto',
        securityType: 'Crypto',
        providerSymbols: { yahoo_chart: cr.symbol },
      },
    };
  }

  // Yahoo stock/ETF as-is
  if (/^[A-Z][A-Z0-9.\\-]{0,14}$/.test(norm)) {
    const assetClass: AssetClass = 'Stocks';
    const symbol = norm;
    return {
      ok: true,
      security: {
        query: raw,
        symbol,
        nameVi: `Cổ phiếu ${symbol}`,
        assetClass,
        securityType: detectSecurityType(assetClass, symbol),
        providerSymbols: { yahoo_chart: symbol },
      },
    };
  }

  return { ok: false, reasonVi: 'Không nhận diện được mã. Thử các dạng: AAPL, BTC, BTCUSDT, EURUSD, SPX, GC, ZC.' };
}

export function createSecurityFromResolved(resolved: ResolveResult & { ok: true }): Security {
  const now = Date.now();
  return {
    id: uuid(),
    ...resolved.security,
    createdAt: now,
    updatedAt: now,
  };
}
