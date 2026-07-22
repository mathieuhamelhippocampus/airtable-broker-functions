import pandas as pd
import re
from datetime import date

PATH = "/mnt/user-data/uploads/2026_NDR_Corporate_calls_Analyst_marketing_Analyst_calls.xlsx"

ALIAS = {
    "unicredit": "Unicredit",
    "intesa": "Intesa Sanpaolo SpA",
    "eurizon": "Eurizon Capital SGR",
    "acomea": "Acomea",
    "swedbank rabour": "Swedbank Robur Fonder AB",
    "swedbank robur": "Swedbank Robur Fonder AB",
    "swedbankrobur": "Swedbank Robur Fonder AB",
    "ap3": "Third Swedish National Pension Fund (AP3)",
    "ap4": "Fourth Swedish National Pension Fund (AP4)",
    "fjarde ap-fonden": "Fourth Swedish National Pension Fund (AP4)",
    "bmc": "Brock Milton Capital AB",
    "brock milton": "Brock Milton Capital AB",
    "tbf": "TBF Global Asset Management GmbH",
    "tbf global": "TBF Global Asset Management GmbH",
    "tbf global am": "TBF Global Asset Management GmbH",
    "laiqon": "Laiqon",
    "spsw laiqon": "Laiqon",
    "dws": "DWS Group GmbH & CO KGaA",
    "seb": "SEB",
    "handelsbanken am": "Handelsbanken Asset Management",
    "dnca": "DNCA Finance",
    "mansartis": "Mansartis",
    "monsartis": "Mansartis",
    "candriam": "Candriam Belgium SA",
    "credit mutuel am": "CREDIT MUTUEL ASSET MANAGEMENT",
    "crédit mutuel am": "CREDIT MUTUEL ASSET MANAGEMENT",
    "crédit mutuel": "CREDIT MUTUEL ASSET MANAGEMENT",
    "cworldwide": "C WorldWide Asset Management",
    "deka": "Deka Investment GmbH",
    "delen": "Delen Private Bank NV",
    "dnb": "DnB Asset Management AS - Norway",
    "first fondene": "First Fondene AS",
    "indecap fonder": "Indecap Fonder AB",
    "lannebo kapitalförvaltning": "Lannebo Kapitalförvaltning AB",
    "mandarine": "Mandarine Gestion",
    "storebrand am": "Storebrand Asset Management AS",
    "sycomore": "Sycomore Asset Management",
    "fideuram": "Fideuram - Intesa Sanpaolo Private Banking S.p.A.",
    "al sydbank": "SYDBANK AS",
    "gefip": "Gestion Financiere Privee GEFIP",
    "compagnie monegasque de banque": "Compagnie Monegasque de Banque SAM",
    "dpam": "Banque Degroof Petercam SA",
    "degroof": "Banque Degroof Petercam SA",
    "acatis investment": "Acatis Investment",
    "algebris": "Algebris",
    "allianz global": "Allianz Global",
    "azimut": "Azimut",
    "dje": "DJE",
    "edram": "EDRAM",
    "eqt partners": "EQT PARTNERS",
    "econopolis": "Econopolis",
    "estela capital": "Estela Capital",
    "gaylussac": "Gay Lussac",
    "hmg": "HMG Finance",
    "kbc": "KBC",
    "lfg zest": "LFG ZEST",
    "lazard frères": "Lazard Frères Gestion",
    "obam": "OBAM",
    "prisma": "Prisma Investment Gmbh",
    "prisma investment": "Prisma Investment Gmbh",
    "sissener as": "Sissener AS",
    "sparinvest": "Sparinvest",
    "bdf am": "Banque de France AM",
    "athymis": "Athymis Gestion",
    "acomea": "Acomea",
    "c worldwide": "C WorldWide Asset Management",
    "azimut investment": "Azimut",
    "edram": "Cross Selling",
    "epsa": "Cross Selling",
    "ecb": "Cross Selling",
    "kc / cross selling": "Cross Selling",
}

NOT_FOUND = set()
DATE_ISSUES = []

