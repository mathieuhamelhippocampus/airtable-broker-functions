// netlify/functions/check-new-events.js
//
// Objectif : comparer une liste candidate d'events (en paramètre GET, encodée
// en base64 JSON) à ce qui existe déjà dans Airtable, pour ne remonter que
// les vrais nouveaux events et signaler les anomalies (date passée, analyste
// introuvable, pays manquant). Claude appelle cette fonction directement
// (via web_fetch) chaque semaine après avoir parsé le nouvel email MQ Events
// Recap — aucune action manuelle nécessaire côté utilisateur pour ce diff.
//
// Appel : GET /.netlify/functions/check-new-events?events=<base64(JSON)>
//
// Format JSON attendu (liste d'objets) :
// [{"name": "...", "type": "...", "date": "YYYY-MM-DD", "ville": "", "societe": "",
//   "pays": ["China"], "secteurs": [], "analystes": ["Nom Analyste"]}, ...]

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

const TABLE_EVENTS = "Events";
const TABLE_ANALYSTES = "Analystes";

async function airtableGetAll(tableName, fields) {
  let records = [];
  let offset;
  do {
    const params = new URLSearchParams();
    if (offset) params.set("offset", offset);
    if (fields) fields.forEach((f) => params.append("fields[]", f));
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}?${params}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    if (!res.ok) throw new Error(`Airtable API error (${res.status}): ${await res.text()}`);
    const data = await res.json();
    records = records.concat(data.records);
    offset = data.offset;
  } while (offset);
  return records;
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
    const eventsParam = url.searchParams.get("events");
    if (!eventsParam) {
      return new Response(
        JSON.stringify({ error: "Paramètre 'events' requis (JSON encodé en base64)." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    let candidates;
    try {
      candidates = JSON.parse(Buffer.from(eventsParam, "base64").toString("utf-8"));
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Paramètre 'events' invalide: " + e.message }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const [eventRecords, analysteRecords] = await Promise.all([
      airtableGetAll(TABLE_EVENTS, ["Event Name", "Date"]),
      airtableGetAll(TABLE_ANALYSTES, ["Nom"]),
    ]);

    const existingKeys = new Set(
      eventRecords.map((r) => `${(r.fields["Event Name"] || "").trim()}|${(r.fields["Date"] || "").trim()}`)
    );
    const knownAnalysts = new Set(analysteRecords.map((r) => (r.fields["Nom"] || "").trim()));

    const today = new Date().toISOString().slice(0, 10);

    const results = candidates.map((ev) => {
      const key = `${(ev.name || "").trim()}|${(ev.date || "").trim()}`;
      const alreadyExists = existingKeys.has(key);

      const anomalies = [];
      if (!alreadyExists) {
        if (ev.date && ev.date < today) anomalies.push(`Date passée (${ev.date} < ${today})`);
        (ev.analystes || []).forEach((a) => {
          if (!knownAnalysts.has(a)) anomalies.push(`Analyste introuvable dans la table Analystes: "${a}"`);
        });
        if (!ev.pays || ev.pays.length === 0) anomalies.push("Pays non renseigné");
      }

      return {
        name: ev.name,
        date: ev.date,
        status: alreadyExists ? "deja_en_base" : (anomalies.length ? "nouveau_avec_anomalies" : "nouveau"),
        anomalies,
        event: ev,
      };
    });

    const nouveaux = results.filter((r) => r.status !== "deja_en_base");

    return new Response(
      JSON.stringify({
        totalCandidats: candidates.length,
        dejaEnBase: results.filter((r) => r.status === "deja_en_base").length,
        nouveaux: nouveaux.length,
        details: results,
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
