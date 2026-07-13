# get-eligible-clients — fonction Netlify

## Ce que ça fait

Donne, pour un Event Airtable donné, la liste des Clients éligibles
(Zone Match + Secteur Match + quota analyste OK) — sans créer aucune
ligne dans la table Bookings. Zéro Postgres, zéro base à gérer :
la fonction interroge directement Airtable via son API à chaque appel.

## Déploiement (une seule fois)

1. Crée un compte Netlify (Free suffit largement pour ce volume d'usage).
2. Depuis ce dossier, déploie via `netlify deploy` (CLI) ou en connectant
   un repo GitHub contenant ce dossier.
3. Dans Netlify → Site settings → Environment variables, ajoute :
   - `AIRTABLE_TOKEN` : ton Personal Access Token Airtable
     (Airtable → Account → Developer hub → Personal access tokens,
     scope minimal : `data.records:read` sur la base "Broking Broker")
   - `AIRTABLE_BASE_ID` : l'ID de la base (visible dans l'URL Airtable,
     commence par "app...", ex. apprqkMTo6NG34BkU d'après tes captures)

## Utilisation

```
GET https://<ton-site>.netlify.app/.netlify/functions/get-eligible-clients?eventId=recXXXXXXXXXXXXXX
```

L'`eventId` est l'ID Airtable du record Event (visible dans l'URL quand
tu ouvres la fiche détaillée d'un Event, ou récupérable via l'API).

## Réponse

```json
{
  "event": { "id": "...", "name": "MQ Group Call: SK Hynix", "pays": ["Korea"], "secteurs": [...], "type": "Group Call" },
  "totalClientsChecked": 81,
  "eligibleCount": 12,
  "eligibleClients": [
    { "clientId": "...", "clientName": "Candriam Belgium SA", "zoneMatch": true, "secteurMatch": true, "callsRemaining": 20, "eligible": true },
    ...
  ]
}
```

## Limites connues

- Les ~71 clients sans profil rempli (Geographic Universe / Sectors vides)
  ne matcheront jamais — normal, pas un bug.
- Cette fonction ne modifie rien dans Airtable (lecture seule). Si tu veux
  ensuite créer les lignes Bookings automatiquement pour les clients
  éligibles, il faudra une deuxième fonction en écriture (POST) — pas
  encore développée ici, à faire si tu le souhaites.
