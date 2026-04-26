/* global document, window */

const STORAGE_KEY = "playlist-management:tags:v1";
const STATIC_SONGS_URL = "./songs.json";
const STATIC_TAGS_URL = "./tags.json";
const STATIC_NEWSONGS_URL = "./newsongs.json";
const STATIC_SONGBOT_URL = "./songbot.json";

function formatYMD(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function ensureDailyVersionInUrl() {
  try {
    if (window.location.protocol === "file:") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("v")) return;
    const today = formatYMD(new Date());
    url.searchParams.set("v", today);
    // Avoid infinite loops if a browser strips query params.
    if (window.sessionStorage.getItem("pm:autov:done") === today) return;
    window.sessionStorage.setItem("pm:autov:done", today);
    window.location.replace(url.toString());
  } catch {
    // ignore
  }
}

function normalizeStr(s) {
  return (s ?? "").toString().trim();
}

function songKey(song) {
  return `${normalizeStr(song.name)}\u0000${normalizeStr(song.artist)}`.toLowerCase();
}

function parseTSV(text) {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  const out = [];
  for (const line of lines) {
    const cols = line.split("\t");
    if (cols.length < 3) continue;
    const [name, artist, playlist] = cols.map((c) => normalizeStr(c));
    if (!name || !artist || !playlist) continue;
    if (name === "歌曲名" && artist === "歌手" && playlist === "所属歌单") continue;
    out.push({ name, artist, playlist });
  }
  return out;
}

function loadTagStore() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return {};
    return obj;
  } catch {
    return {};
  }
}

function saveTagStore(store) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function mergeTagStores(base, incoming, { preferIncoming = false } = {}) {
  const out = { ...(base ?? {}) };
  if (!incoming || typeof incoming !== "object") return out;

  for (const [k, v] of Object.entries(incoming)) {
    const tags = Array.isArray(v?.tags) ? v.tags : Array.isArray(v) ? v : null;
    if (!tags) continue;
    const updatedAt = typeof v?.updatedAt === "number" ? v.updatedAt : 0;

    if (!out[k]) {
      out[k] = { tags, updatedAt };
      continue;
    }
    if (preferIncoming) {
      out[k] = { tags, updatedAt };
      continue;
    }
    const prevUpdated = typeof out[k]?.updatedAt === "number" ? out[k].updatedAt : 0;
    if (updatedAt > prevUpdated) out[k] = { tags, updatedAt };
  }
  return out;
}

function splitTags(text) {
  const s = normalizeStr(text);
  if (!s) return [];
  const parts = s
    .split(/[，,]/g)
    .map((p) => normalizeStr(p))
    .filter(Boolean);
  const seen = new Set();
  const tags = [];
  for (const t of parts) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(t);
  }
  return tags;
}

function tagsToString(tags) {
  return (tags ?? []).join(", ");
}

