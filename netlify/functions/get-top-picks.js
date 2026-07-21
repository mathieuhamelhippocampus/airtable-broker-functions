// netlify/functions/get-top-picks.js
//
// Objectif : donner, pour chaque client, la liste des "Top Picks du jour"
// qui matchent sa Zone géographique ET son Secteur — même logique que le
// matching Event x Client dans get-daily-tasks.js, mais appliquée à une
// liste de picks maintenue en dur dans ce fichier (pas de table Airtable
// dédiée : à éditer manuellement chaque jour où de nouvelles notes sortent).
//
// Appel : GET /.netlify/functions/get-top-picks
//
// Variables d'environnement requises :
//   AIRTABLE_TOKEN   = Personal Access Token Airtable (scope data.records:read)
//   AIRTABLE_BASE_ID = ID de la base (ex. apprqkMTo6NG34BkU)

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

const TABLE_CLIENTS = "Clients - Investment Universe";

// ---- À éditer chaque jour : les picks du jour ----
const TOP_PICKS = [
  {
    id: "weichai-power",
    name: "Weichai Power",
    ticker: "000338 CH / 2338 HK",
    countries: ["China"],
    secteurs: ["Industrials & Capital Goods (Industrial Conglomerates; Industrial Machinery; Aerospace & Defense; Trading Companies & Distributors)"],
    rating: "Outperform — Marquee Buy",
    tsr: "62.0% / 44.6%",
    summary: "Numéro 1 du pecking order Macquarie sur la tournée industrielle Chine (Weichai > Dingli > Hengli > Sany > AirTAC). Exposition la plus large au cycle FA/excavateurs domestique et à la chaîne d'approvisionnement du robot humanoïde.",
    source: "Macquarie Research, China industrial & humanoid robot trip, 21 juillet 2026",
  },
  {
    id: "pumtech-korea",
    name: "Pumtech Korea",
    ticker: "251970 KS",
    countries: ["Korea"],
    secteurs: ["Consumer & Retail (Apparel Retail; Apparel/Accessories & Luxury Goods; Broadline Retail; Consumer Staples Merchandise Retail; Household Appliances; Leisure Products)"],
    rating: "Outperform",
    tsr: "70%",
    summary: "TSR le plus élevé de la couverture cosmétiques coréenne de Macquarie. La correction récente reflète une mauvaise lecture de la montée en puissance de la ligne P4, pas un ralentissement de la demande. Expansion de capacité (Plant 6, Plant 7) en bonne voie.",
    source: "Macquarie Research, Korea Cosmetics — 2Q26 preview, 21 juillet 2026",
  },
  {
    id: "innolight",
    name: "Innolight",
    ticker: "300308 CH",
    countries: ["China"],
    secteurs: ["Semiconductors & Electronics (Semiconductors; Semiconductor Equipment; Electronic Components; Electronic Equipment & Instruments)"],
    rating: "Outperform",
    tsr: "TP Rmb1,800",
    summary: "Top pick explicite de Macquarie sur l'infrastructure IA domestique post-WAIC 2026. La compétition se déplace de la puce individuelle vers le « supernode » ; Innolight capte la bascule vers l'interconnexion optique en scale-up.",
    source: "Macquarie Research, China Technology — WAIC 2026, 21 juillet 2026",
  },
];

async function airtableGet(path) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable API error (${res.status}): ${body}`);
  }
  return res.json();
}

async function airtableGetAll(tableName, params = "") {
  let records = [];
  let offset;
  do {
    const sep = params ? "&" : "";
    const url = `${encodeURIComponent(tableName)}?${params}${offset ? `${sep}offset=${offset}` : ""}`;
    const data = await airtableGet(url);
    records = records.concat(data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function zoneMatch(pickCountries, clientZones) {
  const pickSet = new Set(asArray(pickCountries));
  const clientSet = new Set(asArray(clientZones));
  if (clientSet.has("Global (All Countries)")) return true;
  for (const c of pickSet) if (clientSet.has(c)) return true;
  return false;
}

function secteurMatch(pickSecteurs, clientSecteurs) {
  const pickSet = new Set(asArray(pickSecteurs));
  const clientSet = new Set(asArray(clientSecteurs));
  for (const s of pickSet) if (clientSet.has(s)) return true;
  return false;
}

function firstName(value) {
  if (Array.isArray(value)) return value[0] || "(sans nom)";
  return value || "(sans nom)";
}

export default async (req, context) => {
  try {
    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
      return new Response(
        JSON.stringify({ error: "AIRTABLE_TOKEN ou AIRTABLE_BASE_ID manquant côté serveur." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const clientRecords = await airtableGetAll(TABLE_CLIENTS);

    const clientMatches = [];

    for (const cl of clientRecords) {
      const cf = cl.fields || {};
      const clientZones = cf["Geographic Universe"];
      const clientSecteurs = cf["Sectors / Themes Followed"];
      const clientName = firstName(cf["Management Company"]);

      const matched = TOP_PICKS.filter(
        (p) => zoneMatch(p.countries, clientZones) && secteurMatch(p.secteurs, clientSecteurs)
      );

      if (matched.length > 0) {
        clientMatches.push({
          clientId: cl.id,
          clientName,
          picks: matched,
        });
      }
    }

    // Tri : nombre de picks matchés décroissant
    clientMatches.sort((a, b) => b.picks.length - a.picks.length);

    return new Response(
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        totalPicksToday: TOP_PICKS.length,
        totalClientsMatched: clientMatches.length,
        clients: clientMatches,
      }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
