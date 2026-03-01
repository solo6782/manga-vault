// ============================================
// MangaVault — Application Logic
// ============================================

const GENRES = ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mystery", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Thriller"];
const STATUS_LABELS = {
  en_cours: "En cours", termine: "Terminé", en_pause: "En pause",
  abandonne: "Abandonné", planifie: "Planifié",
};

let currentUser = null;
let works = [];
let editingId = null;
let formState = { type: "manga", rating: 7, genres: [] };
let filterType = "all";

// ============================================
// AUTH
// ============================================

async function initApp() {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    window.location.href = "login.html";
    return;
  }

  currentUser = session.user;
  renderUserInfo();
  await loadWorks();

  document.getElementById("loading").style.display = "none";
  document.getElementById("app").style.display = "block";
}

function renderUserInfo() {
  const name = currentUser.user_metadata?.full_name
    || currentUser.user_metadata?.name
    || currentUser.email?.split("@")[0]
    || "User";

  const avatarUrl = currentUser.user_metadata?.avatar_url;
  const avatarEl = document.getElementById("user-avatar");

  if (avatarUrl) {
    avatarEl.innerHTML = `<img class="navbar-avatar" src="${avatarUrl}" alt="">`;
  } else {
    avatarEl.innerHTML = `<div class="navbar-avatar-placeholder">${name.charAt(0).toUpperCase()}</div>`;
  }

  document.getElementById("user-name").textContent = name;
  document.getElementById("user-email").textContent = currentUser.email;
}

function toggleMenu() {
  const dd = document.getElementById("user-dropdown");
  dd.style.display = dd.style.display === "none" ? "block" : "none";
}

// Fermer le menu si on clique ailleurs
document.addEventListener("click", (e) => {
  if (!e.target.closest(".navbar-user")) {
    document.getElementById("user-dropdown").style.display = "none";
  }
});

async function logout() {
  await supabase.auth.signOut();
  window.location.href = "index.html";
}

// ============================================
// DATA
// ============================================

async function loadWorks() {
  const { data, error } = await supabase
    .from("mv_works")
    .select("*")
    .order("created_at", { ascending: false });

  if (!error) {
    works = data || [];
  }
  renderStats();
  renderWorks();
}

// ============================================
// STATS
// ============================================

function renderStats() {
  const total = works.length;
  const mangas = works.filter(w => w.type === "manga").length;
  const animes = works.filter(w => w.type === "anime").length;
  const rated = works.filter(w => w.rating);
  const avg = rated.length ? (rated.reduce((s, w) => s + w.rating, 0) / rated.length).toFixed(1) : "—";
  const completed = works.filter(w => w.status === "termine").length;

  const stats = [
    { icon: "本", value: total, label: "Total" },
    { icon: "漫画", value: mangas, label: "Manga" },
    { icon: "アニメ", value: animes, label: "Anime" },
    { icon: "評価", value: avg + "★", label: "Note moy." },
    { icon: "完了", value: completed, label: "Terminés" },
  ];

  document.getElementById("stats-bar").innerHTML = stats.map(s => `
    <div class="stat-card">
      <div class="kanji">${s.icon}</div>
      <div class="value">${s.value}</div>
      <div class="label">${s.label}</div>
    </div>
  `).join("");
}

// ============================================
// FILTERS & RENDER
// ============================================

