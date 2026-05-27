import type { MacroThresholdArtifactV1 } from './types';
import { toAppUrl } from '../appUrl';

const THRESHOLD_URL = toAppUrl('data/macro_thresholds.v1.json');

let memo: Promise<MacroThresholdArtifactV1> | null = null;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export async function loadMacroThresholdArtifact(): Promise<MacroThresholdArtifactV1> {
  if (memo) return memo;
  memo = (async () => {
    try {
      const res = await fetch(THRESHOLD_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = (await res.json()) as unknown;
      if (!isRecord(data) || data.version !== 'v1') throw new Error('Bad thresholds artifact');
      const familyDefaults = isRecord(data.familyDefaults) ? (data.familyDefaults as Record<string, number>) : {};
      const seriesStats = isRecord(data.seriesStats) ? (data.seriesStats as Record<string, { threshold: number; n: number; p70AbsRaw: number }>) : {};
      const out: MacroThresholdArtifactV1 = {
        version: 'v1',
        generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : new Date(0).toISOString(),
        windowYears: typeof data.windowYears === 'number' ? data.windowYears : 2,
        minSamples: typeof data.minSamples === 'number' ? data.minSamples : 30,
        method: 'p70_abs_raw',
        familyDefaults,
        seriesStats,
      };
      return out;
    } catch {
      // Fallback: safe defaults (still allows module to run)
      return {
        version: 'v1',
        generatedAt: new Date(0).toISOString(),
        windowYears: 0,
        minSamples: 0,
        method: 'p70_abs_raw',
        familyDefaults: {
          Policy: 0.25,
          Inflation: 0.1,
          Labor: 20000,
          Growth: 0.3,
          Survey: 1.0,
          Demand: 0.3,
        },
        seriesStats: {},
      };
    }
  })();
  return memo;
}

export function thresholdForSeries(artifact: MacroThresholdArtifactV1, seriesKey: string, family: string): number | null {
  const s = artifact.seriesStats?.[seriesKey];
  if (s && Number.isFinite(s.threshold) && s.threshold > 0) return s.threshold;
  const d = artifact.familyDefaults?.[family];
  if (Number.isFinite(d) && d > 0) return d;
  return null;
}

