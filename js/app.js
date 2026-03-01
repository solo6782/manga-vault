// ============================================
// MangaVault — Application Logic v2
// ============================================

var GENRES = ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mystery", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Thriller"];
var STATUS_LABELS = {
  en_cours: "En cours", termine: "Terminé", en_pause: "En pause",
  abandonne: "Abandonné", planifie: "Planifié",
};
var FORMAT_LABELS = { shonen: "Shōnen", seinen: "Seinen", shojo: "Shōjo", josei: "Josei" };
var SEASON_LABELS = { hiver: "Hiver", printemps: "Printemps", ete: "Été", automne: "Automne" };
var PLATFORM_LABELS = {
  crunchyroll: "Crunchyroll", netflix: "Netflix", adn: "ADN",
  disney: "Disney+", prime: "Prime Video", hidive: "HIDIVE", autre: "Autre"
};

var currentUser = null;
var works = [];
var editingId = null;
var filterType = "all";

// Form states per type
var mangaForm = { rating: 7, genres: [] };
var animeForm = { rating: 7, genres: [] };

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

async function logout() {
  await sb.auth.signOut();
  window.location.href = "index.html";
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
    ? (w.volumes_read || w.chapters_read || "?") + (w.volumes_read ? " vol." : " ch.")
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

  var frBadge = "";
  if (isManga && w.available_fr) {
    frBadge = '<span class="badge badge-fr">FR' + (w.fr_volumes ? " T" + w.fr_volumes : "") + '</span>';
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
        frBadge +
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
// STARS & GENRES HELPERS
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
        var labelId = containerId.replace("stars", "rating-label");
        document.getElementById(labelId).textContent = r + "/10";
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

function toggleFrField() {
  var checked = document.getElementById("fm-fr").checked;
  document.getElementById("fm-fr-wrap").style.display = checked ? "block" : "none";
}

// ============================================
// MODAL
// ============================================

function openModal(type, work) {
  work = work || null;
  editingId = work ? work.id : null;

  if (type === "manga") {
    openMangaModal(work);
  } else {
    openAnimeModal(work);
  }
}

function openMangaModal(work) {
  var titleEl = document.getElementById("modal-manga-title");
  var btnEl = document.getElementById("btn-save-manga");

  if (work) {
    titleEl.textContent = "Modifier un manga 漫画";
    btnEl.textContent = "Sauvegarder";
    document.getElementById("fm-title").value = work.title || "";
    document.getElementById("fm-author").value = work.author || "";
    document.getElementById("fm-format").value = work.format || "";
    document.getElementById("fm-year").value = work.year || "";
    document.getElementById("fm-pub-status").value = work.publication_status || "en_cours";
    document.getElementById("fm-status").value = work.status || "en_cours";
    document.getElementById("fm-chapters").value = work.chapters_read || "";
    document.getElementById("fm-chapters-total").value = work.chapters_total || "";
    document.getElementById("fm-volumes").value = work.volumes_read || "";
    document.getElementById("fm-volumes-total").value = work.volumes_total || "";
    document.getElementById("fm-fr").checked = !!work.available_fr;
    document.getElementById("fm-fr-wrap").style.display = work.available_fr ? "block" : "none";
    document.getElementById("fm-fr-volumes").value = work.fr_volumes || "";
    document.getElementById("fm-image").value = work.image_url || "";
    document.getElementById("fm-notes").value = work.notes || "";
    mangaForm.rating = work.rating || 7;
    mangaForm.genres = (work.genres || []).slice();
  } else {
    titleEl.textContent = "Ajouter un manga 漫画";
    btnEl.textContent = "Ajouter";
    document.getElementById("fm-title").value = "";
    document.getElementById("fm-author").value = "";
    document.getElementById("fm-format").value = "";
    document.getElementById("fm-year").value = "";
    document.getElementById("fm-pub-status").value = "en_cours";
    document.getElementById("fm-status").value = "en_cours";
    document.getElementById("fm-chapters").value = "";
    document.getElementById("fm-chapters-total").value = "";
    document.getElementById("fm-volumes").value = "";
    document.getElementById("fm-volumes-total").value = "";
    document.getElementById("fm-fr").checked = false;
    document.getElementById("fm-fr-wrap").style.display = "none";
    document.getElementById("fm-fr-volumes").value = "";
    document.getElementById("fm-image").value = "";
    document.getElementById("fm-notes").value = "";
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
      chapters_read: parseInt(document.getElementById("fm-chapters").value) || 0,
      chapters_total: parseInt(document.getElementById("fm-chapters-total").value) || null,
      volumes_read: parseInt(document.getElementById("fm-volumes").value) || 0,
      volumes_total: parseInt(document.getElementById("fm-volumes-total").value) || null,
      available_fr: document.getElementById("fm-fr").checked,
      fr_volumes: parseInt(document.getElementById("fm-fr-volumes").value) || null,
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
    if (!error && result.data) {
      works = works.map(function(w) { return w.id === editingId ? result.data : w; });
    }
  } else {
    payload.user_id = currentUser.id;
    var result = await sb.from("mv_works").insert(payload).select().single();
    error = result.error;
    if (!error && result.data) {
      works.unshift(result.data);
    }
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
