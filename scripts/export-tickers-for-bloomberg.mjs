import { TOP_PICKS_POOL } from "../lib/top-picks-data.mjs";
import fs from "fs";

const tickers = TOP_PICKS_POOL
  .map(p => ({
    id: p.id,
    name: p.name,
    ticker: p.ticker,
  }));

fs.writeFileSync("top_picks_tickers.json", JSON.stringify(tickers, null, 2));
console.log(`Exporté ${tickers.length} tickers vers top_picks_tickers.json`);
