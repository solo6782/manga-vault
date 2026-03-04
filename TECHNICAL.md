# MangaVault — Documentation technique

## Vue d'ensemble

MangaVault est un tracker personnel de collection manga/anime. Application web statique (vanilla JS/HTML/CSS) avec backend Supabase et API Jikan (MyAnimeList) pour les métadonnées.

**Contrainte principale** : le développement et le déploiement se font exclusivement via le GitHub web interface et le Cloudflare dashboard (pas de CLI local).

---

## Architecture

```
manga-vault/
├── public/                  # Fichiers statiques servis par Cloudflare
│   ├── index.html           # Landing page (redirige vers login/dashboard)
│   ├── login.html           # Page de connexion / inscription
│   ├── dashboard.html       # Dashboard principal (collection, modales)
│   ├── css/
│   │   └── style.css        # Styles globaux (dark mode, responsive)
│   └── js/
│       ├── config.js        # Configuration Supabase (URL, clé anon)
│       └── app.js           # Logique applicative (~1700 lignes)
├── src/
│   └── index.js             # Cloudflare Worker entry point (+ /api/ai-recommend)
├── wrangler.jsonc            # Configuration Cloudflare Workers
└── TECHNICAL.md              # Ce fichier
```

### Stack technique

| Composant | Technologie |
|-----------|-------------|
| Frontend | Vanilla JavaScript, HTML5, CSS3 |
| Backend / BDD | Supabase (PostgreSQL + Auth + RLS) |
| Hosting | Cloudflare Workers (assets statiques + proxy IA) |
| API métadonnées | Jikan v4 (MyAnimeList non-officielle) |
| API IA | Anthropic Claude (claude-sonnet-4-5) via Cloudflare Worker |
| Déploiement | GitHub → Cloudflare (auto-deploy) |

---

## Base de données

### Table `mv_works`

Table unique stockant mangas et animes. Le champ `type` distingue les deux.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid (PK) | Identifiant auto-généré |
| `user_id` | uuid (FK → auth.users) | Propriétaire |
| `type` | text | `"manga"` ou `"anime"` |
| `title` | text | Titre romaji (ex: "Kaguya-sama wa Kokurasetai") |
| `title_english` | text | Titre anglais (ex: "Kaguya-sama: Love is War") |
| `author` | text | Auteur (manga uniquement) |
| `studio` | text | Studio d'animation (anime uniquement) |
| `year` | int4 | Année de publication/diffusion |
| `season_name` | text | Saison de diffusion (anime) : `hiver`, `printemps`, `ete`, `automne` |
| `platform` | text | Plateforme de streaming (anime) |
| `format` | text | Format manga : `shonen`, `seinen`, `shojo`, `josei` |
| `publication_status` | text | Statut de publication manga : `en_cours`, `termine`, `en_pause` |
| `status` | mv_work_status (enum) | Statut personnel : `en_cours`, `termine`, `planifie`, `en_pause`, `abandonne`, `ignore` |
| `rating` | int4 | Note personnelle 1-10 (null si pas terminé) |
| `genres` | jsonb | Tableau de genres : `["Action", "Romance"]` |
| `episodes_watched` | int4 | Épisodes vus (anime) |
| `episodes_total` | int4 | Nombre total d'épisodes (anime) |
| `seasons_count` | int4 | Nombre de saisons (anime) |
| `volumes_read` | int4 | Volumes lus (manga) |
| `volumes_vo` | int4 | Volumes VO total (manga) |
| `fr_volumes` | int4 | Volumes disponibles en français (manga) |
| `available_fr` | boolean | Disponible en VF ? |
| `image_url` | text | URL de la cover (depuis Jikan/MAL) |
| `notes` | text | Commentaire personnel |
| `mal_id` | int4 | ID MyAnimeList |
| `mal_score` | numeric | Score MAL (auto-mis à jour) |
| `universe_id` | text | Identifiant d'univers/franchise (format : `uni_{mal_id}`) |
| `created_at` | timestamptz | Date de création |

### Statuts (`mv_work_status` enum)

| Valeur | Label UI | Description |
|--------|----------|-------------|
| `en_cours` | En cours | En cours de lecture/visionnage |
| `termine` | Terminé | Terminé, note obligatoire |
| `planifie` | Planifié | À voir/lire plus tard |
| `en_pause` | En pause | Mis en pause |
| `abandonne` | Abandonné | Abandonné |
| `ignore` | Pas envie | Pas intéressé — masqué du fil principal, utilisé par l'IA pour ne plus proposer |

### Vue `mv_user_stats`

Vue PostgreSQL pour les statistiques du dashboard. Agrège les compteurs par user.

### Row Level Security (RLS)

