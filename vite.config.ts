import { defineConfig } from 'vite'
import type { Plugin, ViteDevServer } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { unzipSync, strFromU8 } from 'fflate'
import fs from 'node:fs'
import path from 'node:path'

// Custom plugin to mock proxy.php behavior in local dev
const phpProxyPlugin = (): Plugin => ({
  name: 'php-proxy',
  configureServer(server: ViteDevServer) {
    const cotCache = new Map<string, string>();
    void unzipSync; void strFromU8; void fs; void path; // keep for optional future local ZIP parsing

    const parseCsvLine = (line: string) => {
      const out: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"') {
            if (line[i + 1] === '"') {
              cur += '"';
              i++;
            } else {
              inQuotes = false;
            }
          } else {
            cur += ch;
          }
        } else {
          if (ch === '"') inQuotes = true;
          else if (ch === ',') {
            out.push(cur);
            cur = '';
          } else cur += ch;
        }
      }
      out.push(cur);
      return out;
    };

    const findHeaderIndex = (header: string[], candidates: string[]) => {
      const lower = header.map((h) => h.trim().toLowerCase());
      for (const c of candidates) {
        const i = lower.indexOf(c);
        if (i >= 0) return i;
      }
      return -1;
    };

    const fetchWithTimeout = async (input: string, init: RequestInit = {}, timeoutMs = 8000) => {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(input, { ...init, signal: controller.signal });
      } finally {
        clearTimeout(t);
      }
    };

    server.middlewares.use('/proxy.php', async (req: IncomingMessage, res: ServerResponse) => {
      const reqUrl = req.url ?? '';
      const host = req.headers.host ?? 'localhost';
      const url = new URL(reqUrl, `http://${host}`);
      const action = url.searchParams.get('action');
      const symbol = url.searchParams.get('symbol');
      const interval = url.searchParams.get('interval') ?? '1d';
      const range = url.searchParams.get('range') ?? '1y';
      const targetUrlStr = url.searchParams.get('url');
      const cotQ = (url.searchParams.get('q') ?? '').trim().toUpperCase();

      try {
        // `cot` handled via cotdata.net free API by instrument code (mirror).
        if (action === 'cot') {
          let instrument = (url.searchParams.get('instrument') ?? '').trim();
          if (!instrument && cotQ) {
            const map: Record<string, string> = {
              CORN: '002602',
              SOYBEANS: '005602',
              WHEAT: '001602',
              COFFEE: '083731',
              COCOA: '073732',
              'ORANGE JUICE': '040701',
            };
            instrument = map[cotQ] ?? '';
          }
          if (!instrument) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: 'Missing instrument', q: cotQ }));
          }
          const cacheKey = `cot_${instrument}`;
          const cached = cotCache.get(cacheKey);
          if (cached) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(cached);
          }

          try {
            const upstream = await fetchWithTimeout(`https://cotdata.net/api/cot?instrument=${encodeURIComponent(instrument)}`, {
              headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
            }, 8000);
            if (!upstream.ok) {
              res.statusCode = upstream.status;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              return res.end(JSON.stringify({ error: `Upstream ${upstream.status}` }));
            }
            const json = await upstream.text();
            cotCache.set(cacheKey, json);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(json);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Unknown error';
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: 'COT fetch failed', detail: msg }));
          }
        }

        if (action === 'wasde') {
          const commodity = (url.searchParams.get('commodity') ?? '').trim().toLowerCase();
          const scope = (url.searchParams.get('scope') ?? 'us').trim().toLowerCase();
          if (!['corn', 'soybean', 'wheat'].includes(commodity) || scope !== 'us') {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: 'Invalid commodity/scope' }));
          }

          // Try USDA monthly CSV first; fallback to ERS downloadable files if blocked.
          const now = new Date();
          let csvText: string | null = null;
          let reportMonth: string | null = null;
          for (let i = 0; i < 18; i++) {
            const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
            const ym = d.toISOString().slice(0, 7);
            const csvUrl = `https://www.usda.gov/sites/default/files/documents/oce-wasde-report-data-${ym}.csv`;
            try {
              const r = await fetchWithTimeout(csvUrl, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/csv,*/*' } }, 8000);
              if (!r.ok) continue;
              csvText = await r.text();
              reportMonth = ym;
              break;
            } catch {
              // try previous month
            }
          }

          if (!csvText) {
            const ersUrl =
              commodity === 'corn'
                ? 'https://www.ers.usda.gov/media/5766/feed-grains-yearbook-tables-all-years.csv'
                : commodity === 'soybean'
                  ? 'https://www.ers.usda.gov/media/5218/all-tables-oil-crops-yearbook.csv'
                  : 'https://www.ers.usda.gov/media/5709/wheat-data-all-years.zip';
            try {
              const r = await fetchWithTimeout(ersUrl, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' } }, 8000);
              if (!r.ok) throw new Error(String(r.status));
              // wheat zip is not supported in dev (would require unzip); return placeholder.
              if (commodity === 'wheat') {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                return res.end(JSON.stringify({ commodity, scope, reportMonth: 'ers', stocksToUse: null, source: ersUrl }));
              }
              csvText = await r.text();
              reportMonth = 'ers';
            } catch {
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              return res.end(JSON.stringify({ error: 'WASDE fetch failed (timeout or blocked)' }));
            }
          }

          const lines = csvText.split(/\r?\n/).filter(Boolean);
          const header = parseCsvLine(lines[0]);
          const iValue = findHeaderIndex(header, ['value', 'amount']);
          const iItem = findHeaderIndex(header, ['item', 'commodity', 'product']);
          const iAttr = findHeaderIndex(header, ['attribute', 'attribute_desc', 'variable', 'category', 'series']);
          const iCountry = findHeaderIndex(header, ['country', 'geography_desc', 'region', 'area']);
          const iYear = findHeaderIndex(header, ['market_year', 'marketing_year', 'market year', 'year']);

          if (iValue < 0 || iItem < 0 || iAttr < 0) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: 'WASDE parse: missing columns' }));
          }

          const itemNeedle = commodity === 'corn' ? 'corn' : commodity === 'soybean' ? 'soybeans' : 'wheat';
          let bestYear: string | null = null;
          let endingStocks: number | null = null;
          let totalUse: number | null = null;

          for (let i = 1; i < lines.length; i++) {
            const cols = parseCsvLine(lines[i]);
            const item = (cols[iItem] ?? '').trim().toLowerCase();
            const attr = (cols[iAttr] ?? '').trim().toLowerCase();
            const country = iCountry >= 0 ? (cols[iCountry] ?? '').trim().toLowerCase() : '';
            const valRaw = (cols[iValue] ?? '').trim();
            if (!valRaw || valRaw === 'NA') continue;
            if (!item.includes(itemNeedle)) continue;
            if (country && !country.includes('united states') && !country.includes('u.s.') && !country.startsWith('us')) continue;

            const year = iYear >= 0 ? (cols[iYear] ?? '').trim() : '';
            if (year) {
              if (!bestYear || year > bestYear) {
                bestYear = year;
                endingStocks = null;
                totalUse = null;
              }
              if (bestYear !== year) continue;
            }

            const v = Number(valRaw.replace(/,/g, ''));
            if (!Number.isFinite(v)) continue;
            if (endingStocks === null && (attr.includes('ending stocks') || attr.includes('ending stock'))) endingStocks = v;
            else if (totalUse === null && (attr.includes('total use') || attr.includes('use, total'))) totalUse = v;
          }

          const stocksToUse = endingStocks != null && totalUse != null && totalUse !== 0 ? (endingStocks / totalUse) * 100 : null;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(
            JSON.stringify({
              commodity,
              scope,
              reportMonth,
              marketYear: bestYear,
              endingStocks,
              totalUse,
              stocksToUse,
              source: 'usda_historical_wasde_report_data_csv',
            })
          );
        }

        const fetchUrl =
          action === 'chart'
            ? `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`
            : action === 'quote'
              ? `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${symbol}?modules=summaryDetail,financialData`
              : action === 'sp500'
                ? 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies'
                : action === 'enso'
                  ? 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php'
                : action === 'rss' && targetUrlStr
                  ? targetUrlStr
                  : null;

        if (!fetchUrl) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: 'Invalid action' }));
        }

        const fetchRes = await fetch(fetchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': '*/*'
          }
        });
        
        const data = await fetchRes.text();
        if (!fetchRes.ok) {
          res.statusCode = fetchRes.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(JSON.stringify({ error: `Upstream ${fetchRes.status}`, action }));
        }
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (action === 'rss') {
          res.setHeader('Content-Type', 'text/xml');
          return res.end(data);
        }

        if (action === 'sp500') {
          // Parse symbols from Wikipedia HTML to match production proxy.php response shape.
          const tableStart = data.indexOf('id="constituents"');
          const sliceFrom = tableStart >= 0 ? tableStart : 0;
          const tableEnd = data.indexOf('</table>', sliceFrom);
          const tableHtml = tableEnd >= 0 ? data.slice(sliceFrom, tableEnd) : data;

          const constituents: Array<{ symbol: string; sector: string }> = [];
          // Try to capture first and third <td> (Symbol + GICS Sector).
          // This is a best-effort parser for dev only.
          const rowRe = /<tr>\s*<td[^>]*>\s*(?:<a[^>]*>)?\s*([A-Z]{1,5}(?:\.[A-Z])?)\s*(?:<\/a>)?\s*<\/td>\s*<td[\s\S]*?<\/td>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>/g;
          let m: RegExpExecArray | null;
          while ((m = rowRe.exec(tableHtml))) {
            let sym = m[1];
            const sector = (m[2] || '').trim() || 'Unknown';
            if (sym === 'BRK.B') sym = 'BRK-B';
            if (sym === 'BF.B') sym = 'BF-B';
            if (/^[A-Z]{1,5}\.[A-Z]$/.test(sym)) sym = sym.replace('.', '-');
            constituents.push({ symbol: sym, sector });
          }

          const symbols = Array.from(new Set(constituents.map(c => c.symbol)));
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(JSON.stringify({ symbols, constituents, source: 'wikipedia' }));
        }

        if (action === 'enso') {
          // Parse ONI table from NOAA page HTML; best-effort for dev.
          const text = data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
          const rowRe = /\b(19\d{2}|20\d{2})\b((?:\s+-?\d+\.\d){6,})/g;
          const seasons = ['DJF', 'JFM', 'FMA', 'MAM', 'AMJ', 'MJJ', 'JJA', 'JAS', 'ASO', 'SON', 'OND', 'NDJ'];
          const values: Array<{ year: number; season: string; oni: number }> = [];
          let m: RegExpExecArray | null;
          while ((m = rowRe.exec(text))) {
            const year = Number(m[1]);
            const nums = m[2].trim().split(/\s+/g).slice(0, 12);
            nums.forEach((n, i) => values.push({ year, season: seasons[i], oni: Number(n) }));
          }
          const latest = values.at(-1);
          const oni = latest?.oni ?? 0;
          const state = oni >= 0.5 ? 'El Nino' : oni <= -0.5 ? 'La Nina' : 'Neutral';
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(JSON.stringify({ asOf: latest ? `${latest.year} ${latest.season}` : '', oni, state, source: 'noaa_cpc_oni_v5' }));
        }

        res.setHeader('Content-Type', 'application/json');
        res.end(data);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        res.statusCode = 500;
        res.end(JSON.stringify({ error: message }));
      }
    });
  }
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), phpProxyPlugin()],
  base: './',   // ← Required for cPanel: makes all asset paths relative (./assets/...)
})
