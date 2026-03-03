// ============================================================
// ORION — Regime Engine (Tier 2)
// Reads processed news from Redis
// Classifies geopolitical + market regime from news signals
// Uses rolling volatility + sentiment scoring
// Memory budget: 180MB
// ============================================================

const Redis = require('ioredis');
const client = require('prom-client');
const http = require('http');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const PORT = process.env.PORT || 3010;

// ── Prometheus ──────────────────────────────────────────────
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const regimeGauge = new client.Gauge({
  name: 'orion_current_regime',
  help: 'Current regime classification (1=BULL 2=BEAR 3=CRISIS 4=SIDEWAYS 5=FRAGILE)',
  registers: [register]
});
const confidenceGauge = new client.Gauge({
  name: 'orion_regime_confidence',
  help: 'Regime classification confidence 0-1',
  registers: [register]
});
const articlesAnalyzed = new client.Counter({
  name: 'orion_regime_articles_analyzed_total',
  help: 'Total articles analyzed for regime',
  registers: [register]
});

// ── Keyword Signal Maps ─────────────────────────────────────
const CRISIS_KEYWORDS = [
  'war','invasion','attack','missile','nuclear','collapse','default',
  'coup','sanctions','embargo','catastrophe','explosion','terror',
  'famine','pandemic','crash','bankruptcy','riots'
];
const BEAR_KEYWORDS = [
  'recession','inflation','rate hike','unemployment','deficit',
  'downturn','slowdown','contraction','debt','layoffs','losses',
  'decline','falling','weakness','sell-off','bear'
];
const BULL_KEYWORDS = [
  'growth','rally','record','expansion','deal','agreement','ceasefire',
  'recovery','surplus','profit','gains','bullish','surge','hiring',
  'investment','gdp growth','strong'
];
const FRAGILE_KEYWORDS = [
  'tensions','uncertainty','warning','risk','concern','threat',
  'volatile','instability','pressure','dispute','protest'
];

// ── Score Article ───────────────────────────────────────────
function scoreArticle(article) {
  const text = `${article.title} ${article.summary}`.toLowerCase();
  const scores = { crisis: 0, bear: 0, bull: 0, fragile: 0 };

  for (const kw of CRISIS_KEYWORDS)  if (text.includes(kw)) scores.crisis++;
  for (const kw of BEAR_KEYWORDS)    if (text.includes(kw)) scores.bear++;
  for (const kw of BULL_KEYWORDS)    if (text.includes(kw)) scores.bull++;
  for (const kw of FRAGILE_KEYWORDS) if (text.includes(kw)) scores.fragile++;

  // Region weight — amplify crisis signals from high-impact regions
  const regionWeight = { global: 1.5, finance: 1.3, mena: 1.2, asia: 1.1, africa: 1.0 };
  const weight = regionWeight[article.region] || 1.0;

  return {
    crisis:  scores.crisis  * weight,
    bear:    scores.bear    * weight,
    bull:    scores.bull    * weight,
    fragile: scores.fragile * weight
  };
}

// ── Classify Regime from rolling window ────────────────────
function classifyRegime(rollingScores) {
  const totals = { crisis: 0, bear: 0, bull: 0, fragile: 0 };
  for (const s of rollingScores) {
    totals.crisis  += s.crisis;
    totals.bear    += s.bear;
    totals.bull    += s.bull;
    totals.fragile += s.fragile;
  }

  const total = Object.values(totals).reduce((a, b) => a + b, 0) || 1;

  // Normalise
  const pct = {
    crisis:  totals.crisis  / total,
    bear:    totals.bear    / total,
    bull:    totals.bull    / total,
    fragile: totals.fragile / total
  };

  let regime = 'SIDEWAYS';
  let confidence = 0.5;

  if (pct.crisis > 0.30) {
    regime = 'CRISIS'; confidence = Math.min(0.95, pct.crisis + 0.3);
  } else if (pct.bear > 0.35) {
    regime = 'BEAR'; confidence = Math.min(0.90, pct.bear + 0.2);
  } else if (pct.bull > 0.40) {
    regime = 'BULL'; confidence = Math.min(0.90, pct.bull + 0.2);
  } else if (pct.fragile > 0.25) {
    regime = 'FRAGILE'; confidence = Math.min(0.80, pct.fragile + 0.2);
  }

  return { regime, confidence, breakdown: pct, scored_at: new Date().toISOString() };
}

// ── Rolling Buffer (last 100 articles) ─────────────────────
const rollingScores = [];
const MAX_WINDOW = 100;

// ── Main Analysis Loop ──────────────────────────────────────
async function analyzeNews() {
  const items = [];
  for (let i = 0; i < 20; i++) {
    const item = await redis.rpop('orion:news:processed');
    if (!item) break;
    items.push(item);
    // Re-push so other services can also read it
    await redis.lpush('orion:news:analyzed', item);
  }
  await redis.ltrim('orion:news:analyzed', 0, 999);

  if (!items.length) return;

  for (const raw of items) {
    try {
      const article = JSON.parse(raw);
      const score = scoreArticle(article);
      rollingScores.push(score);
      if (rollingScores.length > MAX_WINDOW) rollingScores.shift();
      articlesAnalyzed.inc();
    } catch (e) {}
  }

  if (rollingScores.length < 5) return;

  const result = classifyRegime(rollingScores);

  // Store in Redis
  await redis.set('orion:regime:current', JSON.stringify(result));
  await redis.lpush('orion:regime:history', JSON.stringify(result));
  await redis.ltrim('orion:regime:history', 0, 499);

  // Update Prometheus
  const regimeMap = { BULL: 1, BEAR: 2, CRISIS: 3, SIDEWAYS: 4, FRAGILE: 5 };
  regimeGauge.set(regimeMap[result.regime] || 4);
  confidenceGauge.set(result.confidence);

  console.log(`[Regime] ${result.regime} | confidence: ${(result.confidence * 100).toFixed(1)}% | window: ${rollingScores.length}`);
}

// ── HTTP Server ─────────────────────────────────────────────
http.createServer(async (req, res) => {
  if (req.url === '/health') {
    const current = await redis.get('orion:regime:current').catch(() => null);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', regime: current ? JSON.parse(current) : null }));
  } else if (req.url === '/regime') {
    const current = await redis.get('orion:regime:current').catch(() => null);
    const history = await redis.lrange('orion:regime:history', 0, 9).catch(() => []);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      current: current ? JSON.parse(current) : null,
      history: history.map(h => JSON.parse(h))
    }));
  } else if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': register.contentType });
    res.end(await register.metrics());
  } else { res.writeHead(404); res.end(); }
}).listen(PORT, () => console.log(`[Regime] :${PORT}`));

// Run every 30 seconds
analyzeNews();
setInterval(analyzeNews, 30000);
console.log('[Regime] Engine started — analyzing every 30s');
