// ============================================
// MangaVault — Application Logic v5
// ============================================

var GENRES = ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mystery", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Thriller"];
var STATUS_LABELS = { en_cours: "En cours", termine: "Terminé", en_pause: "En pause", abandonne: "Abandonné", planifie: "Planifié", ignore: "Pas envie" };
var FORMAT_LABELS = { shonen: "Shōnen", seinen: "Seinen", shojo: "Shōjo", josei: "Josei" };
var SEASON_LABELS = { hiver: "Hiver", printemps: "Printemps", ete: "Été", automne: "Automne" };
var PLATFORM_LABELS = { crunchyroll: "Crunchyroll", netflix: "Netflix", adn: "ADN", disney: "Disney+", prime: "Prime Video", hidive: "HIDIVE", autre: "Autre" };
var RELATION_LABELS = { Sequel: "Suite", Prequel: "Préquel", "Alternative setting": "Univers alternatif", "Alternative version": "Version alternative", "Side story": "Histoire parallèle", Summary: "Résumé", "Spin-off": "Spin-off", Other: "Autre", Character: "Personnage", "Full story": "Histoire complète", "Parent story": "Histoire principale" };

var currentUser = null;
var currentProfile = null;
var works = [];
var editingId = null;
var filterType = "all";
var mangaForm = { rating: 7, genres: [], mal_id: null, mal_score: null, universe_id: null };
var animeForm = { rating: 7, genres: [], mal_id: null, mal_score: null, universe_id: null };
var searchTimeout = null;

var ADMIN_EMAIL = "solo6782@gmail.com";
var PLANS = {
  free:  { label: "Free",  works_limit: 50,     ai_calls_limit: 1 },
  beta:  { label: "Bêta",  works_limit: 999999,  ai_calls_limit: 5 },
  admin: { label: "Admin", works_limit: 999999,  ai_calls_limit: 999999 }
};

// ============================================
// AUTH
// ============================================

async function initApp() {
  var result = await sb.auth.getSession();
  var session = result.data.session;
  if (!session) { window.location.href = "login.html"; return; }
  currentUser = session.user;
  renderUserInfo();
  await loadProfile();
  await loadWorks();
  document.getElementById("loading").style.display = "none";
  document.getElementById("app").style.display = "block";
  setTimeout(updateMalScores, 2000);
}

function renderUserInfo() {
  var name = (currentUser.user_metadata && (currentUser.user_metadata.full_name || currentUser.user_metadata.name))
    || (currentUser.email && currentUser.email.split("@")[0]) || "User";
  var avatarUrl = currentUser.user_metadata && currentUser.user_metadata.avatar_url;
  var avatarEl = document.getElementById("user-avatar");
  if (avatarUrl) { avatarEl.innerHTML = '<img class="navbar-avatar" src="' + avatarUrl + '" alt="">'; }
  else { avatarEl.innerHTML = '<div class="navbar-avatar-placeholder">' + name.charAt(0).toUpperCase() + '</div>'; }
  document.getElementById("user-name").textContent = name;
  document.getElementById("user-email").textContent = currentUser.email;
}

function toggleMenu() {
  var dd = document.getElementById("user-dropdown");
  dd.style.display = dd.style.display === "none" ? "block" : "none";
}
document.addEventListener("click", function(e) {
  if (!e.target.closest(".navbar-user")) document.getElementById("user-dropdown").style.display = "none";
});

async function logout() { await sb.auth.signOut(); window.location.href = "index.html"; }


// ============================================
// PLANS & QUOTA
// ============================================

async function loadProfile() {
  var result = await sb.from("mv_profiles").select("*").eq("id", currentUser.id).single();

  if (result.data) {
    currentProfile = result.data;
    // Auto-élévation admin par email
    if (currentUser.email === ADMIN_EMAIL && currentProfile.plan !== "admin") {
      await sb.from("mv_profiles").update({ plan: "admin", works_limit: 999999, ai_calls_limit: 999999 }).eq("id", currentUser.id);
      currentProfile.plan = "admin"; currentProfile.works_limit = 999999; currentProfile.ai_calls_limit = 999999;
    }
  } else {
    // Création du profil si inexistant
    var isAdmin = currentUser.email === ADMIN_EMAIL;
    var newProfile = {
      id: currentUser.id, email: currentUser.email,
      plan: isAdmin ? "admin" : "free",
      works_limit: isAdmin ? 999999 : 50,
      ai_calls_limit: isAdmin ? 999999 : 1,
      ai_calls_used: 0, ai_calls_reset_at: new Date().toISOString()
    };
    var ins = await sb.from("mv_profiles").insert(newProfile).select().single();
    if (!ins.error) currentProfile = ins.data;
  }

  // Reset hebdomadaire
  if (currentProfile) {
    var resetAt = new Date(currentProfile.ai_calls_reset_at);
    var daysDiff = (Date.now() - resetAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff >= 7) {
      var now = new Date().toISOString();
      await sb.from("mv_profiles").update({ ai_calls_used: 0, ai_calls_reset_at: now }).eq("id", currentUser.id);
      currentProfile.ai_calls_used = 0; currentProfile.ai_calls_reset_at = now;
    }
  }

  renderQuota();
  renderAdminBtn();
}

function renderQuota() {
  var el = document.getElementById("quota-display");
  if (!el || !currentProfile) return;
  var plan = currentProfile.plan;
  var used = currentProfile.ai_calls_used || 0;
  var limit = currentProfile.ai_calls_limit;

  if (plan === "admin") {
    el.innerHTML = '<span class="quota-badge quota-admin">∞ Admin</span>';
  } else {
    var remaining = Math.max(0, limit - used);
    var cls = remaining === 0 ? "quota-badge quota-empty" : remaining <= 1 ? "quota-badge quota-low" : "quota-badge quota-ok";
    el.innerHTML = '<span class="' + cls + '">' + remaining + '/' + limit + ' reco cette semaine</span>';
  }
}

function renderAdminBtn() {
  var btn = document.getElementById("btn-admin");
  if (!btn || !currentProfile) return;
  btn.style.display = currentProfile.plan === "admin" ? "block" : "none";
}

function checkWorksLimit() {
  if (!currentProfile) return true;
  if (currentProfile.plan === "admin" || currentProfile.plan === "beta") return true;
  var userWorksCount = works.filter(function(w) { return w.user_id === currentUser.id; }).length;
  if (userWorksCount >= currentProfile.works_limit) {
    alert("🔒 Limite atteinte (" + currentProfile.works_limit + " œuvres max en plan " + (PLANS[currentProfile.plan] ? PLANS[currentProfile.plan].label : currentProfile.plan) + ").\nContacte-nous pour passer en plan Bêta !");
    return false;
  }
  return true;
}

function checkAiQuota() {
  if (!currentProfile) return true;
  if (currentProfile.plan === "admin") return true;
  if (currentProfile.ai_calls_used >= currentProfile.ai_calls_limit) {
    alert("🔒 Tu as utilisé tes " + currentProfile.ai_calls_limit + " recommandation(s) de la semaine.\nReviens dans quelques jours ou contacte-nous pour upgrader !");
    return false;
  }
  return true;
}

// ============================================
// DATA
// ============================================

async function loadWorks() {
  var result = await sb.from("mv_works").select("*").order("created_at", { ascending: false });
  if (!result.error) works = result.data || [];
  renderStats();
  renderWorks();
}

// ============================================
// AUTO-UPDATE MAL SCORES
// ============================================

async function updateMalScores() {
  var toUpdate = works.filter(function(w) { return w.mal_id; });
  if (toUpdate.length === 0) return;
  for (var i = 0; i < toUpdate.length; i++) {
    try {
      var w = toUpdate[i];
      var endpoint = w.type === "manga" ? "manga" : "anime";
      var resp = await fetch("https://api.jikan.moe/v4/" + endpoint + "/" + w.mal_id);
      var data = await resp.json();
      if (data.data && data.data.score && data.data.score !== w.mal_score) {
        await sb.from("mv_works").update({ mal_score: data.data.score }).eq("id", w.id);
        w.mal_score = data.data.score;
      }
      // Respect rate limit
      if (i < toUpdate.length - 1) await new Promise(function(r) { setTimeout(r, 400); });
    } catch (e) { console.log("MAL score update error:", e); }
  }
  console.log("MAL scores updated for " + toUpdate.length + " entries");
}

// ============================================
// JIKAN HELPERS
// ============================================

function mapJikanGenres(data) {
  var genres = [];
  if (data.genres) { data.genres.forEach(function(g) { var n = g.name === "Science Fiction" ? "Sci-Fi" : g.name; if (GENRES.indexOf(n) >= 0) genres.push(n); }); }
  if (data.themes) { data.themes.forEach(function(t) { if (GENRES.indexOf(t.name) >= 0 && genres.indexOf(t.name) < 0) genres.push(t.name); }); }
  return genres;
}

function mapJikanSeason(s) { if (!s) return ""; s = s.toLowerCase(); return s === "spring" ? "printemps" : s === "summer" ? "ete" : s === "fall" ? "automne" : s === "winter" ? "hiver" : ""; }

function mapJikanPlatform(streaming) {
  if (!streaming || streaming.length === 0) return "";
  var map = { crunchyroll: "crunchyroll", netflix: "netflix", "disney plus": "disney", "disney+": "disney", "amazon prime video": "prime", "prime video": "prime", hidive: "hidive", adn: "adn", "anime digital network": "adn" };
  for (var i = 0; i < streaming.length; i++) { var n = (streaming[i].name || "").toLowerCase(); for (var k in map) { if (n.indexOf(k) >= 0) return map[k]; } }
  return "";
}

function reverseAuthorName(name) { var p = name.split(", "); return p.length === 2 ? p[1] + " " + p[0] : name; }

// ============================================
// JIKAN API - MANGA SEARCH
// ============================================

function onMangaSearch() {
  var query = document.getElementById("fm-search").value.trim();
  clearTimeout(searchTimeout);
  if (query.length < 2) { document.getElementById("fm-search-results").style.display = "none"; document.getElementById("fm-manual-btn").style.display = "none"; return; }
  document.getElementById("fm-search-spinner").style.display = "block";
  searchTimeout = setTimeout(function() { searchManga(query); }, 500);
}

async function searchManga(query) {
  try {
    var response = await fetch("https://api.jikan.moe/v4/manga?q=" + encodeURIComponent(query) + "&limit=6");
    var data = await response.json();
    document.getElementById("fm-search-spinner").style.display = "none";
    if (data.data && data.data.length > 0) { renderMangaSearchResults(data.data); }
    else { document.getElementById("fm-search-results").innerHTML = '<div class="search-no-results">Aucun résultat.</div>'; document.getElementById("fm-search-results").style.display = "block"; }
    document.getElementById("fm-manual-btn").style.display = "block";
  } catch (err) { console.error("Jikan error:", err); document.getElementById("fm-search-spinner").style.display = "none"; document.getElementById("fm-manual-btn").style.display = "block"; }
}

function renderMangaSearchResults(results) {
  var c = document.getElementById("fm-search-results");
  c.innerHTML = results.map(function(m) {
    var img = (m.images && m.images.jpg && m.images.jpg.small_image_url) || "";
    var author = (m.authors && m.authors.length > 0) ? m.authors[0].name || "" : "";
    var year = (m.published && m.published.prop && m.published.prop.from) ? m.published.prop.from.year : "";
    var enTitle = m.title_english ? '<div class="search-result-en">' + m.title_english + '</div>' : '';
    return '<button class="search-result-item" onclick="selectManga(' + m.mal_id + ')"><div class="search-result-img">' + (img ? '<img src="' + img + '" alt="">' : '<span>📖</span>') + '</div><div class="search-result-info"><div class="search-result-title">' + (m.title || "") + '</div>' + enTitle + '<div class="search-result-meta">' + (author ? author + ' · ' : '') + (year ? year + ' · ' : '') + (m.volumes || "?") + ' vol.</div></div></button>';
  }).join("");
  c.style.display = "block";
}

