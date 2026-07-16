// netlify/functions/create-events.js
//
// Objectif : créer des Events dans Airtable directement depuis un appel HTTP,
// sans passer par le glisser-déposer CSV manuel. Protégé par un secret partagé
// (jamais exposé publiquement) et un token Airtable dédié à l'écriture,
// séparé du token lecture seule utilisé par les autres fonctions.
//
// Sécurité :
//   - Nécessite ?secret=XXXX correspondant à la variable d'environnement
//     CREATE_EVENTS_SECRET (à définir toi-même dans Netlify, jamais en dur)
//   - Utilise AIRTABLE_TOKEN_WRITE (scope data.records:read + write,
//     limité à la base "Broking Broker"), distinct de AIRTABLE_TOKEN
//     (lecture seule, utilisé par get-eligible-clients / get-daily-tasks /
//     check-new-events)
//   - Dédoublonne automatiquement avant toute écriture : un event dont le
//     couple (Event Name, Date) existe déjà est ignoré, jamais recréé
//
// Appel : POST /.netlify/functions/create-events
// Corps JSON : { "secret": "XXXX", "events": [...] }
//
// Format de chaque event dans "events" : identique à check-new-events.js
// [{"name": "...", "type": "...", "date": "YYYY-MM-DD", "ville": "", "societe": "",
//   "pays": ["China"], "secteurs": [], "analystes": ["Nom Analyste"]}, ...]

const AIRTABLE_TOKEN_WRITE = process.env.AIRTABLE_TOKEN_WRITE;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const CREATE_EVENTS_SECRET = process.env.CREATE_EVENTS_SECRET;

const TABLE_EVENTS = "Events";

async function airtableGetAll(tableName, fields) {
  let records = [];
  let offset;
  do {
    const params = new URLSearchParams();
    if (offset) params.set("offset", offset);
    if (fields) fields.forEach((f) => params.append("fields[]", f));
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}?${params}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN_WRITE}` } });
    if (!res.ok) throw new Error(`Airtable API error (${res.status}): ${await res.text()}`);
    const data = await res.json();
    records = records.concat(data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

async function batchCreate(tableName, recordsPayload) {
  const created = [];
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`;
  for (let i = 0; i < recordsPayload.length; i += 10) {
    const chunk = recordsPayload.slice(i, i + 10);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN_WRITE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: chunk, typecast: true }),
    });
    if (!res.ok) throw new Error(`Airtable create error (${res.status}): ${await res.text()}`);
    const data = await res.json();
    created.push(...data.records);
    await new Promise((r) => setTimeout(r, 220)); // reste sous 5 req/sec
  }
  return created;
}

export default async (req, context) => {
  try {
    if (!AIRTABLE_TOKEN_WRITE || !AIRTABLE_BASE_ID || !CREATE_EVENTS_SECRET) {
      return new Response(
        JSON.stringify({ error: "Configuration serveur incomplète (token écriture, base ID, ou secret manquant)." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Utiliser POST avec un corps JSON: { secret, events: [...] }" }),
        { status: 405, headers: { "Content-Type": "application/json" } }
      );
    }

    let body;
    try {
      body = await req.json();
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Corps JSON invalide: " + e.message }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (body.secret !== CREATE_EVENTS_SECRET) {
      return new Response(
        JSON.stringify({ error: "Secret invalide ou manquant." }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    const candidates = body.events;
    if (!Array.isArray(candidates)) {
      return new Response(
        JSON.stringify({ error: "'events' doit être un tableau." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Dédoublonnage obligatoire avant toute écriture
    const existingRecords = await airtableGetAll(TABLE_EVENTS, ["Event Name", "Date"]);
    const existingKeys = new Set(
      existingRecords.map((r) => `${(r.fields["Event Name"] || "").trim()}|${(r.fields["Date"] || "").trim()}`)
    );

    const toCreate = [];
    const skipped = [];
    for (const ev of candidates) {
      const key = `${(ev.name || "").trim()}|${(ev.date || "").trim()}`;
      if (existingKeys.has(key)) {
        skipped.push(ev.name);
        continue;
      }
      const fields = {
        "Event Name": ev.name,
        "Event Type": ev.type,
        "Date": ev.date,
      };
      if (ev.ville) fields["Ville"] = ev.ville;
      if (ev.societe) fields["Société"] = ev.societe;
      if (ev.pays && ev.pays.length) fields["Pays"] = ev.pays;
      if (ev.secteurs && ev.secteurs.length) fields["Méta-secteurs"] = ev.secteurs;
      if (ev.analystes && ev.analystes.length) fields["Analystes"] = ev.analystes;

      toCreate.push({ fields });
    }

    const created = toCreate.length ? await batchCreate(TABLE_EVENTS, toCreate) : [];

    return new Response(
      JSON.stringify({
        demandes: candidates.length,
        deja_en_base_ignores: skipped,
        crees: created.length,
        details_crees: created.map((r) => ({ id: r.id, name: r.fields["Event Name"] })),
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
