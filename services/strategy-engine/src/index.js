// ============================================================
// ORION — Strategy Engine (Tier 3)
// Synthesizes world model into actionable strategic outlook
// Produces allocation guidance + scenario scoring
// Uses Gemini for narrative intelligence generation
// Memory budget: 200MB
// ============================================================

const Redis = require('ioredis');
const client = require('prom-client');
const http = require('http');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 3014;

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const strategiesGenerated = new client.Counter({
  name: 'orion_strategies_generated_total',
  help: 'Total strategy outputs generated',
  registers: [register]
});
const geminiCalls = new client.Counter({
  name: 'orion_gemini_strategy_calls_total',
  help: 'Total Gemini API calls for strategy',
  registers: [register]
});

// ── Allocation rules by regime ──────────────────────────────
const REGIME_ALLOCATIONS = {
  BULL:     { equities: 60, bonds: 15, commodities: 10, fx: 10, crypto: 5,  cash: 0  },
  BEAR:     { equities: 20, bonds: 40, commodities: 15, fx: 10, crypto: 0,  cash: 15 },
  CRISIS:   { equities: 5,  bonds: 30, commodities: 20, fx: 10, crypto: 0,  cash: 35 },
  SIDEWAYS: { equities: 40, bonds: 25, commodities: 15, fx: 10, crypto: 5,  cash: 5  },
  FRAGILE:  { equities: 25, bonds: 35, commodities: 15, fx: 15, crypto: 0,  cash: 10 }
};

// ── Risk-adjust allocations from asset scores ───────────────
function adjustAllocations(base, assetScores) {
  const adjusted = { ...base };
  // If equities risk score > 70, shift 10% to cash
  if (assetScores.equities > 70) {
    adjusted.equities = Math.max(0, adjusted.equities - 10);
    adjusted.cash = (adjusted.cash || 0) + 10;
  }
  // If commodities risk < 40, increase commodities
  if (assetScores.commodities < 40) {
    adjusted.commodities = Math.min(30, adjusted.commodities + 5);
    adjusted.bonds = Math.max(0, adjusted.bonds - 5);
  }
  return adjusted;
}

// ── Generate scenario scores ────────────────────────────────
function generateScenarios(regime, regionScores, anomalyCount) {
  const menaRisk = regionScores.mena || 50;
  const asiaRisk = regionScores.asia || 50;
  const financeRisk = regionScores.finance || 50;

  return [
    {
      name: 'Base Case',
      probability: regime === 'SIDEWAYS' ? 0.55 : regime === 'BULL' ? 0.60 : 0.40,
      description: `Continuation of ${regime} regime. Markets absorb current signals.`,
      horizon: '4-8 weeks'
    },
    {
      name: 'Escalation',
      probability: (menaRisk + asiaRisk) / 200 * (anomalyCount > 0 ? 1.5 : 1.0),
      description: 'Regional conflict or economic shock intensifies. Risk-off acceleration.',
      horizon: '1-3 weeks'
    },
    {
      name: 'De-escalation',
      probability: regime === 'CRISIS' ? 0.20 : regime === 'BEAR' ? 0.30 : 0.15,
      description: 'Diplomatic resolution or policy response reduces risk premium.',
      horizon: '4-12 weeks'
    },
    {
      name: 'Regime Shift',
      probability: Math.min(0.25, anomalyCount * 0.08 + (financeRisk > 65 ? 0.10 : 0.05)),
      description: 'Unexpected macro catalyst triggers rapid regime change.',
      horizon: '1-4 weeks'
    }
  ].map(s => ({ ...s, probability: parseFloat(Math.min(0.95, s.probability).toFixed(2)) }));
}

// ── Gemini narrative generation ─────────────────────────────
async function generateNarrative(worldState) {
  if (!GEMINI_API_KEY) return 'Gemini API key not configured.';
  try {
    const prompt = `You are ORION, a strategic geopolitical and financial intelligence system.
Based on this world state data, write a concise 3-sentence strategic intelligence briefing:

Regime: ${worldState.regime} (confidence: ${(worldState.regime_confidence * 100).toFixed(0)}%)
Signal: ${worldState.outlook?.signal}
Region risks: ${JSON.stringify(worldState.region_scores)}
Asset risks: ${JSON.stringify(worldState.asset_risk_scores)}
Active anomalies: ${worldState.active_anomalies}

Be direct, analytical, and actionable. No fluff. Reference specific regions and asset classes.`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 300, temperature: 0.4 }
        })
      }
    );
    const data = await res.json();
    geminiCalls.inc();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Narrative unavailable.';
  } catch (err) {
    return `Narrative error: ${err.message}`;
  }
}

// ── Main Strategy Generation ────────────────────────────────
let lastNarrativeTime = 0;
const NARRATIVE_INTERVAL = 10 * 60 * 1000; // every 10 min (Gemini rate limit)

async function generateStrategy() {
  const stateRaw = await redis.get('orion:world:state').catch(() => null);
  if (!stateRaw) { console.log('[Strategy] No world state yet'); return; }

  const worldState = JSON.parse(stateRaw);
  const regime = worldState.regime || 'SIDEWAYS';
  const assetScores = worldState.asset_risk_scores || {};
  const regionScores = worldState.region_scores || {};
  const anomalyCount = worldState.active_anomalies || 0;

  const baseAllocation = REGIME_ALLOCATIONS[regime] || REGIME_ALLOCATIONS.SIDEWAYS;
  const allocation = adjustAllocations(baseAllocation, assetScores);
  const scenarios = generateScenarios(regime, regionScores, anomalyCount);

  // Only call Gemini every 10 minutes
  let narrative = null;
  const now = Date.now();
  if (now - lastNarrativeTime > NARRATIVE_INTERVAL) {
    narrative = await generateNarrative(worldState);
    lastNarrativeTime = now;
  } else {
    const existing = await redis.get('orion:strategy:current').catch(() => null);
    narrative = existing ? JSON.parse(existing).narrative : null;
  }

  const strategy = {
    timestamp: new Date().toISOString(),
    regime,
    signal: worldState.outlook?.signal || 'NEUTRAL',
    allocation,
    scenarios,
    narrative,
    risk_summary: {
      highest_region: Object.entries(regionScores).sort((a, b) => b[1] - a[1])[0],
      highest_asset: Object.entries(assetScores).sort((a, b) => b[1] - a[1])[0],
      anomaly_count: anomalyCount
    }
  };

  await redis.set('orion:strategy:current', JSON.stringify(strategy));
  await redis.lpush('orion:strategy:history', JSON.stringify(strategy));
  await redis.ltrim('orion:strategy:history', 0, 287);
  strategiesGenerated.inc();

  console.log(`[Strategy] ${strategy.signal} | ${regime} | Top risk: ${strategy.risk_summary.highest_region}`);
}

// ── HTTP Server ─────────────────────────────────────────────
http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  } else if (req.url === '/strategy') {
    const s = await redis.get('orion:strategy:current').catch(() => null);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(s || '{}');
  } else if (req.url === '/history') {
    const items = await redis.lrange('orion:strategy:history', 0, 11).catch(() => []);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(items.map(i => JSON.parse(i))));
  } else if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': register.contentType });
    res.end(await register.metrics());
  } else { res.writeHead(404); res.end(); }
}).listen(PORT, () => console.log(`[Strategy] :${PORT}`));

generateStrategy();
setInterval(generateStrategy, 5 * 60 * 1000); // every 5 min
console.log('[Strategy] Engine started — every 5min');
