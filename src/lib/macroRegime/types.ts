export type MacroTimeframe = '7D' | '30D' | '180D';
export type MacroBias = 'BUY' | 'SELL' | 'NEUTRAL';
export type MacroRegimeLabel =
  | 'Risk-on'
  | 'Risk-off'
  | 'Inflationary'
  | 'Disinflationary'
  | 'Growth up'
  | 'Growth down'
  | 'Policy tightening'
  | 'Policy easing'
  | 'Mixed/Transition';

export type MacroAssetClass = 'FX' | 'Commodity' | 'Index';
export type MacroDriverDirection = 'pos' | 'neg' | 'neu';

export interface MacroDriver {
  label: string;
  direction: MacroDriverDirection;
  weight: number; // 0..1
  note: string;
}

export interface MacroCell {
  assetId: string;
  assetClass: MacroAssetClass;
  timeframe: MacroTimeframe;
  bias: MacroBias;
  confidence: number; // 0..100
  regime: MacroRegimeLabel;
  drivers: MacroDriver[]; // top 3–5
  headline: string;
  lastUpdated: string; // ISO
  dataQuality: 'good' | 'partial' | 'stale';
}

export interface MacroCellEventContribution {
  eventId: string;
  when: string; // ISO
  currency: string;
  family: string;
  title: string;
  actual: string;
  forecast: string;
  importance: number;
  z: number;
  weight: number;
  signedImpact: number;
  url?: string;
  note?: string;
}

export interface MacroCellComputed extends MacroCell {
  score: number;
  topEvents: MacroCellEventContribution[];
  // For conflict rule (B): compare 7D vs 180D top driver direction.
  driverSignature: Record<string, MacroDriverDirection>;
}

export interface MacroThresholdArtifactV1 {
  version: 'v1';
  generatedAt: string;
  windowYears: number;
  minSamples: number;
  method: 'p70_abs_raw';
  familyDefaults: Record<string, number>;
  seriesStats: Record<string, { threshold: number; n: number; p70AbsRaw: number }>;
}