- Les utilisateurs ne voient et ne modifient que leurs propres œuvres
- Politique basée sur `auth.uid() = user_id`

### Migrations SQL

```sql
-- v3 : Ajout mal_id et mal_score
ALTER TABLE mv_works ADD COLUMN mal_id int4;
ALTER TABLE mv_works ADD COLUMN mal_score numeric;

-- v6 : Ajout universe_id
ALTER TABLE mv_works ADD COLUMN universe_id text;

-- v1.2.0 : Ajout statut ignore à l'enum
ALTER TYPE mv_work_status ADD VALUE 'ignore';

-- v1.2.3 : Ajout titre anglais
ALTER TABLE mv_works ADD COLUMN title_english text;
```

---

## APIs externes

### Jikan API v4

Base URL : `https://api.jikan.moe/v4`

| Endpoint | Usage | Rate limit |
|----------|-------|------------|
| `GET /anime?q={query}&limit=6` | Recherche anime par pertinence | 3 req/s |
| `GET /manga?q={query}&limit=6` | Recherche manga par pertinence | 3 req/s |
| `GET /anime/{mal_id}/full` | Détails complets d'un anime | 3 req/s |
| `GET /manga/{mal_id}/full` | Détails complets d'un manga | 3 req/s |
| `GET /anime/{mal_id}/relations` | Relations (suites, spin-offs...) | 3 req/s |
| `GET /manga/{mal_id}/relations` | Relations manga | 3 req/s |

**Rate limiting** : délai de 400ms entre chaque appel pour respecter la limite.

**Données auto-remplies depuis Jikan** :
- Titre romaji + anglais
- Auteur/Studio
- Année, saison
- Nombre d'épisodes/volumes
- Format (shonen, seinen, etc. via demographics)
- Statut de publication
- Genres
- Image de couverture
- Score MAL
- Plateforme de streaming (anime)

### Anthropic API (Claude)

Appelée côté serveur via le Cloudflare Worker (`/api/ai-recommend`). La clé API est stockée en **secret Cloudflare** (`ANTHROPIC_API_KEY`), jamais exposée au frontend.

**Modèle** : `claude-sonnet-4-5`

**Endpoint Worker** : `POST /api/ai-recommend`

**Payload envoyé** :
```json
{
  "collection": [...],   // œuvres vues/en cours (titre, note, commentaire, genres, statut)
  "ignored": [...],      // œuvres ignorées (titre, raison)
  "planned": [...],      // œuvres planifiées (titre)
  "type": "anime",       // "manga" ou "anime"
  "genres": ["Romance"], // genres sélectionnés (vide = peu importe)
  "messages": [...]      // historique de débat (vide = première demande)
}
```

**Réponse** : tableau JSON de 3 recommandations :
```json
[
  {
    "title": "Titre romaji exact",
    "explanation": "Pourquoi cette œuvre correspond...",
    "genres": ["Comedy", "Romance"],
    "year": 2019,
    "sequel_of": null
  }
]
```

---

## Fonctionnalités principales

### 1. Recherche et ajout (Wizard)

Flux en deux étapes :
1. **Recherche Jikan** : l'utilisateur tape un titre, résultats avec titre romaji + anglais en sous-titre
2. **Wizard post-sélection** : au lieu du formulaire complet, questions étape par étape

| Statut | Épisodes/Volumes | Note | Commentaire |
|--------|-----------------|------|-------------|
| Terminé | = total (auto) | Demandé (1-10) | Demandé |
| En cours | Demandé | null | Non |
| En pause | Demandé | null | Non |
| Abandonné | Demandé | null | Non |
| Planifié | 0 (auto) | null | Non |

Le formulaire complet reste accessible via "Saisie manuelle" ou via le bouton d'édition (✎).

### 2. Modal de complétion

Quand une œuvre existante est passée à "Terminé" via l'édition :
- Les épisodes/volumes passent automatiquement au total
- Une modal demande la note + commentaire
- Annuler restaure le statut précédent

### 3. Univers / Franchise

Regroupement d'œuvres liées (suites, spin-offs, adaptations).

**Crawl récursif** :
1. Départ depuis une œuvre avec `mal_id`
2. Appel `/relations` pour découvrir les liens directs
3. Récursion sur chaque œuvre liée (queue + Set visited)
4. Auto-assignation de `universe_id` aux œuvres en collection

**Affichage** :
- Grille : les œuvres du même univers sont groupées (badge "X œuvres")
- La carte représentative est l'œuvre la plus ancienne du groupe (tome 1 / saison 1)
- Clic sur image → modale univers
- "Ma collection" : œuvres possédées avec année, note, progression
- "Explorer l'univers complet" : crawl récursif + œuvres non possédées en grisé

