import type { AssetClass } from '../smartMoney';
import type { Security, WatchlistItem } from './types';
import { createSecurityFromResolved, resolveSymbolQuery } from './symbols';
import { uuid } from './utils';
import { dbListSecurities, dbListWatchlist, dbPutSecurity, dbPutWatchlistItem } from './idb';

export type UniversePack = {
  id: string;
  nameVi: string;
  assetClass: AssetClass | 'Mixed';
  queries: string[];
};

export const DEFAULT_UNIVERSE_PACKS: UniversePack[] = [
  {
    id: 'core_crypto',
    nameVi: 'Crypto Core (Top coins)',
    assetClass: 'Crypto',
    queries: ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'DOT'],
  },
  {
    id: 'crypto_50',
    nameVi: 'Crypto Top 50 (mẫu)',
    assetClass: 'Crypto',
    queries: [
      'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'TRX', 'TON', 'AVAX',
      'LINK', 'DOT', 'MATIC', 'LTC', 'BCH', 'NEAR', 'ATOM', 'ICP', 'APT', 'SUI',
      'HBAR', 'XLM', 'FIL', 'ETC', 'XMR', 'ALGO', 'AAVE', 'UNI', 'OP', 'ARB',
      'INJ', 'RUNE', 'IMX', 'GRT', 'MKR', 'LDO', 'STX', 'KAS', 'TIA', 'SEI',
      'FLOW', 'EGLD', 'SAND', 'MANA', 'AXS', 'THETA', 'SNX', 'KAVA', 'CRV', 'PEPE',
    ],
  },
  {
    id: 'core_fx',
    nameVi: 'FX Majors',
    assetClass: 'Forex',
    queries: ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD'],
  },
  {
    id: 'fx_40',
    nameVi: 'FX Majors + Crosses (~40)',
    assetClass: 'Forex',
    queries: [
      'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD',
      'EURJPY', 'EURGBP', 'EURAUD', 'EURNZD', 'EURCAD', 'EURCHF',
      'GBPJPY', 'GBPAUD', 'GBPCAD', 'GBPCHF', 'GBPNZD',
      'AUDJPY', 'AUDCAD', 'AUDCHF', 'AUDNZD',
      'CADJPY', 'CADCHF',
      'CHFJPY',
      'NZDJPY', 'NZDCAD', 'NZDCHF',
      'USDMXN', 'USDZAR', 'USDTRY', 'USDSEK', 'USDNOK', 'USDSGD',
      'EURSEK', 'EURNOK', 'EURTRY', 'EURPLN',
    ],
  },
  {
    id: 'core_indices',
    nameVi: 'Chỉ số (Index)',
    assetClass: 'Mixed',
    queries: ['SPX', 'NDX', 'DJI', 'VIX', 'DXY'],
  },
  {
    id: 'core_commodities',
    nameVi: 'Hàng hoá (Futures phổ biến)',
    assetClass: 'Futures',
    queries: ['GC', 'SI', 'CL', 'NG'],
  },
  {
    id: 'commodities_30',
    nameVi: 'Commodities/Futures (~30)',
    assetClass: 'Futures',
    queries: [
      'GC=F', 'SI=F', 'HG=F', 'PL=F', 'PA=F',
      'CL=F', 'BZ=F', 'NG=F', 'RB=F', 'HO=F',
      'ES=F', 'NQ=F', 'YM=F', 'RTY=F',
      'ZB=F', 'ZN=F', 'ZF=F', 'ZT=F',
      'DX-Y.NYB',
      '6E=F', '6B=F', '6J=F', '6A=F', '6C=F', '6S=F', '6N=F',
      'ZC=F', 'ZW=F', 'ZS=F',
    ],
  },
  {
    id: 'core_agri',
    nameVi: 'Nông sản (Futures phổ biến)',
    assetClass: 'Agriculture',
    queries: ['ZC', 'ZW', 'ZS', 'KC', 'SB', 'CT', 'CC'],
  },
  {
    id: 'agri_25',
    nameVi: 'Nông sản (~25)',
    assetClass: 'Agriculture',
    queries: [
      'ZC=F', 'ZW=F', 'ZS=F', 'ZL=F', 'ZM=F', 'ZR=F',
      'KC=F', 'SB=F', 'CT=F', 'CC=F',
      'OJ=F', 'LB=F',
      'LE=F', 'HE=F',
      'GF=F',
      'KE=F', 'ZO=F', 'ZR=F',
      'DC=F', 'DX=F',
      'MG=F',
      'GF=F',
      'RR=F',
    ],
  },
  {
    id: 'core_stocks',
    nameVi: 'Cổ phiếu Large Cap (mẫu)',
    assetClass: 'Stocks',
    queries: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'BRK-B', 'JPM', 'UNH'],
  },
  {
    id: 'us_stocks_50',
    nameVi: 'US Large Cap (~50)',
    assetClass: 'Stocks',
    queries: [
      'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'BRK-B', 'JPM', 'UNH',
      'XOM', 'LLY', 'V', 'MA', 'AVGO', 'COST', 'WMT', 'HD', 'PG', 'KO',
      'PEP', 'MRK', 'ABBV', 'CRM', 'NFLX', 'AMD', 'INTC', 'CSCO', 'ADBE', 'ORCL',
      'BAC', 'WFC', 'GS', 'MS', 'BLK', 'SPY', 'QQQ', 'IWM', 'DIA', 'XLK',
      'XLV', 'XLE', 'XLF', 'SMH', 'SOXX', 'TLT', 'IEF', 'HYG', 'GLD', 'SLV',
    ],
  },
  {
    id: 'vn_vn30',
    nameVi: 'Việt Nam: VNINDEX + VN30 (mẫu)',
    assetClass: 'Stocks',
    queries: [
      '^VNINDEX.VN',
      'VIC.VN', 'VHM.VN', 'VCB.VN', 'BID.VN', 'CTG.VN', 'TCB.VN', 'MBB.VN', 'HPG.VN', 'VNM.VN', 'MSN.VN',
      'FPT.VN', 'MWG.VN', 'VPB.VN', 'VRE.VN', 'GAS.VN', 'GVR.VN', 'SAB.VN', 'VIB.VN', 'SSI.VN', 'STB.VN',
      'VJC.VN', 'POW.VN', 'PLX.VN', 'BVH.VN', 'PNJ.VN', 'VTP.VN', 'KDH.VN', 'PDR.VN', 'VND.VN', 'HDB.VN',
    ],
  },
];