def match_client(raw):
    if raw is None:
        return None
    if isinstance(raw, float) and pd.isna(raw):
        return None
    key = str(raw).strip().lower()
    if key in ("", "nan"):
        return None
    if key in ALIAS:
        return ALIAS[key]
    NOT_FOUND.add(str(raw).strip())
    return None

def parse_date(val, context=""):
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    s = str(val).strip()
    if s.lower() in ("nan", "not arranged", ""):
        return None
    if s.endswith(".0"):
        s = s[:-2]
    digits = re.sub(r"\D", "", s)
    if len(digits) == 6:
        yy, mm, dd = digits[0:2], digits[2:4], digits[4:6]
        try:
            return date(2000 + int(yy), int(mm), int(dd)).isoformat()
        except ValueError:
            DATE_ISSUES.append(f"{context}: date invalide (YYMMDD) '{val}'")
            return None
    elif len(digits) in (7, 8):
        d8 = digits.zfill(8)
        dd, mm, yyyy = d8[0:2], d8[2:4], d8[4:8]
        try:
            return date(int(yyyy), int(mm), int(dd)).isoformat()
        except ValueError:
            DATE_ISSUES.append(f"{context}: date invalide (DDMMYYYY) '{val}'")
            return None
    DATE_ISSUES.append(f"{context}: format de date non reconnu '{val}'")
    return None

events = []   # list of dict: event_key, Event Name, Event Type, Date, Ville, Société/Analystes
bookings = [] # list of dict: Client, Event Name (matches event_key), Statut, Date confirmée

def add_event(key, name, etype, edate, ville, extra=""):
    events.append({
        "_key": key, "Event Name": name, "Event Type": etype,
        "Date": edate or "", "Ville": ville or "", "Extra": extra
    })

def add_booking(client, event_key, edate):
    bookings.append({"Client": client, "_event_key": event_key, "Statut": "Confirmé", "Date confirmée": edate or ""})

# ---------------------------------------------------------------
# 1. NDR — group par "N of Roadshow"
# ---------------------------------------------------------------
df = pd.read_excel(PATH, sheet_name="NDR")
df["N of Roadshow"] = df["N of Roadshow"].ffill()
df["Date"] = df["Date"].where(df["N of meeting"].notna() | df["Date"].notna())
current_group = {}
for _, row in df.iterrows():
    rs = row["N of Roadshow"]
    if pd.notna(row["Corporates"]):
        current_group[rs] = {
            "corp": row["Corporates"],
            "ville": row["Location"] if pd.notna(row["Location"]) else "",
            "date": parse_date(row["Date"], f"NDR roadshow {rs}"),
        }
    grp = current_group.get(rs, {"corp": "?", "ville": "", "date": None})
    event_key = f"NDR-{rs}"
    event_name = f"NDR: {grp['corp']}"
    add_event(event_key, event_name, "NDR", grp["date"], grp["ville"])
    client = match_client(row["INVESTORS"]) if pd.notna(row["INVESTORS"]) else None
    if client:
        add_booking(client, event_key, grp["date"])

# ---------------------------------------------------------------
# 2. 1o1 Analyst Marketing — group par "N of Marketing"
# ---------------------------------------------------------------
df = pd.read_excel(PATH, sheet_name="1o1 Analyst Marketing")
df["N of Marketing"] = df["N of Marketing"].ffill()
current_group = {}
for _, row in df.iterrows():
    mk = row["N of Marketing"]
    if pd.notna(row["Analyst"]):
        current_group[mk] = {
            "analyst": row["Analyst"],
            "ville": row["Location"] if pd.notna(row["Location"]) else "",
            "date": parse_date(row["Date"], f"Analyst Marketing tour {mk}"),
        }
    grp = current_group.get(mk, {"analyst": "?", "ville": "", "date": None})
    event_key = f"AM-{mk}"
    event_name = f"1o1 Analyst Marketing: {grp['analyst']}"
    add_event(event_key, event_name, "1o1 Analyst Marketing", grp["date"], grp["ville"])
    client = match_client(row["INVESTORS"]) if pd.notna(row["INVESTORS"]) else None
    if client:
        add_booking(client, event_key, grp["date"])

