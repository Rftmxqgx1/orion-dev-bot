const Parser = require('rss-parser');
const Redis = require('ioredis');
const client = require('prom-client');
const http = require('http');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const parser = new Parser({ timeout: 10000, maxRedirects: 3 });
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const articlesScraped = new client.Counter({
  name: 'orion_articles_scraped_total', help: 'Total articles scraped',
  labelNames: ['source', 'language'], registers: [register]
});
const scrapeErrors = new client.Counter({
  name: 'orion_scrape_errors_total', help: 'Scrape errors',
  labelNames: ['source'], registers: [register]
});
const redisQueueSize = new client.Gauge({
  name: 'orion_redis_queue_size', help: 'News queue size', registers: [register]
});

const SOURCES = [
  { name: 'reuters',       url: 'https://feeds.reuters.com/reuters/topNews',  lang: 'en', region: 'global' },
  { name: 'bbc',           url: 'http://feeds.bbci.co.uk/news/world/rss.xml', lang: 'en', region: 'global' },
  { name: 'aljazeera',     url: 'https://www.aljazeera.com/xml/rss/all.xml',  lang: 'en', region: 'mena'   },
  { name: 'ap',            url: 'https://feeds.apnews.com/rss/apf-topnews',   lang: 'en', region: 'global' },
  { name: 'dailymaverick', url: 'https://www.dailymaverick.co.za/feed/',        lang: 'en', region: 'africa' },
  { name: 'mg',            url: 'https://mg.co.za/feed/',                         lang: 'en', region: 'africa' },
  { name: 'scmp',          url: 'https://www.scmp.com/rss/91/feed',               lang: 'en', region: 'asia'   },
  { name: 'dawn',          url: 'https://www.dawn.com/feeds/home',                lang: 'en', region: 'asia'   },
];

function detectLanguage(text) {
  if (!text) return 'en';
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  return 'en';
}

async function scrapeSource(source) {
  try {
    const feed = await parser.parseURL(source.url);
    let count = 0;
    for (const item of (feed.items || []).slice(0, 20)) {
      const lang = detectLanguage(`${item.title||''} ${item.contentSnippet||''}`) || source.lang;
      const article = {
        id: `${source.name}_${Date.now()}_${Math.random().toString(36).substr(2,6)}`,
        source: source.name, region: source.region,
        title: item.title || '', summary: item.contentSnippet || item.summary || '',
        url: item.link || '', published: item.pubDate || new Date().toISOString(),
        language: lang, translated: lang === 'en',
        scraped_at: new Date().toISOString(), processed: false
      };
      await redis.lpush('orion:news:raw', JSON.stringify(article));
      await redis.expire('orion:news:raw', 86400);
      await redis.lpush(`orion:news:region:${source.region}`, JSON.stringify(article));
      await redis.ltrim(`orion:news:region:${source.region}`, 0, 199);
      articlesScraped.inc({ source: source.name, language: lang });
      count++;
    }
    console.log(`[${source.name}] Scraped ${count} articles`);
    return count;
  } catch (err) {
    scrapeErrors.inc({ source: source.name });
    console.error(`[${source.name}] Error: ${err.message}`);
    return 0;
  }
}

async function scrapeAll() {
  console.log(`[Scraper] Starting cycle — ${SOURCES.length} sources`);
  let total = 0;
  for (const source of SOURCES) {
    total += await scrapeSource(source);
    await new Promise(r => setTimeout(r, 500));
  }
  const size = await redis.llen('orion:news:raw');
  redisQueueSize.set(size);
  console.log(`[Scraper] Done — ${total} articles | queue: ${size}`);
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    const q = await redis.llen('orion:news:raw').catch(() => -1);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', queue_size: q, sources: SOURCES.length }));
  } else if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': register.contentType });
    res.end(await register.metrics());
  } else { res.writeHead(404); res.end(); }
});
server.listen(3030, () => console.log('[Scraper] Running on :3030'));

const INTERVAL = parseInt(process.env.SCRAPE_INTERVAL_MS || '300000');
scrapeAll();
setInterval(scrapeAll, INTERVAL);
console.log(`[Scraper] Interval: ${INTERVAL/60000}min`);