async function selectManga(malId) {
  document.getElementById("fm-search-results").style.display = "none";
  document.getElementById("fm-search-spinner").style.display = "block";
  try {
    var response = await fetch("https://api.jikan.moe/v4/manga/" + malId + "/full");
    var data = await response.json(); var m = data.data; if (!m) return;

    // Store all Jikan data for wizard/form
    mangaForm.mal_id = malId;
    mangaForm.mal_score = m.score || null;
    mangaForm._jikan = m; // Keep full data for wizard
    mangaForm.title_english = (m.title_english && m.title_english !== m.title) ? m.title_english : null;

    // Fill hidden form fields (for manual edit later)
    document.getElementById("fm-title").value = m.title || "";
    document.getElementById("fm-year").value = (m.published && m.published.prop && m.published.prop.from) ? m.published.prop.from.year || "" : "";
    document.getElementById("fm-volumes-vo").value = m.volumes || "";
    if (m.authors && m.authors.length > 0) { document.getElementById("fm-author").value = reverseAuthorName(m.authors[0].name || ""); }
    var format = "";
    if (m.demographics && m.demographics.length > 0) {
      var demo = m.demographics[0].name.toLowerCase();
      if (demo.indexOf("shonen") >= 0 || demo.indexOf("shounen") >= 0) format = "shonen";
      else if (demo.indexOf("seinen") >= 0) format = "seinen";
      else if (demo.indexOf("shojo") >= 0 || demo.indexOf("shoujo") >= 0) format = "shojo";
      else if (demo.indexOf("josei") >= 0) format = "josei";
    }
    document.getElementById("fm-format").value = format;
    var pubStatus = "en_cours";
    if (m.status) { if (m.status.toLowerCase().indexOf("finished") >= 0) pubStatus = "termine"; else if (m.status.toLowerCase().indexOf("hiatus") >= 0) pubStatus = "en_pause"; }
    document.getElementById("fm-pub-status").value = pubStatus;
    mangaForm.genres = mapJikanGenres(m);
    if (m.images && m.images.jpg) { document.getElementById("fm-image").value = m.images.jpg.large_image_url || m.images.jpg.image_url || ""; }

    // Open wizard instead of form
    closeModal();
    openWizard("manga", m);

  } catch (err) { console.error("Jikan detail error:", err); alert("Erreur lors de la récupération des détails."); }
  document.getElementById("fm-search-spinner").style.display = "none";
}

function showMangaPreview(m) {
  var img = (m.images && m.images.jpg && m.images.jpg.image_url) || "";
  var author = (m.authors && m.authors.length > 0) ? reverseAuthorName(m.authors[0].name || "") : "";
  var year = (m.published && m.published.prop && m.published.prop.from && m.published.prop.from.year) ? m.published.prop.from.year : "";
  document.getElementById("fm-preview").innerHTML = '<div class="preview-card">' + (img ? '<img src="' + img + '" alt="" class="preview-img">' : '') + '<div class="preview-info"><div class="preview-title">' + (m.title || "") + '</div><div class="preview-meta">' + author + (year ? ' · ' + year : '') + '</div><div class="preview-meta">Score MAL: ' + (m.score || "N/A") + ' · ' + (m.volumes || "?") + ' volumes</div><button class="btn-change-manga" onclick="resetMangaSearch()">Changer ↺</button></div></div>';
  document.getElementById("fm-preview").style.display = "block";
}

function showManualMangaForm() {
  document.getElementById("fm-step-search").style.display = "none";
  document.getElementById("fm-form").style.display = "block";
  document.getElementById("fm-preview").style.display = "none";
  mangaForm.mal_id = null; mangaForm.mal_score = null; mangaForm.universe_id = null;
  buildStars("fm-stars", mangaForm); buildGenres("fm-genres", mangaForm);
}

function resetMangaSearch() {
  document.getElementById("fm-step-search").style.display = "block";
  document.getElementById("fm-form").style.display = "none";
  document.getElementById("fm-search").value = "";
  document.getElementById("fm-search-results").style.display = "none";
  document.getElementById("fm-manual-btn").style.display = "none";
  document.getElementById("fm-preview").style.display = "none";
  document.getElementById("fm-title").value = ""; document.getElementById("fm-author").value = "";
  document.getElementById("fm-format").value = ""; document.getElementById("fm-year").value = "";
  document.getElementById("fm-pub-status").value = "en_cours"; document.getElementById("fm-status").value = "en_cours";
  document.getElementById("fm-volumes").value = ""; document.getElementById("fm-volumes-vo").value = "";
  document.getElementById("fm-fr-volumes").value = ""; document.getElementById("fm-image").value = "";
  document.getElementById("fm-notes").value = ""; document.getElementById("fm-vf-status").style.display = "none";
  mangaForm.rating = 7; mangaForm.genres = []; mangaForm.mal_id = null; mangaForm.mal_score = null; mangaForm.universe_id = null; mangaForm.title_english = null;
}

function searchVF() {
  var title = document.getElementById("fm-title").value.trim(); if (!title) return;
  var statusEl = document.getElementById("fm-vf-status");
  window.open("https://www.nautiljon.com/mangas/?q=" + encodeURIComponent(title), "_blank");
  statusEl.style.display = "block"; statusEl.className = "vf-status searching";
  statusEl.innerHTML = 'Nautiljon ouvert ↗ — Cherche <strong>"Nb volumes VF"</strong> sur la fiche et entre le nombre ci-dessus.';
}

// ============================================
// JIKAN API - ANIME SEARCH
// ============================================

function onAnimeSearch() {
  var query = document.getElementById("fa-search").value.trim();
  clearTimeout(searchTimeout);
  if (query.length < 2) { document.getElementById("fa-search-results").style.display = "none"; document.getElementById("fa-manual-btn").style.display = "none"; return; }
  document.getElementById("fa-search-spinner").style.display = "block";
  searchTimeout = setTimeout(function() { searchAnime(query); }, 500);
}

async function searchAnime(query) {
  try {
    var response = await fetch("https://api.jikan.moe/v4/anime?q=" + encodeURIComponent(query) + "&limit=6");
    var data = await response.json();
    document.getElementById("fa-search-spinner").style.display = "none";
    if (data.data && data.data.length > 0) { renderAnimeSearchResults(data.data); }
    else { document.getElementById("fa-search-results").innerHTML = '<div class="search-no-results">Aucun résultat.</div>'; document.getElementById("fa-search-results").style.display = "block"; }
    document.getElementById("fa-manual-btn").style.display = "block";
  } catch (err) { console.error("Jikan error:", err); document.getElementById("fa-search-spinner").style.display = "none"; document.getElementById("fa-manual-btn").style.display = "block"; }
}

function renderAnimeSearchResults(results) {
  var c = document.getElementById("fa-search-results");
  c.innerHTML = results.map(function(a) {
    var img = (a.images && a.images.jpg && a.images.jpg.small_image_url) || "";
    var studio = (a.studios && a.studios.length > 0) ? a.studios[0].name || "" : "";
    var year = a.year || "";
    var enTitle = a.title_english ? '<div class="search-result-en">' + a.title_english + '</div>' : '';
    return '<button class="search-result-item" onclick="selectAnime(' + a.mal_id + ')"><div class="search-result-img">' + (img ? '<img src="' + img + '" alt="">' : '<span>📺</span>') + '</div><div class="search-result-info"><div class="search-result-title">' + (a.title || "") + '</div>' + enTitle + '<div class="search-result-meta">' + (studio ? studio + ' · ' : '') + (year ? year + ' · ' : '') + (a.episodes || "?") + ' ep. · ' + (a.type || "") + '</div></div></button>';
  }).join("");
  c.style.display = "block";
}

async function selectAnime(malId) {
  document.getElementById("fa-search-results").style.display = "none";
  document.getElementById("fa-search-spinner").style.display = "block";
  try {
    var response = await fetch("https://api.jikan.moe/v4/anime/" + malId + "/full");
    var data = await response.json(); var a = data.data; if (!a) return;

    animeForm.mal_id = malId;
    animeForm.mal_score = a.score || null;
    animeForm._jikan = a;
    animeForm.title_english = (a.title_english && a.title_english !== a.title) ? a.title_english : null;

    // Fill hidden form fields
    document.getElementById("fa-title").value = a.title || "";
    if (a.studios && a.studios.length > 0) { document.getElementById("fa-studio").value = a.studios[0].name || ""; }
    document.getElementById("fa-year").value = a.year || "";
    document.getElementById("fa-season").value = mapJikanSeason(a.season);
    document.getElementById("fa-platform").value = mapJikanPlatform(a.streaming);
    document.getElementById("fa-episodes-total").value = a.episodes || "";
    animeForm.genres = mapJikanGenres(a);
    if (a.images && a.images.jpg) { document.getElementById("fa-image").value = a.images.jpg.large_image_url || a.images.jpg.image_url || ""; }

    // Open wizard
    closeModal();
    openWizard("anime", a);

  } catch (err) { console.error("Jikan detail error:", err); alert("Erreur lors de la récupération des détails."); }
  document.getElementById("fa-search-spinner").style.display = "none";
}

function showAnimePreview(a) {
  var img = (a.images && a.images.jpg && a.images.jpg.image_url) || "";
  var studio = (a.studios && a.studios.length > 0) ? a.studios[0].name : "";
  var season = a.season ? a.season.charAt(0).toUpperCase() + a.season.slice(1) : "";
  document.getElementById("fa-preview").innerHTML = '<div class="preview-card">' + (img ? '<img src="' + img + '" alt="" class="preview-img">' : '') + '<div class="preview-info"><div class="preview-title">' + (a.title || "") + '</div><div class="preview-meta">' + studio + (a.year ? ' · ' + (season ? season + ' ' : '') + a.year : '') + '</div><div class="preview-meta">Score MAL: ' + (a.score || "N/A") + ' · ' + (a.episodes || "?") + ' épisodes' + (a.type ? ' · ' + a.type : '') + '</div><button class="btn-change-manga" onclick="resetAnimeSearch()">Changer ↺</button></div></div>';
  document.getElementById("fa-preview").style.display = "block";
}

function showManualAnimeForm() {
  document.getElementById("fa-step-search").style.display = "none";
  document.getElementById("fa-form").style.display = "block";
  document.getElementById("fa-preview").style.display = "none";
  animeForm.mal_id = null; animeForm.mal_score = null; animeForm.universe_id = null;
  buildStars("fa-stars", animeForm); buildGenres("fa-genres", animeForm);
}

function resetAnimeSearch() {
  document.getElementById("fa-step-search").style.display = "block";
  document.getElementById("fa-form").style.display = "none";
  document.getElementById("fa-search").value = "";
  document.getElementById("fa-search-results").style.display = "none";
  document.getElementById("fa-manual-btn").style.display = "none";
  document.getElementById("fa-preview").style.display = "none";
  document.getElementById("fa-title").value = ""; document.getElementById("fa-studio").value = "";
  document.getElementById("fa-year").value = ""; document.getElementById("fa-season").value = "";
  document.getElementById("fa-platform").value = ""; document.getElementById("fa-status").value = "en_cours";
  document.getElementById("fa-episodes").value = ""; document.getElementById("fa-episodes-total").value = "";
  document.getElementById("fa-seasons").value = ""; document.getElementById("fa-image").value = "";
  document.getElementById("fa-notes").value = "";
  animeForm.rating = 7; animeForm.genres = []; animeForm.mal_id = null; animeForm.mal_score = null; animeForm.universe_id = null; animeForm.title_english = null;
}

// ============================================
// UNIVERSE (recursive crawl of related works)
// ============================================

var currentUniverseId = null;