# ---------------------------------------------------------------
# 3. 1o1 Corporate Call — chaque ligne = 1 event
# ---------------------------------------------------------------
df = pd.read_excel(PATH, sheet_name="1o1 Corporate Call")
for i, row in df.iterrows():
    edate = parse_date(row["Date"], f"Corporate Call ligne {i}")
    event_key = f"CC-{i}"
    corp = row["Corporate"] if pd.notna(row["Corporate"]) else "?"
    event_name = f"1o1 Corporate Call: {corp}"
    add_event(event_key, event_name, "1o1 Corporate Call", edate, "")
    client = match_client(row["Investor"]) if pd.notna(row["Investor"]) else None
    if client:
        add_booking(client, event_key, edate)

# ---------------------------------------------------------------
# 4. 1o1 Analyst Call — chaque ligne = 1 event
# ---------------------------------------------------------------
df = pd.read_excel(PATH, sheet_name="1o1 Analyst Call")
for i, row in df.iterrows():
    edate = parse_date(row["Date"], f"Analyst Call ligne {i}")
    event_key = f"AC-{i}"
    topic = row["Topic"] if pd.notna(row["Topic"]) else ""
    analyst = row["Analyst"] if pd.notna(row["Analyst"]) else "?"
    event_name = f"1o1 Analyst Call: {analyst}" + (f" ({topic})" if topic else "")
    add_event(event_key, event_name, "1o1 Analyst Call", edate, "")
    client = match_client(row["Investor"]) if pd.notna(row["Investor"]) else None
    if client:
        add_booking(client, event_key, edate)

# ---------------------------------------------------------------
# 5. Group Calls — un event par (date, host), attendees en dessous
# ---------------------------------------------------------------
df = pd.read_excel(PATH, sheet_name="Group Calls", header=None)
current_event = None
for i, row in df.iterrows():
    c0, c1, c3 = row[0], row[1], row[3]
    if pd.notna(c0) and str(c0).strip().lower() != "date":  # ligne "date | host" = nouvel event
        try:
            edate = pd.to_datetime(c0).date().isoformat()
        except Exception:
            edate = parse_date(c0, f"Group Calls ligne {i}")
        host = row[1] if pd.notna(row[1]) else "?"
        event_key = f"GC-{i}"
        event_name = f"Group Call: {host}"
        add_event(event_key, event_name, "Group Call", edate, "")
        current_event = {"key": event_key, "date": edate}
    else:
        firm = row[3] if pd.notna(row[3]) else None
        if firm and current_event:
            client = match_client(firm)
            if client:
                add_booking(client, current_event["key"], current_event["date"])

# ---------------------------------------------------------------
# 6. 1o1 with Matthieu H. — group par colonne 1 (numéro séquentiel)
# ---------------------------------------------------------------
df = pd.read_excel(PATH, sheet_name="1o1 with Matthieu H.", header=None)
last_key = None
last_date = None
for i, row in df.iterrows():
    seq, typ, edate_raw, firm = row[1], row[2], row[3], row[4]
    if pd.notna(seq):
        edate = parse_date(edate_raw, f"1o1 Matthieu H. ligne {i}")
        typ_str = typ if pd.notna(typ) else "1o1"
        firm_str = firm if pd.notna(firm) else "?"
        event_key = f"MH-{i}"
        event_name = f"1o1 with Matthieu H.: {typ_str} — {firm_str}"
        add_event(event_key, event_name, "1o1 with Matthieu H.", edate, "")
        last_key = event_key
        last_date = edate
        client = match_client(firm) if pd.notna(firm) else None
        if client and last_key:
            add_booking(client, last_key, last_date)
    # lignes de continuation (contact supplémentaire sans nouvelle séquence) : pas de firme -> ignoré

# ---------------------------------------------------------------
# Désambiguïsation : si plusieurs events partagent le même nom texte
# (ex. 2 analyst calls "Ellie Jiang (BABA Tencent)" à 2 dates différentes),
# Airtable les fusionnerait par erreur lors de l'import CSV (matching par
# texte du champ primaire). On ajoute la date (ou l'index) pour les distinguer.
# ---------------------------------------------------------------
events_df = pd.DataFrame(events).drop_duplicates(subset=["_key"])
name_counts = events_df["Event Name"].value_counts()
dup_names = set(name_counts[name_counts > 1].index)

