import { TOP_PICKS_POOL } from "../lib/top-picks-data.mjs";
import fs from "fs";

// Exclu : pas de vrai ticker Bloomberg (note macro/stratégie transversale) ou
// pas un "buy pick" (note de prudence Underperform).
const EXCLUDED_IDS = new Set(["macro-strategy-synthesis", "bangkok-bank"]);

const tickers = TOP_PICKS_POOL
  .filter(p => !EXCLUDED_IDS.has(p.id))
  .map(p => ({
    id: p.id,
    name: p.name,
    ticker: p.ticker,
  }));

fs.writeFileSync("top_picks_tickers.json", JSON.stringify(tickers, null, 2));
console.log(`Exporté ${tickers.length} tickers vers top_picks_tickers.json`);