async function openUniverse(workId) {
  var work = works.find(function(w) { return w.id === workId; });
  if (!work) return;

  // If this work is part of a group, show the group modal
  if (work.universe_id) {
    openUniverseGroup(work.universe_id, work.title);
    return;
  }

  // If no mal_id, can't crawl
  if (!work.mal_id) return;

  // Assign a universe_id if not yet set
  var uniId = "uni_" + work.mal_id;
  currentUniverseId = uniId;

  // Update this work's universe_id in DB
  await sb.from("mv_works").update({ universe_id: uniId }).eq("id", work.id);
  work.universe_id = uniId;

  document.getElementById("universe-title").textContent = "Univers — " + work.title;
  document.getElementById("universe-content").innerHTML = "";
  document.getElementById("universe-loading").style.display = "flex";
  document.getElementById("modal-universe").style.display = "flex";

  // Recursive crawl
  var visited = {};
  var allEntries = [];
  var queue = [{ mal_id: work.mal_id, type: work.type }];
  visited[work.type + "_" + work.mal_id] = true;
  var statusEl = document.getElementById("universe-loading");

  while (queue.length > 0) {
    var current = queue.shift();
    var endpoint = current.type === "manga" ? "manga" : "anime";

    try {
      statusEl.querySelector("span").textContent = "Exploration... " + allEntries.length + " œuvres trouvées";
      var resp = await fetch("https://api.jikan.moe/v4/" + endpoint + "/" + current.mal_id + "/relations");
      var data = await resp.json();

      if (data.data) {
        data.data.forEach(function(rel) {
          rel.entry.forEach(function(e) {
            var key = e.type.toLowerCase() + "_" + e.mal_id;
            if (!visited[key]) {
              visited[key] = true;
              var entry = { mal_id: e.mal_id, name: e.name, type: e.type.toLowerCase(), relation: rel.relation };
              allEntries.push(entry);
              // Add to queue for recursive crawl (only anime/manga)
              if (e.type.toLowerCase() === "anime" || e.type.toLowerCase() === "manga") {
                queue.push({ mal_id: e.mal_id, type: e.type.toLowerCase() });
              }
            }
          });
        });
      }
      // Rate limit
      await new Promise(function(r) { setTimeout(r, 400); });
    } catch (err) {
      console.log("Crawl error for " + current.mal_id + ":", err);
    }
  }

  document.getElementById("universe-loading").style.display = "none";

  if (allEntries.length === 0) {
    document.getElementById("universe-content").innerHTML = '<div class="universe-empty">Aucune œuvre liée trouvée.</div>';
    return;
  }

  // Auto-assign universe_id to works already in collection
  var myMalIds = {};
  works.forEach(function(w) { if (w.mal_id) myMalIds[w.type + "_" + w.mal_id] = w; });

  for (var i = 0; i < allEntries.length; i++) {
    var key = allEntries[i].type + "_" + allEntries[i].mal_id;
    var existing = myMalIds[key];
    if (existing && !existing.universe_id) {
      await sb.from("mv_works").update({ universe_id: uniId }).eq("id", existing.id);
      existing.universe_id = uniId;
    }
  }

  renderUniverseList(allEntries, myMalIds, uniId);

  // Progressively load images
  for (var i = 0; i < allEntries.length; i++) {
    try {
      var e = allEntries[i];
      var apiType = e.type === "manga" ? "manga" : "anime";
      var detResp = await fetch("https://api.jikan.moe/v4/" + apiType + "/" + e.mal_id);
      var detData = await detResp.json();
      if (detData.data && detData.data.images && detData.data.images.jpg) {
        var imgEl = document.getElementById("uni-img-" + e.mal_id);
        if (imgEl) { imgEl.src = detData.data.images.jpg.image_url || ""; imgEl.style.display = "block"; }
        var scoreEl = document.getElementById("uni-score-" + e.mal_id);
        if (scoreEl && detData.data.score) { scoreEl.textContent = "★ " + detData.data.score; }
        var epsEl = document.getElementById("uni-eps-" + e.mal_id);
        if (epsEl) { epsEl.textContent = detData.data.episodes ? detData.data.episodes + " ep." : detData.data.volumes ? detData.data.volumes + " vol." : ""; }
        var enEl = document.getElementById("uni-en-" + e.mal_id);
        if (enEl && detData.data.title_english && detData.data.title_english !== detData.data.title) { enEl.textContent = detData.data.title_english; }
        var yearEl = document.getElementById("uni-year-" + e.mal_id);
        if (yearEl) {
          var yr = detData.data.year || (detData.data.published && detData.data.published.prop && detData.data.published.prop.from ? detData.data.published.prop.from.year : null);
          if (yr) yearEl.textContent = yr + " · ";
        }
      }
      if (i < allEntries.length - 1) await new Promise(function(r) { setTimeout(r, 400); });
    } catch (err) { console.log("Detail error:", err); }
  }
}

function openUniverseGroup(universeId, title) {
  currentUniverseId = universeId;
  var groupWorks = works.filter(function(w) { return w.universe_id === universeId; });
  if (groupWorks.length === 0) return;

  // Find the "main" work for the title
  var mainTitle = title || groupWorks[0].title;
  document.getElementById("universe-title").textContent = "Univers — " + mainTitle;
  document.getElementById("universe-loading").style.display = "none";
  document.getElementById("modal-universe").style.display = "flex";

  // Show owned works
  var html = '<div class="universe-group"><h3 class="universe-group-title">Ma collection</h3><div class="universe-items">';
  groupWorks.forEach(function(w) {
    var typeBadge = w.type === "anime" ? "アニメ" : "漫画";
    var progress = w.type === "manga" ? (w.volumes_read || 0) + "/" + (w.volumes_vo || "?") + " vol." : (w.episodes_watched || 0) + "/" + (w.episodes_total || "?") + " ep.";
    var malLinkHtml = w.mal_id ? '<a href="https://myanimelist.net/' + w.type + '/' + w.mal_id + '" target="_blank" class="universe-mal-link" onclick="event.stopPropagation()" title="Voir sur MyAnimeList">MAL ↗</a>' : '';
    html += '<div class="universe-item owned">' +
      '<div class="universe-item-img-wrap" onclick="closeUniverse();editWork(\'' + w.id + '\')">' +
        (w.image_url ? '<img class="universe-item-img" src="' + w.image_url + '" style="display:block">' : '') +
        '<div class="universe-item-placeholder" style="' + (w.image_url ? 'display:none' : '') + '">' + (w.type === "anime" ? "📺" : "📖") + '</div>' +
      '</div>' +
      '<div class="universe-item-info" onclick="closeUniverse();editWork(\'' + w.id + '\')">' +
        '<div class="universe-item-title">' + w.title + '</div>' +
        '<div class="universe-item-meta"><span class="badge badge-' + w.type + ' badge-sm">' + typeBadge + '</span> ' + (w.year ? w.year + ' · ' : '') + '★ ' + (w.rating || "—") + '/10 · ' + progress + '</div>' +
      '</div>' +
      '<div class="universe-item-actions">' + malLinkHtml + '<div class="universe-item-check">✓</div></div></div>';
  });
  html += '</div></div>';

  // Button to search for more related works
  var mainWork = groupWorks.find(function(w) { return w.mal_id; });
  if (mainWork) {
    html += '<div class="universe-explore"><button class="btn-explore" onclick="exploreFull(\'' + mainWork.id + '\')">🔍 Explorer l\'univers complet</button></div>';
  }

  document.getElementById("universe-content").innerHTML = html;
}

async function exploreFull(workId) {
  var work = works.find(function(w) { return w.id === workId; });
  if (!work || !work.mal_id) return;

  document.getElementById("universe-loading").style.display = "flex";
  currentUniverseId = work.universe_id;

  // Recursive crawl (same as openUniverse)
  var visited = {};
  var allEntries = [];
  var queue = [];
  var statusEl = document.getElementById("universe-loading");

  // Start from ALL works in this universe that have mal_id
  var uniWorks = works.filter(function(w) { return w.universe_id === work.universe_id && w.mal_id; });
  uniWorks.forEach(function(w) {
    visited[w.type + "_" + w.mal_id] = true;
    queue.push({ mal_id: w.mal_id, type: w.type });
  });

  while (queue.length > 0) {
    var current = queue.shift();
    var endpoint = current.type === "manga" ? "manga" : "anime";
    try {
      statusEl.querySelector("span").textContent = "Exploration... " + allEntries.length + " œuvres trouvées";
      var resp = await fetch("https://api.jikan.moe/v4/" + endpoint + "/" + current.mal_id + "/relations");
      var data = await resp.json();
      if (data.data) {
        data.data.forEach(function(rel) {
          rel.entry.forEach(function(e) {
            var key = e.type.toLowerCase() + "_" + e.mal_id;
            if (!visited[key]) {
              visited[key] = true;
              allEntries.push({ mal_id: e.mal_id, name: e.name, type: e.type.toLowerCase(), relation: rel.relation });
              if (e.type.toLowerCase() === "anime" || e.type.toLowerCase() === "manga") {
                queue.push({ mal_id: e.mal_id, type: e.type.toLowerCase() });
              }
            }
          });
        });
      }
      await new Promise(function(r) { setTimeout(r, 400); });
    } catch (err) { console.log("Crawl error:", err); }
  }

  document.getElementById("universe-loading").style.display = "none";

  var myMalIds = {};
  works.forEach(function(w) { if (w.mal_id) myMalIds[w.type + "_" + w.mal_id] = w; });

  // Auto-assign universe_id
  for (var i = 0; i < allEntries.length; i++) {
    var key = allEntries[i].type + "_" + allEntries[i].mal_id;
    var existing = myMalIds[key];
    if (existing && !existing.universe_id) {
      await sb.from("mv_works").update({ universe_id: work.universe_id }).eq("id", existing.id);
      existing.universe_id = work.universe_id;
    }
  }

  // Filter out already owned
  var unownedEntries = allEntries.filter(function(e) { return !myMalIds[e.type + "_" + e.mal_id]; });

  // Re-render with full group + unowned
  openUniverseGroup(work.universe_id, work.title);
  if (unownedEntries.length > 0) {
    var extraHtml = '<div class="universe-group"><h3 class="universe-group-title">Pas encore dans ma collection</h3><div class="universe-items">';
    unownedEntries.forEach(function(e) {
      var typeBadge = e.type === "anime" ? "アニメ" : "漫画";
      var malUrl = "https://myanimelist.net/" + e.type + "/" + e.mal_id;
      extraHtml += '<div class="universe-item not-owned">' +
        '<div class="universe-item-img-wrap" onclick="onUniverseItemClick(' + e.mal_id + ',\'' + e.type + '\')"><img id="uni-img-' + e.mal_id + '" class="universe-item-img" src="" alt="" style="display:none"><div class="universe-item-placeholder">' + (e.type === "anime" ? "📺" : "📖") + '</div></div>' +
        '<div class="universe-item-info" onclick="onUniverseItemClick(' + e.mal_id + ',\'' + e.type + '\')"><div class="universe-item-title">' + e.name + '</div><div id="uni-en-' + e.mal_id + '" class="universe-item-en"></div><div class="universe-item-meta"><span class="badge badge-' + e.type + ' badge-sm">' + typeBadge + '</span> <span id="uni-year-' + e.mal_id + '"></span><span id="uni-score-' + e.mal_id + '"></span> <span id="uni-eps-' + e.mal_id + '"></span></div></div>' +
        '<div class="universe-item-actions"><a href="' + malUrl + '" target="_blank" class="universe-mal-link" onclick="event.stopPropagation()" title="Voir sur MyAnimeList">MAL ↗</a><div class="universe-item-add" onclick="onUniverseItemClick(' + e.mal_id + ',\'' + e.type + '\')">+</div></div></div>';
    });
    extraHtml += '</div></div>';
    document.getElementById("universe-content").innerHTML += extraHtml;

    // Load images progressively
    for (var i = 0; i < unownedEntries.length; i++) {
      try {
        var e = unownedEntries[i];
        var detResp = await fetch("https://api.jikan.moe/v4/" + e.type + "/" + e.mal_id);
        var detData = await detResp.json();
        if (detData.data && detData.data.images && detData.data.images.jpg) {
          var imgEl = document.getElementById("uni-img-" + e.mal_id);
          if (imgEl) { imgEl.src = detData.data.images.jpg.image_url || ""; imgEl.style.display = "block"; }
          var scoreEl = document.getElementById("uni-score-" + e.mal_id);
          if (scoreEl && detData.data.score) { scoreEl.textContent = "★ " + detData.data.score; }
          var epsEl = document.getElementById("uni-eps-" + e.mal_id);
          if (epsEl) { epsEl.textContent = detData.data.episodes ? detData.data.episodes + " ep." : detData.data.volumes ? detData.data.volumes + " vol." : ""; }
          var enEl = document.getElementById("uni-en-" + e.mal_id);
          if (enEl && detData.data.title_english && detData.data.title_english !== detData.data.title) { enEl.textContent = detData.data.title_english; }
          var yearEl = document.getElementById("uni-year-" + e.mal_id);
          if (yearEl) {
            var yr = detData.data.year || (detData.data.published && detData.data.published.prop && detData.data.published.prop.from ? detData.data.published.prop.from.year : null);
            if (yr) yearEl.textContent = yr + " · ";
          }
        }
        if (i < unownedEntries.length - 1) await new Promise(function(r) { setTimeout(r, 400); });
      } catch (err) { console.log("Detail error:", err); }
    }
  }
}

