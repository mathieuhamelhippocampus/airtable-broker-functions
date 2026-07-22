"""
check_new_events.py

Objectif : comparer une liste candidate d'events (extraite d'un email MQ Events
Recap) à ce qui existe déjà dans Airtable, pour ne remonter que les vrais
nouveaux events et signaler les anomalies avant import CSV.

Utilisation :
    1. Remplir CANDIDATE_EVENTS ci-dessous avec les events extraits de l'email
       (fait par Claude à partir du .msg, à chaque nouvelle recap hebdomadaire)
    2. Définir le token en variable d'environnement :
       PowerShell : $env:AIRTABLE_TOKEN = "patXXXXXXXXXXXXXX"
       (le token LECTURE SEULE existant, netlify-broker-function, suffit ici)
    3. Lancer : python check_new_events.py

Le script :
    - Récupère tous les Events existants (Event Name + Date)
    - Récupère tous les noms d'Analystes existants (pour repérer les typos)
    - Compare la liste candidate : NOUVEAU / DÉJÀ EN BASE / ANOMALIE
    - Génère un CSV prêt à importer avec uniquement les nouveaux events validés
"""

import os
import sys
import csv
import time
from datetime import date
import requests

BASE_ID = "apprqkMTo6NG34BkU"
TABLE_EVENTS = "Events"
TABLE_ANALYSTES = "Analystes"

TOKEN = os.environ.get("AIRTABLE_TOKEN")
if not TOKEN:
    print("ERREUR : variable d'environnement AIRTABLE_TOKEN manquante.")
    sys.exit(1)

HEADERS = {"Authorization": f"Bearer {TOKEN}"}

# ---------------------------------------------------------------------------
# À REMPLIR À CHAQUE NOUVELLE RECAP : liste des events extraits de l'email
# ---------------------------------------------------------------------------
CANDIDATE_EVENTS = [
    # (Event Name, Event Type, Date ISO, Ville, Société, Pays liste, Méta-secteurs liste, Analystes liste)
    {"name": "MQ Conv with the Greats: Dixon Technologies (India) full update post Vivo approval",
     "type": "Group Call", "date": "2026-07-16", "ville": "", "societe": "Dixon Technologies",
     "pays": ["India"], "secteurs": [], "analystes": ["Sameet Sinha"]},
    {"name": "MQ Conv with the Greats: Chinese Healthcare sector update",
     "type": "Group Call", "date": "2026-07-17", "ville": "", "societe": "",
     "pays": ["China"], "secteurs": [], "analystes": ["Tony Ren", "Candyce Gao"]},
    {"name": "MQ Conv with the Greats: Xiaomi (1810 HK) full update",
     "type": "Group Call", "date": "2026-07-21", "ville": "", "societe": "Xiaomi",
     "pays": ["China"], "secteurs": [], "analystes": ["Cherry Ma"]},
    {"name": "MQ Conv with the Greats: CATL, BYD full update",
     "type": "Group Call", "date": "2026-07-22", "ville": "", "societe": "CATL, BYD",
     "pays": ["China"], "secteurs": [], "analystes": ["Eugene Hsiao"]},
    {"name": "MQ Conv with the Greats: Indian Autos full sector update 2H26 outlook",
     "type": "Group Call", "date": "2026-07-23", "ville": "", "societe": "",
     "pays": ["India"], "secteurs": [], "analystes": ["Ashish Jain"]},
    {"name": "MQ China ETAC Biweekly Management Group Call 03 - Neway Valve (Suzhou)",
     "type": "Group Call", "date": "2026-07-20", "ville": "", "societe": "Neway Valve (Suzhou)",
     "pays": ["China"], "secteurs": [], "analystes": ["Albert Miao"]},
    {"name": "MQ JPN Group Call: Food & Life Companies (3563 JP)",
     "type": "Group Call", "date": "2026-08-19", "ville": "", "societe": "Food & Life Companies",
     "pays": ["Japan"], "secteurs": [], "analystes": ["Maki Shinozaki"]},
    {"name": "MQ China Consumer Channel Check Day",
     "type": "Conference", "date": "2026-07-22", "ville": "", "societe": "",
     "pays": ["China"], "secteurs": [], "analystes": ["Linda Huang"]},
    {"name": "MQ ASEAN Conference Site Tour: Penang Tech Tour",
     "type": "Tour", "date": "2026-08-17", "ville": "", "societe": "",
     "pays": ["Malaysia"], "secteurs": [], "analystes": ["Jayden Vantarakis"]},
    {"name": "MQ ASEAN Conference Site Tour: Johor-Singapore Healthcare/Property Tour",
     "type": "Tour", "date": "2026-08-17", "ville": "", "societe": "",
     "pays": ["Malaysia", "Singapore"], "secteurs": [], "analystes": ["Jayden Vantarakis"]},
    {"name": "MQ ASEAN Conference Site Tour: Johor Data Centre & JS-SEZ Tour",
     "type": "Tour", "date": "2026-08-18", "ville": "", "societe": "",
     "pays": ["Malaysia"], "secteurs": [], "analystes": ["Jayden Vantarakis"]},
    {"name": "MQ JPN Tokyo Electric Power (9501 JP) Nuclear Power Plant Tour",
     "type": "Tour", "date": "2026-09-14", "ville": "", "societe": "Tokyo Electric Power",
     "pays": ["Japan"], "secteurs": [], "analystes": ["Hiroshi Yamashina"]},  # NB: email dit "Yamashita", à confirmer
    {"name": "Macquarie Energy Transition & Commodities Conference",
     "type": "Conference", "date": "2026-11-16", "ville": "", "societe": "",
     "pays": [], "secteurs": [], "analystes": ["Charles Yonts"]},  # Pays à confirmer avec l'utilisateur
    {"name": "MQ Group Tour: Macquarie India Yatra",
     "type": "Tour", "date": "2026-11-30", "ville": "", "societe": "",
     "pays": ["India"], "secteurs": [], "analystes": ["Aditya Suresh"]},
]

