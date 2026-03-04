# MangaVault 📚🎬

Tracker personnel de collection manga & anime.

## Fonctionnalités

- **Recherche intelligente** : recherche Jikan (MyAnimeList) avec auto-remplissage complet
- **Wizard d'ajout** : ajout en quelques clics (statut → progression → note)
- **Univers / Franchise** : regroupement automatique par crawl récursif des relations MAL
- **Scores MAL live** : mise à jour automatique des scores MyAnimeList
- **Filtres & tri** : par type, statut, titre, année, note
- **Dark mode** : interface sombre et responsive

## Stack

- **Frontend** : Vanilla JS / HTML / CSS
- **Backend** : [Supabase](https://supabase.com) (PostgreSQL + Auth)
- **Hosting** : [Cloudflare Workers](https://workers.cloudflare.com)
- **API** : [Jikan v4](https://jikan.moe) (MyAnimeList)

## Déploiement

1. Créer un projet Supabase et configurer la table `mv_works` (voir `TECHNICAL.md`)
2. Mettre à jour `public/js/config.js` avec vos credentials Supabase
3. Push sur GitHub
4. Connecter le repo à Cloudflare Workers (auto-deploy)

## Documentation

Voir [TECHNICAL.md](./TECHNICAL.md) pour la documentation technique complète.

## Version

v1.0.0 — Mars 2026
