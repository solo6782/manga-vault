// ============================================
// MangaVault — Application Logic v3
// ============================================

var GENRES = ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mystery", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Thriller"];
var STATUS_LABELS = { en_cours: "En cours", termine: "Terminé", en_pause: "En pause", abandonne: "Abandonné", planifie: "Planifié" };
var FORMAT_LABELS = { shonen: "Shōnen", seinen: "Seinen", shojo: "Shōjo", josei: "Josei" };
var SEASON_LABELS = { hiver: "Hiver", printemps: "Printemps", ete: "Été", automne: "Automne" };
var PLATFORM_LABELS = { crunchyroll: "Crunchyroll", netflix: "Netflix", adn: "ADN", disney: "Disney+", prime: "Prime Video", hidive: "HIDIVE", autre: "Autre" };

var currentUser = null;
var works = [];
var editingId = null;
var filterType = "all";
var mangaForm = { rating: 7, genres: [] };
var animeForm = { rating: 7, genres: [] };
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
}

function renderUserInfo() {
  var name = (currentUser.user_metadata && (currentUser.user_metadata.full_name || currentUser.user_metadata.name))
    || (currentUser.email && currentUser.email.split("@")[0]) || "User";
  var avatarUrl = currentUser.user_metadata && currentUser.user_metadata.avatar_url;
  var avatarEl = document.getElementById("user-avatar");
  if (avatarUrl) {
    avatarEl.innerHTML = '<img class="navbar-avatar" src="' + avatarUrl + '" alt="">';
  } else {
    avatarEl.innerHTML = '<div class="navbar-avatar-placeholder">' + name.charAt(0).toUpperCase() + '</div>';
  }
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
// JIKAN API - MANGA SEARCH
// ============================================

function onMangaSearch() {
  var query = document.getElementById("fm-search").value.trim();
  clearTimeout(searchTimeout);
  if (query.length < 2) {
    document.getElementById("fm-search-results").style.display = "none";
    document.getElementById("fm-manual-btn").style.display = "none";
    return;
  }
  document.getElementById("fm-search-spinner").style.display = "block";
  searchTimeout = setTimeout(function() { searchManga(query); }, 500);
}

async function searchManga(query) {
  try {
    var response = await fetch("https://api.jikan.moe/v4/manga?q=" + encodeURIComponent(query) + "&limit=6&order_by=popularity&sort=asc");
    var data = await response.json();
    document.getElementById("fm-search-spinner").style.display = "none";
    if (data.data && data.data.length > 0) {
      renderSearchResults(data.data);
    } else {
      document.getElementById("fm-search-results").innerHTML = '<div class="search-no-results">Aucun résultat. Essaie un autre titre ou passe en saisie manuelle.</div>';
      document.getElementById("fm-search-results").style.display = "block";
    }
    document.getElementById("fm-manual-btn").style.display = "block";
  } catch (err) {
    console.error("Jikan API error:", err);
    document.getElementById("fm-search-spinner").style.display = "none";
    document.getElementById("fm-manual-btn").style.display = "block";
  }
}

function renderSearchResults(results) {
  var container = document.getElementById("fm-search-results");
  container.innerHTML = results.map(function(m) {
    var img = (m.images && m.images.jpg && m.images.jpg.small_image_url) || "";
    var author = (m.authors && m.authors.length > 0) ? m.authors[0].name || "" : "";
    var year = (m.published && m.published.prop && m.published.prop.from) ? m.published.prop.from.year : "";
    var vols = m.volumes || "?";
    var status = m.status || "";
    return '<button class="search-result-item" onclick="selectManga(' + m.mal_id + ')">' +
      '<div class="search-result-img">' + (img ? '<img src="' + img + '" alt="">' : '<span>📖</span>') + '</div>' +
      '<div class="search-result-info">' +
        '<div class="search-result-title">' + (m.title || "") + '</div>' +
        '<div class="search-result-meta">' + (author ? author + ' · ' : '') + (year ? year + ' · ' : '') + vols + ' vol.' + (status ? ' · ' + status : '') + '</div>' +
      '</div></button>';
  }).join("");
  container.style.display = "block";
}

async function selectManga(malId) {
  document.getElementById("fm-search-results").style.display = "none";
  document.getElementById("fm-search-spinner").style.display = "block";

  try {
    var response = await fetch("https://api.jikan.moe/v4/manga/" + malId + "/full");
    var data = await response.json();
    var m = data.data;
    if (!m) return;

    // Title
    document.getElementById("fm-title").value = m.title || "";

    // Year
    document.getElementById("fm-year").value = (m.published && m.published.prop && m.published.prop.from) ? m.published.prop.from.year || "" : "";

    // Volumes VO
    document.getElementById("fm-volumes-vo").value = m.volumes || "";

    // Author (reverse "LastName, FirstName")
    if (m.authors && m.authors.length > 0) {
      var authorName = m.authors[0].name || "";
      var parts = authorName.split(", ");
      if (parts.length === 2) authorName = parts[1] + " " + parts[0];
      document.getElementById("fm-author").value = authorName;
    }

    // Format (demographic)
    var format = "";
    if (m.demographics && m.demographics.length > 0) {
      var demo = m.demographics[0].name.toLowerCase();
      if (demo.indexOf("shonen") >= 0 || demo.indexOf("shounen") >= 0) format = "shonen";
      else if (demo.indexOf("seinen") >= 0) format = "seinen";
      else if (demo.indexOf("shojo") >= 0 || demo.indexOf("shoujo") >= 0) format = "shojo";
      else if (demo.indexOf("josei") >= 0) format = "josei";
    }
    document.getElementById("fm-format").value = format;

    // Publication status
    var pubStatus = "en_cours";
    if (m.status) {
      if (m.status.toLowerCase().indexOf("finished") >= 0) pubStatus = "termine";
      else if (m.status.toLowerCase().indexOf("hiatus") >= 0) pubStatus = "en_pause";
    }
    document.getElementById("fm-pub-status").value = pubStatus;

    // Genres
    mangaForm.genres = [];
    if (m.genres) {
      m.genres.forEach(function(g) {
        var name = g.name;
        if (name === "Science Fiction") name = "Sci-Fi";
        if (GENRES.indexOf(name) >= 0) mangaForm.genres.push(name);
      });
    }
    if (m.themes) {
      m.themes.forEach(function(t) {
        if (GENRES.indexOf(t.name) >= 0 && mangaForm.genres.indexOf(t.name) < 0) mangaForm.genres.push(t.name);
      });
    }

    // Image
    if (m.images && m.images.jpg) {
      document.getElementById("fm-image").value = m.images.jpg.large_image_url || m.images.jpg.image_url || "";
    }

    // Show preview
    showMangaPreview(m);

    // Show form, hide search
    document.getElementById("fm-step-search").style.display = "none";
    document.getElementById("fm-form").style.display = "block";
    buildStars("fm-stars", mangaForm);
    buildGenres("fm-genres", mangaForm);

    // Auto-search VF in background
    setTimeout(function() { searchVF(); }, 300);

  } catch (err) {
    console.error("Jikan detail error:", err);
    alert("Erreur lors de la récupération des détails.");
  }
  document.getElementById("fm-search-spinner").style.display = "none";
}

function showMangaPreview(m) {
  var img = (m.images && m.images.jpg && m.images.jpg.image_url) || "";
  var author = "";
  if (m.authors && m.authors.length > 0) {
    var parts = (m.authors[0].name || "").split(", ");
    author = parts.length === 2 ? parts[1] + " " + parts[0] : parts[0];
  }
  var year = (m.published && m.published.prop && m.published.prop.from && m.published.prop.from.year) ? m.published.prop.from.year : "";

  var preview = document.getElementById("fm-preview");
  preview.innerHTML =
    '<div class="preview-card">' +
      (img ? '<img src="' + img + '" alt="" class="preview-img">' : '') +
      '<div class="preview-info">' +
        '<div class="preview-title">' + (m.title || "") + '</div>' +
        '<div class="preview-meta">' + author + (year ? ' · ' + year : '') + '</div>' +
        '<div class="preview-meta">Score MAL: ' + (m.score || "N/A") + ' · ' + (m.volumes || "?") + ' volumes</div>' +
        '<button class="btn-change-manga" onclick="resetMangaSearch()">Changer ↺</button>' +
      '</div></div>';
  preview.style.display = "block";
}

function showManualMangaForm() {
  document.getElementById("fm-step-search").style.display = "none";
  document.getElementById("fm-form").style.display = "block";
  document.getElementById("fm-preview").style.display = "none";
  buildStars("fm-stars", mangaForm);
  buildGenres("fm-genres", mangaForm);
}

function resetMangaSearch() {
  document.getElementById("fm-step-search").style.display = "block";
  document.getElementById("fm-form").style.display = "none";
  document.getElementById("fm-search").value = "";
  document.getElementById("fm-search-results").style.display = "none";
  document.getElementById("fm-manual-btn").style.display = "none";
  document.getElementById("fm-preview").style.display = "none";
  document.getElementById("fm-title").value = "";
  document.getElementById("fm-author").value = "";
  document.getElementById("fm-format").value = "";
  document.getElementById("fm-year").value = "";
  document.getElementById("fm-pub-status").value = "en_cours";
  document.getElementById("fm-status").value = "en_cours";
  document.getElementById("fm-volumes").value = "";
  document.getElementById("fm-volumes-vo").value = "";
  document.getElementById("fm-fr-volumes").value = "";
  document.getElementById("fm-image").value = "";
  document.getElementById("fm-notes").value = "";
  document.getElementById("fm-vf-status").style.display = "none";
  mangaForm.rating = 7;
  mangaForm.genres = [];
}

// ============================================
// VF SEARCH via Nautiljon (2-step: search → detail)
// ============================================

var CORS_PROXIES = [
  function(url) { return "https://api.allorigins.win/get?url=" + encodeURIComponent(url); },
  function(url) { return "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(url); },
];

async function fetchViaProxy(url) {
  for (var i = 0; i < CORS_PROXIES.length; i++) {
    try {
      var proxyUrl = CORS_PROXIES[i](url);
      var response = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });

      if (!response.ok) continue;

      // allorigins returns { contents: "..." }
      var contentType = response.headers.get("content-type") || "";
      if (contentType.indexOf("json") >= 0) {
        var json = await response.json();
        return json.contents || "";
      }
      // codetabs returns raw HTML
      return await response.text();
    } catch (e) {
      console.log("Proxy " + i + " failed:", e.message);
    }
  }
  return null;
}

