import type { Alert, Security, WatchlistItem } from './types';
import { dbGetSecurity, dbListAlerts, dbListSecurities, dbListWatchlist, dbPutAlert, dbPutSecurity, dbPutWatchlistItem, dbDeleteWatchlistItem, dbDeleteAlert } from './idb';
import { createSecurityFromResolved, resolveSymbolQuery } from './symbols';
import { uuid } from './utils';

export async function addToWatchlist(query: string) {
  const resolved = resolveSymbolQuery(query);
  if (!resolved.ok) return { ok: false as const, reasonVi: resolved.reasonVi };
  const sec = createSecurityFromResolved(resolved);
  await dbPutSecurity(sec);
  const item: WatchlistItem = { id: uuid(), securityId: sec.id, addedAt: Date.now() };
  await dbPutWatchlistItem(item);
  return { ok: true as const, security: sec, watchlistItem: item };
}

export async function removeFromWatchlist(watchlistItemId: string) {
  await dbDeleteWatchlistItem(watchlistItemId);
}

export async function loadTerminalSnapshot() {
  const [securities, watchlist, alerts] = await Promise.all([
    dbListSecurities(),
    dbListWatchlist(),
    dbListAlerts(),
  ]);

  const securitiesById: Record<string, Security> = {};
  for (const s of securities) securitiesById[s.id] = s;
  return { securities, securitiesById, watchlist, alerts };
}

export async function getSecurity(id: string) {
  return dbGetSecurity(id);
}

export async function saveAlert(alert: Alert) {
  await dbPutAlert(alert);
}

export async function deleteAlert(id: string) {
  await dbDeleteAlert(id);
}

