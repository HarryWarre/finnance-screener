import type { Alert, AlertComparison, AlertEvent, AlertRule, Security, StoredSeries } from './types';
import { dbListAlerts, dbPutAlert, dbPutAlertEvent } from './idb';
import { pctChange } from './series';
import { uuid } from './utils';
import { buildSmartMoneyWindow } from '../smartMoney';

function cmp(compare: AlertComparison, now: number, prev: number | null, threshold: number) {
  switch (compare) {
    case '>': return now > threshold;
    case '>=': return now >= threshold;
    case '<': return now < threshold;
    case '<=': return now <= threshold;
    case 'crosses_above': return prev !== null && prev <= threshold && now > threshold;
    case 'crosses_below': return prev !== null && prev >= threshold && now < threshold;
  }
}

function withinCooldown(alert: Alert, firedAt: number) {
  if (!alert.lastTriggeredAt) return false;
  const cdMs = Math.max(0, alert.cooldownMinutes) * 60 * 1000;
  return firedAt - alert.lastTriggeredAt < cdMs;
}

function formatRuleVi(rule: AlertRule) {
  if (rule.type === 'price_change_pct') return `Giá thay đổi ${rule.windowDays}D ${rule.compare} ${rule.thresholdPct.toFixed(2)}%`;
  if (rule.type === 'price_cross') return `Giá ${rule.compare === 'crosses_above' ? 'cắt lên' : 'cắt xuống'} ${rule.price}`;
  if (rule.type === 'smart_money_score_pct') return `Smart Money Score (${rule.assetClass}) ${rule.windowDays}D ${rule.compare} ${rule.thresholdPct.toFixed(0)}%`;
  if (rule.type === 'smart_money_bucket_pct') return `Nhóm ${rule.bucket} (${rule.assetClass}) ${rule.windowDays}D ${rule.compare} ${rule.thresholdPct.toFixed(0)}%`;
  return `Metric ${rule.metricId} (${rule.assetClass}) ${rule.windowDays}D ${rule.compare} z=${rule.thresholdZ}`;
}

export async function evaluateAlerts(params: {
  securitiesById: Record<string, Security>;
  closeSeriesBySecurityId: Record<string, StoredSeries | undefined>;
}) {
  const alerts = (await dbListAlerts()).filter(a => a.enabled);
  const firedAt = Date.now();

  for (const alert of alerts) {
    if (withinCooldown(alert, firedAt)) continue;

    const res = await evaluateOneAlert(alert, params);
    if (!res) continue;

    const event: AlertEvent = {
      id: uuid(),
      alertId: alert.id,
      firedAt,
      messageVi: res.messageVi,
      snapshot: res.snapshot,
    };
    await dbPutAlertEvent(event);
    await dbPutAlert({ ...alert, lastTriggeredAt: firedAt, updatedAt: firedAt });
  }
}

async function evaluateOneAlert(
  alert: Alert,
  params: {
    securitiesById: Record<string, Security>;
    closeSeriesBySecurityId: Record<string, StoredSeries | undefined>;
  }
): Promise<{ messageVi: string; snapshot: Record<string, unknown> } | null> {
  const rule = alert.rule;

  if (rule.type === 'price_change_pct') {
    if (!alert.securityId) return null;
    const sec = params.securitiesById[alert.securityId];
    const series = params.closeSeriesBySecurityId[alert.securityId];
    if (!sec || !series) return null;
    const nowPct = pctChange(series, rule.windowDays);
    if (nowPct === null) return null;
    const prevPct = null;
    const ok = cmp(rule.compare, nowPct, prevPct, rule.thresholdPct);
    if (!ok) return null;
    return {
      messageVi: `[${sec.symbol}] ${alert.nameVi}: ${nowPct.toFixed(2)}% (${formatRuleVi(rule)})`,
      snapshot: { nowPct, rule, symbol: sec.symbol },
    };
  }

  if (rule.type === 'price_cross') {
    if (!alert.securityId) return null;
    const sec = params.securitiesById[alert.securityId];
    const series = params.closeSeriesBySecurityId[alert.securityId];
    if (!sec || !series?.points?.length) return null;
    const n = series.points.length;
    const now = series.points[n - 1].v;
    const prev = n >= 2 ? series.points[n - 2].v : null;
    const ok = cmp(rule.compare, now, prev, rule.price);
    if (!ok) return null;
    return {
      messageVi: `[${sec.symbol}] ${alert.nameVi}: giá ${now.toFixed(2)} (${formatRuleVi(rule)})`,
      snapshot: { now, prev, rule, symbol: sec.symbol },
    };
  }

  if (rule.type === 'smart_money_score_pct') {
    const rNow = buildSmartMoneyWindow({
      assetClass: rule.assetClass,
      windowDays: rule.windowDays,
      baselineDays: rule.baselineDays,
    });
    const now = rNow.scorePct;
    const ok = cmp(rule.compare, now, null, rule.thresholdPct);
    if (!ok) return null;
    return {
      messageVi: `[${rule.assetClass}] ${alert.nameVi}: score ${now.toFixed(0)}% (${formatRuleVi(rule)})`,
      snapshot: { now, rule },
    };
  }

  if (rule.type === 'smart_money_bucket_pct') {
    const rNow = buildSmartMoneyWindow({
      assetClass: rule.assetClass,
      windowDays: rule.windowDays,
      baselineDays: rule.baselineDays,
    });
    const b = rNow.bucketScores[rule.bucket as keyof typeof rNow.bucketScores];
    if (!b) return null;
    const now = b.pct;
    const ok = cmp(rule.compare, now, null, rule.thresholdPct);
    if (!ok) return null;
    return {
      messageVi: `[${rule.assetClass}] ${alert.nameVi}: ${rule.bucket} ${now.toFixed(0)}% (${formatRuleVi(rule)})`,
      snapshot: { now, bucket: rule.bucket, rule },
    };
  }

  if (rule.type === 'smart_money_metric_z') {
    const rNow = buildSmartMoneyWindow({
      assetClass: rule.assetClass,
      windowDays: rule.windowDays,
      baselineDays: rule.baselineDays,
    });
    const snap = rNow.snapshots.find(s => s.metric.id === rule.metricId);
    if (!snap || !snap.hasHistory) return null;
    const now = snap.z;
    const ok = cmp(rule.compare, now, null, rule.thresholdZ);
    if (!ok) return null;
    return {
      messageVi: `[${rule.assetClass}] ${alert.nameVi}: ${snap.metric.nameVi} z=${now.toFixed(2)} (${formatRuleVi(rule)})`,
      snapshot: { now, metricId: rule.metricId, rule },
    };
  }

  return null;
}

export function makeDefaultAlert(params: {
  nameVi: string;
  severity?: Alert['severity'];
  securityId?: string;
  rule: AlertRule;
}): Alert {
  const now = Date.now();
  return {
    id: uuid(),
    nameVi: params.nameVi,
    enabled: true,
    severity: params.severity ?? 'info',
    securityId: params.securityId,
    rule: params.rule,
    cooldownMinutes: 60,
    createdAt: now,
    updatedAt: now,
  };
}

