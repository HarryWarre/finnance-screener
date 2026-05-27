function normalizeBasePath(baseUrl: string): string {
  const raw = (baseUrl || '/').trim();
  if (!raw || raw === '.') return './';
  if (raw === './' || raw === '../') return raw;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw)) return raw;

  let out = raw.startsWith('/') ? raw : `/${raw}`;
  if (!out.endsWith('/')) out += '/';
  return out;
}

export function toAppUrl(pathOrQuery: string): string {
  const raw = pathOrQuery.trim();
  const normalizedPath = raw.startsWith('/') ? raw.slice(1) : raw;
  const basePath = normalizeBasePath(import.meta.env.BASE_URL || '/');
  const base = new URL(basePath, window.location.href);
  return new URL(normalizedPath, base).toString();
}