async function searchVF() {
  var title = document.getElementById("fm-title").value.trim();
  if (!title) return;

  var statusEl = document.getElementById("fm-vf-status");
  var btn = document.getElementById("fm-vf-btn");
  btn.disabled = true;
  btn.textContent = "⏳";
  statusEl.style.display = "block";
  statusEl.className = "vf-status searching";
  statusEl.innerHTML = "Recherche VF sur Nautiljon...";

  var found = false;

  // Step 1: Search on Nautiljon
  try {
    var searchUrl = "https://www.nautiljon.com/mangas/?q=" + encodeURIComponent(title);
    var searchHtml = await fetchViaProxy(searchUrl);

    if (searchHtml) {
      // Find the first manga detail link in search results
      // Nautiljon links look like: href="/mangas/ge+-+good+ending.html"
      var linkMatch = searchHtml.match(/href="(\/mangas\/[^"]+\.html)"/);

      if (linkMatch && linkMatch[1]) {
        var detailUrl = "https://www.nautiljon.com" + linkMatch[1];
        statusEl.innerHTML = "Lecture de la fiche Nautiljon...";

        // Step 2: Fetch detail page
        var detailHtml = await fetchViaProxy(detailUrl);

        if (detailHtml) {
          // Parse "Nb volumes VF : 16" or "Nb volumes VF : 16 (Terminé)"
          var vfMatch = detailHtml.match(/Nb\s*volumes?\s*VF\s*:\s*(\d+)/i);
          if (vfMatch && vfMatch[1]) {
            var volVF = parseInt(vfMatch[1]);
            document.getElementById("fm-fr-volumes").value = volVF;
            statusEl.innerHTML = '✓ Nautiljon : ' + volVF + ' tomes VF · <a href="' + detailUrl + '" target="_blank">Vérifier ↗</a>';
            statusEl.className = "vf-status success";
            found = true;
          }

          // Bonus: also grab VO count if we didn't have it
          if (!document.getElementById("fm-volumes-vo").value) {
            var voMatch = detailHtml.match(/Nb\s*volumes?\s*VO\s*:\s*(\d+)/i);
            if (voMatch && voMatch[1]) {
              document.getElementById("fm-volumes-vo").value = parseInt(voMatch[1]);
            }
          }
        }
      }
    }
  } catch (err) {
    console.log("Nautiljon search failed:", err);
  }

  // Fallback: direct link to manga-news for manual check
  if (!found) {
    var mnUrl = "https://www.manga-news.com/index.php/recherche?query=" + encodeURIComponent(title);
    var nautUrl = "https://www.nautiljon.com/mangas/?q=" + encodeURIComponent(title);
    statusEl.innerHTML = 'Pas trouvé auto. Vérifie : <a href="' + nautUrl + '" target="_blank">Nautiljon ↗</a> · <a href="' + mnUrl + '" target="_blank">Manga-News ↗</a>';
    statusEl.className = "vf-status not-found";
  }

  btn.disabled = false;
  btn.textContent = "🔍 Chercher";
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
    { icon: "本", value: total, label: "Total" },
    { icon: "漫画", value: mangas, label: "Manga" },
    { icon: "アニメ", value: animes, label: "Anime" },
    { icon: "評価", value: avg + "★", label: "Note moy." },
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
  if (key === "type") {
    filterType = value;
    var btns = document.querySelectorAll("#type-filters .filter-btn");
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove("active");
    btn.classList.add("active");
  }
  renderWorks();
}