function renderUniverseList(entries, myMalIds, uniId) {
  var groups = {};
  entries.forEach(function(e) {
    var rel = RELATION_LABELS[e.relation] || e.relation;
    if (!groups[rel]) groups[rel] = [];
    groups[rel].push(e);
  });
  var html = "";
  for (var rel in groups) {
    html += '<div class="universe-group"><h3 class="universe-group-title">' + rel + '</h3><div class="universe-items">';
    groups[rel].forEach(function(e) {
      var key = e.type + "_" + e.mal_id;
      var owned = myMalIds[key];
      var cls = owned ? "universe-item owned" : "universe-item not-owned";
      var typeBadge = e.type === "anime" ? "アニメ" : "漫画";
      var malUrl = "https://myanimelist.net/" + e.type + "/" + e.mal_id;
      if (owned) {
        html += '<div class="' + cls + '">' +
          '<div class="universe-item-img-wrap" onclick="closeUniverse();editWork(\'' + owned.id + '\')"><img id="uni-img-' + e.mal_id + '" class="universe-item-img" src="" alt="" style="display:none"><div class="universe-item-placeholder">' + (e.type === "anime" ? "📺" : "📖") + '</div></div>' +
          '<div class="universe-item-info" onclick="closeUniverse();editWork(\'' + owned.id + '\')"><div class="universe-item-title">' + e.name + '</div><div id="uni-en-' + e.mal_id + '" class="universe-item-en"></div><div class="universe-item-meta"><span class="badge badge-' + e.type + ' badge-sm">' + typeBadge + '</span> <span id="uni-year-' + e.mal_id + '"></span><span id="uni-score-' + e.mal_id + '"></span> <span id="uni-eps-' + e.mal_id + '"></span></div></div>' +
          '<div class="universe-item-actions"><a href="' + malUrl + '" target="_blank" class="universe-mal-link" onclick="event.stopPropagation()" title="Voir sur MyAnimeList">MAL ↗</a><div class="universe-item-check">✓</div></div></div>';
      } else {
        html += '<div class="' + cls + '">' +
          '<div class="universe-item-img-wrap" onclick="onUniverseItemClick(' + e.mal_id + ',\'' + e.type + '\')"><img id="uni-img-' + e.mal_id + '" class="universe-item-img" src="" alt="" style="display:none"><div class="universe-item-placeholder">' + (e.type === "anime" ? "📺" : "📖") + '</div></div>' +
          '<div class="universe-item-info" onclick="onUniverseItemClick(' + e.mal_id + ',\'' + e.type + '\')"><div class="universe-item-title">' + e.name + '</div><div id="uni-en-' + e.mal_id + '" class="universe-item-en"></div><div class="universe-item-meta"><span class="badge badge-' + e.type + ' badge-sm">' + typeBadge + '</span> <span id="uni-year-' + e.mal_id + '"></span><span id="uni-score-' + e.mal_id + '"></span> <span id="uni-eps-' + e.mal_id + '"></span></div></div>' +
          '<div class="universe-item-actions"><a href="' + malUrl + '" target="_blank" class="universe-mal-link" onclick="event.stopPropagation()" title="Voir sur MyAnimeList">MAL ↗</a><div class="universe-item-add" onclick="onUniverseItemClick(' + e.mal_id + ',\'' + e.type + '\')">+</div></div></div>';
      }
    });
    html += '</div></div>';
  }
  document.getElementById("universe-content").innerHTML = html;
}

function onUniverseItemClick(malId, type) {
  closeUniverse();
  // Set universe_id on the form, then fetch and open wizard directly
  if (type === "anime") {
    animeForm.universe_id = currentUniverseId;
    // Fake spinner elements for selectAnime
    document.getElementById("fa-search-results").style.display = "none";
    document.getElementById("fa-search-spinner").style.display = "none";
    selectAnime(malId);
  } else {
    mangaForm.universe_id = currentUniverseId;
    document.getElementById("fm-search-results").style.display = "none";
    document.getElementById("fm-search-spinner").style.display = "none";
    selectManga(malId);
  }
}

function closeUniverse() {
  document.getElementById("modal-universe").style.display = "none";
  renderWorks(); // Refresh grid to show updated groups
}

// ============================================
// COMPLETION MODAL (when marking as terminé)
// ============================================

var completeRating = 7;
var completeType = null;
var completeResolve = null;

function onStatusChange(type) {
  var statusEl = document.getElementById(type === "manga" ? "fm-status" : "fa-status");
  if (statusEl.value === "termine" && editingId) {
    // Auto-fill progress to total
    if (type === "manga") {
      var total = document.getElementById("fm-volumes-vo").value;
      if (total) document.getElementById("fm-volumes").value = total;
    } else {
      var total = document.getElementById("fa-episodes-total").value;
      if (total) document.getElementById("fa-episodes").value = total;
    }
    // Open completion modal
    openCompleteModal(type);
  } else if (statusEl.value === "planifie") {
    // Reset progress to 0
    if (type === "manga") { document.getElementById("fm-volumes").value = "0"; }
    else { document.getElementById("fa-episodes").value = "0"; }
  }
}

function openCompleteModal(type) {
  completeType = type;
  completeRating = 7;
  document.getElementById("complete-notes").value = "";
  buildCompleteStars();
  document.getElementById("modal-complete").style.display = "flex";
}

function buildCompleteStars() {
  var el = document.getElementById("complete-stars");
  el.innerHTML = "";
  for (var i = 1; i <= 10; i++) {
    (function(r) {
      var btn = document.createElement("button");
      btn.textContent = "★";
      btn.className = completeRating >= r ? "active" : "";
      btn.onclick = function() {
        completeRating = r;
        document.getElementById("complete-rating-label").textContent = r + "/10";
        buildCompleteStars();
      };
      el.appendChild(btn);
    })(i);
  }
  document.getElementById("complete-rating-label").textContent = completeRating + "/10";
}

// closeComplete is defined below (rec-aware version)

// ============================================
// WIZARD (step-by-step add after Jikan select)
// ============================================

var wizardData = {};
var wizardRating = 7;

function openWizard(type, jikanData) {
  wizardData = { type: type };
  wizardRating = 7;

  // Build preview
  var img = (jikanData.images && jikanData.images.jpg && jikanData.images.jpg.image_url) || "";
  var title = jikanData.title || "";
  var enTitle = jikanData.title_english || "";
  var meta1 = "", meta2 = "";

  if (type === "manga") {
    var author = (jikanData.authors && jikanData.authors.length > 0) ? reverseAuthorName(jikanData.authors[0].name || "") : "";
    var year = (jikanData.published && jikanData.published.prop && jikanData.published.prop.from && jikanData.published.prop.from.year) ? jikanData.published.prop.from.year : "";
    meta1 = author + (year ? " · " + year : "");
    meta2 = "Score MAL: " + (jikanData.score || "N/A") + " · " + (jikanData.volumes || "?") + " volumes";
    wizardData.totalCount = jikanData.volumes || null;
    wizardData.progressLabel = "volumes lus";
    wizardData.progressUnit = "vol.";
  } else {
    var studio = (jikanData.studios && jikanData.studios.length > 0) ? jikanData.studios[0].name : "";
    var season = jikanData.season ? jikanData.season.charAt(0).toUpperCase() + jikanData.season.slice(1) : "";
    meta1 = studio + (jikanData.year ? " · " + (season ? season + " " : "") + jikanData.year : "");
    meta2 = "Score MAL: " + (jikanData.score || "N/A") + " · " + (jikanData.episodes || "?") + " épisodes" + (jikanData.type ? " · " + jikanData.type : "");
    wizardData.totalCount = jikanData.episodes || null;
    wizardData.progressLabel = "épisodes vus";
    wizardData.progressUnit = "ep.";
  }

  document.getElementById("wizard-header").className = "modal-header-bar " + type;
  document.getElementById("wizard-title").textContent = type === "manga" ? "Ajouter un manga 漫画" : "Ajouter un anime アニメ";

  document.getElementById("wiz-preview").innerHTML =
    '<div class="preview-card">' +
      (img ? '<img src="' + img + '" alt="" class="preview-img">' : '') +
      '<div class="preview-info">' +
        '<div class="preview-title">' + title + '</div>' +
        (enTitle && enTitle !== title ? '<div class="preview-en">' + enTitle + '</div>' : '') +
        '<div class="preview-meta">' + meta1 + '</div>' +
        '<div class="preview-meta">' + meta2 + '</div>' +
      '</div></div>';

  // Reset steps
  document.getElementById("wiz-step-status").style.display = "block";
  document.getElementById("wiz-step-progress").style.display = "none";
  document.getElementById("wiz-step-rating").style.display = "none";
  document.getElementById("wiz-step-notes").style.display = "none";
  document.getElementById("wiz-step-saving").style.display = "none";

  // Reset active status buttons
  var btns = document.querySelectorAll(".wiz-status-btn");
  for (var i = 0; i < btns.length; i++) btns[i].classList.remove("active");

  document.getElementById("modal-wizard").style.display = "flex";
}

function wizSetStatus(status) {
  wizardData.status = status;

  // Highlight selected button
  var btns = document.querySelectorAll(".wiz-status-btn");
  for (var i = 0; i < btns.length; i++) btns[i].classList.remove("active");
  document.querySelector('.wiz-status-btn[data-status="' + status + '"]').classList.add("active");

  // Hide all next steps
  document.getElementById("wiz-step-progress").style.display = "none";
  document.getElementById("wiz-step-rating").style.display = "none";
  document.getElementById("wiz-step-notes").style.display = "none";

  if (status === "termine") {
    // Episodes = total, ask for rating
    wizardData.progress = wizardData.totalCount || 0;
    wizardRating = 7;
    buildWizStars();
    document.getElementById("wiz-step-rating").style.display = "block";
    document.getElementById("wiz-step-rating").scrollIntoView({ behavior: "smooth" });
  } else if (status === "planifie") {
    // 0 progress, no rating, save directly
    wizardData.progress = 0;
    wizSave();
  } else {
    // en_cours, en_pause, abandonne: ask progress
    document.getElementById("wiz-progress-label").textContent = "Combien de " + wizardData.progressLabel + " ?";
    document.getElementById("wiz-progress").value = "";
    document.getElementById("wiz-progress-total").textContent = "/ " + (wizardData.totalCount || "?") + " " + wizardData.progressUnit;
    document.getElementById("wiz-step-progress").style.display = "block";
    document.getElementById("wiz-progress").focus();
    document.getElementById("wiz-step-progress").scrollIntoView({ behavior: "smooth" });
  }
}

function wizAfterProgress() {
  wizardData.progress = parseInt(document.getElementById("wiz-progress").value) || 0;
  wizSave();
}

function buildWizStars() {
  var el = document.getElementById("wiz-stars");
  el.innerHTML = "";
  for (var i = 1; i <= 10; i++) {
    (function(r) {
      var btn = document.createElement("button");
      btn.textContent = "★";
      btn.className = wizardRating >= r ? "active" : "";
      btn.onclick = function() {
        wizardRating = r;
        document.getElementById("wiz-rating-label").textContent = r + "/10";
        buildWizStars();
      };
      el.appendChild(btn);
    })(i);
  }
  document.getElementById("wiz-rating-label").textContent = wizardRating + "/10";
}

function wizAfterRating() {
  // Show notes step
  document.getElementById("wiz-notes").value = "";
  document.getElementById("wiz-step-notes").style.display = "block";
  document.getElementById("wiz-notes").focus();
  document.getElementById("wiz-step-notes").scrollIntoView({ behavior: "smooth" });
}