### 4. Recommandations IA

Accessible via le bouton "✨ Recommandations IA" dans le dashboard.

**Flux** :
1. Choix du type (manga / anime)
2. Choix des genres (extraits dynamiquement de la collection)
3. L'IA analyse la collection + œuvres ignorées + planifiées et propose 3 œuvres
4. Score MAL + lien chargés progressivement via Jikan
5. Badge "🔗 Suite de [titre]" si la proposition est une suite directe

**Actions par carte** :
- **📋 Planifier** : sauvegarde en `planifie` avec métadonnées Jikan
- **👁 Déjà vu** : sauvegarde en `termine` via la modale note/commentaire (séquentielle si plusieurs)
- **🚫 Pas envie** : sauvegarde en `ignore` avec raison — l'IA en tient compte pour les prochaines propositions
- **💬 Débattre** : mini-chat inline, l'IA peut reproposer une autre œuvre

Le bouton "Valider la sélection" est sticky en bas de modale, visible dès 1 carte sélectionnée.

### 5. Filtres et tri

- **Type** : Tout / Manga / Anime
- **Statut** : Tout / En cours / Terminé / Planifié / En pause / Abandonné / Pas envie
- Les œuvres "Pas envie" sont masquées dans le filtre "Tous statuts"
- **Recherche** : filtre sur titre
- **Tri** : Titre (A-Z) / Année / Note

### 6. Mise à jour des scores MAL

Au chargement du dashboard, `updateMalScores()` parcourt les œuvres ayant un `mal_id` et met à jour `mal_score` depuis Jikan (délai 400ms entre appels).

---

## Cloudflare Workers

### Configuration (`wrangler.jsonc`)

```jsonc
{
  "name": "manga-vault",
  "compatibility_date": "2025-09-27",
  "main": "src/index.js",
  "assets": {
    "directory": "./public",
    "binding": "ASSETS"
  }
}
```

### Worker (`src/index.js`)

Deux rôles :
1. **Proxy IA** : route `POST /api/ai-recommend` → appel Anthropic avec la clé secrète
2. **Assets** : sert les fichiers statiques via `env.ASSETS.fetch(request)`

**Secret requis** : `ANTHROPIC_API_KEY` à configurer dans Cloudflare Dashboard → Workers → Settings → Variables and Secrets.

### Déploiement

1. Push sur GitHub (via l'interface web)
2. Cloudflare auto-deploy depuis le repo
3. **Astuce** : décocher "Build for non-production branches" dans la config Cloudflare pour débloquer le formulaire

---

## Points d'attention

### Enum `mv_work_status`

Le champ `status` est un **type enum** PostgreSQL (pas un `text` libre). Toute nouvelle valeur de statut nécessite un `ALTER TYPE mv_work_status ADD VALUE '...'` avant d'être utilisable.

### Nautiljon

Nautiljon bloque les proxies CORS et retourne des pages anti-bot. Le scraping côté client ou via proxy générique n'est pas viable. Le bouton "📖 Nautiljon ↗" ouvre simplement la page dans un nouvel onglet.

### Jikan rate limiting

Jikan impose ~3 requêtes/seconde. Le code utilise un délai de 400ms entre les appels. Le crawl récursif d'univers et le chargement des données MAL des recommandations peuvent générer de nombreux appels — un indicateur de progression est affiché.

### Données Jikan pré-chargées (recommandations IA)

Lors de l'affichage des recommandations, `loadRecMalData()` pré-charge les données complètes Jikan (`/full`) et les cache dans `rec._jikanFull`. La validation (Planifier / Déjà vu) utilise ce cache — aucun appel réseau supplémentaire.

### Supabase views et migrations

Les vues PostgreSQL (`mv_user_stats`) dépendent des colonnes de la table. Si on modifie les colonnes, il faut :
1. `DROP VIEW mv_user_stats`
2. `ALTER TABLE mv_works ...`
3. `CREATE VIEW mv_user_stats ...` (recréer)

### Cache navigateur

Après déploiement, un hard refresh (Ctrl+Shift+R) est souvent nécessaire car Cloudflare cache agressivement les assets JS/CSS.

### Backfill titre anglais

Le bouton "Traductions ANG" dans le menu utilisateur lance `backfillTitleEnglish()` — parcourt toutes les œuvres avec `mal_id` mais sans `title_english` et les met à jour depuis Jikan.

---

## Versioning

Le changelog est accessible via le bouton de version en bas du dashboard. Les versions suivent le semver :
- **Major** : changement de structure BDD ou refonte UI
- **Minor** : nouvelles fonctionnalités
- **Patch** : corrections de bugs, polish
