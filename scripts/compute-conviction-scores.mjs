import { TOP_PICKS_POOL } from "../lib/top-picks-data.mjs";
import fs from "fs";

const WEIGHTS = {
  growthSurprise: 0.50, // (croissance CA 3Y - croissance BPA implicite) : plus haut = mieux
  tsr: 0.40,             // plus haut = mieux
  pb: 0.10,              // plus bas = mieux (inversé)
};

function toBloombergTicker(rawTicker) {
  const parts = rawTicker.split("/").map(p => p.trim());
  const hk = parts.find(p => p.endsWith("HK"));
  const primary = hk || parts[0];
  return `${primary} Equity`;
}

function normalize(values) {
  const valid = values.filter(v => typeof v === "number" && !isNaN(v));
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  return values.map(v => {
    if (typeof v !== "number" || isNaN(v) || max === min) return null;
    return ((v - min) / (max - min)) * 100;
  });
}

const bloombergData = JSON.parse(fs.readFileSync("data/bloomberg-metrics.json", "utf-8"));
const bloombergByTicker = {};
bloombergData.forEach(b => { bloombergByTicker[b.ticker] = b; });

const rows = TOP_PICKS_POOL.map(p => {
  const bTicker = toBloombergTicker(p.ticker);
  const b = bloombergByTicker[bTicker] || null;
  const revCagr3Y = b && typeof b.croissance_histo_ca_pct === "number" ? b.croissance_histo_ca_pct : null;
  const impliedEpsGrowth = b && typeof b.croissance_implicite_bpa_pct === "number" ? b.croissance_implicite_bpa_pct : null;
  const growthSurprise = (revCagr3Y !== null && impliedEpsGrowth !== null) ? (revCagr3Y - impliedEpsGrowth) : null;
  return {
    id: p.id,
    tsr: p.tsrValue,
    growthSurprise,
    pb: b && typeof b.pb === "number" ? b.pb : null,
    bloombergMatched: !!b,
  };
});

const tsrNorm = normalize(rows.map(r => r.tsr));
const growthNorm = normalize(rows.map(r => r.growthSurprise));
const pbNorm = normalize(rows.map(r => r.pb)); // sera inversé ci-dessous

const scores = {};
rows.forEach((r, i) => {
  const parts = [];
  const weightsUsed = [];

  if (tsrNorm[i] !== null) { parts.push(WEIGHTS.tsr * tsrNorm[i]); weightsUsed.push(WEIGHTS.tsr); }
  if (growthNorm[i] !== null) { parts.push(WEIGHTS.growthSurprise * growthNorm[i]); weightsUsed.push(WEIGHTS.growthSurprise); }
  if (pbNorm[i] !== null) { parts.push(WEIGHTS.pb * (100 - pbNorm[i])); weightsUsed.push(WEIGHTS.pb); }

  const totalWeight = weightsUsed.reduce((a, b) => a + b, 0);
  scores[r.id] = totalWeight > 0 ? parts.reduce((a, b) => a + b, 0) / totalWeight : r.tsr; // fallback TSR seul si aucune donnée Bloomberg
});

fs.writeFileSync("data/conviction-scores.json", JSON.stringify(scores, null, 2));

console.log("Scores calculés :");
rows.forEach(r => {
  const scoreLabel = typeof scores[r.id] === "number" ? scores[r.id].toFixed(1) : "n/a";
  console.log(`  ${r.id}: score=${scoreLabel} | growthSurprise=${r.growthSurprise} | TSR=${r.tsr} | P/B=${r.pb} | Bloomberg matché: ${r.bloombergMatched}`);
});