async function wizSave() {
  document.getElementById("wiz-step-status").style.display = "none";
  document.getElementById("wiz-step-progress").style.display = "none";
  document.getElementById("wiz-step-rating").style.display = "none";
  document.getElementById("wiz-step-notes").style.display = "none";
  document.getElementById("wiz-step-saving").style.display = "block";

  var formObj = wizardData.type === "manga" ? mangaForm : animeForm;
  var payload = {};

  if (wizardData.type === "manga") {
    payload = {
      title: document.getElementById("fm-title").value, type: "manga",
      title_english: formObj.title_english || null,
      author: document.getElementById("fm-author").value || null,
      format: document.getElementById("fm-format").value || null,
      year: parseInt(document.getElementById("fm-year").value) || null,
      publication_status: document.getElementById("fm-pub-status").value || null,
      status: wizardData.status,
      rating: wizardData.status === "termine" ? wizardRating : null,
      genres: formObj.genres,
      volumes_read: wizardData.progress || 0,
      volumes_vo: parseInt(document.getElementById("fm-volumes-vo").value) || null,
      fr_volumes: null, available_fr: false,
      image_url: document.getElementById("fm-image").value || null,
      notes: wizardData.status === "termine" ? (document.getElementById("wiz-notes").value || null) : null,
      mal_id: formObj.mal_id, mal_score: formObj.mal_score,
      universe_id: formObj.universe_id || null,
      user_id: currentUser.id,
    };
  } else {
    payload = {
      title: document.getElementById("fa-title").value, type: "anime",
      title_english: formObj.title_english || null,
      studio: document.getElementById("fa-studio").value || null,
      year: parseInt(document.getElementById("fa-year").value) || null,
      season_name: document.getElementById("fa-season").value || null,
      platform: document.getElementById("fa-platform").value || null,
      status: wizardData.status,
      rating: wizardData.status === "termine" ? wizardRating : null,
      genres: formObj.genres,
      episodes_watched: wizardData.progress || 0,
      episodes_total: parseInt(document.getElementById("fa-episodes-total").value) || null,
      seasons_count: null,
      image_url: document.getElementById("fa-image").value || null,
      notes: wizardData.status === "termine" ? (document.getElementById("wiz-notes").value || null) : null,
      mal_id: formObj.mal_id, mal_score: formObj.mal_score,
      universe_id: formObj.universe_id || null,
      user_id: currentUser.id,
    };
  }

  if (!checkWorksLimit()) {
    document.getElementById("wiz-step-saving").style.display = "none";
    document.getElementById("wiz-step-status").style.display = "block";
    return;
  }

  var result = await sb.from("mv_works").insert(payload).select().single();
  if (result.error) {
    console.error("Save error:", result.error);
    alert("Erreur: " + result.error.message);
    document.getElementById("wiz-step-saving").style.display = "none";
    document.getElementById("wiz-step-status").style.display = "block";
  } else {
    works.unshift(result.data);
    renderStats();
    renderWorks();
    closeWizard();
  }
}

function closeWizard() {
  document.getElementById("modal-wizard").style.display = "none";
  wizardData = {};
}

// ============================================
// STATS
// ============================================

function renderStats() {
  var total = works.length;
  var mangas = works.filter(function(w) { return w.type === "manga"; }).length;
  var animes = works.filter(function(w) { return w.type === "anime"; }).length;
  var rated = works.filter(function(w) { return w.rating; });
  var avg = rated.length ? (rated.reduce(function(s, w) { return s + w.rating; }, 0) / rated.length).toFixed(1) : "—";
  var completed = works.filter(function(w) { return w.status === "termine"; }).length;
  var stats = [
    { icon: "本", value: total, label: "Total" }, { icon: "漫画", value: mangas, label: "Manga" },
    { icon: "アニメ", value: animes, label: "Anime" }, { icon: "評価", value: avg + "★", label: "Note moy." },
    { icon: "完了", value: completed, label: "Terminés" },
  ];
  document.getElementById("stats-bar").innerHTML = stats.map(function(s) {
    return '<div class="stat-card"><div class="kanji">' + s.icon + '</div><div class="value">' + s.value + '</div><div class="label">' + s.label + '</div></div>';
  }).join("");
}

// ============================================
// FILTERS & RENDER
// ============================================

function setFilter(key, value, btn) {
  if (key === "type") { filterType = value; var btns = document.querySelectorAll("#type-filters .filter-btn"); for (var i = 0; i < btns.length; i++) btns[i].classList.remove("active"); btn.classList.add("active"); }
  renderWorks();
}

function renderWorks() {
  var search = document.getElementById("search").value.toLowerCase();
  var statusFilter = document.getElementById("status-filter").value;
  var sortBy = document.getElementById("sort-by").value;
  var filtered = works.filter(function(w) {
    return (filterType === "all" || w.type === filterType) && (statusFilter === "all" ? w.status !== "ignore" : w.status === statusFilter) && w.title.toLowerCase().indexOf(search) >= 0;
  });
  filtered.sort(function(a, b) {
    if (sortBy === "rating") return (b.rating || 0) - (a.rating || 0);
    if (sortBy === "title") return a.title.localeCompare(b.title);
    return new Date(b.created_at) - new Date(a.created_at);
  });

  // Group by universe_id: show oldest work (first added = base work) as representative
  var seenUniverse = {};
  var displayList = [];
  filtered.forEach(function(w) {
    if (w.universe_id) {
      if (!seenUniverse[w.universe_id]) {
        seenUniverse[w.universe_id] = true;
        var groupWorks = works.filter(function(x) { return x.universe_id === w.universe_id; });
        var groupCount = groupWorks.length;
        // Use the oldest (first added) as representative
        var representative = groupWorks.reduce(function(oldest, x) {
          return new Date(x.created_at) < new Date(oldest.created_at) ? x : oldest;
        }, groupWorks[0]);
        displayList.push({ work: representative, groupCount: groupCount });
      }
    } else {
      displayList.push({ work: w, groupCount: 0 });
    }
  });

  var grid = document.getElementById("works-grid");
  var empty = document.getElementById("empty-state");
  if (displayList.length > 0) {
    grid.style.display = "grid"; empty.style.display = "none";
    grid.innerHTML = displayList.map(function(item, i) { return renderCard(item.work, i, item.groupCount); }).join("");
  } else {
    grid.style.display = "none"; empty.style.display = "block";
    empty.innerHTML = works.length === 0 ? '<div class="emoji">📚</div><p>Ta collection est vide</p><p class="sub">Commence par ajouter ton premier manga ou anime !</p>' : '<div class="emoji">🔍</div><p>Aucune œuvre trouvée</p><p class="sub">Essaie de modifier tes filtres</p>';
  }
}

function renderCard(w, i, groupCount) {
  var isManga = w.type === "manga";
  var progress = isManga ? (w.volumes_read || "?") + "/" + (w.volumes_vo || "?") + " vol." : (w.episodes_watched || "?") + "/" + (w.episodes_total || "?") + " ep.";
  var subtitle = "";
  if (isManga) { var p = []; if (w.author) p.push(w.author); if (w.format && FORMAT_LABELS[w.format]) p.push(FORMAT_LABELS[w.format]); if (w.year) p.push(w.year); subtitle = p.join(" · "); }
  else { var p = []; if (w.studio) p.push(w.studio); if (w.year) p.push(w.year); if (w.platform && PLATFORM_LABELS[w.platform]) p.push(PLATFORM_LABELS[w.platform]); subtitle = p.join(" · "); }
  var extraBadges = "";
  if (isManga && w.fr_volumes) { extraBadges = '<span class="badge badge-fr">VF T' + w.fr_volumes + '</span>'; }
  if (groupCount > 1) { extraBadges += '<span class="badge badge-group">' + groupCount + ' œuvres</span>'; }
  var genres = (w.genres || []).slice(0, 3).map(function(g) { return '<span>' + g + '</span>'; }).join("");
  var placeholder = isManga ? "📖" : "📺";
  var image = w.image_url ? '<img class="work-card-image" src="' + w.image_url + '" alt="' + w.title + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' : "";
  var malScoreHtml = (w.mal_score && w.mal_id) ? '<a class="mal-score-link" href="https://myanimelist.net/' + w.type + '/' + w.mal_id + '" target="_blank" onclick="event.stopPropagation()"> · MAL ' + w.mal_score + ' ↗</a>' : w.mal_score ? '<span class="dim"> · MAL ' + w.mal_score + '</span>' : '';
  var hasUniverse = w.universe_id || w.mal_id;
  var cardClick = hasUniverse ? ' onclick="openUniverse(\'' + w.id + '\')"' : '';
  var cardClass = "work-card" + (hasUniverse ? " has-universe" : "");
  var hintText = groupCount > 1 ? "🌐 " + groupCount + " œuvres" : "🌐 Voir l'univers";

  return '<div class="' + cardClass + '" style="animation:slideUp 0.4s ease ' + (i * 0.04) + 's both"' + cardClick + '>' +
    '<div class="work-card-image-wrap">' + image +
      '<div class="work-card-placeholder" style="' + (w.image_url ? 'display:none' : '') + '">' + placeholder + '</div>' +
      '<div class="work-card-gradient"></div>' +
      (hasUniverse ? '<div class="work-card-universe-hint">' + hintText + '</div>' : '') +
      '<div class="work-card-badges"><span class="badge badge-' + w.type + '">' + (isManga ? "漫画" : "アニメ") + '</span><span class="badge badge-status badge-' + w.status + '">' + (STATUS_LABELS[w.status] || w.status) + '</span>' + extraBadges + '</div>' +
      '<div class="work-card-actions"><button class="work-card-action-btn edit" onclick="event.stopPropagation();editWork(\'' + w.id + '\')">✎</button><button class="work-card-action-btn delete" onclick="event.stopPropagation();deleteWork(\'' + w.id + '\')">✕</button></div>' +
      '<div class="work-card-info"><div class="work-card-meta">★ ' + (w.rating || "—") + '/10<span class="dim">· ' + progress + '</span>' + malScoreHtml + '</div><h3 class="work-card-title">' + w.title + '</h3>' + (w.title_english ? '<div class="work-card-title-en">' + w.title_english + '</div>' : '') + (subtitle ? '<div class="work-card-subtitle">' + subtitle + '</div>' : '') + (genres ? '<div class="work-card-genres">' + genres + '</div>' : '') + '</div></div></div>';
}

// ============================================
// STARS & GENRES
// ============================================

function buildStars(containerId, formObj) {
  var el = document.getElementById(containerId); el.innerHTML = "";
  for (var i = 1; i <= 10; i++) { (function(r) { var btn = document.createElement("button"); btn.textContent = "★"; btn.className = formObj.rating >= r ? "active" : ""; btn.onclick = function() { formObj.rating = r; document.getElementById(containerId.replace("stars", "rating-label")).textContent = r + "/10"; buildStars(containerId, formObj); }; el.appendChild(btn); })(i); }
}

function buildGenres(containerId, formObj) {
  document.getElementById(containerId).innerHTML = GENRES.map(function(g) {
    return '<button class="genre-tag ' + (formObj.genres.indexOf(g) >= 0 ? "active" : "") + '" onclick="toggleGenre(\'' + containerId + '\',' + JSON.stringify(g) + ')">' + g + '</button>';
  }).join("");
}

function toggleGenre(containerId, genre) {
  var formObj = containerId.indexOf("fm") === 0 ? mangaForm : animeForm;
  var idx = formObj.genres.indexOf(genre); if (idx >= 0) formObj.genres.splice(idx, 1); else formObj.genres.push(genre);
  buildGenres(containerId, formObj);
}

// ============================================
// MODAL
// ============================================

function openModal(type, work) {
  work = work || null; editingId = work ? work.id : null;
  if (type === "manga") openMangaModal(work); else openAnimeModal(work);
}

function openMangaModal(work) {
  var titleEl = document.getElementById("modal-manga-title");
  var btnEl = document.getElementById("btn-save-manga");
  if (work) {
    titleEl.textContent = "Modifier un manga 漫画"; btnEl.textContent = "Sauvegarder";
    document.getElementById("fm-step-search").style.display = "none";
    document.getElementById("fm-form").style.display = "block";
    document.getElementById("fm-preview").style.display = "none";
    document.getElementById("fm-title").value = work.title || "";
    document.getElementById("fm-author").value = work.author || "";
    document.getElementById("fm-format").value = work.format || "";
    document.getElementById("fm-year").value = work.year || "";
    document.getElementById("fm-pub-status").value = work.publication_status || "en_cours";
    document.getElementById("fm-status").value = work.status || "en_cours";
    document.getElementById("fm-volumes").value = work.volumes_read || "";
    document.getElementById("fm-volumes-vo").value = work.volumes_vo || "";
    document.getElementById("fm-fr-volumes").value = work.fr_volumes || "";
    document.getElementById("fm-image").value = work.image_url || "";
    document.getElementById("fm-notes").value = work.notes || "";
    document.getElementById("fm-vf-status").style.display = "none";
    mangaForm.rating = work.rating || 7; mangaForm.genres = (work.genres || []).slice();
    mangaForm.mal_id = work.mal_id || null; mangaForm.mal_score = work.mal_score || null; mangaForm.universe_id = work.universe_id || null; mangaForm.title_english = work.title_english || null;
  } else {
    titleEl.textContent = "Ajouter un manga 漫画"; btnEl.textContent = "Ajouter";
    document.getElementById("fm-step-search").style.display = "block";
    document.getElementById("fm-form").style.display = "none";
    document.getElementById("fm-vf-status").style.display = "none";
    resetMangaSearch(); mangaForm.rating = 7; mangaForm.genres = [];
  }
  document.getElementById("fm-rating-label").textContent = mangaForm.rating + "/10";
  buildStars("fm-stars", mangaForm); buildGenres("fm-genres", mangaForm);
  document.getElementById("modal-manga").style.display = "flex";
}

