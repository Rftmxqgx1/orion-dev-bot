const Redis = require('ioredis');
const client = require('prom-client');
const http = require('http');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BATCH_SIZE = parseInt(process.env.TRANSLATE_BATCH_SIZE || '10');
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const translationsTotal = new client.Counter({
  name: 'orion_translations_total', help: 'Articles translated',
  labelNames: ['language'], registers: [register]
});
const translationErrors = new client.Counter({
  name: 'orion_translation_errors_total', help: 'Translation errors', registers: [register]
});
const processedQueueGauge = new client.Gauge({
  name: 'orion_processed_queue_size', help: 'Processed queue size', registers: [register]
});

async function translateWithGemini(text, sourceLang) {
  if (!GEMINI_API_KEY) return text;
  const prompt = `Translate the following ${sourceLang} text to English. Return ONLY the translated text:\n\n${text}`;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 500, temperature: 0.1 } }) }
  );
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || text;
}

async function pushToProcessed(article) {
  await redis.lpush('orion:news:processed', JSON.stringify(article));
  await redis.ltrim('orion:news:processed', 0, 999);
  await redis.expire('orion:news:processed', 86400);
  await redis.lpush(`orion:news:processed:${article.region}`, JSON.stringify(article));
  await redis.ltrim(`orion:news:processed:${article.region}`, 0, 199);
}

async function processArticle(raw) {
  const article = JSON.parse(raw);
  if (article.translated || article.language === 'en') {
    article.translated = true;
    return await pushToProcessed(article);
  }
  try {
    article.title_original = article.title;
    article.summary_original = article.summary;
    article.title = await translateWithGemini(article.title, article.language);
    article.summary = await translateWithGemini(article.summary, article.language);
    article.translated = true;
    article.translated_at = new Date().toISOString();
    translationsTotal.inc({ language: article.language });
    console.log(`[Translator] ${article.language}→en: ${article.source}`);
  } catch (err) {
    translationErrors.inc();
    article.translated = false;
    article.translation_error = err.message;
  }
  await pushToProcessed(article);
}

async function processBatch() {
  const items = [];
  for (let i = 0; i < BATCH_SIZE; i++) {
    const item = await redis.rpop('orion:news:raw');
    if (!item) break;
    items.push(item);
  }
  if (!items.length) return;
  console.log(`[Translator] Processing ${items.length} articles`);
  for (const item of items) {
    await processArticle(item);
    await new Promise(r => setTimeout(r, 200));
  }
  processedQueueGauge.set(await redis.llen('orion:news:processed'));
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    const raw = await redis.llen('orion:news:raw').catch(() => -1);
    const processed = await redis.llen('orion:news:processed').catch(() => -1);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', raw_queue: raw, processed_queue: processed }));
  } else if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': register.contentType });
    res.end(await register.metrics());
  } else { res.writeHead(404); res.end(); }
});
server.listen(3031, () => console.log('[Translator] Running on :3031'));

async function main() {
  console.log('[Translator] Starting...');
  while (true) {
    await processBatch();
    await new Promise(r => setTimeout(r, 5000));
  }
}
main().catch(err => { console.error('[Translator] Fatal:', err); process.exit(1); });
