"""
create_bookings_from_csv.py

Objectif : créer les lignes Bookings dans Airtable en liant correctement
Client et Event par leur ID (contrairement à l'import CSV par glisser-déposer,
qui ne sait pas résoudre les Linked Records par texte).

Utilisation :
    1. Définir le token dans une variable d'environnement (jamais en dur) :
       PowerShell : $env:AIRTABLE_TOKEN = "patXXXXXXXXXXXXXX"
    2. Lancer : python create_bookings_from_csv.py

Le script :
    - Récupère tous les Clients et tous les Events existants (avec leurs IDs)
    - Lit import_bookings_historique.csv
    - Résout Client / Event par nom exact -> ID
    - Crée les Bookings par lots de 10 (limite API Airtable)
    - Affiche un rapport clair des lignes non résolues (rien créé pour elles)
"""

import os
import sys
import csv
import time
import requests

BASE_ID = "apprqkMTo6NG34BkU"
TABLE_CLIENTS = "Clients - Investment Universe"
TABLE_EVENTS = "Events"
TABLE_BOOKINGS = "Bookings"
CSV_PATH = "import_bookings_historique.csv"

TOKEN = os.environ.get("AIRTABLE_TOKEN")
if not TOKEN:
    print("ERREUR : variable d'environnement AIRTABLE_TOKEN manquante.")
    print('Dans PowerShell : $env:AIRTABLE_TOKEN = "patXXXXXXXXXXXXXX"')
    sys.exit(1)

HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json",
}

def airtable_get_all(table_name, fields=None):
    records = []
    offset = None
    while True:
        params = {}
        if offset:
            params["offset"] = offset
        if fields:
            params["fields[]"] = fields
        url = f"https://api.airtable.com/v0/{BASE_ID}/{requests.utils.quote(table_name)}"
        resp = requests.get(url, headers=HEADERS, params=params)
        resp.raise_for_status()
        data = resp.json()
        records.extend(data.get("records", []))
        offset = data.get("offset")
        if not offset:
            break
        time.sleep(0.21)  # reste sous 5 req/sec
    return records

def primary_field_map(records, primary_field_candidates):
    """Construit un dict {nom -> id} en essayant plusieurs noms de champ primaire possibles."""
    mapping = {}
    for r in records:
        fields = r.get("fields", {})
        name = None
        for cand in primary_field_candidates:
            if cand in fields:
                name = fields[cand]
                break
        if name is None:
            continue
        if isinstance(name, list):
            name = name[0] if name else None
        if name:
            mapping[str(name).strip()] = r["id"]
    return mapping

def batch_create(table_name, records_payload):
    """records_payload: liste de dicts {"fields": {...}}. Crée par lots de 10."""
    created = []
    url = f"https://api.airtable.com/v0/{BASE_ID}/{requests.utils.quote(table_name)}"
    for i in range(0, len(records_payload), 10):
        chunk = records_payload[i:i+10]
        resp = requests.post(url, headers=HEADERS, json={"records": chunk})
        if resp.status_code == 429:
            print("  -> Rate limit atteint, pause 30s...")
            time.sleep(30)
            resp = requests.post(url, headers=HEADERS, json={"records": chunk})
        if not resp.ok:
            print(f"  ERREUR sur le lot {i//10 + 1}: {resp.status_code} {resp.text}")
            continue
        result = resp.json()
        created.extend(result.get("records", []))
        print(f"  Lot {i//10 + 1}/{(len(records_payload)-1)//10 + 1} créé ({len(chunk)} lignes)")
        time.sleep(0.21)
    return created

def main():
    print("1. Récupération des Clients existants...")
    client_records = airtable_get_all(TABLE_CLIENTS)
    client_map = primary_field_map(client_records, ["Name", "Management Company"])
    print(f"   {len(client_map)} clients trouvés.")

    print("2. Récupération des Events existants...")
    event_records = airtable_get_all(TABLE_EVENTS)
    event_map = primary_field_map(event_records, ["Event Name"])
    print(f"   {len(event_map)} events trouvés.")

    print(f"3. Lecture de {CSV_PATH}...")
    rows = []
    with open(CSV_PATH, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    print(f"   {len(rows)} lignes à traiter.")

    to_create = []
    unresolved = []
    for row in rows:
        client_name = row["Client"].strip()
        event_name = row["Event"].strip()
        client_id = client_map.get(client_name)
        event_id = event_map.get(event_name)

        if not client_id or not event_id:
            unresolved.append({
                "Client": client_name, "Event": event_name,
                "client_trouve": bool(client_id), "event_trouve": bool(event_id),
            })
            continue

        fields = {
            "Client": [client_id],
            "Event": [event_id],
            "Statut": row.get("Statut") or "Confirmé",
        }
        if row.get("Date confirmée"):
            fields["Date confirmée"] = row["Date confirmée"]

        to_create.append({"fields": fields})

    print(f"4. {len(to_create)} lignes prêtes à créer, {len(unresolved)} non résolues.")
    if unresolved:
        print("\n=== NON RÉSOLUES (rien créé pour ces lignes) ===")
        for u in unresolved:
            print(f"   Client={u['Client']!r} (trouvé={u['client_trouve']})  "
                  f"Event={u['Event']!r} (trouvé={u['event_trouve']})")
        print()

    if not to_create:
        print("Rien à créer, arrêt.")
        return

    input(f"Appuie sur Entrée pour créer {len(to_create)} bookings dans Airtable (Ctrl+C pour annuler)...")

    print("5. Création des Bookings par lots de 10...")
    created = batch_create(TABLE_BOOKINGS, to_create)
    print(f"\nTerminé : {len(created)} bookings créés sur {len(to_create)} prévus.")

if __name__ == "__main__":
    main()
