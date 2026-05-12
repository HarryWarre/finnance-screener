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
      const targetUrlStr = url.searchParams.get('url');

      const fetchUrl =
        action === 'chart'
          ? `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y`
          : action === 'quote'
            ? `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${symbol}?modules=summaryDetail,financialData`
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
        } else {
          res.setHeader('Content-Type', 'application/json');
        }
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
