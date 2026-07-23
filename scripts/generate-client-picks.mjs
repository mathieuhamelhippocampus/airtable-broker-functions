import { TOP_PICKS_POOL } from "../lib/top-picks-data.mjs";
import fs from "fs";
import path from "path";

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_CLIENTS = "Clients - Investment Universe";
const SITE_URL = "https://airtable-broker-functions.netlify.app";
const EMAIL_FIELD_CANDIDATES = ["Email", "Contact Email", "E-mail", "Email Address"];

// Date de génération de la page (pas la date de note d'un pick individuel,
// qui reste dans son propre champ `source` et ne doit jamais être touchée ici).
const GENERATION_DATE = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

function toBloombergTicker(rawTicker) {
  const parts = rawTicker.split("/").map(p => p.trim());
  const hk = parts.find(p => p.endsWith("HK"));
  const primary = hk || parts[0];
  return `${primary} Equity`;
}

const bloombergByTicker = {};
JSON.parse(fs.readFileSync("data/bloomberg-metrics.json", "utf-8")).forEach(b => {
  bloombergByTicker[b.ticker] = b;
});

function bloombergBlockHTML(p) {
  const bTicker = toBloombergTicker(p.ticker);
  const b = bloombergByTicker[bTicker];
  if (!b) return "";

  const chartFile = b.chart_revenue ? b.chart_revenue.split("/").pop() : null;
  const chartImg = chartFile
    ? `<img src="/public-picks/charts/${chartFile}" alt="Revenue TTM ${p.name}" style="width:100%; max-width:420px; margin-top:10px; border-radius:3px;">`
    : "";

  return `
    <div style="margin-top:14px; padding-top:14px; border-top:1px dashed var(--rule);">
      <div class="section-label">Bloomberg market data — ${b.name}</div>
      <div class="metrics-row" style="grid-template-columns: repeat(5, 1fr);">
        <div class="metric-box"><div class="metric-label">P/E</div><div class="metric-value">${b.pe}x</div></div>
        <div class="metric-box"><div class="metric-label">P/B</div><div class="metric-value">${b.pb}x</div></div>
        <div class="metric-box"><div class="metric-label">Rev TTM</div><div class="metric-value">${b.rev_usd_m}M$</div></div>
        <div class="metric-box"><div class="metric-label">Rev CAGR 3Y</div><div class="metric-value">${b.croissance_histo_ca_pct}%</div></div>
        <div class="metric-box"><div class="metric-label">Impl. EPS growth</div><div class="metric-value">${b.croissance_implicite_bpa_pct}%</div></div>
      </div>
      ${chartImg}
    </div>`;
}

if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
  console.error("AIRTABLE_TOKEN / AIRTABLE_BASE_ID manquants dans l'environnement. Fais `netlify env:pull` ou exporte-les avant de lancer ce script.");
  process.exit(1);
}

