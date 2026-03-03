// ============================================================
// ORION — World Modeling Service (Tier 3)
// Aggregates regime + anomaly + news signals
// Builds a rolling world state model
// Scores geopolitical regions + asset classes
// Memory budget: 256MB
// ============================================================

const Redis = require('ioredis');
const client = require('prom-client');
const http = require('http');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const PORT = process.env.PORT || 3020;

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const worldStateUpdates = new client.Counter({
  name: 'orion_world_state_updates_total',
  help: 'Total world state model updates',
  registers: [register]
});
const regionScoreGauge = new client.Gauge({
  name: 'orion_region_risk_score',
  help: 'Risk score per region 0-100',
  labelNames: ['region'],
  registers: [register]
});

// ── Region baseline risk profiles ──────────────────────────
const REGIONS = ['global', 'africa', 'asia', 'mena', 'finance'];
const ASSET_CLASSES = ['equities', 'bonds', 'commodities', 'fx', 'crypto'];

// ── Sentiment keywords for world scoring ───────────────────
const ESCALATION = ['war','attack','sanctions','coup','collapse','default','crisis','conflict'];
const DEESCALATION = ['ceasefire','deal','agreement','recovery','growth','stimulus','peace','resolution'];

function scoreRegionFromArticles(region, articles) {
  const regional = articles.filter(a => a.region === region || region === 'global');
  if (!regional.length) return 50; // neutral baseline

  let escalation = 0, deescalation = 0;
  for (const a of regional) {
    const text = `${a.title} ${a.summary}`.toLowerCase();
    for (const kw of ESCALATION)   if (text.includes(kw)) escalation++;
    for (const kw of DEESCALATION) if (text.includes(kw)) deescalation++;
  }

  const net = escalation - deescalation;
  const base = 50;
  const score = Math.min(100, Math.max(0, base + net * 5));
  return parseFloat(score.toFixed(1));
}

function scoreAssetClass(assetClass, regime, regionScores, anomalyCount) {
  const avgRegion = Object.values(regionScores).reduce((a, b) => a + b, 0) / REGIONS.length;
  const regimeMultiplier = { BULL: 0.7, BEAR: 1.3, CRISIS: 1.6, SIDEWAYS: 1.0, FRAGILE: 1.2 }[regime] || 1.0;
  const anomalyBoost = anomalyCount > 0 ? anomalyCount * 3 : 0;

  const assetBaseRisk = { equities: 50, bonds: 35, commodities: 55, fx: 40, crypto: 65 };
  const base = assetBaseRisk[assetClass] || 50;
  const score = Math.min(100, Math.max(0, (base + (avgRegion - 50) * 0.5 + anomalyBoost) * regimeMultiplier));
  return parseFloat(score.toFixed(1));
}

function buildOutlook(regime, confidence, regionScores, assetScores) {
  const avgRisk = Object.values(regionScores).reduce((a, b) => a + b, 0) / REGIONS.length;

  let signal = 'NEUTRAL';
  let summary = '';

  if (regime === 'CRISIS' && avgRisk > 65) {
    signal = 'RISK-OFF';
    summary = 'Crisis conditions detected across multiple regions. Defensive posture recommended.';
  } else if (regime === 'BEAR' || avgRisk > 60) {
    signal = 'CAUTIOUS';
    summary = 'Elevated stress indicators. Monitor closely for escalation.';
  } else if (regime === 'BULL' && avgRisk < 40) {
    signal = 'RISK-ON';
    summary = 'Constructive conditions. Growth signals dominant across key regions.';
  } else if (regime === 'FRAGILE') {
    signal = 'WATCH';
    summary = 'Mixed signals. Fragile equilibrium — event risk elevated.';
  } else {
    signal = 'NEUTRAL';
    summary = 'No dominant directional signal. Monitoring for regime shift.';
  }

  return { signal, summary, regime, confidence };
}

async function updateWorldModel() {
  // Pull current regime
  const regimeRaw = await redis.get('orion:regime:current').catch(() => null);
  const regime = regimeRaw ? JSON.parse(regimeRaw) : { regime: 'SIDEWAYS', confidence: 0.5 };

  // Pull recent anomalies
  const anomalyItems = await redis.lrange('orion:anomalies', 0, 9).catch(() => []);
  const anomalies = anomalyItems.map(i => { try { return JSON.parse(i); } catch { return null; } }).filter(Boolean);

  // Pull recent processed news
  const newsItems = await redis.lrange('orion:news:processed', 0, 49).catch(() => []);
  const articles = newsItems.map(i => { try { return JSON.parse(i); } catch { return null; } }).filter(Boolean);

  // Score all regions
  const regionScores = {};
  for (const region of REGIONS) {
    const score = scoreRegionFromArticles(region, articles);
    regionScores[region] = score;
    regionScoreGauge.set({ region }, score);
  }

  // Score asset classes
  const assetScores = {};
  for (const asset of ASSET_CLASSES) {
    assetScores[asset] = scoreAssetClass(asset, regime.regime, regionScores, anomalies.length);
  }

  // Build outlook
  const outlook = buildOutlook(regime.regime, regime.confidence, regionScores, assetScores);

  // Compose world state
  const worldState = {
    timestamp: new Date().toISOString(),
    regime: regime.regime,
    regime_confidence: regime.confidence,
    outlook,
    region_scores: regionScores,
    asset_risk_scores: assetScores,
    active_anomalies: anomalies.length,
    articles_analyzed: articles.length,
    top_anomalies: anomalies.slice(0, 3).map(a => ({ type: a.type, severity: a.severity }))
  };

  await redis.set('orion:world:state', JSON.stringify(worldState));
  await redis.lpush('orion:world:history', JSON.stringify(worldState));
  await redis.ltrim('orion:world:history', 0, 287); // 24h at 5min intervals
  worldStateUpdates.inc();

  console.log(`[World] ${outlook.signal} | Regime: ${regime.regime} | AvgRisk: ${Object.values(regionScores).reduce((a,b)=>a+b,0)/REGIONS.length|0}`);
}

// ── HTTP Server ─────────────────────────────────────────────
http.createServer(async (req, res) => {
  if (req.url === '/health') {
    const state = await redis.get('orion:world:state').catch(() => null);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', last_update: state ? JSON.parse(state).timestamp : null }));
  } else if (req.url === '/state') {
    const state = await redis.get('orion:world:state').catch(() => null);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(state || '{}');
  } else if (req.url === '/history') {
    const items = await redis.lrange('orion:world:history', 0, 23).catch(() => []);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(items.map(i => JSON.parse(i))));
  } else if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': register.contentType });
    res.end(await register.metrics());
  } else { res.writeHead(404); res.end(); }
}).listen(PORT, () => console.log(`[World] :${PORT}`));

updateWorldModel();
setInterval(updateWorldModel, 60000);
console.log('[World] Modeling — every 60s');
