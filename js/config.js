// ============================================
// MangaVault — Configuration Supabase
// Remplace les valeurs ci-dessous par les tiennes
// (Settings > API dans ton projet Supabase)
// ============================================

const SUPABASE_URL = "https://denhmucpuksiedfynokm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlbmhtdWNwdWtzaWVkZnlub2ttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNzkxNTYsImV4cCI6MjA4Nzk1NTE1Nn0.f25F82Z5nlds83KgI-W8fDsVQozvfALt_JUVT3MLkVU";

// URL du site (à mettre à jour après déploiement Cloudflare)
const SITE_URL = window.location.origin;

// Initialisation du client Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