function renderWorks() {
  var search = document.getElementById("search").value.toLowerCase();
  var statusFilter = document.getElementById("status-filter").value;
  var sortBy = document.getElementById("sort-by").value;

  var filtered = works.filter(function(w) {
    return (filterType === "all" || w.type === filterType)
      && (statusFilter === "all" || w.status === statusFilter)
      && w.title.toLowerCase().indexOf(search) >= 0;
  });

  filtered.sort(function(a, b) {
    if (sortBy === "rating") return (b.rating || 0) - (a.rating || 0);
    if (sortBy === "title") return a.title.localeCompare(b.title);
    return new Date(b.created_at) - new Date(a.created_at);
  });

  var grid = document.getElementById("works-grid");
  var empty = document.getElementById("empty-state");

  if (filtered.length > 0) {
    grid.style.display = "grid";
    empty.style.display = "none";
    grid.innerHTML = filtered.map(function(w, i) { return renderCard(w, i); }).join("");
  } else {
    grid.style.display = "none";
    empty.style.display = "block";
    empty.innerHTML = works.length === 0
      ? '<div class="emoji">📚</div><p>Ta collection est vide</p><p class="sub">Commence par ajouter ton premier manga ou anime !</p>'
      : '<div class="emoji">🔍</div><p>Aucune œuvre trouvée</p><p class="sub">Essaie de modifier tes filtres</p>';
  }
}

