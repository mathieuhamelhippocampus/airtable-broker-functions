// netlify/functions/update-events.js
//
// Objectif : mettre à jour des champs sur des Events déjà existants (identifiés
// par Event Name + Date), par exemple pour compléter un Méta-secteurs oublié
// à la création. Même sécurité que create-events.js (secret + token écriture
// dédié), même dédoublonnage par (Event Name, Date) mais en sens inverse :
// ici on exige que l'event EXISTE déjà, sinon on ignore la ligne (jamais de
// création accidentelle depuis cette fonction).
//
// Appel : POST /.netlify/functions/update-events
// Corps JSON : { "secret": "XXXX", "updates": [
//   {"name": "...", "date": "YYYY-MM-DD", "fields": {"Méta-secteurs": ["..."]}}
// ]}
//
// "fields" peut contenir n'importe quel champ Airtable valide de la table Events.

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

async function batchUpdate(tableName, recordsPayload) {
  const updated = [];
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`;
  for (let i = 0; i < recordsPayload.length; i += 10) {
    const chunk = recordsPayload.slice(i, i + 10);
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN_WRITE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: chunk, typecast: true }),
    });
    if (!res.ok) throw new Error(`Airtable update error (${res.status}): ${await res.text()}`);
    const data = await res.json();
    updated.push(...data.records);
    await new Promise((r) => setTimeout(r, 220));
  }
  return updated;
}

export default async (req, context) => {
  try {
    if (!AIRTABLE_TOKEN_WRITE || !AIRTABLE_BASE_ID || !CREATE_EVENTS_SECRET) {
      return new Response(
        JSON.stringify({ error: "Configuration serveur incomplète." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Utiliser POST avec un corps JSON: { secret, updates: [...] }" }),
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

    const updates = body.updates;
    if (!Array.isArray(updates)) {
      return new Response(
        JSON.stringify({ error: "'updates' doit être un tableau." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const existingRecords = await airtableGetAll(TABLE_EVENTS, ["Event Name", "Date"]);
    const existingByKey = new Map(
      existingRecords.map((r) => [`${(r.fields["Event Name"] || "").trim()}|${(r.fields["Date"] || "").trim()}`, r.id])
    );

    const toUpdate = [];
    const notFound = [];
    for (const u of updates) {
      const key = `${(u.name || "").trim()}|${(u.date || "").trim()}`;
      const id = existingByKey.get(key);
      if (!id) {
        notFound.push(u.name);
        continue;
      }
      toUpdate.push({ id, fields: u.fields });
    }

    const updated = toUpdate.length ? await batchUpdate(TABLE_EVENTS, toUpdate) : [];

    return new Response(
      JSON.stringify({
        demandes: updates.length,
        introuvables: notFound,
        mis_a_jour: updated.length,
        details: updated.map((r) => ({ id: r.id, name: r.fields["Event Name"] })),
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
