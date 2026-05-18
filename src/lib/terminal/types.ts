import type { YahooInterval } from '../api';
import type { AssetClass } from '../smartMoney';

export type UUID = string;

export type TerminalCadence = 'realtime' | 'daily' | 'weekly' | 'monthly' | 'quarterly';

export type DataSourceId = 'yahoo_chart' | 'smart_money_mock';

export type DataSource = {
  id: DataSourceId;
  nameVi: string;
  cadence: TerminalCadence;
  latencyHintVi: string;
};

export type SecurityType =
  | 'Stock'
  | 'ETF'
  | 'Index'
  | 'FX'
  | 'Crypto'
  | 'Future'
  | 'Commodity'
  | 'Agriculture';

export type Security = {
  id: UUID;
  query: string; // cái user nhập
  symbol: string; // canonical
  nameVi: string;
  assetClass: AssetClass;
  securityType: SecurityType;
  currency?: string;
  exchange?: string;
  providerSymbols: Partial<Record<DataSourceId, string>>;
  createdAt: number;
  updatedAt: number;
};

export type SeriesField = 'open' | 'high' | 'low' | 'close' | 'volume';

export type TimeSeriesPoint = { t: number; v: number }; // epoch ms

export type SeriesKey = {
  securityId: UUID;
  provider: DataSourceId;
  interval: YahooInterval;
  field: SeriesField;
};

export type StoredSeries = {
  id: string; // `${securityId}:${provider}:${interval}:${field}`
  key: SeriesKey;
  points: TimeSeriesPoint[];
  updatedAt: number;
  source: DataSource;
  quality: {
    missingPct: number;
    isStale: boolean;
    notesVi?: string;
  };
};

export type WatchlistItem = {
  id: UUID;
  securityId: UUID;
  addedAt: number;
};

export type AlertType =
  | 'price_change_pct'
  | 'price_cross'
  | 'smart_money_score_pct'
  | 'smart_money_bucket_pct'
  | 'smart_money_metric_z';

export type AlertComparison = '>' | '>=' | '<' | '<=' | 'crosses_above' | 'crosses_below';

export type AlertRule =
  | {
      type: 'price_change_pct';
      interval: YahooInterval;
      windowDays: number;
      compare: AlertComparison;
      thresholdPct: number;
    }
  | {
      type: 'price_cross';
      interval: YahooInterval;
      compare: 'crosses_above' | 'crosses_below';
      price: number;
    }
  | {
      type: 'smart_money_score_pct';
      assetClass: AssetClass;
      windowDays: number;
      baselineDays: number;
      compare: AlertComparison;
      thresholdPct: number;
    }
  | {
      type: 'smart_money_bucket_pct';
      assetClass: AssetClass;
      bucket: string;
      windowDays: number;
      baselineDays: number;
      compare: AlertComparison;
      thresholdPct: number;
    }
  | {
      type: 'smart_money_metric_z';
      assetClass: AssetClass;
      metricId: string;
      windowDays: number;
      baselineDays: number;
      compare: AlertComparison;
      thresholdZ: number;
    };

export type Alert = {
  id: UUID;
  nameVi: string;
  enabled: boolean;
  severity: 'info' | 'warn' | 'critical';
  securityId?: UUID; // nếu alert bám vào 1 mã
  rule: AlertRule;
  cooldownMinutes: number;
  lastTriggeredAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type AlertEvent = {
  id: UUID;
  alertId: UUID;
  firedAt: number;
  messageVi: string;
  snapshot: Record<string, unknown>;
};