function renderCard(w, i) {
  var isManga = w.type === "manga";
  var progress = isManga
    ? (w.volumes_read || "?") + "/" + (w.volumes_vo || "?") + " vol."
    : (w.episodes_watched || "?") + " ep.";

  var subtitle = "";
  if (isManga) {
    var parts = [];
    if (w.author) parts.push(w.author);
    if (w.format && FORMAT_LABELS[w.format]) parts.push(FORMAT_LABELS[w.format]);
    if (w.year) parts.push(w.year);
    subtitle = parts.join(" · ");
  } else {
    var parts = [];
    if (w.studio) parts.push(w.studio);
    if (w.year) parts.push(w.year);
    if (w.platform && PLATFORM_LABELS[w.platform]) parts.push(PLATFORM_LABELS[w.platform]);
    subtitle = parts.join(" · ");
  }

  var extraBadges = "";
  if (isManga && w.fr_volumes) {
    extraBadges = '<span class="badge badge-fr">VF T' + w.fr_volumes + '</span>';
  }

  var genres = (w.genres || []).slice(0, 3).map(function(g) { return '<span>' + g + '</span>'; }).join("");
  var placeholder = isManga ? "📖" : "📺";
  var image = w.image_url
    ? '<img class="work-card-image" src="' + w.image_url + '" alt="' + w.title + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
    : "";

  return '<div class="work-card" style="animation:slideUp 0.4s ease ' + (i * 0.04) + 's both">' +
    '<div class="work-card-image-wrap">' +
      image +
      '<div class="work-card-placeholder" style="' + (w.image_url ? 'display:none' : '') + '">' + placeholder + '</div>' +
      '<div class="work-card-gradient"></div>' +
      '<div class="work-card-badges">' +
        '<span class="badge badge-' + w.type + '">' + (isManga ? "漫画" : "アニメ") + '</span>' +
        '<span class="badge badge-status badge-' + w.status + '">' + (STATUS_LABELS[w.status] || w.status) + '</span>' +
        extraBadges +
      '</div>' +
      '<div class="work-card-actions">' +
        '<button class="work-card-action-btn edit" onclick="editWork(\'' + w.id + '\')">✎</button>' +
        '<button class="work-card-action-btn delete" onclick="deleteWork(\'' + w.id + '\')">✕</button>' +
      '</div>' +
      '<div class="work-card-info">' +
        '<div class="work-card-meta">★ ' + (w.rating || "—") + '/10<span class="dim">· ' + progress + '</span></div>' +
        '<h3 class="work-card-title">' + w.title + '</h3>' +
        (subtitle ? '<div class="work-card-subtitle">' + subtitle + '</div>' : '') +
        (genres ? '<div class="work-card-genres">' + genres + '</div>' : '') +
      '</div>' +
    '</div></div>';
}

