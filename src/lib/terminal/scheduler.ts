import type { Security, StoredSeries } from './types';
import { dbGetSeries } from './idb';
import { seriesId } from './series';
import { syncYahooDailyOHLCV } from './ingest';

export type AutoSyncConfig = {
  enabled: boolean;
  intervalMinutes: number;
  maxPerCycle: number; // tránh rate limit
  minRefreshMinutesPerSymbol: number;
};

const DEFAULTS: AutoSyncConfig = {
  enabled: true,
  intervalMinutes: 15,
  maxPerCycle: 8,
  minRefreshMinutesPerSymbol: 20,
};

function pickToSync(securities: Security[], closeSeriesById: Record<string, StoredSeries | undefined>, cfg: AutoSyncConfig) {
  const now = Date.now();
  const minMs = cfg.minRefreshMinutesPerSymbol * 60 * 1000;

  const scored = securities.map((sec) => {
    const close = closeSeriesById[sec.id];
    const lastUpd = close?.updatedAt ?? 0;
    const staleness = now - lastUpd;
    const isEligible = staleness >= minMs;
    const penalty = sec.assetClass === 'Stocks' ? 1 : 0; // small bias to keep mix
    return { sec, isEligible, staleness, penalty };
  });

  return scored
    .filter(x => x.isEligible)
    .sort((a, b) => (b.staleness - a.staleness) + (a.penalty - b.penalty))
    .slice(0, cfg.maxPerCycle)
    .map(x => x.sec);
}

async function loadCloseSeriesMap(securities: Security[]) {
  const map: Record<string, StoredSeries | undefined> = {};
  for (const sec of securities) {
    map[sec.id] = await dbGetSeries(seriesId(sec.id, 'yahoo_chart', '1d', 'close'));
  }
  return map;
}

export function startAutoScheduler(params: {
  getSecurities: () => Promise<{ securitiesById: Record<string, Security> }>;
  onCycle?: (info: { synced: number; evaluated: boolean; at: number }) => void;
  config?: Partial<AutoSyncConfig>;
}) {
  const cfg: AutoSyncConfig = { ...DEFAULTS, ...(params.config ?? {}) };
  let timer: number | null = null;
  let running = false;

  const tick = async () => {
    if (!cfg.enabled) return;
    if (running) return;
    running = true;
    try {
      const snap = await params.getSecurities();
      const securities = Object.values(snap.securitiesById);
      const closeMap = await loadCloseSeriesMap(securities);
      const toSync = pickToSync(securities, closeMap, cfg);

      let synced = 0;
      for (const sec of toSync) {
        const res = await syncYahooDailyOHLCV(sec, '1y');
        if (res.ok) synced += 1;
      }

      params.onCycle?.({ synced, evaluated: false, at: Date.now() });
    } finally {
      running = false;
    }
  };

  const start = () => {
    if (timer !== null) return;
    const ms = Math.max(2, Math.floor(cfg.intervalMinutes)) * 60 * 1000;
    timer = window.setInterval(() => { void tick(); }, ms);
    void tick(); // chạy ngay 1 vòng khi start
  };

  const stop = () => {
    if (timer === null) return;
    window.clearInterval(timer);
    timer = null;
  };

  return { start, stop, tick };
}