function setFilter(filterKey, value, btn) {
  if (filterKey === "type") {
    filterType = value;
    document.querySelectorAll("#type-filters .filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  }
  renderWorks();
}

function renderWorks() {
  const search = document.getElementById("search").value.toLowerCase();
  const statusFilter = document.getElementById("status-filter").value;
  const sortBy = document.getElementById("sort-by").value;

  let filtered = works
    .filter(w => filterType === "all" || w.type === filterType)
    .filter(w => statusFilter === "all" || w.status === statusFilter)
    .filter(w => w.title.toLowerCase().includes(search));

  filtered.sort((a, b) => {
    if (sortBy === "rating") return (b.rating || 0) - (a.rating || 0);
    if (sortBy === "title") return a.title.localeCompare(b.title);
    return new Date(b.created_at) - new Date(a.created_at);
  });

  const grid = document.getElementById("works-grid");
  const empty = document.getElementById("empty-state");

  if (filtered.length > 0) {
    grid.style.display = "grid";
    empty.style.display = "none";
    grid.innerHTML = filtered.map((w, i) => renderCard(w, i)).join("");
  } else {
    grid.style.display = "none";
    empty.style.display = "block";
    if (works.length === 0) {
      empty.innerHTML = `
        <div class="emoji">📚</div>
        <p>Ta collection est vide</p>
        <p class="sub">Commence par ajouter ton premier manga ou anime !</p>
        <button class="btn-add" onclick="openModal()" style="margin-top:20px;display:inline-flex">
          + Ajouter ma première œuvre
        </button>
      `;
    } else {
      empty.innerHTML = `
        <div class="emoji">🔍</div>
        <p>Aucune œuvre trouvée</p>
        <p class="sub">Essaie de modifier tes filtres</p>
      `;
    }
  }
}

function renderCard(w, i) {
  const progress = w.type === "manga"
    ? `${w.chapters_read || "?"} ch.`
    : `${w.episodes_watched || "?"} ep.`;

  const genres = (w.genres || []).slice(0, 3).map(g => `<span>${g}</span>`).join("");
  const placeholder = w.type === "manga" ? "📖" : "📺";

  const image = w.image_url
    ? `<img class="work-card-image" src="${w.image_url}" alt="${w.title}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : "";

  return `
    <div class="work-card" style="animation:slideUp 0.4s ease ${i * 0.04}s both">
      <div class="work-card-image-wrap">
        ${image}
        <div class="work-card-placeholder" style="${w.image_url ? 'display:none' : ''}">${placeholder}</div>
        <div class="work-card-gradient"></div>
        <div class="work-card-badges">
          <span class="badge badge-${w.type}">${w.type === "manga" ? "漫画" : "アニメ"}</span>
          <span class="badge badge-status badge-${w.status}">${STATUS_LABELS[w.status] || w.status}</span>
        </div>
        <div class="work-card-actions">
          <button class="work-card-action-btn edit" onclick="editWork('${w.id}')">✎</button>
          <button class="work-card-action-btn delete" onclick="deleteWork('${w.id}')">✕</button>
        </div>
        <div class="work-card-info">
          <div class="work-card-meta">
            ★ ${w.rating || "—"}/10
            <span class="dim">· ${progress}</span>
          </div>
          <h3 class="work-card-title">${w.title}</h3>
          ${genres ? `<div class="work-card-genres">${genres}</div>` : ""}
        </div>
      </div>
    </div>
  `;
}

// ============================================
// MODAL
// ============================================

function initModalWidgets() {
  // Stars
  const starContainer = document.getElementById("star-rating");
  starContainer.innerHTML = "";
  for (let i = 1; i <= 10; i++) {
    const btn = document.createElement("button");
    btn.textContent = "★";
    btn.className = formState.rating >= i ? "active" : "";
    btn.onclick = () => {
      formState.rating = i;
      document.getElementById("rating-label").textContent = i + "/10";
      initModalWidgets();
    };
    starContainer.appendChild(btn);
  }

  // Genres
  const genreContainer = document.getElementById("genre-tags");
  genreContainer.innerHTML = GENRES.map(g => `
    <button class="genre-tag ${formState.genres.includes(g) ? "active" : ""}"
      onclick="toggleGenre('${g}')">${g}</button>
  `).join("");

  // Progress fields
  updateProgressFields();
}

function updateProgressFields() {
  const container = document.getElementById("progress-fields");
  if (formState.type === "manga") {
    container.innerHTML = `
      <div>
        <label class="modal-label">Chapitres lus</label>
        <input class="modal-input" type="number" id="f-progress" placeholder="0" value="${document.getElementById("f-progress")?.value || ""}">
      </div>
      <div>
        <label class="modal-label">Chapitres total</label>
        <input class="modal-input" type="number" id="f-total" placeholder="?" value="${document.getElementById("f-total")?.value || ""}">
      </div>
    `;
  } else {
    container.innerHTML = `
      <div>
        <label class="modal-label">Épisodes vus</label>
        <input class="modal-input" type="number" id="f-progress" placeholder="0" value="${document.getElementById("f-progress")?.value || ""}">
      </div>
      <div>
        <label class="modal-label">Épisodes total</label>
        <input class="modal-input" type="number" id="f-total" placeholder="?" value="${document.getElementById("f-total")?.value || ""}">
      </div>
    `;
  }
}

function setType(type) {
  formState.type = type;
  document.getElementById("f-type-manga").className = "type-btn" + (type === "manga" ? " active-manga" : "");
  document.getElementById("f-type-anime").className = "type-btn" + (type === "anime" ? " active-anime" : "");
  updateProgressFields();
}

function toggleGenre(genre) {
  const idx = formState.genres.indexOf(genre);
  if (idx >= 0) formState.genres.splice(idx, 1);
  else formState.genres.push(genre);
  initModalWidgets();
}

function openModal(work = null) {
  editingId = work ? work.id : null;

  if (work) {
    document.getElementById("modal-title").textContent = "Modifier une œuvre";
    document.getElementById("btn-save").textContent = "Sauvegarder";
    document.getElementById("f-title").value = work.title || "";
    document.getElementById("f-status").value = work.status || "en_cours";
    document.getElementById("f-image").value = work.image_url || "";
    document.getElementById("f-notes").value = work.notes || "";
    formState.type = work.type || "manga";
    formState.rating = work.rating || 7;
    formState.genres = [...(work.genres || [])];
  } else {
    document.getElementById("modal-title").textContent = "Ajouter une œuvre";
    document.getElementById("btn-save").textContent = "Ajouter";
    document.getElementById("f-title").value = "";
    document.getElementById("f-status").value = "en_cours";
    document.getElementById("f-image").value = "";
    document.getElementById("f-notes").value = "";
    formState.type = "manga";
    formState.rating = 7;
    formState.genres = [];
  }

  setType(formState.type);
  document.getElementById("rating-label").textContent = formState.rating + "/10";
  initModalWidgets();

  // Set progress values after fields are created
  if (work) {
    const progressEl = document.getElementById("f-progress");
    const totalEl = document.getElementById("f-total");
    if (work.type === "manga") {
      if (progressEl) progressEl.value = work.chapters_read || "";
      if (totalEl) totalEl.value = work.chapters_total || "";
    } else {
      if (progressEl) progressEl.value = work.episodes_watched || "";
      if (totalEl) totalEl.value = work.episodes_total || "";
    }
  }

  document.getElementById("modal-overlay").style.display = "flex";
}

function closeModal() {
  document.getElementById("modal-overlay").style.display = "none";
  editingId = null;
}

function editWork(id) {
  const work = works.find(w => w.id === id);
  if (work) openModal(work);
}

// ============================================
// CRUD
// ============================================

async function saveWork() {
  const title = document.getElementById("f-title").value.trim();
  if (!title) return;

  const btn = document.getElementById("btn-save");
  btn.disabled = true;
  btn.textContent = "Sauvegarde...";

  const progress = parseInt(document.getElementById("f-progress")?.value) || 0;
  const total = parseInt(document.getElementById("f-total")?.value) || null;

  const payload = {
    title,
    type: formState.type,
    status: document.getElementById("f-status").value,
    rating: formState.rating,
    genres: formState.genres,
    image_url: document.getElementById("f-image").value || null,
    notes: document.getElementById("f-notes").value || null,
    chapters_read: formState.type === "manga" ? progress : 0,
    chapters_total: formState.type === "manga" ? total : null,
    episodes_watched: formState.type === "anime" ? progress : 0,
    episodes_total: formState.type === "anime" ? total : null,
  };

  let error;

  if (editingId) {
    const result = await supabase
      .from("mv_works")
      .update(payload)
      .eq("id", editingId)
      .select()
      .single();
    error = result.error;
    if (!error && result.data) {
      works = works.map(w => w.id === editingId ? result.data : w);
    }
  } else {
    payload.user_id = currentUser.id;
    const result = await supabase
      .from("mv_works")
      .insert(payload)
      .select()
      .single();
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

  const { error } = await supabase
    .from("mv_works")
    .delete()
    .eq("id", id);

  if (!error) {
    works = works.filter(w => w.id !== id);
    renderStats();
    renderWorks();
  }
}

// ============================================
// INIT
// ============================================

initApp();