// ============================================
// STARS & GENRES
// ============================================

function buildStars(containerId, formObj) {
  var el = document.getElementById(containerId);
  el.innerHTML = "";
  for (var i = 1; i <= 10; i++) {
    (function(r) {
      var btn = document.createElement("button");
      btn.textContent = "★";
      btn.className = formObj.rating >= r ? "active" : "";
      btn.onclick = function() {
        formObj.rating = r;
        document.getElementById(containerId.replace("stars", "rating-label")).textContent = r + "/10";
        buildStars(containerId, formObj);
      };
      el.appendChild(btn);
    })(i);
  }
}

function buildGenres(containerId, formObj) {
  document.getElementById(containerId).innerHTML = GENRES.map(function(g) {
    return '<button class="genre-tag ' + (formObj.genres.indexOf(g) >= 0 ? "active" : "") +
      '" onclick="toggleGenre(\'' + containerId + '\',' + JSON.stringify(g) + ')">' + g + '</button>';
  }).join("");
}

function toggleGenre(containerId, genre) {
  var formObj = containerId.indexOf("fm") === 0 ? mangaForm : animeForm;
  var idx = formObj.genres.indexOf(genre);
  if (idx >= 0) formObj.genres.splice(idx, 1);
  else formObj.genres.push(genre);
  buildGenres(containerId, formObj);
}

// ============================================
// MODAL
// ============================================

function openModal(type, work) {
  work = work || null;
  editingId = work ? work.id : null;
  if (type === "manga") openMangaModal(work);
  else openAnimeModal(work);
}

function openMangaModal(work) {
  var titleEl = document.getElementById("modal-manga-title");
  var btnEl = document.getElementById("btn-save-manga");

  if (work) {
    titleEl.textContent = "Modifier un manga 漫画";
    btnEl.textContent = "Sauvegarder";
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
    mangaForm.rating = work.rating || 7;
    mangaForm.genres = (work.genres || []).slice();
  } else {
    titleEl.textContent = "Ajouter un manga 漫画";
    btnEl.textContent = "Ajouter";
    document.getElementById("fm-step-search").style.display = "block";
    document.getElementById("fm-form").style.display = "none";
    document.getElementById("fm-vf-status").style.display = "none";
    resetMangaSearch();
    mangaForm.rating = 7;
    mangaForm.genres = [];
  }

  document.getElementById("fm-rating-label").textContent = mangaForm.rating + "/10";
  buildStars("fm-stars", mangaForm);
  buildGenres("fm-genres", mangaForm);
  document.getElementById("modal-manga").style.display = "flex";
}