function openAnimeModal(work) {
  var titleEl = document.getElementById("modal-anime-title");
  var btnEl = document.getElementById("btn-save-anime");
  if (work) {
    titleEl.textContent = "Modifier un anime アニメ"; btnEl.textContent = "Sauvegarder";
    document.getElementById("fa-step-search").style.display = "none";
    document.getElementById("fa-form").style.display = "block";
    document.getElementById("fa-preview").style.display = "none";
    document.getElementById("fa-title").value = work.title || "";
    document.getElementById("fa-studio").value = work.studio || "";
    document.getElementById("fa-year").value = work.year || "";
    document.getElementById("fa-season").value = work.season_name || "";
    document.getElementById("fa-platform").value = work.platform || "";
    document.getElementById("fa-status").value = work.status || "en_cours";
    document.getElementById("fa-episodes").value = work.episodes_watched || "";
    document.getElementById("fa-episodes-total").value = work.episodes_total || "";
    document.getElementById("fa-seasons").value = work.seasons_count || "";
    document.getElementById("fa-image").value = work.image_url || "";
    document.getElementById("fa-notes").value = work.notes || "";
    animeForm.rating = work.rating || 7; animeForm.genres = (work.genres || []).slice();
    animeForm.mal_id = work.mal_id || null; animeForm.mal_score = work.mal_score || null; animeForm.universe_id = work.universe_id || null; animeForm.title_english = work.title_english || null;
  } else {
    titleEl.textContent = "Ajouter un anime アニメ"; btnEl.textContent = "Ajouter";
    document.getElementById("fa-step-search").style.display = "block";
    document.getElementById("fa-form").style.display = "none";
    resetAnimeSearch(); animeForm.rating = 7; animeForm.genres = [];
  }
  document.getElementById("fa-rating-label").textContent = animeForm.rating + "/10";
  buildStars("fa-stars", animeForm); buildGenres("fa-genres", animeForm);
  document.getElementById("modal-anime").style.display = "flex";
}

function closeModal() {
  document.getElementById("modal-manga").style.display = "none";
  document.getElementById("modal-anime").style.display = "none";
  editingId = null;
}

function editWork(id) { var work = works.find(function(w) { return w.id === id; }); if (work) openModal(work.type, work); }

// ============================================
// CRUD
// ============================================

async function saveWork(type) {
  var payload = {}; var btn;
  if (type === "manga") {
    var title = document.getElementById("fm-title").value.trim(); if (!title) return;
    btn = document.getElementById("btn-save-manga");
    payload = {
      title: title, type: "manga",
      title_english: mangaForm.title_english || null,
      author: document.getElementById("fm-author").value || null,
      format: document.getElementById("fm-format").value || null,
      year: parseInt(document.getElementById("fm-year").value) || null,
      publication_status: document.getElementById("fm-pub-status").value || null,
      status: document.getElementById("fm-status").value,
      rating: document.getElementById("fm-status").value === "termine" ? mangaForm.rating : null, genres: mangaForm.genres,
      volumes_read: parseInt(document.getElementById("fm-volumes").value) || 0,
      volumes_vo: parseInt(document.getElementById("fm-volumes-vo").value) || null,
      fr_volumes: parseInt(document.getElementById("fm-fr-volumes").value) || null,
      available_fr: !!parseInt(document.getElementById("fm-fr-volumes").value),
      image_url: document.getElementById("fm-image").value || null,
      notes: document.getElementById("fm-notes").value || null,
      mal_id: mangaForm.mal_id, mal_score: mangaForm.mal_score, universe_id: mangaForm.universe_id,
    };
  } else {
    var title = document.getElementById("fa-title").value.trim(); if (!title) return;
    btn = document.getElementById("btn-save-anime");
    payload = {
      title: title, type: "anime",
      title_english: animeForm.title_english || null,
      studio: document.getElementById("fa-studio").value || null,
      year: parseInt(document.getElementById("fa-year").value) || null,
      season_name: document.getElementById("fa-season").value || null,
      platform: document.getElementById("fa-platform").value || null,
      status: document.getElementById("fa-status").value,
      rating: document.getElementById("fa-status").value === "termine" ? animeForm.rating : null, genres: animeForm.genres,
      episodes_watched: parseInt(document.getElementById("fa-episodes").value) || 0,
      episodes_total: parseInt(document.getElementById("fa-episodes-total").value) || null,
      seasons_count: parseInt(document.getElementById("fa-seasons").value) || null,
      image_url: document.getElementById("fa-image").value || null,
      notes: document.getElementById("fa-notes").value || null,
      mal_id: animeForm.mal_id, mal_score: animeForm.mal_score, universe_id: animeForm.universe_id,
    };
  }
  btn.disabled = true; btn.textContent = "Sauvegarde...";
  var error;
  if (editingId) {
    var result = await sb.from("mv_works").update(payload).eq("id", editingId).select().single();
    error = result.error;
    if (!error && result.data) works = works.map(function(w) { return w.id === editingId ? result.data : w; });
  } else {
    if (!checkWorksLimit()) { btn.disabled = false; btn.textContent = "Ajouter"; return; }
    payload.user_id = currentUser.id;
    var result = await sb.from("mv_works").insert(payload).select().single();
    error = result.error;
    if (!error && result.data) works.unshift(result.data);
  }
  if (error) { console.error("Save error:", error); alert("Erreur: " + error.message); }
  else { renderStats(); renderWorks(); closeModal(); }
  btn.disabled = false; btn.textContent = editingId ? "Sauvegarder" : "Ajouter";
}

async function deleteWork(id) {
  if (!confirm("Supprimer cette œuvre ?")) return;
  var result = await sb.from("mv_works").delete().eq("id", id);
  if (!result.error) { works = works.filter(function(w) { return w.id !== id; }); renderStats(); renderWorks(); }
}

// ============================================
// AI RECOMMENDATIONS
// ============================================

var recType = null;
var recGenres = [];
var recDebateHistory = [];
var recCurrentResults = [];
var recCardStates = []; // "none" | "planifier" | "dejaVu"
var recDejaVuQueue = [];  // [{rec, jikanData}, ...]
var recDejaVuQueueIdx = 0;
var recCompleteMode = false; // true when modal-complete is used for rec flow

function openRecommendModal() {
  recType = null;
  recGenres = [];
  recCurrentResults = [];
  recCardStates = [];
  document.getElementById("rec-step-type").style.display = "block";
  document.getElementById("rec-step-genres").style.display = "none";
  document.getElementById("rec-step-loading").style.display = "none";
  document.getElementById("rec-step-results").style.display = "none";
  document.getElementById("modal-recommend").style.display = "flex";
}

function closeRecommendModal() {
  document.getElementById("modal-recommend").style.display = "none";
}

function recSetType(type) {
  recType = type;
  recGenres = [];
  var allGenres = {};
  works.filter(function(w) { return w.type === type; }).forEach(function(w) {
    (w.genres || []).forEach(function(g) { allGenres[g] = true; });
  });
  var genreList = Object.keys(allGenres).sort();
  if (genreList.length === 0) genreList = GENRES;
  var container = document.getElementById("rec-genre-tags");
  container.innerHTML = '<button class="rec-genre-tag active" id="rec-genre-any" onclick="recToggleAnyGenre()">Peu importe</button>' +
    genreList.map(function(g) {
      return '<button class="rec-genre-tag" onclick="recToggleGenre(this,\'' + g + '\')">' + g + '</button>';
    }).join("");
  document.getElementById("rec-step-type").style.display = "none";
  document.getElementById("rec-step-genres").style.display = "block";
}

function recBackToType() {
  document.getElementById("rec-step-genres").style.display = "none";
  document.getElementById("rec-step-type").style.display = "block";
}

function recToggleAnyGenre() {
  recGenres = [];
  var tags = document.querySelectorAll(".rec-genre-tag");
  for (var i = 0; i < tags.length; i++) tags[i].classList.remove("active");
  document.getElementById("rec-genre-any").classList.add("active");
}

function recToggleGenre(btn, genre) {
  document.getElementById("rec-genre-any").classList.remove("active");
  var idx = recGenres.indexOf(genre);
  if (idx >= 0) { recGenres.splice(idx, 1); btn.classList.remove("active"); }
  else { recGenres.push(genre); btn.classList.add("active"); }
  if (recGenres.length === 0) document.getElementById("rec-genre-any").classList.add("active");
}

async function fetchRecommendations() {
  if (!checkAiQuota()) return;

  document.getElementById("rec-step-genres").style.display = "none";
  document.getElementById("rec-step-results").style.display = "none";
  document.getElementById("rec-step-loading").style.display = "block";

  var collection = works.filter(function(w) { return w.type === recType && w.status !== "ignore" && w.status !== "planifie"; })
    .map(function(w) { return { title: w.title, rating: w.rating, notes: w.notes, genres: w.genres, status: w.status }; });
  var ignored = works.filter(function(w) { return w.type === recType && w.status === "ignore"; })
    .map(function(w) { return { title: w.title, notes: w.notes }; });
  var planned = works.filter(function(w) { return w.type === recType && w.status === "planifie"; })
    .map(function(w) { return { title: w.title }; });

  // Get auth token for server-side quota check
  var sessionResult = await sb.auth.getSession();
  var authToken = sessionResult.data.session ? "Bearer " + sessionResult.data.session.access_token : null;

  try {
    var resp = await fetch("/api/ai-recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection: collection, ignored: ignored, planned: planned, type: recType, genres: recGenres, messages: [], authToken: authToken }),
    });
    var data = await resp.json();
    if (data.error) throw new Error(data.error);
    var text = data.text.trim().replace(/```json|```/g, "").trim();
    var recommendations = JSON.parse(text);
    recCurrentResults = recommendations;
    recDebateHistory = recommendations.map(function() { return []; });
    recCardStates = recommendations.map(function() { return "none"; });
    renderRecommendations(recommendations);
    // Increment quota counter locally + in DB
    if (currentProfile && currentProfile.plan !== "admin") {
      currentProfile.ai_calls_used = (currentProfile.ai_calls_used || 0) + 1;
      sb.from("mv_profiles").update({ ai_calls_used: currentProfile.ai_calls_used }).eq("id", currentUser.id);
      renderQuota();
    }
    // Load MAL data async after render
    loadRecMalData(recommendations);
  } catch (err) {
    document.getElementById("rec-step-loading").style.display = "none";
    document.getElementById("rec-step-results").style.display = "block";
    document.getElementById("rec-results-list").innerHTML = '<div class="rec-error">Erreur lors de la generation. Reessaie.<br><small>' + err.message + '</small></div>';
  }
}

