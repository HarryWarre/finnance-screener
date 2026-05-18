export function uuid(): string {
  // good enough for client-side ids
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}

export function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

export function fmtAgoVi(ts: number) {
  const diff = Date.now() - ts;
  if (!Number.isFinite(diff)) return '-';
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s trước`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m trước`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h trước`;
  const d = Math.floor(h / 24);
  return `${d}d trước`;
}

export function safeNumber(x: unknown, fallback = 0) {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

