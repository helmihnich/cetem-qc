# Guide de déploiement PoV — CETEM-QC

Ce guide permet à un opérateur de préparer un environnement PoV protégé : web sur Vercel, API sur Render, PostgreSQL sur Neon. Rien n'est déployé par le dépôt ; aucun compte n'est nécessaire pour exécuter les tests ni la démonstration locale (Docker Compose). Les noms Vercel, Render et Neon sont des exemples de cibles retenues par le Product Owner, pas une dépendance du code.

## 1. Périmètre et hors périmètre

Empreinte retenue : une application web, une API, une base PostgreSQL, une application mobile (configurée, non conteneurisée), un stockage d'objets privé, un analyseur antivirus optionnel, un fournisseur de synthèse IA et un générateur de document, tous derrière des ports remplaçables.

**Hors périmètre** (aucune instruction dans ce guide) : microservices, Kubernetes, haute disponibilité (HA), multi-région, autoscaling, file d'attente ou worker, gestionnaire de secrets, et **production sans approbation écrite**.

## 2. Environnements séparés

| Environnement | Usage | Modèle de configuration |
| --- | --- | --- |
| `local` | développement et démonstration Docker Compose | `.env.example`, `deploy/env/compose.env.example` |
| `pov` | démonstration protégée de bout en bout | `deploy/env/api.pov.env.example`, `web.pov.env.example`, `mobile.pov.env.example` |

Les modèles ne contiennent aucun secret : toute clé sensible (`*PASSWORD*`, `*SECRET*`, `*KEY*`, `*TOKEN*`, `*DATABASE_URL*`) est vide. Les valeurs réelles se saisissent uniquement dans le tableau de bord de l'hébergeur ou dans `deploy/env/compose.env` (ignoré par git). Ne jamais les committer, ni les inscrire dans une image ou un journal.

## 3. Démonstration locale (Docker Compose)

1. Copier `deploy/env/compose.env.example` vers `deploy/env/compose.env` et renseigner `POSTGRES_PASSWORD`.
2. `docker compose --env-file deploy/env/compose.env up --build` : PostgreSQL (réseau interne, aucun port publié), `migrate` (une fois), `api`, `web` sur `http://localhost:3000`.
3. Antivirus optionnel : `--profile scan` avec `ANTIVIRUS=clamav` et `CLAMAV_HOST=clamav`. Par défaut `ANTIVIRUS=none` enregistre « analyse antivirus non effectuée (PoV) ».
4. Mobile : définir `EXPO_PUBLIC_API_URL` (adresse HTTPS de l'API PoV, aucun secret) et `EXPO_PUBLIC_OFFLINE_AUTHORIZATION_WINDOW_DAYS`.

## 4. Neon (PostgreSQL)

- Chaîne de connexion privée fournie par `NEON_DATABASE_URL` (côté serveur uniquement) avec `sslmode=require`. `DATABASE_URL` l'emporte si les deux sont définis.
- Deux rôles : un rôle **propriétaire/migration** utilisé uniquement pour `pnpm --filter @cetem-qc/api db:migrate`, et un rôle **d'exécution à moindre privilège** pour l'API, sans droits DDL, TRIGGER ni TRUNCATE (accès SELECT/INSERT/UPDATE/DELETE sur les tables, USAGE sur les séquences).
- Les migrations sont exécutées avec l'URL du rôle propriétaire ; l'API démarre avec celle du rôle d'exécution.

## 5. Render (API)

- Service web Node 24.21.0, racine du dépôt. Build : `corepack enable && pnpm install --frozen-lockfile`. Démarrage : `pnpm --filter @cetem-qc/api exec tsx src/index.ts`. Migration (étape de pré-déploiement) : `pnpm --filter @cetem-qc/api db:migrate`.
- Chemin de santé : `/ready` (200 si la base répond, 503 sinon, sans détail). `/api/v1/health` reste la sonde de vivacité.
- Variables : `HOST=0.0.0.0`, `TRUST_PROXY=true`, `FORCE_HTTPS=true`, `NEON_DATABASE_URL`, `FILE_STORAGE=local`, `FILE_STORAGE_DIR` sur un **disque persistant**, `ANTIVIRUS`, `AI_PROVIDER`. `PORT` est fourni par la plateforme.
- TLS est terminé par la plateforme ; `FORCE_HTTPS` est le filet de sécurité applicatif (redirection 308 pour GET/HEAD, refus 403 `HTTPS_REQUIRED` sinon). **Il est interdit d'exposer l'API en HTTP simple.**
- Limite PoV : le stockage local sur disque persistant n'est pas une conception de production.

## 6. Vercel (web)

Projet `apps/web`, variable serveur `CETEM_QC_API_URL` (adresse HTTPS de l'API), jamais préfixée `NEXT_PUBLIC_`. Le cookie de session reste `secure` quand `NODE_ENV=production`.

## 7. Ports remplaçables

Stockage d'objets : `FILE_STORAGE` (`local`, `memory`). Antivirus : `ANTIVIRUS` (`none`, `clamav`). Synthèse IA : `AI_PROVIDER` (vide = mock, `gemini`). Génération de document : modèle Word intégré. Aucun fournisseur n'est imposé.

## 8. Provisionnement du premier Responsable

Depuis un poste opérateur disposant de `NEON_DATABASE_URL` (rôle d'exécution) : `pnpm --filter @cetem-qc/api bootstrap:responsable`. Le mot de passe temporaire est affiché une seule fois ; le transmettre hors bande. Mot de passe oublié : `pnpm --filter @cetem-qc/api reset:responsable-password`.

## 9. Journaux et corrélation

Les journaux sont structurés sur la sortie standard (stdout) et collectés par l'hébergeur. La story 12.2 précise les événements de diagnostic et la corrélation.

## 10. Sauvegarde

- Neon : restauration à un instant donné (point-in-time) ou branche.
- Planifiée : `pg_dump -Fc "$NEON_DATABASE_URL" -f cetem_qc.dump`.
- Copie du volume de fichiers (`FILE_STORAGE_DIR`) avec la même fréquence.

## 11. Restauration et exercice de restauration

1. Créer une base ou une branche vide ; restaurer : `pg_restore --clean --if-exists --no-owner -d "<url-cible>" cetem_qc.dump`.
2. Restaurer le volume de fichiers correspondant.
3. Pointer `NEON_DATABASE_URL` vers la cible, redémarrer l'API, vérifier `/ready`.

**Exercice de restauration (liste de contrôle)** : sauvegarde récente identifiée ; restauration sur une cible vierge réussie ; `/ready` répond 200 ; connexion du Responsable possible ; un rapport officiel existant s'ouvre ; durée mesurée et consignée.

## 12. Retour arrière (rollback)

Les migrations sont à sens unique (forward-only). Retour arrière = **restaurer** la sauvegarde antérieure à la migration, puis **redéployer** la version précédente de l'API.

## 13. Liste de vérification

1. `GET /ready` renvoie 200 `{"status":"ready"}`.
2. Une requête en HTTP simple est redirigée ou refusée.
3. Connexion du Responsable depuis le web.
4. Un téléversement de PDF est accepté puis consultable.