const DEFAULT_AUTO_PACK_IDS = [
  'crypto_50',
  'fx_40',
  'commodities_30',
  'agri_25',
  'us_stocks_50',
  'vn_vn30',
  'core_indices',
] as const;

// Alerts bị loại khỏi Terminal UI theo yêu cầu. (Giữ universe seed thuần watchlist.)

async function ensurePack(
  packId: string,
  existingBySymbol: Map<string, Security>,
  existingWatchBySecurityId: Set<string>
) {
  const pack = DEFAULT_UNIVERSE_PACKS.find(p => p.id === packId);
  if (!pack) return { added: 0, securities: [] as Security[] };

  let added = 0;
  const addedSecs: Security[] = [];

  for (const q of pack.queries) {
    const resolved = resolveSymbolQuery(q);
    if (!resolved.ok) continue;
    const sym = resolved.security.symbol.toUpperCase();
    const already = existingBySymbol.get(sym);
    if (already) {
      if (!existingWatchBySecurityId.has(already.id)) {
        const item: WatchlistItem = { id: uuid(), securityId: already.id, addedAt: Date.now() };
        await dbPutWatchlistItem(item);
        existingWatchBySecurityId.add(already.id);
        added += 1;
      }
      continue;
    }

    const sec = createSecurityFromResolved(resolved);
    existingBySymbol.set(sym, sec);
    addedSecs.push(sec);
    await dbPutSecurity(sec);
    const item: WatchlistItem = { id: uuid(), securityId: sec.id, addedAt: Date.now() };
    await dbPutWatchlistItem(item);
    existingWatchBySecurityId.add(sec.id);
    added += 1;
  }

  return { added, securities: addedSecs };
}

export async function seedDefaultUniverseAuto() {
  const [existingSec, existingWatch] = await Promise.all([dbListSecurities(), dbListWatchlist()]);
  const existingBySymbol = new Map<string, Security>(
    existingSec.map(s => [s.symbol.toUpperCase(), s])
  );
  const existingWatchBySecurityId = new Set<string>(existingWatch.map(w => w.securityId));

  let addedTotal = 0;
  const addedSecurities: Security[] = [];
  for (const id of DEFAULT_AUTO_PACK_IDS) {
    const res = await ensurePack(id, existingBySymbol, existingWatchBySecurityId);
    addedTotal += res.added;
    addedSecurities.push(...res.securities);
  }

  const allSecurities = [...existingSec, ...addedSecurities];
  return {
    ok: true as const,
    seeded: existingSec.length === 0 && existingWatch.length === 0,
    added: addedTotal,
    securities: allSecurities,
    watchlistCount: (await dbListWatchlist()).length,
  };
}