function renderRecommendations(recommendations) {
  document.getElementById("rec-step-loading").style.display = "none";
  document.getElementById("rec-step-results").style.display = "block";

  var html = recommendations.map(function(rec, idx) {
    var genreTags = (rec.genres || []).map(function(g) { return '<span class="rec-result-genre">' + g + '</span>'; }).join("");
    var sequelBadge = rec.sequel_of ? '<span class="rec-sequel-badge">🔗 Suite de ' + rec.sequel_of + '</span>' : '';
    return '<div class="rec-result-card" id="rec-card-' + idx + '">' +
      '<div class="rec-result-header">' +
        sequelBadge +
        '<div class="rec-result-title-row">' +
          '<span class="rec-result-title">' + rec.title + (rec.year ? ' <span class="rec-result-year">(' + rec.year + ')</span>' : '') + '</span>' +
          '<a class="rec-mal-link" id="rec-mal-link-' + idx + '" href="#" target="_blank" style="display:none">MAL <span id="rec-mal-score-' + idx + '"></span> ↗</a>' +
        '</div>' +
        '<div class="rec-result-genres">' + genreTags + '</div>' +
      '</div>' +
      '<div class="rec-result-explanation">💡 ' + rec.explanation + '</div>' +
      '<div class="rec-result-actions">' +
        '<button class="rec-action-btn" id="rec-btn-plan-' + idx + '" onclick="recToggleState(' + idx + ',\'planifier\')">📋 Planifier</button>' +
        '<button class="rec-action-btn" id="rec-btn-deja-' + idx + '" onclick="recToggleState(' + idx + ',\'dejaVu\')">👁 Déjà vu</button>' +
        '<button class="rec-action-btn" id="rec-btn-pas-' + idx + '" onclick="recTogglePasEnvie(' + idx + ')">🚫 Pas envie</button>' +
        '<button class="rec-action-btn rec-action-debate" id="rec-btn-debate-' + idx + '" onclick="recOpenDebate(' + idx + ')">💬</button>' +
      '</div>' +
      '<div class="rec-pasenvie-area" id="rec-pasenvie-' + idx + '" style="display:none">' +
        '<label class="rec-pasenvie-label">Pourquoi tu n\'as pas envie ?</label>' +
        '<textarea class="modal-input rec-pasenvie-input" id="rec-pasenvie-input-' + idx + '" placeholder="Trop de romance, pas fan du style..."></textarea>' +
        '<div class="rec-pasenvie-actions">' +
          '<button class="btn-cancel" onclick="recCancelPasEnvie(' + idx + ')">Annuler</button>' +
          '<button class="btn-save rec-btn-ai" onclick="recSavePasEnvie(' + idx + ')">Confirmer 🚫</button>' +
        '</div>' +
      '</div>' +
      '<div class="rec-done-overlay" id="rec-done-' + idx + '" style="display:none"></div>' +
      '<div class="rec-debate-area" id="rec-debate-' + idx + '" style="display:none">' +
        '<div class="rec-debate-messages" id="rec-debate-msgs-' + idx + '"></div>' +
        '<div class="rec-debate-input-row">' +
          '<input class="modal-input rec-debate-input" id="rec-debate-input-' + idx + '" placeholder="Dis-moi pourquoi tu n\'es pas convaincu..." onkeydown="if(event.key===\'Enter\')recSendDebate(' + idx + ')">' +
          '<button class="btn-save rec-btn-ai" onclick="recSendDebate(' + idx + ')">Envoyer</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join("");

  document.getElementById("rec-results-list").innerHTML = html;
  updateRecValidateBtn();
}

async function loadRecMalData(recommendations) {
  // Pre-fetch and cache full Jikan data so validation is instant (no Jikan calls at validate time)
  for (var i = 0; i < recommendations.length; i++) {
    try {
      var rec = recommendations[i];
      var idx = i; // capture for closure
      var endpoint = recType === "manga" ? "manga" : "anime";
      // Step 1: search
      var resp = await fetch("https://api.jikan.moe/v4/" + endpoint + "?q=" + encodeURIComponent(rec.title) + "&limit=1");
      var data = await resp.json();
      if (data.data && data.data.length > 0) {
        var item = data.data[0];
        // Update UI: MAL link + score
        var linkEl = document.getElementById("rec-mal-link-" + idx);
        var scoreEl = document.getElementById("rec-mal-score-" + idx);
        if (linkEl) {
          linkEl.href = "https://myanimelist.net/" + endpoint + "/" + item.mal_id;
          linkEl.style.display = "inline-flex";
        }
        if (scoreEl && item.score) scoreEl.textContent = "★" + item.score;
        // Step 2: fetch full details for caching
        await new Promise(function(r) { setTimeout(r, 400); });
        var detResp = await fetch("https://api.jikan.moe/v4/" + endpoint + "/" + item.mal_id + "/full");
        var detData = await detResp.json();
        if (detData.data && recCurrentResults[idx]) {
          recCurrentResults[idx]._jikanFull = detData.data;
          // Update score with full data if available
          if (scoreEl && detData.data.score) scoreEl.textContent = "★" + detData.data.score;
        }
      }
      if (i < recommendations.length - 1) await new Promise(function(r) { setTimeout(r, 400); });
    } catch(e) { console.log("MAL lookup error:", e); }
  }
}

// ---- Card state toggle (Planifier / Déjà vu) ----
function recToggleState(idx, state) {
  // If card is done (pasEnvie saved), ignore
  if (recCardStates[idx] === "pasEnvie") return;

  if (recCardStates[idx] === state) {
    recCardStates[idx] = "none";
  } else {
    recCardStates[idx] = state;
  }
  var card = document.getElementById("rec-card-" + idx);
  var btnPlan = document.getElementById("rec-btn-plan-" + idx);
  var btnDeja = document.getElementById("rec-btn-deja-" + idx);
  btnPlan.classList.toggle("active", recCardStates[idx] === "planifier");
  btnDeja.classList.toggle("active", recCardStates[idx] === "dejaVu");
  card.classList.toggle("rec-card-selected", recCardStates[idx] !== "none");
  updateRecValidateBtn();
}

function updateRecValidateBtn() {
  var count = recCardStates.filter(function(s) { return s === "planifier" || s === "dejaVu"; }).length;
  var btn = document.getElementById("rec-validate-btn");
  if (!btn) return;
  if (count > 0) {
    btn.style.display = "block";
    btn.textContent = "Valider la sélection (" + count + ")";
  } else {
    btn.style.display = "none";
  }
}

// ---- Pas envie inline ----
function recTogglePasEnvie(idx) {
  var area = document.getElementById("rec-pasenvie-" + idx);
  var isOpen = area.style.display !== "none";
  area.style.display = isOpen ? "none" : "block";
  if (!isOpen) document.getElementById("rec-pasenvie-input-" + idx).focus();
}

function recCancelPasEnvie(idx) {
  document.getElementById("rec-pasenvie-" + idx).style.display = "none";
}

async function recSavePasEnvie(idx) {
  var rec = recCurrentResults[idx];
  var reason = document.getElementById("rec-pasenvie-input-" + idx).value.trim();
  var btn = document.querySelector("#rec-card-" + idx + " .rec-btn-ai");
  if (btn) { btn.disabled = true; btn.textContent = "Sauvegarde..."; }

  try {
    var jikanData = rec._jikanFull || null;
    var payload = recBuildPayload(rec, jikanData, "ignore");
    payload.notes = reason || null;
    var result = await sb.from("mv_works").insert(payload).select().single();
    if (result.error) throw new Error(result.error.message);
    works.unshift(result.data);
    renderStats();
    // Mark card as done
    recCardStates[idx] = "pasEnvie";
    recMarkCardDone(idx, "🚫 Ajouté en « Pas envie »");
    document.getElementById("rec-pasenvie-" + idx).style.display = "none";
    updateRecValidateBtn();
  } catch(err) {
    if (btn) { btn.disabled = false; btn.textContent = "Confirmer 🚫"; }
    alert("Erreur: " + err.message);
  }
}

function recMarkCardDone(idx, msg) {
  var card = document.getElementById("rec-card-" + idx);
  if (!card) return;
  card.classList.add("rec-card-done");
  var overlay = document.getElementById("rec-done-" + idx);
  if (overlay) { overlay.style.display = "flex"; overlay.textContent = msg; }
  // Disable action buttons
  ["rec-btn-plan-" + idx, "rec-btn-deja-" + idx, "rec-btn-pas-" + idx, "rec-btn-debate-" + idx].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.disabled = true;
  });
}

// ---- Validate selection ----
async function recValidateSelection() {
  var btn = document.getElementById("rec-validate-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Traitement..."; }

  // 1. Process all "planifier" items — use pre-cached Jikan data, no API calls
  var planIndices = recCardStates.map(function(s, i) { return s === "planifier" ? i : -1; }).filter(function(i) { return i >= 0; });
  for (var pi = 0; pi < planIndices.length; pi++) {
    var idx = planIndices[pi];
    try {
      var rec = recCurrentResults[idx];
      var payload = recBuildPayload(rec, rec._jikanFull || null, "planifie");
      var result = await sb.from("mv_works").insert(payload).select().single();
      if (result.error) throw new Error(result.error.message);
      works.unshift(result.data);
      recMarkCardDone(idx, "📋 Ajouté en Planifié");
      recCardStates[idx] = "done";
    } catch(err) {
      recMarkCardDone(idx, "❌ Erreur: " + err.message);
      recCardStates[idx] = "done";
    }
  }
  if (planIndices.length > 0) { renderStats(); renderWorks(); }

  // 2. Build dejaVu queue — use pre-cached Jikan data, instant (no API calls)
  var dejaIndices = recCardStates.map(function(s, i) { return s === "dejaVu" ? i : -1; }).filter(function(i) { return i >= 0; });
  if (dejaIndices.length === 0) {
    updateRecValidateBtn();
    if (btn) { btn.disabled = false; }
    return;
  }

  recDejaVuQueue = dejaIndices.map(function(idx) {
    return { rec: recCurrentResults[idx], jikanData: recCurrentResults[idx]._jikanFull || null, cardIdx: idx };
  });
  recDejaVuQueueIdx = 0;
  recProcessNextDejaVu();
}

function recProcessNextDejaVu() {
  if (recDejaVuQueueIdx >= recDejaVuQueue.length) {
    // All done — restore recommend modal so user can see results
    recCompleteMode = false;
    renderStats();
    renderWorks();
    document.getElementById("modal-recommend").style.display = "flex";
    updateRecValidateBtn();
    return;
  }

  var item = recDejaVuQueue[recDejaVuQueueIdx];
  recCompleteMode = true;
  completeRating = 7;

  // Hide recommend modal so complete modal is visible (z-index safety)
  document.getElementById("modal-recommend").style.display = "none";

  // Show subtitle in modal
  var subtitleEl = document.getElementById("complete-subtitle");
  if (subtitleEl) {
    subtitleEl.style.display = "block";
    subtitleEl.textContent = item.rec.title + " (" + (recDejaVuQueueIdx + 1) + "/" + recDejaVuQueue.length + ")";
  }

  document.getElementById("complete-notes").value = "";
  buildCompleteStars();
  document.getElementById("modal-complete").style.display = "flex";
}

// Override closeComplete to handle rec queue flow
var _origCloseComplete = null;
function recHandleCompleteClose(confirmed) {
  document.getElementById("modal-complete").style.display = "none";
  var subtitleEl = document.getElementById("complete-subtitle");
  if (subtitleEl) subtitleEl.style.display = "none";

  var item = recDejaVuQueue[recDejaVuQueueIdx];
  if (confirmed) {
    var notes = document.getElementById("complete-notes").value || null;
    var rating = completeRating;
    // Save async, then move to next
    (async function() {
      try {
        var jikanData = item.jikanData;
        var payload = recBuildPayload(item.rec, jikanData, "termine");
        payload.rating = rating;
        payload.notes = notes;
        var result = await sb.from("mv_works").insert(payload).select().single();
        if (result.error) throw new Error(result.error.message);
        works.unshift(result.data);
        recMarkCardDone(item.cardIdx, "✅ Ajouté en Terminé");
        recCardStates[item.cardIdx] = "done";
      } catch(err) {
        recMarkCardDone(item.cardIdx, "❌ Erreur");
        console.error(err);
      }
      recDejaVuQueueIdx++;
      recProcessNextDejaVu();
    })();
  } else {
    // Skip this one
    recDejaVuQueueIdx++;
    recProcessNextDejaVu();
  }
}

// Patch closeComplete to support rec mode
function closeComplete(confirmed) {
  if (recCompleteMode) {
    recHandleCompleteClose(confirmed);
    return;
  }
  // Original logic
  document.getElementById("modal-complete").style.display = "none";
  if (confirmed) {
    var formObj = completeType === "manga" ? mangaForm : animeForm;
    formObj.rating = completeRating;
    var starsId = completeType === "manga" ? "fm-stars" : "fa-stars";
    var labelId = completeType === "manga" ? "fm-rating-label" : "fa-rating-label";
    var notesId = completeType === "manga" ? "fm-notes" : "fa-notes";
    document.getElementById(labelId).textContent = completeRating + "/10";
    document.getElementById(notesId).value = document.getElementById("complete-notes").value;
    buildStars(starsId, formObj);
  } else {
    var statusEl = document.getElementById(completeType === "manga" ? "fm-status" : "fa-status");
    var work = works.find(function(w) { return w.id === editingId; });
    if (work) statusEl.value = work.status;
  }
}