async function airtableGetAll(tableName) {
  let records = [];
  let offset;
  do {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}${offset ? `?offset=${offset}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    records = records.concat(data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

function asArray(v) { return !v ? [] : Array.isArray(v) ? v : [v]; }
function zoneMatch(pickCountries, clientZones) {
  const cs = new Set(asArray(clientZones));
  if (cs.has("Global (All Countries)")) return true;
  return asArray(pickCountries).some((c) => cs.has(c));
}
function secteurMatch(pickSecteurs, clientSecteurs) {
  const cs = new Set(asArray(clientSecteurs));
  return asArray(pickSecteurs).some((s) => cs.has(s));
}
function slugify(name) {
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function firstName(v) { return Array.isArray(v) ? (v[0] || "") : (v || ""); }

// Compat entre l'ancien schéma (tsr: string, moat: string) et le nouveau
// (metrics: [{label, value, sub}], structuralDrivers: [...], competitiveAdvantage: [...]).
function pickTSR(p) {
  if (p.tsr) return p.tsr;
  if (Array.isArray(p.metrics)) {
    const m = p.metrics.find((x) => x && x.label === "TSR") || p.metrics.find((x) => x && x.label === "TP");
    if (m) return m.sub ? `${m.value} (${m.sub})` : m.value;
  }
  if (typeof p.tsrValue === "number") return `${p.tsrValue}%`;
  return "n/a";
}

function pickMoatLines(p) {
  if (p.moat) return [`<strong>Moat —</strong> ${p.moat}`];
  const lines = [];
  if (Array.isArray(p.structuralDrivers) && p.structuralDrivers.length) {
    lines.push(`<strong>Structural drivers —</strong> ${p.structuralDrivers.join(" ")}`);
  }
  if (Array.isArray(p.competitiveAdvantage) && p.competitiveAdvantage.length) {
    lines.push(`<strong>Competitive advantage —</strong> ${p.competitiveAdvantage.join(" ")}`);
  }
  if (lines.length === 0) lines.push(`<strong>Moat —</strong> n/a`);
  return lines;
}

function pickTSRLine(p) {
  return `${p.rating}, ${pickTSR(p)}`;
}

// Score de conviction (croissance CA 3Y - BPA implicite à 50%, TSR à 40%, P/B à 10%),
// calculé par scripts/compute-conviction-scores.mjs. Fallback sur tsrValue si absent
// (pick ajouté après le dernier calcul, ou script jamais lancé).
let CONVICTION_SCORES = {};
try {
  CONVICTION_SCORES = JSON.parse(fs.readFileSync("data/conviction-scores.json", "utf-8"));
} catch {
  console.warn("data/conviction-scores.json introuvable — fallback sur tsrValue pour le classement. Lance `node scripts/compute-conviction-scores.mjs` d'abord.");
}

function convictionScore(p) {
  const s = CONVICTION_SCORES[p.id];
  return typeof s === "number" && !isNaN(s) ? s : (p.tsrValue ?? -Infinity);
}

function pickTop3(clientZones, clientSecteurs) {
  const byScoreDesc = (a, b) => convictionScore(b) - convictionScore(a);

  // Geographic Universe est un prérequis strict à TOUS les paliers — un pick hors
  // de la zone du client (et hors "Global") ne doit jamais être recommandé, même
  // en repli sectoriel. Le tri par palier ne porte donc plus que sur la qualité
  // du match secteur, à l'intérieur du sous-ensemble déjà éligible géographiquement.
  const zoneEligible = TOP_PICKS_POOL.filter(p => zoneMatch(p.countries, clientZones));

  const exact = zoneEligible
    .filter(p => secteurMatch(p.secteurs, clientSecteurs))
    .sort(byScoreDesc);

  if (exact.length === 0) {
    return { top3: [], matched: false };
  }

  const rest = zoneEligible
    .filter(p => !exact.includes(p))
    .sort(byScoreDesc);

  const combined = [...exact, ...rest];
  const seen = new Set();
  const top3 = [];
  for (const p of combined) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    top3.push(p);
    if (top3.length === 3) break;
  }
  return { top3, matched: true };
}

function metricsRowHTML(p) {
  if (!Array.isArray(p.metrics) || p.metrics.length === 0) return "";

  // Deux formats coexistent dans le pool : objets {label, value, sub} (grille de
  // cases compactes) ou chaînes descriptives complètes (liste à puces, comme
  // Structural Drivers) — on détecte le format selon le type du premier élément.
  if (typeof p.metrics[0] === "string") {
    return `
      <div class="section-label">Key metrics</div>
      <ul class="pts">${p.metrics.map((m) => `<li>${m}</li>`).join("")}</ul>`;
  }

  return `
      <div class="metrics-row">
        ${p.metrics.map((m) => `
        <div class="metric-box">
          <div class="metric-label">${m.label}</div>
          <div class="metric-value">${m.value}</div>
          ${m.sub ? `<div class="metric-sub">${m.sub}</div>` : ""}
        </div>`).join("")}
      </div>`;
}

function renderClientHTML(clientName, gerantName, top3) {
  const cardHTML = (p, i) => {
    const catalystsLi = p.catalysts && p.catalysts.length
      ? `<li><strong>Catalysts —</strong> ${p.catalysts.join(" ")}</li>`
      : "";

    return `
  <div class="card rank-${i+1}">
    <div class="card-left">
      <div class="rank-number">0${i+1}</div>
      <div class="rank-label">Pick ${i+1}</div>
      <div class="card-ticker">${p.name}</div>
      <div class="card-name">${p.ticker}</div>
      <span class="pill pill-blue">${p.rating}</span>
      <div class="card-tsr">${pickTSR(p)}</div>
    </div>
    <div class="card-right">
      ${metricsRowHTML(p)}
      <ul class="pts">
        ${pickMoatLines(p).map((line) => `<li>${line}</li>`).join("")}
        ${catalystsLi}
      </ul>
      <ul class="pts">
        <li><strong>Thesis —</strong> ${p.thesis}</li>
      </ul>
      <div class="card-source">${p.source}</div>
      ${bloombergBlockHTML(p)}
    </div>
  </div>`;
  };

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Top 3 for ${clientName} — ${GENERATION_DATE}</title>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Figtree:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
:root { --white:#fff; --off:#f7f6f3; --rule:#d8d4cc; --muted:#9a9488; --body:#2c2a26; --ink:#141210; --blue:#1a3a6b; --blue-light:#e8eef6; --green:#1a5c3a; --amber:#8b5a00; }
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Figtree',sans-serif;font-size:13px;color:var(--body);}
.topbar{background:var(--blue);color:#fff;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;padding:7px 36px;display:flex;justify-content:space-between;}
header{padding:28px 36px 20px;border-bottom:1px solid var(--rule);}
header h1{font-family:'EB Garamond',serif;font-size:30px;color:var(--ink);}
header .sub{font-size:12px;color:var(--muted);margin-top:6px;}
.main{padding:26px 36px;}
.card{display:grid;grid-template-columns:200px 1fr;border:1px solid var(--rule);border-radius:3px;margin-bottom:16px;overflow:hidden;}
.card.rank-1{border-top:3px solid var(--blue);} .card.rank-2{border-top:3px solid var(--green);} .card.rank-3{border-top:3px solid var(--amber);}
.card-left{padding:18px 16px;border-right:1px solid var(--rule);background:var(--off);}
.rank-number{font-family:'EB Garamond',serif;font-size:26px;font-weight:600;color:var(--blue);}
.rank-label{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:10px;}
.card-ticker{font-family:'EB Garamond',serif;font-size:20px;color:var(--ink);}
.card-name{font-size:11px;color:var(--muted);margin-bottom:6px;}
.pill{display:inline-block;font-size:9px;text-transform:uppercase;padding:3px 8px;border-radius:2px;background:var(--blue-light);color:var(--blue);}
.card-tsr{font-size:11px;color:var(--muted);margin-top:8px;}
.card-right{padding:18px 20px;}
.metrics-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px;}
.metric-box{background:var(--off);border:1px solid var(--rule);border-radius:4px;padding:8px 6px;text-align:center;}
.metric-label{font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:3px;}
.metric-value{font-family:'EB Garamond',serif;font-size:15px;font-weight:600;color:var(--ink);line-height:1.1;}
.metric-sub{font-size:9px;color:var(--muted);margin-top:2px;}
.section-label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600;margin-bottom:8px;}
ul.pts{list-style:none;display:flex;flex-direction:column;gap:8px;margin-bottom:10px;}
ul.pts li{font-size:12px;line-height:1.5;}
.card-source{font-size:9.5px;color:var(--muted);}
footer{background:var(--off);border-top:1px solid var(--rule);padding:16px 36px;font-size:10px;color:var(--muted);}
</style></head><body>
<div class="topbar"><span>Kepler Cheuvreux — Institutional Equity Sales</span><span>Top 3 Ideas — ${GENERATION_DATE}</span></div>
<header><h1>Top 3 for ${gerantName ? `${gerantName} (${clientName})` : clientName}</h1><div class="sub">Personalised from Macquarie Research notes published as of ${GENERATION_DATE}, matched to your sector and geography mandate.</div></header>
<div class="main">
${top3.map(cardHTML).join("")}
</div>
<footer>Kepler Cheuvreux — institutional use only. All ratings, targets and TSR figures sourced from Macquarie Research notes, as compiled ${GENERATION_DATE}.</footer>
</body></html>`;
}

function renderEML(clientName, contactName, email, top3, pageUrl) {
  const to = email || "TODO@fill-in-manually.com";
  const subject = `Top 3 ideas for ${contactName ? `${contactName} (${clientName})` : clientName} — ${GENERATION_DATE}`;
  const greeting = contactName ? `Hi ${contactName.split(" ")[0]},` : "Hi,";
  const body = `${greeting}

Based on this week's Macquarie research, here are three ideas matched to your coverage:

${top3.map((p, i) => `${i+1}. ${p.name} (${p.ticker}) — ${pickTSRLine(p)}`).join("\n")}

Full write-up with moat and thesis for each name: ${pageUrl}

Happy to set up a call with the analyst on any of these.

Best,
Mathieu`;
  return `To: ${to}\nSubject: ${subject}\nContent-Type: text/plain; charset="UTF-8"\n\n${body}\n`;
}

// Lien mailto public — pas d'adresse destinataire (rien de confidentiel), l'utilisateur
// choisit/vérifie le destinataire dans son client mail avant envoi.
function renderMailtoLink(clientName, top3, pageUrl) {
  const subject = `Top 3 ideas for ${clientName} — ${GENERATION_DATE}`;
  const body = `Hi,

Based on this week's Macquarie research, here are three ideas matched to your coverage:

${top3.map((p, i) => `${i+1}. ${p.name} (${p.ticker}) — ${pickTSRLine(p)}`).join("\n")}

Full write-up with moat and thesis for each name: ${pageUrl}

Happy to set up a call with the analyst on any of these.

Best,
Mathieu`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function main() {
  const clients = await airtableGetAll(TABLE_CLIENTS);
  fs.mkdirSync("public-picks", { recursive: true });
  fs.mkdirSync("outreach-emails", { recursive: true });

  const missingEmail = [];
  const noMatch = [];
  const manifest = [];
  let count = 0;

  for (const cl of clients) {
    const cf = cl.fields || {};
    const clientName = firstName(cf["Management Company"]) || cl.fields["Name"] || "Client";
    const contactName = cf["Contact (name & role)"] || cf["Contact Name"] || cf["Contact"] || "";
    let email = "";
    for (const f of EMAIL_FIELD_CANDIDATES) { if (cf[f]) { email = cf[f]; break; } }

    const { top3, matched } = pickTop3(cf["Geographic Universe"], cf["Sectors / Themes Followed"]);

    if (!matched) {
      noMatch.push(clientName);
      continue;
    }

    if (!email) missingEmail.push(clientName);

    const gerantSlug = contactName ? slugify(contactName) : cl.id;
    const slug = slugify(`${clientName}-${gerantSlug}`);
    const pageUrl = `${SITE_URL}/public-picks/${slug}.html`;
    const mailtoLink = renderMailtoLink(clientName, top3, pageUrl);

    fs.writeFileSync(path.join("public-picks", `${slug}.html`), renderClientHTML(clientName, contactName, top3));
    fs.writeFileSync(path.join("outreach-emails", `${slug}.eml`), renderEML(clientName, contactName, email, top3, pageUrl));
    manifest.push({
      clientName,
      gerantName: contactName,
      slug,
      pickCount: top3.length,
      mailtoLink,
      preview: top3.map(p => ({ name: p.name, ticker: p.ticker, rating: p.rating })),
    });
    count++;
  }

  manifest.sort((a, b) => a.clientName.localeCompare(b.clientName));
  fs.writeFileSync(path.join("public-picks", "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join("outreach-emails", "_missing-emails.txt"), missingEmail.join("\n"));
  fs.writeFileSync(path.join("outreach-emails", "_no-sector-country-match.txt"), noMatch.join("\n"));
  console.log(`Généré : ${count} pages HTML + ${count} emails .eml + manifest.json (${manifest.length} entrées)`);
  console.log(`Clients sans email trouvé : ${missingEmail.length} (voir outreach-emails/_missing-emails.txt)`);
  console.log(`Clients exclus (aucun match secteur/pays) : ${noMatch.length} (voir outreach-emails/_no-sector-country-match.txt)`);
}

main();
