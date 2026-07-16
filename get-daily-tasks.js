// netlify/functions/get-daily-tasks.js
//
// Objectif : donner une liste unique "qui appeler et pourquoi", en combinant :
//   1. Tous les Events de la table Events x tous les Clients -> matching Zone/Secteur/Quota
//   2. Les Clients en retard sur leur rythme annuel (Retard sur rythme > 0),
//      même sans event précis à l'horizon
//
// Appel : GET /.netlify/functions/get-daily-tasks
//
// Variables d'environnement requises :
//   AIRTABLE_TOKEN   = Personal Access Token Airtable (scope data.records:read)
//   AIRTABLE_BASE_ID = ID de la base (ex. apprqkMTo6NG34BkU)

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

const TABLE_EVENTS = "Events";
const TABLE_CLIENTS = "Clients - Investment Universe";

const QUOTA_CONSUMING_TYPES = new Set([
  "1:1 Analyst Call",
  "Physical Roadshow",
  "NDR",
  "Tour",
]);

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

function zoneMatch(eventPays, clientZones) {
  const eventSet = new Set(asArray(eventPays));
  const clientSet = new Set(asArray(clientZones));
  if (clientSet.has("Global (All Countries)")) return true;
  for (const p of eventSet) if (clientSet.has(p)) return true;
  return false;
}

function secteurMatch(eventSecteurs, clientSecteurs) {
  const eventSet = new Set(asArray(eventSecteurs));
  const clientSet = new Set(asArray(clientSecteurs));
  for (const s of eventSet) if (clientSet.has(s)) return true;
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

    const [eventRecords, clientRecords] = await Promise.all([
      airtableGetAll(TABLE_EVENTS),
      airtableGetAll(TABLE_CLIENTS),
    ]);

    // tasksByClient: clientId -> { clientName, reasons: [...] }
    const tasksByClient = new Map();

    function addReason(clientId, clientName, reason, budget) {
      if (!tasksByClient.has(clientId)) {
        tasksByClient.set(clientId, { clientName, budget: budget || 0, reasons: [] });
      }
      tasksByClient.get(clientId).reasons.push(reason);
    }

    const todayISO = new Date().toISOString().slice(0, 10);

    // 1. Matching Event x Client sur les events d'aujourd'hui ou à venir uniquement
    for (const ev of eventRecords) {
      const ef = ev.fields || {};
      const eventPays = ef["Pays"];
      const eventSecteurs = ef["Méta-secteurs"];
      const eventType = ef["Event Type"];
      const eventName = ef["Event Name"] || "(event sans nom)";
      const eventDate = ef["Date"] || null;

      if (!eventDate || eventDate < todayISO) continue;

      for (const cl of clientRecords) {
        const cf = cl.fields || {};
        const clientZones = cf["Geographic Universe"];
        const clientSecteurs = cf["Sectors / Themes Followed"];
        const callsRemaining = cf["Analyst Calls Remaining"];
        const budget = cf["Annual Research Budget (KEUR)"] || 0;

        const zm = zoneMatch(eventPays, clientZones);
        const sm = secteurMatch(eventSecteurs, clientSecteurs);
        if (!zm || !sm) continue;

        const consumesQuota = QUOTA_CONSUMING_TYPES.has(eventType);
        const quotaOk = !consumesQuota || (callsRemaining ?? 0) > 0;
        if (!quotaOk) continue;

        addReason(cl.id, firstName(cf["Management Company"]), {
          type: "event",
          eventName,
          eventDate,
          eventType,
        }, budget);
      }
    }

    // 2. Clients en retard sur leur rythme annuel
    for (const cl of clientRecords) {
      const cf = cl.fields || {};
      const retard = cf["Retard sur rythme"];
      const budget = cf["Annual Research Budget (KEUR)"] || 0;
      if (typeof retard === "number" && retard > 0) {
        addReason(cl.id, firstName(cf["Management Company"]), {
          type: "retard",
          retard,
          callsRemaining: cf["Analyst Calls Remaining"] ?? null,
        }, budget);
      }
    }

    const tasks = Array.from(tasksByClient.entries()).map(([clientId, data]) => ({
      clientId,
      clientName: data.clientName,
      budget: data.budget || 0,
      reasons: data.reasons,
    }));

    // Tri : clients payants (budget > 0) en premier, puis retard, puis nb de raisons
    tasks.sort((a, b) => {
      const aPaying = a.budget > 0 ? 1 : 0;
      const bPaying = b.budget > 0 ? 1 : 0;
      if (bPaying !== aPaying) return bPaying - aPaying;
      const retardA = a.reasons.find((r) => r.type === "retard")?.retard || 0;
      const retardB = b.reasons.find((r) => r.type === "retard")?.retard || 0;
      if (retardB !== retardA) return retardB - retardA;
      return b.reasons.length - a.reasons.length;
    });

    return new Response(
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        totalEventsChecked: eventRecords.filter(ev => (ev.fields || {})["Date"] >= todayISO).length,
        totalClientsChecked: clientRecords.length,
        totalClientsToCall: tasks.length,
        tasks,
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
