/* global document, window */

const STORAGE_KEY = "playlist-management:tags:v1";
const STATIC_SONGS_URL = "./songs.json";
const STATIC_TAGS_URL = "./tags.json";
const STATIC_NEWSONGS_URL = "./newsongs.json";

function normalizeStr(s) {
  return (s ?? "").toString().trim();
}

function songKey(song) {
  // name + artist is generally stable; playlist can change.
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
    // skip header repeats
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

function downloadText(filename, content, mime = "application/json;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const els = {
  fileInput: document.getElementById("fileInput"),
  exportBtn: document.getElementById("exportBtn"),
  importTagsInput: document.getElementById("importTagsInput"),
  resetTagsBtn: document.getElementById("resetTagsBtn"),
  notice: document.getElementById("notice"),
  navLibrary: document.getElementById("navLibrary"),
  navWeekly: document.getElementById("navWeekly"),
  libraryView: document.getElementById("libraryView"),
  weeklyView: document.getElementById("weeklyView"),
  weeklySubtitle: document.getElementById("weeklySubtitle"),
  weeklyGrid: document.getElementById("weeklyGrid"),

  playlistList: document.getElementById("playlistList"),
  genreChips: document.getElementById("genreChips"),
  searchInput: document.getElementById("searchInput"),
  onlyUntagged: document.getElementById("onlyUntagged"),
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
  view: "library", // library | weekly
  songs: [],
  playlists: [],
  selectedPlaylist: "__ALL__",
  search: "",
  onlyUntagged: false,
  selectedGenres: new Set(), // active filters
  tagStore: loadTagStore(), // key -> { tags: string[], updatedAt: number }
  staticTagStore: null, // optional from tags.json (for static deployment)
  weeklyImages: [], // { date: 'YYYYMMDD', file: 'newsongs/xxx.png' }
  editingSongKey: null,
};

function getSongTags(song) {
  const rec = state.tagStore[songKey(song)];
  return Array.isArray(rec?.tags) ? rec.tags : [];
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

  const filtered = state.songs.filter(matchesFilters);
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
  els.exportBtn.disabled = false;
  els.importTagsInput.disabled = false;
  els.importTagsInput.parentElement?.setAttribute("aria-disabled", "false");
  els.resetTagsBtn.disabled = false;
  els.searchInput.disabled = false;
  els.onlyUntagged.disabled = false;
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
  if (els.libraryView) els.libraryView.hidden = state.view !== "library";
  if (els.weeklyView) els.weeklyView.hidden = state.view !== "weekly";
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

async function readFileText(file) {
  return await file.text();
}

async function tryLoadStaticJSON(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
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
    renderAll();
  });
}
if (els.navWeekly) {
  els.navWeekly.addEventListener("click", () => {
    state.view = "weekly";
    renderAll();
  });
}

els.fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const text = await readFileText(file);
  const songs = parseTSV(text);
  state.songs = songs;
  state.playlists = computePlaylists(songs);
  state.selectedPlaylist = "__ALL__";
  state.search = "";
  state.onlyUntagged = false;
  state.selectedGenres = new Set();

  els.searchInput.value = "";
  els.onlyUntagged.checked = false;
  enableUI();
  renderAll();
});

els.searchInput.addEventListener("input", (e) => {
  state.search = e.target.value ?? "";
  renderAll();
});

els.onlyUntagged.addEventListener("change", (e) => {
  state.onlyUntagged = Boolean(e.target.checked);
  renderAll();
});

els.exportBtn.addEventListener("click", () => {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    tags: state.tagStore,
  };
  downloadText("tags.json", JSON.stringify(payload, null, 2));
});

els.importTagsInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const raw = await readFileText(file);
    const json = JSON.parse(raw);
    const tags = json?.tags;
    if (!tags || typeof tags !== "object") throw new Error("Invalid tags.json format");
    state.tagStore = tags;
    saveTagStore(state.tagStore);
    renderAll();
  } catch (err) {
    window.alert(`导入失败：${err?.message ?? err}`);
  } finally {
    // allow re-import same file
    e.target.value = "";
  }
});

els.resetTagsBtn.addEventListener("click", () => {
  const ok = window.confirm("确定清空本地标签？这不会影响 songs.txt，只会删除浏览器本地保存的标签。");
  if (!ok) return;
  state.tagStore = {};
  saveTagStore(state.tagStore);
  state.selectedGenres = new Set();
  renderAll();
});

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
renderAll();
bootFromStaticFilesIfPresent();

