// src/lib/rss.ts

export interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  sentiment: 'BUY' | 'SELL' | 'NEUTRAL';
  score: {
    buy: number;
    sell: number;
  };
}

// Dictionary for Sentiment Analysis (Forex + Commodities + Vietnamese)
const BULLISH_WORDS = [
  'bullish', 'buy', 'long', 'surge', 'rally', 'upward', 'support holds',
  'target high', 'hawkish', 'breakout', 'gain', 'positive', 'optimistic',
  'growth', 'recovery', 'uptrend', 'higher', 
  'shortage', 'drought', 'disruption', 'bad weather', 'frost', 'supply constraints',
  'tăng', 'phục hồi', 'lạc quan', 'hỗ trợ', 'mua', 'bơm tiền', 'nới lỏng', 'tăng trưởng', 'vượt đỉnh'
];

const BEARISH_WORDS = [
  'bearish', 'sell', 'short', 'drop', 'crash', 'downward', 'resistance',
  'dovish', 'pressure', 'breakdown', 'loss', 'negative', 'pessimistic',
  'decline', 'recession', 'downtrend', 'lower', 'cut',
  'surplus', 'record harvest', 'abundant', 'oversupply', 'weather improves',
  'giảm', 'suy thoái', 'bi quan', 'kháng cự', 'bán', 'thắt chặt', 'hút tiền', 'lạm phát', 'thủng đáy'
];

export function analyzeSentiment(text: string): { sentiment: 'BUY' | 'SELL' | 'NEUTRAL', score: { buy: number, sell: number } } {
  const lowerText = text.toLowerCase();
  let buyScore = 0;
  let sellScore = 0;

  BULLISH_WORDS.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = lowerText.match(regex);
    if (matches) buyScore += matches.length;
  });

  BEARISH_WORDS.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = lowerText.match(regex);
    if (matches) sellScore += matches.length;
  });

  let sentiment: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
  if (buyScore > sellScore) sentiment = 'BUY';
  else if (sellScore > buyScore) sentiment = 'SELL';

  return { sentiment, score: { buy: buyScore, sell: sellScore } };
}

const PROXY_URL = 'proxy.php'; // relative path — works in any subfolder on cPanel

export async function fetchRssFeed(rssUrl: string): Promise<RssItem[]> {
  try {
    const res = await fetch(`${PROXY_URL}?action=rss&url=${encodeURIComponent(rssUrl)}`);
    if (!res.ok) throw new Error("Proxy failed");
    const xmlText = await res.text();

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    
    // Check for parsing errors
    const errorNode = xmlDoc.querySelector("parsererror");
    if (errorNode) {
      console.error("XML Parsing Error", errorNode.textContent);
      return [];
    }

    const items = xmlDoc.querySelectorAll("item");
    const result: RssItem[] = [];

    items.forEach(item => {
      const title = item.querySelector("title")?.textContent || "";
      const link = item.querySelector("link")?.textContent || "";
      const pubDate = item.querySelector("pubDate")?.textContent || "";
      const description = item.querySelector("description")?.textContent || "";
      
      // Strip HTML tags from description for analysis
      const cleanDescription = description.replace(/<[^>]*>?/gm, '');
      const fullText = `${title} ${cleanDescription}`;
      
      const analysis = analyzeSentiment(fullText);

      result.push({
        title,
        link,
        pubDate,
        description: cleanDescription,
        sentiment: analysis.sentiment,
        score: analysis.score
      });
    });

    return result;
  } catch (error) {
    console.error("Error fetching RSS feed:", error);
    return [];
  }
}