final_names = {}
for _, row in events_df.iterrows():
    key = row["_key"]
    name = row["Event Name"]
    if name in dup_names:
        suffix = row["Date"] if row["Date"] else key
        name = f"{name} — {suffix}"
    final_names[key] = name

events_df["Event Name"] = events_df["_key"].map(final_names)
bookings_df = pd.DataFrame(bookings)
bookings_df["Event"] = bookings_df["_event_key"].map(final_names)

# Dédoublonnage : uniquement si Client + Event + Date sont TOUS identiques
# (un vrai doublon exact), jamais sur Client+Event seul.
before_b = len(bookings_df)
bookings_df = bookings_df.drop_duplicates(subset=["Client", "Event", "Date confirmée"])
after_b = len(bookings_df)
if before_b != after_b:
    print(f"(dédoublonnage exact: {before_b} -> {after_b} bookings)")

# ---------------------------------------------------------------
# Résultats
# ---------------------------------------------------------------

print("=== EVENTS générés:", len(events_df), "===")
print("=== BOOKINGS générés (clients matchés):", len(bookings_df), "===")
print()
print("=== Investisseurs NON trouvés (exclus) ===")
for nf in sorted(NOT_FOUND):
    print(" -", nf)
print()
print("=== Problèmes de date rencontrés ===")
for d in DATE_ISSUES:
    print(" -", d)

events_df.to_csv("/home/claude/matching/events_generated.csv", index=False)
bookings_df.to_csv("/home/claude/matching/bookings_generated.csv", index=False)

# ---------------------------------------------------------------
# Post-traitements demandés par Jensen :
#  - normaliser les villes en noms complets anglais (Single select à venir)
#  - Doosan Enerbility (Changwon, hors des 10 villes) : NDR -> 1o1 Corporate
#    Call, et suppression du doublon avec l'event déjà issu de l'onglet
#    "1o1 Corporate Call" pour la même société/date
# ---------------------------------------------------------------
VILLE_MAP = {
    "PAR": "Paris", "MIL": "Milan", "FRA": "Frankfurt", "COP": "Copenhagen",
    "OSL": "Oslo", "STO": "Stockholm", "BRU": "Brussels", "MAD": "Madrid",
    "AMS": "Amsterdam", "MCO": "Monaco",
}
events_df["Ville"] = events_df["Ville"].apply(
    lambda v: VILLE_MAP.get(str(v).strip(), v) if pd.notna(v) and str(v).strip() else v
)

# Doosan Enerbility : repérer l'event NDR et le vrai event Corporate Call
ndr_mask = events_df["Event Name"].str.startswith("NDR: Doosan Enerbility", na=False)
cc_mask = events_df["Event Name"].str.startswith("1o1 Corporate Call: Doosan Enerbility", na=False)

if ndr_mask.any() and cc_mask.any():
    ndr_key = events_df.loc[ndr_mask, "_key"].iloc[0]
    ndr_name = events_df.loc[ndr_mask, "Event Name"].iloc[0]
    cc_name = events_df.loc[cc_mask, "Event Name"].iloc[0]
    # rediriger les bookings du doublon NDR vers le vrai event Corporate Call
    bookings_df.loc[bookings_df["Event"] == ndr_name, "Event"] = cc_name
    # supprimer l'event NDR en doublon
    events_df = events_df[~ndr_mask]
    # dédoublonnage exact uniquement (même client+event+date)
    bookings_df = bookings_df.drop_duplicates(subset=["Client", "Event", "Date confirmée"])

events_final = events_df[["Event Name", "Event Type", "Date", "Ville"]].copy()
bookings_final = bookings_df[["Client", "Event", "Statut", "Date confirmée"]].copy()

events_final.to_csv("/mnt/user-data/outputs/import_events_historique.csv", index=False)
bookings_final.to_csv("/mnt/user-data/outputs/import_bookings_historique.csv", index=False)

print()
print("=== FINAL après post-traitements ===")
print("Events:", len(events_final), "| Bookings:", len(bookings_final))
print("Villes utilisées:", sorted(set(v for v in events_final["Ville"].dropna() if str(v).strip())))