# ---------------------------------------------------------------------------

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
        time.sleep(0.21)
    return records

def main():
    print("1. Récupération des Events existants...")
    event_records = airtable_get_all(TABLE_EVENTS, fields=["Event Name", "Date"])
    existing = set()
    for r in event_records:
        f = r.get("fields", {})
        existing.add((str(f.get("Event Name", "")).strip(), str(f.get("Date", "")).strip()))
    print(f"   {len(existing)} events existants.")

    print("2. Récupération des Analystes existants...")
    analyste_records = airtable_get_all(TABLE_ANALYSTES, fields=["Nom"])
    known_analysts = set(r.get("fields", {}).get("Nom", "").strip() for r in analyste_records)
    print(f"   {len(known_analysts)} analystes connus.")

    today = date.today().isoformat()

    new_events = []
    print("\n=== ANALYSE ===")
    for ev in CANDIDATE_EVENTS:
        key = (ev["name"].strip(), ev["date"].strip())
        status = []

        if key in existing:
            print(f"  [DÉJÀ EN BASE] {ev['name']} ({ev['date']})")
            continue

        if ev["date"] < today:
            status.append(f"⚠️ DATE PASSÉE ({ev['date']} < aujourd'hui {today})")

        for a in ev["analystes"]:
            if a not in known_analysts:
                status.append(f"⚠️ ANALYSTE INTROUVABLE dans la table Analystes: '{a}'")

        if not ev["pays"]:
            status.append("⚠️ PAYS NON RENSEIGNÉ")

        tag = "NOUVEAU" if not status else "NOUVEAU AVEC ANOMALIE(S)"
        print(f"  [{tag}] {ev['name']} ({ev['date']})")
        for s in status:
            print(f"      {s}")

        new_events.append(ev)

    print(f"\n{len(new_events)} events nouveaux à examiner avant import.")

    # Génère le CSV (uniquement les nouveaux, y compris ceux avec anomalie —
    # à corriger manuellement avant import si signalé ci-dessus)
    out_path = "nouveaux_events_a_importer.csv"
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Event Name", "Event Type", "Date", "Ville", "Société", "Pays", "Méta-secteurs", "Analystes"])
        for ev in new_events:
            writer.writerow([
                ev["name"], ev["type"], ev["date"], ev["ville"], ev["societe"],
                ",".join(ev["pays"]), ",".join(ev["secteurs"]), ",".join(ev["analystes"]),
            ])
    print(f"\nCSV généré : {out_path}")

if __name__ == "__main__":
    main()