function openAnimeModal(work) {
  var titleEl = document.getElementById("modal-anime-title");
  var btnEl = document.getElementById("btn-save-anime");

  if (work) {
    titleEl.textContent = "Modifier un anime アニメ";
    btnEl.textContent = "Sauvegarder";
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
    animeForm.rating = work.rating || 7;
    animeForm.genres = (work.genres || []).slice();
  } else {
    titleEl.textContent = "Ajouter un anime アニメ";
    btnEl.textContent = "Ajouter";
    document.getElementById("fa-title").value = "";
    document.getElementById("fa-studio").value = "";
    document.getElementById("fa-year").value = "";
    document.getElementById("fa-season").value = "";
    document.getElementById("fa-platform").value = "";
    document.getElementById("fa-status").value = "en_cours";
    document.getElementById("fa-episodes").value = "";
    document.getElementById("fa-episodes-total").value = "";
    document.getElementById("fa-seasons").value = "";
    document.getElementById("fa-image").value = "";
    document.getElementById("fa-notes").value = "";
    animeForm.rating = 7;
    animeForm.genres = [];
  }

  document.getElementById("fa-rating-label").textContent = animeForm.rating + "/10";
  buildStars("fa-stars", animeForm);
  buildGenres("fa-genres", animeForm);
  document.getElementById("modal-anime").style.display = "flex";
}

function closeModal() {
  document.getElementById("modal-manga").style.display = "none";
  document.getElementById("modal-anime").style.display = "none";
  editingId = null;
}

function editWork(id) {
  var work = works.find(function(w) { return w.id === id; });
  if (work) openModal(work.type, work);
}

// ============================================
// CRUD
// ============================================

async function saveWork(type) {
  var payload = {};
  var btn;

  if (type === "manga") {
    var title = document.getElementById("fm-title").value.trim();
    if (!title) return;
    btn = document.getElementById("btn-save-manga");
    payload = {
      title: title,
      type: "manga",
      author: document.getElementById("fm-author").value || null,
      format: document.getElementById("fm-format").value || null,
      year: parseInt(document.getElementById("fm-year").value) || null,
      publication_status: document.getElementById("fm-pub-status").value || null,
      status: document.getElementById("fm-status").value,
      rating: mangaForm.rating,
      genres: mangaForm.genres,
      volumes_read: parseInt(document.getElementById("fm-volumes").value) || 0,
      volumes_vo: parseInt(document.getElementById("fm-volumes-vo").value) || null,
      fr_volumes: parseInt(document.getElementById("fm-fr-volumes").value) || null,
      available_fr: !!parseInt(document.getElementById("fm-fr-volumes").value),
      image_url: document.getElementById("fm-image").value || null,
      notes: document.getElementById("fm-notes").value || null,
    };
  } else {
    var title = document.getElementById("fa-title").value.trim();
    if (!title) return;
    btn = document.getElementById("btn-save-anime");
    payload = {
      title: title,
      type: "anime",
      studio: document.getElementById("fa-studio").value || null,
      year: parseInt(document.getElementById("fa-year").value) || null,
      season_name: document.getElementById("fa-season").value || null,
      platform: document.getElementById("fa-platform").value || null,
      status: document.getElementById("fa-status").value,
      rating: animeForm.rating,
      genres: animeForm.genres,
      episodes_watched: parseInt(document.getElementById("fa-episodes").value) || 0,
      episodes_total: parseInt(document.getElementById("fa-episodes-total").value) || null,
      seasons_count: parseInt(document.getElementById("fa-seasons").value) || null,
      image_url: document.getElementById("fa-image").value || null,
      notes: document.getElementById("fa-notes").value || null,
    };
  }

  btn.disabled = true;
  btn.textContent = "Sauvegarde...";
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

  if (error) {
    console.error("Save error:", error);
    alert("Erreur: " + error.message);
  } else {
    renderStats();
    renderWorks();
    closeModal();
  }

  btn.disabled = false;
  btn.textContent = editingId ? "Sauvegarder" : "Ajouter";
}

async function deleteWork(id) {
  if (!confirm("Supprimer cette œuvre ?")) return;
  var result = await sb.from("mv_works").delete().eq("id", id);
  if (!result.error) {
    works = works.filter(function(w) { return w.id !== id; });
    renderStats();
    renderWorks();
  }
}

// ============================================
// INIT
// ============================================

initApp();
