import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Custom plugin to mock proxy.php behavior in local dev
const phpProxyPlugin = () => ({
  name: 'php-proxy',
  configureServer(server: any) {
    server.middlewares.use('/proxy.php', async (req: any, res: any) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const action = url.searchParams.get('action');
      const symbol = url.searchParams.get('symbol');
      const targetUrlStr = url.searchParams.get('url');

      let fetchUrl = '';
      if (action === 'chart') {
        fetchUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y`;
      } else if (action === 'quote') {
        fetchUrl = `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${symbol}?modules=summaryDetail,financialData`;
      } else if (action === 'rss' && targetUrlStr) {
        fetchUrl = targetUrlStr;
      } else {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Invalid action' }));
      }

      try {
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
      } catch (e: any) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  }
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), phpProxyPlugin()],
  base: './',   // ← Required for cPanel: makes all asset paths relative (./assets/...)
})

