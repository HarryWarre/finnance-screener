import { defineConfig, loadEnv } from 'vite'
import type { Plugin, ViteDevServer } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { unzipSync, strFromU8 } from 'fflate'
import fs from 'node:fs'
import path from 'node:path'

// Custom plugin to mock proxy.php behavior in local dev
const phpProxyPlugin = (env: Record<string, string>): Plugin => ({
  name: 'php-proxy',
  configureServer(server: ViteDevServer) {
    const cotCache = new Map<string, string>();
    const cgCache = new Map<string, { expiresAt: number; body: string }>();
    const investingCache = new Map<string, { expiresAt: number; body: string }>();
    const macroCalCache = new Map<string, { expiresAt: number; body: string }>();
    void unzipSync; void strFromU8; void fs; void path; // keep for optional future local ZIP parsing

    const stripTags = (html: string) =>
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();

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

    const TE_API_KEY = (env.TE_API_KEY || env.VITE_TE_API_KEY || process.env.TE_API_KEY || '').trim();
    const FINNHUB_API_KEY = (env.FINNHUB_API_KEY || env.VITE_FINNHUB_API_KEY || process.env.FINNHUB_API_KEY || '').trim();
    const FXS_CLIENT_ID = (env.FXS_CLIENT_ID || env.VITE_FXS_CLIENT_ID || process.env.FXS_CLIENT_ID || '').trim();
    const FXS_CLIENT_SECRET = (env.FXS_CLIENT_SECRET || env.VITE_FXS_CLIENT_SECRET || process.env.FXS_CLIENT_SECRET || '').trim();
    const FXS_CALENDAR_API_BASE = (env.FXS_CALENDAR_API_BASE || env.VITE_FXS_CALENDAR_API_BASE || process.env.FXS_CALENDAR_API_BASE || '').trim() || 'https://calendar-api.fxstreet.com';

    let fxstreetTokenMemo: { expiresAt: number; tokenType: string; accessToken: string } | null = null;

    const getFxStreetToken = async () => {
      if (fxstreetTokenMemo && fxstreetTokenMemo.expiresAt > Date.now() + 60_000) return fxstreetTokenMemo;
      if (!FXS_CLIENT_ID || !FXS_CLIENT_SECRET) return null;

      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: FXS_CLIENT_ID,
        client_secret: FXS_CLIENT_SECRET,
        scope: 'calendar',
      }).toString();

      const res = await fetchWithTimeout(
        'https://authorization.fxstreet.com/v2/token',
        {
          method: 'POST',
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
        },
        15000
      );

      const text = await res.text();
      if (!res.ok) throw new Error(`FXStreet token HTTP ${res.status}`);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error('FXStreet token invalid JSON');
      }
      if (!json || typeof json !== 'object') throw new Error('FXStreet token invalid JSON');
      const r = json as Record<string, unknown>;
      const accessToken = typeof r.access_token === 'string' ? r.access_token : '';
      const tokenType = typeof r.token_type === 'string' ? r.token_type : 'Bearer';
      const expiresIn = typeof r.expires_in === 'number' ? r.expires_in : Number(r.expires_in);
      if (!accessToken) throw new Error('FXStreet token missing access_token');
      const ttlMs = Number.isFinite(expiresIn) && expiresIn > 60 ? Math.round(expiresIn * 1000) : 3600_000;
      fxstreetTokenMemo = { accessToken, tokenType, expiresAt: Date.now() + ttlMs };
      return fxstreetTokenMemo;
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
      const cgVsCurrency = (url.searchParams.get('vs_currency') ?? 'usd').trim().toLowerCase();
      const cgOrder = (url.searchParams.get('order') ?? 'market_cap_desc').trim();
      const cgPerPage = (url.searchParams.get('per_page') ?? '50').trim();
      const cgPage = (url.searchParams.get('page') ?? '1').trim();
      const cgSparkline = (url.searchParams.get('sparkline') ?? 'false').trim();
      const cgIds = (url.searchParams.get('ids') ?? '').trim();
      const cgId = (url.searchParams.get('id') ?? '').trim();
      const cgDays = (url.searchParams.get('days') ?? '120').trim();
      const cgInterval = (url.searchParams.get('interval') ?? '').trim();
      const binanceSymbol = (url.searchParams.get('symbol') ?? '').trim().toUpperCase();
      const binanceInterval = (url.searchParams.get('interval') ?? '1d').trim();
      const binanceLimit = (url.searchParams.get('limit') ?? '').trim();
      const binanceStartTime = (url.searchParams.get('startTime') ?? '').trim();
      const binanceEndTime = (url.searchParams.get('endTime') ?? '').trim();
      const investingDateFrom = (url.searchParams.get('dateFrom') ?? '').trim();
      const investingDateTo = (url.searchParams.get('dateTo') ?? '').trim();
      const investingTimeZone = (url.searchParams.get('timeZone') ?? '8').trim();
      const teDateFrom = (url.searchParams.get('dateFrom') ?? '').trim();
      const teDateTo = (url.searchParams.get('dateTo') ?? '').trim();
      const teImportance = (url.searchParams.get('importance') ?? '').trim();
      const finnhubDateFrom = (url.searchParams.get('dateFrom') ?? '').trim();
      const finnhubDateTo = (url.searchParams.get('dateTo') ?? '').trim();
      const fxsDateFrom = (url.searchParams.get('dateFrom') ?? '').trim();
      const fxsDateTo = (url.searchParams.get('dateTo') ?? '').trim();
      const fxsCulture = (url.searchParams.get('culture') ?? 'en').trim();
      const fxsApiVersion = (url.searchParams.get('apiVersion') ?? 'v1').trim();
      const fxsCountries = (url.searchParams.get('countries') ?? 'US,EMU,UK,JP,CH,CA,AU,NZ,CN,HK').trim();

      try {
        if (action === 'health') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(JSON.stringify({ ok: true, ts: Date.now(), mode: 'vite_dev_proxy' }));
        }

        // CoinGecko: keep dev-mode working without PHP proxy.php on cPanel.
        // Best-effort caching to reduce rate-limit pain while developing.
        if (action === 'cg_markets') {
          const upstreamUrl =
            'https://api.coingecko.com/api/v3/coins/markets' +
            `?vs_currency=${encodeURIComponent(cgVsCurrency || 'usd')}` +
            `&order=${encodeURIComponent(cgOrder || 'market_cap_desc')}` +
            `&per_page=${encodeURIComponent(cgPerPage || '50')}` +
            `&page=${encodeURIComponent(cgPage || '1')}` +
            `&sparkline=${encodeURIComponent(cgSparkline || 'false')}` +
            (cgIds ? `&ids=${encodeURIComponent(cgIds)}` : '');

          const cacheKey = `cg_markets::${upstreamUrl}`;
          const cached = cgCache.get(cacheKey);
          if (cached && cached.expiresAt > Date.now()) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(cached.body);
          }

          const upstream = await fetchWithTimeout(
            upstreamUrl,
            {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'application/json',
              },
            },
            12000
          );
          const body = await upstream.text();
          if (!upstream.ok) {
            res.statusCode = upstream.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: `Upstream ${upstream.status}`, action: 'cg_markets' }));
          }
          cgCache.set(cacheKey, { expiresAt: Date.now() + 30_000, body });
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(body);
        }

        if (action === 'cg_market_chart') {
          if (!cgId) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: 'Missing id', action: 'cg_market_chart' }));
          }
          const upstreamUrl =
            `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(cgId)}/market_chart` +
            `?vs_currency=${encodeURIComponent(cgVsCurrency || 'usd')}` +
            `&days=${encodeURIComponent(cgDays || '120')}` +
            (cgInterval ? `&interval=${encodeURIComponent(cgInterval)}` : '');

          const cacheKey = `cg_market_chart::${upstreamUrl}`;
          const cached = cgCache.get(cacheKey);
          if (cached && cached.expiresAt > Date.now()) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(cached.body);
          }

          const upstream = await fetchWithTimeout(
            upstreamUrl,
            {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'application/json',
              },
            },
            15000
          );
          const body = await upstream.text();
          if (!upstream.ok) {
            res.statusCode = upstream.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: `Upstream ${upstream.status}`, action: 'cg_market_chart' }));
          }
          cgCache.set(cacheKey, { expiresAt: Date.now() + 30_000, body });
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(body);
        }

        if (action === 'binance_exchangeInfo') {
          const upstreamUrl = 'https://api.binance.com/api/v3/exchangeInfo';
          const cacheKey = `binance_exchangeInfo`;
          const cached = cgCache.get(cacheKey);
          if (cached && cached.expiresAt > Date.now()) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(cached.body);
          }
          const upstream = await fetchWithTimeout(
            upstreamUrl,
            { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } },
            12000
          );
          const body = await upstream.text();
          if (!upstream.ok) {
            res.statusCode = upstream.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: `Upstream ${upstream.status}`, action: 'binance_exchangeInfo' }));
          }
          cgCache.set(cacheKey, { expiresAt: Date.now() + 60_000, body });
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(body);
        }

        if (action === 'binance_ticker24hr') {
          const upstreamUrl = 'https://api.binance.com/api/v3/ticker/24hr';
          const cacheKey = `binance_ticker24hr`;
          const cached = cgCache.get(cacheKey);
          if (cached && cached.expiresAt > Date.now()) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(cached.body);
          }
          const upstream = await fetchWithTimeout(
            upstreamUrl,
            { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } },
            12000
          );
          const body = await upstream.text();
          if (!upstream.ok) {
            res.statusCode = upstream.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: `Upstream ${upstream.status}`, action: 'binance_ticker24hr' }));
          }
          cgCache.set(cacheKey, { expiresAt: Date.now() + 15_000, body });
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(body);
        }

        if (action === 'binance_klines') {
          if (!binanceSymbol) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: 'Missing symbol', action: 'binance_klines' }));
          }
          const params = new URLSearchParams();
          params.set('symbol', binanceSymbol);
          params.set('interval', binanceInterval || '1d');
          if (binanceLimit) params.set('limit', binanceLimit);
          if (binanceStartTime) params.set('startTime', binanceStartTime);
          if (binanceEndTime) params.set('endTime', binanceEndTime);
          const upstreamUrl = `https://api.binance.com/api/v3/klines?${params.toString()}`;
          const cacheKey = `binance_klines::${upstreamUrl}`;
          const cached = cgCache.get(cacheKey);
          if (cached && cached.expiresAt > Date.now()) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(cached.body);
          }
          const upstream = await fetchWithTimeout(
            upstreamUrl,
            { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } },
            15000
          );
          const body = await upstream.text();
          if (!upstream.ok) {
            res.statusCode = upstream.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: `Upstream ${upstream.status}`, action: 'binance_klines' }));
          }
          cgCache.set(cacheKey, { expiresAt: Date.now() + 30_000, body });
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(body);
        }

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

        if (action === 'investing_calendar') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(investingDateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(investingDateTo)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: 'Invalid dateFrom/dateTo. Use YYYY-MM-DD.' }));
          }

          const cacheKey = `investing_calendar::${investingDateFrom}::${investingDateTo}::tz${investingTimeZone}`;
          const cached = investingCache.get(cacheKey);
          if (cached && cached.expiresAt > Date.now()) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(cached.body);
          }

          const body = new URLSearchParams({
            dateFrom: investingDateFrom,
            dateTo: investingDateTo,
            timeZone: investingTimeZone || '8',
          });

          const upstream = await fetchWithTimeout(
            'https://www.investing.com/economic-calendar/Service/getCalendarFilteredData',
            {
              method: 'POST',
              headers: {
                'x-requested-with': 'XMLHttpRequest',
                'content-type': 'application/x-www-form-urlencoded',
                origin: 'https://www.investing.com',
                referer: 'https://www.investing.com/economic-calendar/',
                'user-agent':
                  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                accept: '*/*',
              },
              body,
            },
            15000
          );

          const txt = await upstream.text();
          if (!upstream.ok) {
            // Cloudflare "challenge" shows up as 403 with an HTML payload. In dev-mode, return an empty payload
            // so the UI can fall back gracefully instead of hard erroring.
            const looksLikeCf = upstream.status === 403 && /Just a moment|challenges\.cloudflare\.com/i.test(txt);
            if (looksLikeCf) {
              const payload = JSON.stringify({
                dateFrom: investingDateFrom,
                dateTo: investingDateTo,
                timeZone: Number(investingTimeZone || '8'),
                events: [],
                source: 'investing_blocked_cloudflare',
                blocked: true,
                message: 'Investing.com is blocked by Cloudflare challenge in this environment.',
              });
              investingCache.set(cacheKey, { expiresAt: Date.now() + 60_000, body: payload });
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              return res.end(payload);
            }

            res.statusCode = upstream.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: `Upstream ${upstream.status}`, action: 'investing_calendar' }));
          }

          let html = '';
          try {
            const parsed = JSON.parse(txt) as { data?: string };
            html = typeof parsed?.data === 'string' ? parsed.data : '';
          } catch {
            html = '';
          }
          if (!html) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: 'Investing response missing data', action: 'investing_calendar' }));
          }

          const events: Array<{
            id: number;
            datetime: string;
            currency: string;
            country: string;
            importance: number;
            title: string;
            actual: string;
            forecast: string;
            previous: string;
            url: string;
          }> = [];

          const rowRe = /<tr[^>]*class="[^"]*js-event-item[^"]*"[\s\S]*?<\/tr>/g;
          const tdRe = /<td\b[^>]*>([\s\S]*?)<\/td>/g;
          let m: RegExpExecArray | null;
          while ((m = rowRe.exec(html))) {
            const row = m[0];
            const datetime = row.match(/data-event-datetime="([^"]+)"/i)?.[1] ?? '';
            if (!datetime) continue;
            const id = Number(row.match(/id="eventRowId_(\d+)"/i)?.[1] ?? '0');

            const tds: string[] = [];
            let td: RegExpExecArray | null;
            while ((td = tdRe.exec(row))) tds.push(td[1]);
            if (tds.length < 4) continue;

            const currencyCell = tds[1] ?? '';
            const currencyText = stripTags(currencyCell);
            const currency = currencyText.match(/\b([A-Z]{3})\b$/)?.[1] ?? '';
            const country = currencyCell.match(/title="([^"]+)"/)?.[1] ?? '';

            const importanceCell = tds[2] ?? '';
            const bullKey = importanceCell.match(/data-img_key="(bull\d)"/i)?.[1] ?? '';
            const importance = Number(bullKey.replace('bull', '')) || 0;

            const eventCell = tds[3] ?? '';
            const title = stripTags(eventCell);
            const urlPath = eventCell.match(/href="([^"]+)"/i)?.[1] ?? '';
            const urlAbs = urlPath ? (urlPath.startsWith('http') ? urlPath : `https://www.investing.com${urlPath}`) : '';

            const actual = stripTags(tds[4] ?? '');
            const forecast = stripTags(tds[5] ?? '');
            const previous = stripTags(tds[6] ?? '');

            events.push({
              id: Number.isFinite(id) ? id : 0,
              datetime,
              currency,
              country,
              importance,
              title,
              actual,
              forecast,
              previous,
              url: urlAbs,
            });
          }

          const payload = JSON.stringify({
            dateFrom: investingDateFrom,
            dateTo: investingDateTo,
            timeZone: Number(investingTimeZone || '8'),
            events,
            source: 'investing_getCalendarFilteredData',
          });

          investingCache.set(cacheKey, { expiresAt: Date.now() + 10 * 60 * 1000, body: payload });
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(payload);
        }

        if (action === 'te_calendar') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(teDateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(teDateTo)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: 'Invalid dateFrom/dateTo. Use YYYY-MM-DD.' }));
          }
          if (!TE_API_KEY) {
            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: 'Missing TE_API_KEY (set in .env, not committed).' }));
          }
          const imp = /^[0-3]$/.test(teImportance) ? `&importance=${encodeURIComponent(teImportance)}` : '';
          const countries = 'united%20states,euro%20area,united%20kingdom,japan,switzerland,canada,australia,new%20zealand,china,hong%20kong';
          const upstreamUrl =
            `https://api.tradingeconomics.com/calendar/country/${countries}/${encodeURIComponent(teDateFrom)}/${encodeURIComponent(teDateTo)}` +
            `?c=${encodeURIComponent(TE_API_KEY)}&f=json${imp}`;

          const upstream = await fetchWithTimeout(upstreamUrl, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }, 15000);
          const body = await upstream.text();
          if (!upstream.ok) {
            res.statusCode = upstream.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: `Upstream ${upstream.status}`, action: 'te_calendar' }));
          }
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(JSON.stringify({ dateFrom: teDateFrom, dateTo: teDateTo, events: JSON.parse(body), source: 'tradingeconomics_api' }));
        }

        if (action === 'finnhub_calendar') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(finnhubDateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(finnhubDateTo)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: 'Invalid dateFrom/dateTo. Use YYYY-MM-DD.' }));
          }
          if (!FINNHUB_API_KEY) {
            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: 'Missing FINNHUB_API_KEY (set in .env, not committed).' }));
          }

          const upstreamUrl =
            `https://finnhub.io/api/v1/calendar/economic?from=${encodeURIComponent(finnhubDateFrom)}` +
            `&to=${encodeURIComponent(finnhubDateTo)}` +
            `&token=${encodeURIComponent(FINNHUB_API_KEY)}`;

          const cacheKey = `finnhub_calendar::${upstreamUrl}`;
          const cached = macroCalCache.get(cacheKey);
          if (cached && cached.expiresAt > Date.now()) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(cached.body);
          }

          const upstream = await fetchWithTimeout(upstreamUrl, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }, 15000);
          const body = await upstream.text();
          if (!upstream.ok) {
            res.statusCode = upstream.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: `Upstream ${upstream.status}`, action: 'finnhub_calendar' }));
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: 'Invalid upstream JSON', action: 'finnhub_calendar' }));
          }
          const events = (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).economicCalendar)) ? (parsed as any).economicCalendar : [];
          const payload = JSON.stringify({ dateFrom: finnhubDateFrom, dateTo: finnhubDateTo, events, source: 'finnhub_calendar' });
          macroCalCache.set(cacheKey, { expiresAt: Date.now() + 15 * 60 * 1000, body: payload });
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(payload);
        }

        if (action === 'fxstreet_calendar') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(fxsDateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(fxsDateTo)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: 'Invalid dateFrom/dateTo. Use YYYY-MM-DD.' }));
          }
          if (!FXS_CLIENT_ID || !FXS_CLIENT_SECRET) {
            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: 'Missing FXS_CLIENT_ID/FXS_CLIENT_SECRET (set in .env, not committed).' }));
          }

          const token = await getFxStreetToken();
          if (!token) {
            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: 'Missing FXStreet credentials' }));
          }

          const fromParam = `${fxsDateFrom}T00:00:00Z`;
          const toParam = `${fxsDateTo}T23:59:59Z`;
          const countries = fxsCountries
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter((s) => /^[A-Z]{2,3}$/.test(s));
          const qs = countries.map((c) => `countries=${encodeURIComponent(c)}`).join('&');
          const upstreamUrl =
            `${FXS_CALENDAR_API_BASE.replace(/\/$/, '')}/${encodeURIComponent(fxsCulture || 'en')}` +
            `/api/${encodeURIComponent((fxsApiVersion || 'v1').toLowerCase())}` +
            `/eventDates/${encodeURIComponent(fromParam)}/${encodeURIComponent(toParam)}` +
            (qs ? `?${qs}` : '');

          const cacheKey = `fxstreet_calendar::${upstreamUrl}`;
          const cached = macroCalCache.get(cacheKey);
          if (cached && cached.expiresAt > Date.now()) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(cached.body);
          }

          const upstream = await fetchWithTimeout(
            upstreamUrl,
            {
              headers: {
                'User-Agent': 'Mozilla/5.0',
                Accept: 'application/json',
                Authorization: `${token.tokenType} ${token.accessToken}`,
              },
            },
            20000
          );
          const body = await upstream.text();
          if (!upstream.ok) {
            res.statusCode = upstream.status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ error: `Upstream ${upstream.status}`, action: 'fxstreet_calendar' }));
          }

          const payload = JSON.stringify({ dateFrom: fxsDateFrom, dateTo: fxsDateTo, culture: fxsCulture, apiVersion: (fxsApiVersion || 'v1').toLowerCase(), events: JSON.parse(body), source: 'fxstreet_api' });
          macroCalCache.set(cacheKey, { expiresAt: Date.now() + 10 * 60 * 1000, body: payload });
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(payload);
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
export default defineConfig(({ mode }) => ({
  plugins: [react(), phpProxyPlugin(loadEnv(mode, process.cwd(), ''))],
  base: './',   // ← Required for cPanel: makes all asset paths relative (./assets/...)
}));
