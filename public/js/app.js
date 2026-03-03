// ============================================
// MangaVault — Application Logic v5
// ============================================

var GENRES = ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mystery", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Thriller"];
var STATUS_LABELS = { en_cours: "En cours", termine: "Terminé", en_pause: "En pause", abandonne: "Abandonné", planifie: "Planifié" };
var FORMAT_LABELS = { shonen: "Shōnen", seinen: "Seinen", shojo: "Shōjo", josei: "Josei" };
var SEASON_LABELS = { hiver: "Hiver", printemps: "Printemps", ete: "Été", automne: "Automne" };
var PLATFORM_LABELS = { crunchyroll: "Crunchyroll", netflix: "Netflix", adn: "ADN", disney: "Disney+", prime: "Prime Video", hidive: "HIDIVE", autre: "Autre" };
var RELATION_LABELS = { Sequel: "Suite", Prequel: "Préquel", "Alternative setting": "Univers alternatif", "Alternative version": "Version alternative", "Side story": "Histoire parallèle", Summary: "Résumé", "Spin-off": "Spin-off", Other: "Autre", Character: "Personnage", "Full story": "Histoire complète", "Parent story": "Histoire principale" };

var currentUser = null;
var works = [];
var editingId = null;
var filterType = "all";
var mangaForm = { rating: 7, genres: [], mal_id: null, mal_score: null, universe_id: null };
var animeForm = { rating: 7, genres: [], mal_id: null, mal_score: null, universe_id: null };
var searchTimeout = null;

// ============================================
// AUTH
// ============================================

