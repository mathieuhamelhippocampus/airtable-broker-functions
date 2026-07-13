// netlify/functions/get-eligible-clients.js
//
// Objectif : pour un Event donné (par son Airtable record ID), retourner
// la liste des Clients éligibles (Zone Match + Secteur Match + quota OK)
// SANS créer aucune ligne dans la table Bookings.
//
// Appel : GET /.netlify/functions/get-eligible-clients?eventId=recXXXXXXXXXXXXXX
//
// Variables d'environnement requises (à configurer dans Netlify, jamais en dur) :
//   AIRTABLE_TOKEN   = Personal Access Token Airtable (scopes: data.records:read)
//   AIRTABLE_BASE_ID = ID de la base (commence par "app...")

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

const TABLE_EVENTS = "Events";
const TABLE_CLIENTS = "Clients - Investment Universe";

// Types d'événements qui consomment le quota budgétaire analyste
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

// Récupère TOUTES les pages d'une table (Airtable pagine par 100 lignes)
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

// Un client "Global (All Countries)" matche automatiquement n'importe quelle zone
function zoneMatch(eventPays, clientZones) {
  const eventSet = new Set(asArray(eventPays));
  const clientSet = new Set(asArray(clientZones));
  if (clientSet.has("Global (All Countries)")) return true;
  for (const pays of eventSet) {
    if (clientSet.has(pays)) return true;
  }
  return false;
}

function secteurMatch(eventSecteurs, clientSecteurs) {
  const eventSet = new Set(asArray(eventSecteurs));
  const clientSet = new Set(asArray(clientSecteurs));
  for (const secteur of eventSet) {
    if (clientSet.has(secteur)) return true;
  }
  return false;
}

function isEligible({ eventPays, eventSecteurs, eventType, clientZones, clientSecteurs, clientCallsRemaining }) {
  const zm = zoneMatch(eventPays, clientZones);
  const sm = secteurMatch(eventSecteurs, clientSecteurs);
  if (!zm || !sm) return { eligible: false, zoneMatch: zm, secteurMatch: sm };

  const consumesQuota = QUOTA_CONSUMING_TYPES.has(eventType);
  const quotaOk = !consumesQuota || (clientCallsRemaining ?? 0) > 0;

  return { eligible: quotaOk, zoneMatch: zm, secteurMatch: sm };
}

export default async (req, context) => {
  try {
    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
      return new Response(
        JSON.stringify({ error: "AIRTABLE_TOKEN ou AIRTABLE_BASE_ID manquant côté serveur." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const eventId = url.searchParams.get("eventId");
    if (!eventId) {
      return new Response(
        JSON.stringify({ error: "Paramètre 'eventId' requis, ex: ?eventId=recXXXXXXXXXXXXXX" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 1. Récupérer l'Event
    const eventRecord = await airtableGet(`${encodeURIComponent(TABLE_EVENTS)}/${eventId}`);
    const eventFields = eventRecord.fields || {};
    const eventPays = eventFields["Pays"];
    const eventSecteurs = eventFields["Méta-secteurs"];
    const eventType = eventFields["Event Type"];
    const eventName = eventFields["Event Name"];

    // 2. Récupérer tous les Clients
    const clientRecords = await airtableGetAll(TABLE_CLIENTS);

    // 3. Calculer le matching pour chaque client
    const results = clientRecords.map((rec) => {
      const f = rec.fields || {};
      const clientZones = f["Geographic Universe"];
      const clientSecteurs = f["Sectors / Themes Followed"];
      const clientCallsRemaining = f["Analyst Calls Remaining"];

      const { eligible, zoneMatch: zm, secteurMatch: sm } = isEligible({
        eventPays,
        eventSecteurs,
        eventType,
        clientZones,
        clientSecteurs,
        clientCallsRemaining,
      });

      return {
        clientId: rec.id,
        clientName: f["Management Company"] || "(sans nom)",
        zoneMatch: zm,
        secteurMatch: sm,
        callsRemaining: clientCallsRemaining ?? null,
        eligible,
      };
    });

    const eligibleClients = results.filter((r) => r.eligible);

    return new Response(
      JSON.stringify({
        event: { id: eventId, name: eventName, pays: eventPays, secteurs: eventSecteurs, type: eventType },
        totalClientsChecked: results.length,
        eligibleCount: eligibleClients.length,
        eligibleClients,
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
