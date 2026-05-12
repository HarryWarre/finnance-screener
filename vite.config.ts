import { defineConfig } from 'vite'
import type { Plugin, ViteDevServer } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'

// Custom plugin to mock proxy.php behavior in local dev
const phpProxyPlugin = (): Plugin => ({
  name: 'php-proxy',
  configureServer(server: ViteDevServer) {
    server.middlewares.use('/proxy.php', async (req: IncomingMessage, res: ServerResponse) => {
      const reqUrl = req.url ?? '';
      const host = req.headers.host ?? 'localhost';
      const url = new URL(reqUrl, `http://${host}`);
      const action = url.searchParams.get('action');
      const symbol = url.searchParams.get('symbol');
      const interval = url.searchParams.get('interval') ?? '1d';
      const range = url.searchParams.get('range') ?? '1y';
      const targetUrlStr = url.searchParams.get('url');

      const fetchUrl =
        action === 'chart'
          ? `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`
        : action === 'quote'
          ? `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${symbol}?modules=summaryDetail,financialData`
        : action === 'sp500'
          ? 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies'
        : action === 'rss' && targetUrlStr
          ? targetUrlStr
          : null;

      try {
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