function uniqSorted(arr) {
  const set = new Set(arr.filter(Boolean));
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

const els = {
  notice: document.getElementById("notice"),
  navLibrary: document.getElementById("navLibrary"),
  navWeekly: document.getElementById("navWeekly"),
  navDashboard: document.getElementById("navDashboard"),

  sidebar: document.getElementById("sidebar"),
  sidebarToggle: document.getElementById("sidebarToggle"),
  sidebarBackdrop: document.getElementById("sidebarBackdrop"),

  libraryView: document.getElementById("libraryView"),
  weeklyView: document.getElementById("weeklyView"),
  dashboardView: document.getElementById("dashboardView"),

  dashboardSubtitle: document.getElementById("dashboardSubtitle"),
  chartTopTags: document.getElementById("chartTopTags"),
  chartTagRadar: document.getElementById("chartTagRadar"),
  chartAddWeek: document.getElementById("chartAddWeek"),
  chartHeatTop: document.getElementById("chartHeatTop"),
  heatNote: document.getElementById("heatNote"),
  commentSearch: document.getElementById("commentSearch"),
  commentRefresh: document.getElementById("commentRefresh"),
  commentList: document.getElementById("commentList"),

  weeklySubtitle: document.getElementById("weeklySubtitle"),
  weeklyGrid: document.getElementById("weeklyGrid"),

  playlistList: document.getElementById("playlistList"),
  genreChips: document.getElementById("genreChips"),
  searchInput: document.getElementById("searchInput"),
  onlyUntagged: document.getElementById("onlyUntagged"),
  sortSelect: document.getElementById("sortSelect"),
  stats: document.getElementById("stats"),

  currentTitle: document.getElementById("currentTitle"),
  currentSubtitle: document.getElementById("currentSubtitle"),
  songTbody: document.getElementById("songTbody"),

  tagDialog: document.getElementById("tagDialog"),
  dialogSongInfo: document.getElementById("dialogSongInfo"),
  tagInput: document.getElementById("tagInput"),
  saveTagsBtn: document.getElementById("saveTagsBtn"),
  suggestJpopBtn: document.getElementById("suggestJpopBtn"),
  suggestAnimeBtn: document.getElementById("suggestAnimeBtn"),
  suggestVocaloidBtn: document.getElementById("suggestVocaloidBtn"),
  suggestGameBtn: document.getElementById("suggestGameBtn"),
  suggestInstrumentalBtn: document.getElementById("suggestInstrumentalBtn"),

  imageDialog: document.getElementById("imageDialog"),
  imageDialogSubtitle: document.getElementById("imageDialogSubtitle"),
  imageDialogImg: document.getElementById("imageDialogImg"),
};

const state = {
  view: "library", // library | weekly | dashboard
  songs: [],
  playlists: [],
  selectedPlaylist: "__ALL__",
  search: "",
  onlyUntagged: false,
  sort: "playlist:asc",
  selectedGenres: new Set(),
  tagStore: loadTagStore(),
  staticTagStore: null,
  weeklyImages: [],
  songbot: null,
  editingSongKey: null,
  charts: {
    topTags: null,
    tagRadar: null,
    addWeek: null,
    heatTop: null,
  },
  commentNonce: 0,
};

function getSongTags(song) {
  const rec = state.tagStore[songKey(song)];
  return Array.isArray(rec?.tags) ? rec.tags : [];
}

function getUpdatedAt(song) {
  const rec = state.tagStore[songKey(song)];
  return typeof rec?.updatedAt === "number" ? rec.updatedAt : 0;
}

function sortSongs(list) {
  const raw = normalizeStr(state.sort || "playlist:asc");
  const [key, dirRaw] = raw.split(":");
  const dir = dirRaw === "desc" ? "desc" : "asc";
  const mul = dir === "desc" ? -1 : 1;
  const cmpText = (a, b) => a.localeCompare(b, "zh-Hans-CN");

  const decorated = list.map((s, idx) => ({ s, idx }));
  decorated.sort((A, B) => {
    const a = A.s;
    const b = B.s;

    let r = 0;
    if (key === "name") r = cmpText(a.name, b.name);
    else if (key === "artist") r = cmpText(a.artist, b.artist);
    else if (key === "playlist") r = cmpText(a.playlist, b.playlist);
    else if (key === "tags") r = getSongTags(a).length - getSongTags(b).length;
    else if (key === "updated") r = getUpdatedAt(a) - getUpdatedAt(b);
    else r = cmpText(a.playlist, b.playlist);

    if (r !== 0) return r * mul;
    return A.idx - B.idx;
  });
  return decorated.map((x) => x.s);
}

function setSongTags(song, tags) {
  const k = songKey(song);
  if (!tags || tags.length === 0) {
    delete state.tagStore[k];
  } else {
    state.tagStore[k] = { tags, updatedAt: Date.now() };
  }
  saveTagStore(state.tagStore);
}

function computePlaylists(songs) {
  const map = new Map();
  for (const s of songs) {
    map.set(s.playlist, (map.get(s.playlist) ?? 0) + 1);
  }
  const items = Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
  return items;
}

function computeAllGenres() {
  const all = [];
  for (const s of state.songs) {
    for (const t of getSongTags(s)) all.push(t);
  }
  return uniqSorted(all);
}

function normalizeSongbotPayload(p) {
  if (!p || typeof p !== "object") return null;
  return {
    library: Array.isArray(p.library) ? p.library : [],
    reactions: Array.isArray(p.reactions) ? p.reactions : [],
    comments: Array.isArray(p.comments) ? p.comments : [],
    emojiWeights: p.emojiWeights && typeof p.emojiWeights === "object" ? p.emojiWeights : null,
    version: p.version,
    source: p.source,
    generatedAt: p.generatedAt,
  };
}

function matchesFilters(song) {
  if (state.selectedPlaylist !== "__ALL__" && song.playlist !== state.selectedPlaylist) return false;

  const tags = getSongTags(song);
  if (state.onlyUntagged && tags.length > 0) return false;

  const q = normalizeStr(state.search).toLowerCase();
  if (q) {
    const hay = [
      song.name,
      song.artist,
      song.playlist,
      tagsToString(tags),
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }

  if (state.selectedGenres.size > 0) {
    const tagSet = new Set(tags.map((t) => t.toLowerCase()));
    for (const g of state.selectedGenres) {
      if (!tagSet.has(g.toLowerCase())) return false;
    }
  }

  return true;
}

function renderPlaylists() {
  if (state.songs.length === 0) {
    els.playlistList.innerHTML = `<div class="muted">请先导入 \`songs.txt\`</div>`;
    return;
  }

  const total = state.songs.length;
  const playlists = state.playlists;

  const frag = document.createDocumentFragment();

  const allItem = document.createElement("div");
  allItem.className = "playlist-item";
  allItem.setAttribute("role", "button");
  allItem.setAttribute("tabindex", "0");
  allItem.setAttribute("aria-selected", state.selectedPlaylist === "__ALL__" ? "true" : "false");
  allItem.innerHTML = `<div>全部</div><div class="pill">${total}</div>`;
  allItem.addEventListener("click", () => {
    state.selectedPlaylist = "__ALL__";
    renderAll();
  });
  frag.appendChild(allItem);

  for (const p of playlists) {
    const el = document.createElement("div");
    el.className = "playlist-item";
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-selected", state.selectedPlaylist === p.name ? "true" : "false");
    el.innerHTML = `<div>${escapeHtml(p.name)}</div><div class="pill">${p.count}</div>`;
    el.addEventListener("click", () => {
      state.selectedPlaylist = p.name;
      renderAll();
    });
    frag.appendChild(el);
  }

  els.playlistList.innerHTML = "";
  els.playlistList.appendChild(frag);
}

function renderGenreChips() {
  const genres = computeAllGenres();
  els.genreChips.innerHTML = "";
  if (genres.length === 0) {
    els.genreChips.innerHTML = `<div class="muted">暂无标签（先给歌曲打标签）</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  for (const g of genres) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = g;
    chip.setAttribute("aria-pressed", state.selectedGenres.has(g) ? "true" : "false");
    chip.addEventListener("click", () => {
      if (state.selectedGenres.has(g)) state.selectedGenres.delete(g);
      else state.selectedGenres.add(g);
      renderAll();
    });
    frag.appendChild(chip);
  }
  els.genreChips.appendChild(frag);
}

function renderHeader(filteredCount) {
  if (state.songs.length === 0) {
    els.currentTitle.textContent = "未导入";
    els.currentSubtitle.textContent = "";
    return;
  }
  const title = state.selectedPlaylist === "__ALL__" ? "全部歌曲" : state.selectedPlaylist;
  els.currentTitle.textContent = title;

  const parts = [];
  parts.push(`共 ${state.songs.length} 首`);
  if (state.selectedPlaylist !== "__ALL__") {
    const p = state.playlists.find((x) => x.name === state.selectedPlaylist);
    if (p) parts.push(`本歌单 ${p.count} 首`);
  }
  parts.push(`当前显示 ${filteredCount} 首`);
  if (state.selectedGenres.size > 0) parts.push(`标签筛选：${Array.from(state.selectedGenres).join(" + ")}`);
  els.currentSubtitle.textContent = parts.join(" · ");
}

function renderStats(filteredSongs) {
  if (state.songs.length === 0) {
    els.stats.textContent = "";
    return;
  }
  const tagged = filteredSongs.filter((s) => getSongTags(s).length > 0).length;
  const untagged = filteredSongs.length - tagged;

  const artists = new Set(filteredSongs.map((s) => s.artist)).size;
  const playlists = new Set(filteredSongs.map((s) => s.playlist)).size;

  els.stats.textContent =
    `当前范围：歌手 ${artists} 位 · 歌单 ${playlists} 个\n` +
    `标签：已标 ${tagged} · 未标 ${untagged}`;
}

function renderSongs() {
  if (state.songs.length === 0) {
    els.songTbody.innerHTML = `<tr><td colspan="4" class="muted">导入 \`songs.txt\` 后会显示列表。</td></tr>`;
    return { filtered: [] };
  }

  const filtered = sortSongs(state.songs.filter(matchesFilters));
  renderHeader(filtered.length);
  renderStats(filtered);

  if (filtered.length === 0) {
    els.songTbody.innerHTML = `<tr><td colspan="4" class="muted">没有匹配的歌曲（可尝试清空搜索/筛选）。</td></tr>`;
    return { filtered };
  }

  const frag = document.createDocumentFragment();
  for (const s of filtered) {
    const tr = document.createElement("tr");

    const tdName = document.createElement("td");
    tdName.textContent = s.name;
    tr.appendChild(tdName);

    const tdArtist = document.createElement("td");
    tdArtist.textContent = s.artist;
    tr.appendChild(tdArtist);

    const tdPlaylist = document.createElement("td");
    tdPlaylist.textContent = s.playlist;
    tr.appendChild(tdPlaylist);

    const tdTags = document.createElement("td");
    const wrap = document.createElement("div");
    wrap.className = "tags";
    const tags = getSongTags(s);
    if (tags.length === 0) {
      const empty = document.createElement("span");
      empty.className = "tag tag--empty";
      empty.textContent = "未标注";
      wrap.appendChild(empty);
    } else {
      for (const t of tags) {
        const span = document.createElement("span");
        span.className = "tag";
        span.textContent = t;
        wrap.appendChild(span);
      }
    }

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "tag-action";
    editBtn.textContent = "编辑";
    editBtn.addEventListener("click", () => openTagDialog(s));
    wrap.appendChild(editBtn);

    tdTags.appendChild(wrap);
    tr.appendChild(tdTags);

    frag.appendChild(tr);
  }

  els.songTbody.innerHTML = "";
  els.songTbody.appendChild(frag);
  return { filtered };
}

function enableUI() {
  els.searchInput.disabled = false;
  els.onlyUntagged.disabled = false;
  if (els.sortSelect) els.sortSelect.disabled = false;
}

function enableReadonlyStaticNotice() {
  // In static deployment, tags.json is the shared baseline; local edits still exist in localStorage.
  // We keep behavior the same; this hook is reserved if you want a banner later.
}

function escapeHtml(s) {
  return normalizeStr(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function openTagDialog(song) {
  const k = songKey(song);
  state.editingSongKey = k;
  const tags = getSongTags(song);
  els.dialogSongInfo.textContent = `${song.name} — ${song.artist}（${song.playlist}）`;
  els.tagInput.value = tagsToString(tags);
  els.tagDialog.showModal();
  setTimeout(() => els.tagInput.focus(), 0);
}

function appendSuggestion(tag) {
  const current = splitTags(els.tagInput.value);
  current.push(tag);
  els.tagInput.value = tagsToString(uniqSorted(current));
  els.tagInput.focus();
}

function renderAll() {
  renderNav();
  if (state.view === "weekly") {
    renderWeekly();
    return;
  }
  if (state.view === "dashboard") {
    renderDashboard();
    return;
  }
  renderPlaylists();
  const { filtered } = renderSongs();
  renderGenreChips();

  // keep stats tied to filtered list; genre chips are global in dataset.
  // If the user chose a playlist, chips remain global, but filters apply after selection.
  // That is intentional: chips represent your taxonomy.
  if (filtered.length === 0 && state.selectedGenres.size > 0) {
    // if filters lead to empty, chips still reflect existing tags; no special action needed
  }
}

function renderNav() {
  if (els.navLibrary && els.navWeekly) {
    els.navLibrary.setAttribute("aria-pressed", state.view === "library" ? "true" : "false");
    els.navWeekly.setAttribute("aria-pressed", state.view === "weekly" ? "true" : "false");
  }
  if (els.navDashboard) {
    els.navDashboard.setAttribute("aria-pressed", state.view === "dashboard" ? "true" : "false");
  }
  if (els.libraryView) els.libraryView.hidden = state.view !== "library";
  if (els.weeklyView) els.weeklyView.hidden = state.view !== "weekly";
  if (els.dashboardView) els.dashboardView.hidden = state.view !== "dashboard";
}

function formatDateLabel(yyyymmdd) {
  const s = normalizeStr(yyyymmdd);
  if (!/^\d{8}$/.test(s)) return s || "unknown";
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function openImageDialog(item) {
  if (!els.imageDialog || !els.imageDialogImg) return;
  const dateLabel = formatDateLabel(item.date);
  if (els.imageDialogSubtitle) els.imageDialogSubtitle.textContent = dateLabel;
  els.imageDialogImg.src = item.file;
  els.imageDialog.showModal();
}

function renderWeekly() {
  if (!els.weeklyGrid) return;
  const items = Array.isArray(state.weeklyImages) ? state.weeklyImages : [];
  if (els.weeklySubtitle) {
    els.weeklySubtitle.textContent = items.length ? `共 ${items.length} 期` : "";
  }

  if (!items.length) {
    els.weeklyGrid.innerHTML =
      `<div class="muted">未检测到 \`web/newsongs.json\`（或内容为空）。\n` +
      `你可以运行：python tools/build_newsongs_manifest.py --src "new songs" --out web/newsongs.json --copy-to web/newsongs</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  for (const it of items) {
    const card = document.createElement("div");
    card.className = "weekly-card";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");

    const img = document.createElement("img");
    img.className = "weekly-thumb";
    img.loading = "lazy";
    img.alt = formatDateLabel(it.date);
    img.src = it.thumb || it.file;

    const meta = document.createElement("div");
    meta.className = "weekly-meta";
    meta.innerHTML = `<div class="weekly-date">${escapeHtml(formatDateLabel(it.date))}</div><div class="pill">打开</div>`;

    card.appendChild(img);
    card.appendChild(meta);
    card.addEventListener("click", () => openImageDialog(it));
    frag.appendChild(card);
  }

  els.weeklyGrid.innerHTML = "";
  els.weeklyGrid.appendChild(frag);
}

function getTopTags(limit = 12) {
  const counts = new Map();
  for (const s of state.songs) {
    for (const t of getSongTags(s)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-Hans-CN"))
    .slice(0, limit);
}

function computeSongbotHeatTop(limit = 12) {
  const sb = state.songbot;
  if (!sb) return [];
  const bySong = new Map();
  for (const r of sb.reactions) {
    const name = normalizeStr(r.name);
    const artist = normalizeStr(r.artist);
    const k = `${name}\u0000${artist}`.toLowerCase();
    const cnt = Number(r.count ?? 0) || 0;
    const w = sb.emojiWeights ? Number(sb.emojiWeights[r.emojiId ?? r.emoji_unique_id ?? r.emoji_unique_id] ?? 1) : 1;
    bySong.set(k, (bySong.get(k) ?? 0) + cnt * (Number.isFinite(w) ? w : 1));
  }
  return Array.from(bySong.entries())
    .map(([k, count]) => {
      const [name, artist] = k.split("\u0000");
      return { label: `${name} — ${artist}`, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function ensureChartJsReady() {
  return typeof window.Chart !== "undefined";
}

function destroyChart(ch) {
  try {
    if (ch && typeof ch.destroy === "function") ch.destroy();
  } catch {}
}

function renderDashboard() {
  if (!els.dashboardSubtitle) return;
  const totalSongs = state.songs.length;
  const taggedSongs = state.songs.filter((s) => getSongTags(s).length > 0).length;
  const sb = state.songbot;
  const sbText = sb ? ` · 喵喵机器人：库 ${sb.library.length} / 表情记录 ${sb.reactions.length} / 评论 ${sb.comments.length}` : "";
  els.dashboardSubtitle.textContent = totalSongs
    ? `共 ${totalSongs} 首 · 已打标签 ${taggedSongs} 首${sbText}`
    : `请先导入 songs.txt 或生成 songs.json${sbText}`;

  if (!ensureChartJsReady()) {
    setTimeout(() => {
      if (state.view === "dashboard") renderDashboard();
    }, 250);
    return;
  }

  const top = getTopTags(12);
  if (els.chartTopTags) {
    destroyChart(state.charts.topTags);
    state.charts.topTags = new window.Chart(els.chartTopTags, {
      type: "bar",
      data: { labels: top.map((x) => x.tag), datasets: [{ label: "歌曲数", data: top.map((x) => x.count) }] },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#cfd3ff" }, grid: { color: "rgba(255,255,255,.06)" } },
          y: { ticks: { color: "#cfd3ff" }, grid: { color: "rgba(255,255,255,.06)" } },
        },
      },
    });
  }

  // Add-week histogram (from songbot library.addWeek like 2026W12)
  if (els.chartAddWeek) {
    const sb2 = state.songbot;
    const lib = sb2?.library || [];
    const counts = new Map();
    for (const row of lib) {
      const w = normalizeStr(row.addWeek);
      if (!w) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
    const labels = Array.from(counts.keys()).sort((a, b) => a.localeCompare(b));
    const values = labels.map((k) => counts.get(k) ?? 0);
    destroyChart(state.charts.addWeek);
    state.charts.addWeek = new window.Chart(els.chartAddWeek, {
      type: "bar",
      data: { labels, datasets: [{ label: "新增歌曲数", data: values }] },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#cfd3ff" }, grid: { color: "rgba(255,255,255,.06)" } },
          y: { ticks: { color: "#cfd3ff" }, grid: { color: "rgba(255,255,255,.06)" } },
        },
      },
    });
  }

  if (els.chartTagRadar) {
    const radarTop = getTopTags(8);
    destroyChart(state.charts.tagRadar);
    state.charts.tagRadar = new window.Chart(els.chartTagRadar, {
      type: "radar",
      data: { labels: radarTop.map((x) => x.tag), datasets: [{ label: "歌曲数", data: radarTop.map((x) => x.count), fill: true }] },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          r: {
            angleLines: { color: "rgba(255,255,255,.10)" },
            grid: { color: "rgba(255,255,255,.10)" },
            pointLabels: { color: "#d9ddff" },
            ticks: { color: "rgba(255,255,255,.55)", backdropColor: "transparent" },
          },
        },
      },
    });
  }

  if (els.chartHeatTop) {
    const heatTop = computeSongbotHeatTop(12);
    destroyChart(state.charts.heatTop);
    state.charts.heatTop = new window.Chart(els.chartHeatTop, {
      type: "bar",
      data: { labels: heatTop.map((x) => x.label), datasets: [{ label: "热度", data: heatTop.map((x) => x.count) }] },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#cfd3ff" }, grid: { color: "rgba(255,255,255,.06)" } },
          y: { ticks: { color: "#cfd3ff" }, grid: { color: "rgba(255,255,255,.06)" } },
        },
      },
    });
  }

  if (els.heatNote) {
    const hasWeights = Boolean(sb?.emojiWeights);
    els.heatNote.textContent = hasWeights ? "热度 = Σ(表情次数 × 表情分数)" : "当前未提供表情分数：热度暂按“互动次数”计算";
  }

  renderCommentsSection();
}

function renderCommentsSection() {
  if (!els.commentList) return;
  const sb = state.songbot;
  const all = sb?.comments || [];

  const q = normalizeStr(els.commentSearch?.value).toLowerCase();
  const filtered = q
    ? all.filter((c) => {
        const name = normalizeStr(c.name);
        const artist = normalizeStr(c.artist);
        const text = normalizeStr(c.comment);
        const nick = normalizeStr(c.nick) || "未知用户";
        return `${name} ${artist} ${text} ${nick}`.toLowerCase().includes(q);
      })
    : all;

  if (!filtered.length) {
    els.commentList.textContent = all.length ? "没有匹配的评论" : "暂无评论数据（把导出的 songbot.json 放到站点根目录即可）";
    els.commentList.classList.add("muted");
    return;
  }

  // Random pick 2
  const picks = [];
  const n = Math.min(2, filtered.length);
  // simple shuffle via random indices
  const used = new Set();
  while (picks.length < n) {
    const idx = Math.floor(Math.random() * filtered.length);
    if (used.has(idx)) continue;
    used.add(idx);
    picks.push(filtered[idx]);
  }

  els.commentList.classList.remove("muted");
  els.commentList.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const c of picks) {
    const card = document.createElement("div");
    card.className = "comment-card";
    const name = normalizeStr(c.name) || "（未知歌曲）";
    const artist = normalizeStr(c.artist) || "（未知歌手）";
    const nick = normalizeStr(c.nick) || "未知用户";
    const text = normalizeStr(c.comment) || "";
    card.innerHTML =
      `<div class="comment-card__title">${escapeHtml(name)} — ${escapeHtml(artist)}</div>` +
      `<div class="comment-card__text">${escapeHtml(text)}</div>` +
      `<div class="comment-card__meta">— ${escapeHtml(nick)}</div>`;
    frag.appendChild(card);
  }
  els.commentList.appendChild(frag);
}

async function readFileText(file) {
  return await file.text();
}

async function tryLoadStaticJSON(url) {
  try {
    const base = new URL(url, window.location.href);
    const v = new URL(window.location.href).searchParams.get("v");
    if (v) base.searchParams.set("v", v);
    const res = await fetch(base.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function setSidebarOpen(open) {
  const isOpen = Boolean(open);
  document.body.classList.toggle("sidebar-open", isOpen);
  if (els.sidebarToggle) els.sidebarToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  if (els.sidebarBackdrop) els.sidebarBackdrop.hidden = !isOpen;
}

function showNotice(text) {
  if (!els.notice) return;
  if (!text) {
    els.notice.hidden = true;
    els.notice.textContent = "";
    return;
  }
  els.notice.hidden = false;
  els.notice.textContent = text;
}

async function bootFromStaticFilesIfPresent() {
  if (window.location.protocol === "file:") {
    showNotice(
      "检测到你是直接打开本地文件（file://）。\n" +
        "浏览器通常会禁止读取 ./songs.json 和 ./tags.json，所以“自动读取”会失败。\n\n" +
        "解决办法：在 web/ 目录启动一个本地静态服务器，然后用 http://localhost 打开。\n" +
        "PowerShell：cd \"f:\\Playlist Management\\web\" ; python -m http.server 8000\n" +
        "然后浏览器访问：http://localhost:8000/"
    );
  } else {
    showNotice("");
  }

  const songsJson = await tryLoadStaticJSON(STATIC_SONGS_URL);
  if (Array.isArray(songsJson?.songs)) {
    state.songs = songsJson.songs
      .map((s) => ({
        name: normalizeStr(s.name),
        artist: normalizeStr(s.artist),
        playlist: normalizeStr(s.playlist),
      }))
      .filter((s) => s.name && s.artist && s.playlist);
    state.playlists = computePlaylists(state.songs);
    enableUI();
  }

  const tagsJson = await tryLoadStaticJSON(STATIC_TAGS_URL);
  if (tagsJson && typeof tagsJson === "object") {
    const tagsObj = tagsJson?.tags && typeof tagsJson.tags === "object" ? tagsJson.tags : null;
    if (tagsObj) {
      state.staticTagStore = tagsObj;
      // Merge static tags into local tags store; local wins unless incoming has newer updatedAt.
      const merged = mergeTagStores(state.tagStore, tagsObj, { preferIncoming: false });
      state.tagStore = merged;
      saveTagStore(state.tagStore);
      enableReadonlyStaticNotice();
    }
  }

  const newsJson = await tryLoadStaticJSON(STATIC_NEWSONGS_URL);
  if (Array.isArray(newsJson?.items)) {
    state.weeklyImages = newsJson.items
      .map((x) => ({
        date: normalizeStr(x.date),
        file: normalizeStr(x.file),
        thumb: normalizeStr(x.thumb),
      }))
      .filter((x) => x.date && x.file);
    state.weeklyImages.sort((a, b) => b.date.localeCompare(a.date));
  }

  const songbotJson = await tryLoadStaticJSON(STATIC_SONGBOT_URL);
  const sb = normalizeSongbotPayload(songbotJson);
  if (sb) state.songbot = sb;

  if (state.songs.length === 0 && window.location.protocol !== "file:") {
    showNotice(
      "未能自动读取 ./songs.json（可能还没生成或没部署到同一目录）。\n" +
        "你可以先点击右上角“导入 songs.txt”继续使用。"
    );
  }

  renderAll();
}

if (els.navLibrary) {
  els.navLibrary.addEventListener("click", () => {
    state.view = "library";
    setSidebarOpen(false);
    renderAll();
  });
}
if (els.navWeekly) {
  els.navWeekly.addEventListener("click", () => {
    state.view = "weekly";
    setSidebarOpen(false);
    renderAll();
  });
}

if (els.navDashboard) {
  els.navDashboard.addEventListener("click", () => {
    state.view = "dashboard";
    setSidebarOpen(false);
    renderAll();
  });
}

if (els.sidebarToggle) {
  els.sidebarToggle.addEventListener("click", () => {
    const open = !document.body.classList.contains("sidebar-open");
    setSidebarOpen(open);
  });
}
if (els.sidebarBackdrop) {
  els.sidebarBackdrop.addEventListener("click", () => setSidebarOpen(false));
}
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setSidebarOpen(false);
});

els.searchInput.addEventListener("input", (e) => {
  state.search = e.target.value ?? "";
  renderAll();
});

els.onlyUntagged.addEventListener("change", (e) => {
  state.onlyUntagged = Boolean(e.target.checked);
  renderAll();
});

if (els.sortSelect) {
  els.sortSelect.addEventListener("change", (e) => {
    state.sort = e.target.value || "playlist:asc";
    renderAll();
  });
}

if (els.commentSearch) {
  els.commentSearch.addEventListener("input", () => {
    if (state.view === "dashboard") renderCommentsSection();
  });
}

if (els.commentRefresh) {
  els.commentRefresh.addEventListener("click", () => {
    state.commentNonce += 1;
    if (state.view === "dashboard") renderCommentsSection();
  });
}

els.tagDialog.addEventListener("close", () => {
  // reset editing state to avoid accidental carry-over
  state.editingSongKey = null;
});

els.saveTagsBtn.addEventListener("click", () => {
  // dialog closes automatically (method=dialog). We need to persist before close finishes.
  const k = state.editingSongKey;
  if (!k) return;

  // find a song sample to compute tags; we already have key, but need to set store with same key
  const tags = splitTags(els.tagInput.value);
  if (tags.length === 0) {
    delete state.tagStore[k];
  } else {
    state.tagStore[k] = { tags, updatedAt: Date.now() };
  }
  saveTagStore(state.tagStore);
  renderAll();
});

els.suggestJpopBtn.addEventListener("click", () => appendSuggestion("J-POP"));
els.suggestAnimeBtn.addEventListener("click", () => appendSuggestion("动漫"));
els.suggestVocaloidBtn.addEventListener("click", () => appendSuggestion("Vocaloid"));
els.suggestGameBtn.addEventListener("click", () => appendSuggestion("游戏"));
els.suggestInstrumentalBtn.addEventListener("click", () => appendSuggestion("纯音乐"));

// initial render (no data)
ensureDailyVersionInUrl();
renderAll();
bootFromStaticFilesIfPresent();

