# MangaVault 📚

Ta bibliothèque manga & anime personnelle — site statique + Supabase, déployable sur Cloudflare Pages.

## Structure

```
manga-vault/
├── index.html          # Landing page
├── login.html          # Connexion (Google + Magic Link)
├── dashboard.html      # Collection (protégée)
├── css/
│   └── style.css       # Styles
└── js/
    ├── config.js       # ⚠️ Clés Supabase à remplir
    └── app.js          # Logique applicative
```

## Setup

### 1. Configurer `js/config.js`

Ouvre le fichier et remplace les valeurs par les tiennes (Supabase > Settings > API) :

```js
const SUPABASE_URL = "https://ton-projet.supabase.co";
const SUPABASE_ANON_KEY = "eyJ...";
```

### 2. Pousser sur GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/ton-user/manga-vault.git
git push -u origin main
```

### 3. Déployer sur Cloudflare Pages

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) > Pages > Create a project
2. Connect to Git > sélectionne ton repo
3. Build settings :
   - **Build command** : *(laisser vide)*
   - **Build output directory** : `/`
4. Deploy

### 4. Mettre à jour les URLs

Après le premier déploiement, mets à jour :
- **Supabase** > Authentication > URL Configuration > Site URL → `https://ton-domaine.pages.dev`
- **Supabase** > Authentication > URL Configuration > Redirect URLs → ajoute `https://ton-domaine.pages.dev/**`
- **Google Cloud** > OAuth > Authorized redirect URIs → vérifie que le callback Supabase est bien là