async function initApp() {
  var result = await sb.auth.getSession();
  var session = result.data.session;
  if (!session) { window.location.href = "login.html"; return; }
  currentUser = session.user;
  renderUserInfo();
  await loadWorks();
  document.getElementById("loading").style.display = "none";
  document.getElementById("app").style.display = "block";
  // Auto-update MAL scores in background
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
    var response = await fetch("https://api.jikan.moe/v4/manga?q=" + encodeURIComponent(query) + "&limit=6&order_by=popularity&sort=asc");
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
  mangaForm.rating = 7; mangaForm.genres = []; mangaForm.mal_id = null; mangaForm.mal_score = null; mangaForm.universe_id = null;
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
    var response = await fetch("https://api.jikan.moe/v4/anime?q=" + encodeURIComponent(query) + "&limit=6&order_by=popularity&sort=asc");
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
  animeForm.rating = 7; animeForm.genres = []; animeForm.mal_id = null; animeForm.mal_score = null; animeForm.universe_id = null;
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
    html += '<div class="universe-item owned" onclick="closeUniverse();editWork(\'' + w.id + '\')">' +
      '<div class="universe-item-img-wrap">' +
        (w.image_url ? '<img class="universe-item-img" src="' + w.image_url + '" style="display:block">' : '') +
        '<div class="universe-item-placeholder" style="' + (w.image_url ? 'display:none' : '') + '">' + (w.type === "anime" ? "📺" : "📖") + '</div>' +
      '</div>' +
      '<div class="universe-item-info">' +
        '<div class="universe-item-title">' + w.title + '</div>' +
        '<div class="universe-item-meta"><span class="badge badge-' + w.type + ' badge-sm">' + typeBadge + '</span> ★ ' + (w.rating || "—") + '/10 · ' + progress + '</div>' +
      '</div>' +
      '<div class="universe-item-check">✓</div></div>';
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
      extraHtml += '<div class="universe-item not-owned" onclick="onUniverseItemClick(' + e.mal_id + ',\'' + e.type + '\')">' +
        '<div class="universe-item-img-wrap"><img id="uni-img-' + e.mal_id + '" class="universe-item-img" src="" alt="" style="display:none"><div class="universe-item-placeholder">' + (e.type === "anime" ? "📺" : "📖") + '</div></div>' +
        '<div class="universe-item-info"><div class="universe-item-title">' + e.name + '</div><div class="universe-item-meta"><span class="badge badge-' + e.type + ' badge-sm">' + typeBadge + '</span> <span id="uni-score-' + e.mal_id + '"></span> <span id="uni-eps-' + e.mal_id + '"></span></div></div>' +
        '<div class="universe-item-add">+</div></div>';
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
      var clickAction = owned ? 'onclick="closeUniverse();editWork(\'' + owned.id + '\')"' : 'onclick="onUniverseItemClick(' + e.mal_id + ',\'' + e.type + '\')"';
      html += '<div class="' + cls + '" ' + clickAction + '>' +
        '<div class="universe-item-img-wrap"><img id="uni-img-' + e.mal_id + '" class="universe-item-img" src="" alt="" style="display:none"><div class="universe-item-placeholder">' + (e.type === "anime" ? "📺" : "📖") + '</div></div>' +
        '<div class="universe-item-info"><div class="universe-item-title">' + e.name + '</div><div class="universe-item-meta"><span class="badge badge-' + e.type + ' badge-sm">' + typeBadge + '</span> <span id="uni-score-' + e.mal_id + '"></span> <span id="uni-eps-' + e.mal_id + '"></span></div></div>' +
        (owned ? '<div class="universe-item-check">✓</div>' : '<div class="universe-item-add">+</div>') +
      '</div>';
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
    return (filterType === "all" || w.type === filterType) && (statusFilter === "all" || w.status === statusFilter) && w.title.toLowerCase().indexOf(search) >= 0;
  });
  filtered.sort(function(a, b) {
    if (sortBy === "rating") return (b.rating || 0) - (a.rating || 0);
    if (sortBy === "title") return a.title.localeCompare(b.title);
    return new Date(b.created_at) - new Date(a.created_at);
  });

  // Group by universe_id: only show one card per universe
  var seenUniverse = {};
  var displayList = [];
  filtered.forEach(function(w) {
    if (w.universe_id) {
      if (!seenUniverse[w.universe_id]) {
        seenUniverse[w.universe_id] = true;
        var groupCount = works.filter(function(x) { return x.universe_id === w.universe_id; }).length;
        displayList.push({ work: w, groupCount: groupCount });
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
  var malScoreHtml = w.mal_score ? '<span class="dim"> · MAL ' + w.mal_score + '</span>' : '';
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
      '<div class="work-card-info"><div class="work-card-meta">★ ' + (w.rating || "—") + '/10<span class="dim">· ' + progress + '</span>' + malScoreHtml + '</div><h3 class="work-card-title">' + w.title + '</h3>' + (subtitle ? '<div class="work-card-subtitle">' + subtitle + '</div>' : '') + (genres ? '<div class="work-card-genres">' + genres + '</div>' : '') + '</div></div></div>';
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
    mangaForm.mal_id = work.mal_id || null; mangaForm.mal_score = work.mal_score || null; mangaForm.universe_id = work.universe_id || null;
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
    animeForm.mal_id = work.mal_id || null; animeForm.mal_score = work.mal_score || null; animeForm.universe_id = work.universe_id || null;
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
      author: document.getElementById("fm-author").value || null,
      format: document.getElementById("fm-format").value || null,
      year: parseInt(document.getElementById("fm-year").value) || null,
      publication_status: document.getElementById("fm-pub-status").value || null,
      status: document.getElementById("fm-status").value,
      rating: mangaForm.rating, genres: mangaForm.genres,
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
      studio: document.getElementById("fa-studio").value || null,
      year: parseInt(document.getElementById("fa-year").value) || null,
      season_name: document.getElementById("fa-season").value || null,
      platform: document.getElementById("fa-platform").value || null,
      status: document.getElementById("fa-status").value,
      rating: animeForm.rating, genres: animeForm.genres,
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
// INIT
// ============================================

initApp();
