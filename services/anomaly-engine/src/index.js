// ============================================================
// ORION — Anomaly Engine (Tier 2)
// Monitors news volume + sentiment for sudden spikes
// Z-score detection + EWMA deviation
// Fires anomaly alerts into Redis
// Memory budget: 150MB
// ============================================================

const Redis = require('ioredis');
const client = require('prom-client');
const http = require('http');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const PORT = process.env.PORT || 3015;

// ── Prometheus ──────────────────────────────────────────────
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const anomaliesDetected = new client.Counter({
  name: 'orion_anomalies_detected_total',
  help: 'Total anomalies detected',
  labelNames: ['severity', 'region'],
  registers: [register]
});
const volumeGauge = new client.Gauge({
  name: 'orion_news_volume_per_cycle',
  help: 'News articles per analysis cycle',
  registers: [register]
});
const zscoreGauge = new client.Gauge({
  name: 'orion_volume_zscore',
  help: 'Z-score of current news volume',
  registers: [register]
});

// ── Rolling Buffers ─────────────────────────────────────────
const volumeHistory = [];     // article counts per cycle
const MAX_HISTORY = 50;
let ewma = null;
const EWMA_ALPHA = 0.2;       // smoothing factor

// ── Statistical Detection ───────────────────────────────────
function calcMean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function calcStd(arr, mean) {
  const variance = arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}
function calcZScore(value, mean, std) {
  if (std === 0) return 0;
  return (value - mean) / std;
}
function updateEWMA(value) {
  if (ewma === null) { ewma = value; return ewma; }
  ewma = EWMA_ALPHA * value + (1 - EWMA_ALPHA) * ewma;
  return ewma;
}

// ── Keyword Spike Detection ─────────────────────────────────
const HIGH_ALERT_KEYWORDS = [
  'nuclear','war declared','invasion','coup','collapse','default',
  'pandemic','earthquake','tsunami','explosion','assassination'
];

function scanForHighAlert(articles) {
  const hits = [];
  for (const article of articles) {
    const text = `${article.title} ${article.summary}`.toLowerCase();
    for (const kw of HIGH_ALERT_KEYWORDS) {
      if (text.includes(kw)) {
        hits.push({ keyword: kw, source: article.source, title: article.title, region: article.region });
        break;
      }
    }
  }
  return hits;
}

// ── Main Detection Loop ─────────────────────────────────────
async function detectAnomalies() {
  // Pull latest analyzed articles
  const rawItems = await redis.lrange('orion:news:analyzed', 0, 49).catch(() => []);
  if (!rawItems.length) return;

  const articles = rawItems.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
  const count = articles.length;

  volumeGauge.set(count);
  volumeHistory.push(count);
  if (volumeHistory.length > MAX_HISTORY) volumeHistory.shift();

  const currentEWMA = updateEWMA(count);

  // Need at least 10 data points for statistical detection
  if (volumeHistory.length < 10) return;

  const mean = calcMean(volumeHistory);
  const std = calcStd(volumeHistory, mean);
  const zScore = calcZScore(count, mean, std);
  zscoreGauge.set(zScore);

  const anomalies = [];

  // Volume spike detection (z-score > 2.5 = anomaly)
  if (Math.abs(zScore) > 2.5) {
    const severity = Math.abs(zScore) > 3.5 ? 'CRITICAL' : 'HIGH';
    const anomaly = {
      type: 'VOLUME_SPIKE',
      severity,
      zscore: parseFloat(zScore.toFixed(3)),
      count,
      mean: parseFloat(mean.toFixed(1)),
      ewma: parseFloat(currentEWMA.toFixed(1)),
      detected_at: new Date().toISOString()
    };
    anomalies.push(anomaly);
    anomaliesDetected.inc({ severity, region: 'global' });
    console.log(`[Anomaly] VOLUME SPIKE ${severity} | z=${zScore.toFixed(2)} | count=${count}`);
  }

  // EWMA deviation (current > 2x EWMA = unusual burst)
  if (ewma > 0 && count > ewma * 2) {
    const anomaly = {
      type: 'EWMA_BURST',
      severity: 'HIGH',
      count,
      ewma: parseFloat(currentEWMA.toFixed(1)),
      ratio: parseFloat((count / ewma).toFixed(2)),
      detected_at: new Date().toISOString()
    };
    anomalies.push(anomaly);
    anomaliesDetected.inc({ severity: 'HIGH', region: 'global' });
    console.log(`[Anomaly] EWMA BURST | count=${count} ewma=${currentEWMA.toFixed(1)}`);
  }

  // Keyword-based high alert scan
  const keywordHits = scanForHighAlert(articles);
  if (keywordHits.length > 0) {
    const anomaly = {
      type: 'KEYWORD_ALERT',
      severity: 'CRITICAL',
      hits: keywordHits,
      count: keywordHits.length,
      detected_at: new Date().toISOString()
    };
    anomalies.push(anomaly);
    for (const hit of keywordHits) {
      anomaliesDetected.inc({ severity: 'CRITICAL', region: hit.region || 'unknown' });
    }
    console.log(`[Anomaly] KEYWORD ALERT | ${keywordHits.length} high-alert terms detected`);
  }

  // Store anomalies
  for (const anomaly of anomalies) {
    await redis.lpush('orion:anomalies', JSON.stringify(anomaly));
  }
  await redis.ltrim('orion:anomalies', 0, 199);

  if (!anomalies.length) {
    console.log(`[Anomaly] Normal | z=${zScore.toFixed(2)} | count=${count} | mean=${mean.toFixed(1)}`);
  }
}

// ── HTTP Server ─────────────────────────────────────────────
http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', window: volumeHistory.length, ewma }));
  } else if (req.url === '/anomalies') {
    const items = await redis.lrange('orion:anomalies', 0, 19).catch(() => []);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ anomalies: items.map(i => JSON.parse(i)), total: items.length }));
  } else if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': register.contentType });
    res.end(await register.metrics());
  } else { res.writeHead(404); res.end(); }
}).listen(PORT, () => console.log(`[Anomaly] :${PORT}`));

// Run every 60 seconds
detectAnomalies();
setInterval(detectAnomalies, 60000);
console.log('[Anomaly] Engine started — detecting every 60s');