// ---- Jikan helpers for rec ----
async function recFetchJikan(rec) {
  var endpoint = recType === "manga" ? "manga" : "anime";
  // Use stored malId if available from loadRecMalData
  if (rec._malId) {
    var resp = await fetch("https://api.jikan.moe/v4/" + endpoint + "/" + rec._malId + "/full");
    var data = await resp.json();
    return data.data || null;
  }
  // Fallback: search by title
  var resp = await fetch("https://api.jikan.moe/v4/" + endpoint + "?q=" + encodeURIComponent(rec.title) + "&limit=1");
  var data = await resp.json();
  if (!data.data || data.data.length === 0) return null;
  var malId = data.data[0].mal_id;
  await new Promise(function(r) { setTimeout(r, 400); });
  var detResp = await fetch("https://api.jikan.moe/v4/" + endpoint + "/" + malId + "/full");
  var detData = await detResp.json();
  return detData.data || null;
}

function recBuildPayload(rec, d, status) {
  var payload = {
    type: recType,
    title: (d && d.title) || rec.title,
    title_english: (d && d.title_english && d.title_english !== d.title) ? d.title_english : null,
    status: status,
    genres: d ? mapJikanGenres(d) : (rec.genres || []),
    image_url: (d && d.images && d.images.jpg && d.images.jpg.large_image_url) || null,
    mal_id: (d && d.mal_id) || null,
    mal_score: (d && d.score) || null,
    user_id: currentUser.id,
    rating: null,
    notes: null,
  };
  if (recType === "manga") {
    payload.author = (d && d.authors && d.authors.length > 0) ? reverseAuthorName(d.authors[0].name || "") : null;
    payload.year = (d && d.published && d.published.prop && d.published.prop.from) ? d.published.prop.from.year || null : null;
    payload.volumes_vo = (d && d.volumes) || null;
    payload.volumes_read = status === "termine" ? (payload.volumes_vo || 0) : 0;
    var format = "";
    if (d && d.demographics && d.demographics.length > 0) {
      var demo = d.demographics[0].name.toLowerCase();
      if (demo.indexOf("shonen") >= 0 || demo.indexOf("shounen") >= 0) format = "shonen";
      else if (demo.indexOf("seinen") >= 0) format = "seinen";
      else if (demo.indexOf("shojo") >= 0 || demo.indexOf("shoujo") >= 0) format = "shojo";
      else if (demo.indexOf("josei") >= 0) format = "josei";
    }
    payload.format = format;
    payload.publication_status = (d && d.status && d.status.toLowerCase().indexOf("finished") >= 0) ? "termine" : "en_cours";
  } else {
    payload.studio = (d && d.studios && d.studios.length > 0) ? d.studios[0].name : null;
    payload.year = (d && d.year) || null;
    payload.season_name = (d && mapJikanSeason(d.season)) || null;
    payload.platform = (d && mapJikanPlatform(d.streaming)) || null;
    payload.episodes_total = (d && d.episodes) || null;
    payload.episodes_watched = status === "termine" ? (payload.episodes_total || 0) : 0;
  }
  return payload;
}

// ---- Debate ----
function recOpenDebate(idx) {
  var area = document.getElementById("rec-debate-" + idx);
  var isOpen = area.style.display !== "none";
  area.style.display = isOpen ? "none" : "block";
  if (!isOpen) document.getElementById("rec-debate-input-" + idx).focus();
}

async function recSendDebate(idx) {
  var input = document.getElementById("rec-debate-input-" + idx);
  var msg = input.value.trim();
  if (!msg) return;
  input.value = "";
  var rec = recCurrentResults[idx];
  recDebateHistory[idx].push({ role: "assistant", content: JSON.stringify([rec]) });
  recDebateHistory[idx].push({ role: "user", content: msg });
  var msgsEl = document.getElementById("rec-debate-msgs-" + idx);
  msgsEl.innerHTML += '<div class="rec-debate-msg user">' + msg + '</div>';
  msgsEl.innerHTML += '<div class="rec-debate-msg ai thinking">...</div>';
  msgsEl.scrollTop = msgsEl.scrollHeight;

  try {
    var collection = works.filter(function(w) { return w.type === recType && w.status !== "ignore" && w.status !== "planifie"; })
      .map(function(w) { return { title: w.title, rating: w.rating, notes: w.notes, genres: w.genres, status: w.status }; });
    var ignored = works.filter(function(w) { return w.type === recType && w.status === "ignore"; })
      .map(function(w) { return { title: w.title, notes: w.notes }; });
    var planned = works.filter(function(w) { return w.type === recType && w.status === "planifie"; })
      .map(function(w) { return { title: w.title }; });

    var resp = await fetch("/api/ai-recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection: collection, ignored: ignored, planned: planned, type: recType, genres: recGenres, messages: recDebateHistory[idx] }),
    });
    var data = await resp.json();
    if (data.error) throw new Error(data.error);
    var text = data.text.trim().replace(/```json|```/g, "").trim();
    var newRecs;
    try { newRecs = JSON.parse(text); } catch(e) { newRecs = null; }

    var thinking = msgsEl.querySelector(".thinking");
    if (thinking) thinking.remove();

    if (newRecs && Array.isArray(newRecs) && newRecs.length > 0) {
      recCurrentResults[idx] = newRecs[0];
      recDebateHistory[idx].push({ role: "assistant", content: JSON.stringify(newRecs) });
      msgsEl.innerHTML += '<div class="rec-debate-msg ai">Nouvelle proposition ↓</div>';
      var card = document.getElementById("rec-card-" + idx);
      var newRec = newRecs[0];
      var genreTags = (newRec.genres || []).map(function(g) { return '<span class="rec-result-genre">' + g + '</span>'; }).join("");
      card.querySelector(".rec-result-title").innerHTML = newRec.title + (newRec.year ? ' <span class="rec-result-year">(' + newRec.year + ')</span>' : '');
      card.querySelector(".rec-result-genres").innerHTML = genreTags;
      card.querySelector(".rec-result-explanation").innerHTML = "💡 " + newRec.explanation;
      // Update sequel badge
      var seqEl = card.querySelector(".rec-sequel-badge");
      if (newRec.sequel_of) {
        if (!seqEl) card.querySelector(".rec-result-header").insertAdjacentHTML("afterbegin", '<span class="rec-sequel-badge">🔗 Suite de ' + newRec.sequel_of + '</span>');
        else seqEl.textContent = "🔗 Suite de " + newRec.sequel_of;
      } else if (seqEl) seqEl.remove();
      // Reload MAL (resets _jikanFull on new rec)
      newRec._jikanFull = null; // will be re-fetched by loadRecMalData
      loadRecMalData([newRec]);
    } else {
      recDebateHistory[idx].push({ role: "assistant", content: data.text });
      msgsEl.innerHTML += '<div class="rec-debate-msg ai">' + data.text + '</div>';
    }
    msgsEl.scrollTop = msgsEl.scrollHeight;
  } catch(err) {
    var thinking = msgsEl.querySelector(".thinking");
    if (thinking) thinking.innerHTML = "Erreur: " + err.message;
  }
}


// ============================================
// ADMIN
// ============================================

function openAdminModal() {
  document.getElementById("modal-admin").style.display = "flex";
  document.getElementById("admin-table-body").innerHTML = "<tr><td colspan='6' style='text-align:center;padding:24px;color:var(--text-secondary)'>Chargement...</td></tr>";
  document.getElementById("user-dropdown").style.display = "none";
  loadAdminUsers();
}

function closeAdminModal() {
  document.getElementById("modal-admin").style.display = "none";
}

async function loadAdminUsers() {
  var result = await sb.rpc("get_all_profiles");
  if (result.error) {
    document.getElementById("admin-table-body").innerHTML = "<tr><td colspan='6' style='color:#f87171;padding:16px'>Erreur: " + result.error.message + "</td></tr>";
    return;
  }
  var users = result.data || [];
  users.sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });

  var html = users.map(function(u) {
    var planOptions = Object.keys(PLANS).map(function(p) {
      return '<option value="' + p + '"' + (u.plan === p ? " selected" : "") + '>' + PLANS[p].label + '</option>';
    }).join("");
    var resetDate = new Date(u.ai_calls_reset_at);
    var nextReset = new Date(resetDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    var daysLeft = Math.max(0, Math.ceil((nextReset - Date.now()) / (1000 * 60 * 60 * 24)));
    var aiInfo = u.plan === "admin" ? "∞" : (u.ai_calls_used || 0) + "/" + u.ai_calls_limit + " (reset J-" + daysLeft + ")";
    return '<tr>' +
      '<td class="admin-td admin-email">' + (u.email || "—") + '</td>' +
      '<td class="admin-td">' +
        '<select class="admin-plan-select" onchange="adminChangePlan(\'' + u.id + '\', this)">' + planOptions + '</select>' +
      '</td>' +
      '<td class="admin-td admin-center">' + (u.works_count || 0) + ' / ' + (u.works_limit >= 999999 ? "∞" : u.works_limit) + '</td>' +
      '<td class="admin-td admin-center">' + aiInfo + '</td>' +
      '<td class="admin-td admin-center admin-date">' + new Date(u.created_at).toLocaleDateString("fr-FR") + '</td>' +
    '</tr>';
  }).join("");

  document.getElementById("admin-table-body").innerHTML = html || "<tr><td colspan='5' style='text-align:center;padding:24px;color:var(--text-secondary)'>Aucun utilisateur</td></tr>";
  document.getElementById("admin-user-count").textContent = users.length + " utilisateur" + (users.length > 1 ? "s" : "");
}

async function adminChangePlan(userId, selectEl) {
  var newPlan = selectEl.value;
  var plan = PLANS[newPlan];
  if (!plan) return;
  selectEl.disabled = true;
  var result = await sb.rpc("admin_update_profile", {
    target_id: userId,
    new_plan: newPlan,
    new_works_limit: plan.works_limit,
    new_ai_limit: plan.ai_calls_limit
  });
  if (result.error) {
    alert("Erreur: " + result.error.message);
    selectEl.disabled = false;
    return;
  }
  selectEl.disabled = false;
  // Visual feedback
  var row = selectEl.closest("tr");
  row.style.background = "rgba(34,197,94,0.08)";
  setTimeout(function() { row.style.background = ""; }, 1200);
}

// ============================================
// BACKFILL title_english
// ============================================

async function backfillTitleEnglish() {
  var toBackfill = works.filter(function(w) { return w.mal_id && !w.title_english; });
  if (toBackfill.length === 0) { alert("Toutes les oeuvres ont deja un titre anglais !"); return; }
  var btn = document.getElementById("btn-backfill");
  if (btn) { btn.disabled = true; btn.textContent = "Mise a jour... 0/" + toBackfill.length; }
  var updated = 0, errors = 0;
  for (var i = 0; i < toBackfill.length; i++) {
    var w = toBackfill[i];
    try {
      var endpoint = w.type === "manga" ? "manga" : "anime";
      var resp = await fetch("https://api.jikan.moe/v4/" + endpoint + "/" + w.mal_id);
      var data = await resp.json();
      if (data.data && data.data.title_english && data.data.title_english !== data.data.title) {
        var en = data.data.title_english;
        var result = await sb.from("mv_works").update({ title_english: en }).eq("id", w.id);
        if (!result.error) { w.title_english = en; updated++; }
      }
      if (btn) btn.textContent = "Mise a jour... " + (i + 1) + "/" + toBackfill.length;
      if (i < toBackfill.length - 1) await new Promise(function(r) { setTimeout(r, 400); });
    } catch(e) { errors++; console.log("Backfill error:", e); }
  }
  renderWorks();
  if (btn) { btn.disabled = false; btn.textContent = "Traductions ANG"; }
  alert("Termine ! " + updated + " oeuvres mises a jour" + (errors ? ", " + errors + " erreurs." : "."));
}

// CHANGELOG
// ============================================

function openChangelog() { document.getElementById("modal-changelog").style.display = "flex"; }
function closeChangelog() { document.getElementById("modal-changelog").style.display = "none"; }

// ============================================
// INIT
// ============================================

initApp();
