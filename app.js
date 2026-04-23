/* BPLog — app.js */
'use strict';

// =================== Build Info ===================
const APP_VERSION = 'dev'; /* CI_INJECT_VERSION */
const BUILD_SHA = 'dev';   /* CI_INJECT_SHA */
const BUILD_DATE = '2026-04-14';
const REPO_OWNER = 'Comfac-Global-Group';
const REPO_NAME = 'bp-app';

// =================== State ===================
const state = {
  currentUserId: localStorage.getItem('bplog_current_user') || null,
  users: [],
  entries: [],
  tags: [],
  images: [], // metadata only
  pendingImage: null, // { blob, dataUrl, timestamp }
  pendingEntryId: null,
  fileQueue: [],
  charts: {},
  deferredInstall: null,
  allTagRegistry: new Set(),
  amm: null, // { ready, capabilities, models, version } or null
  // Batch / queue state
  queue: [], // pending_ocr entries for current user
  isProcessing: false,
  pauseRequested: false,
  currentQueueIndex: 0,
  duplicateChoice: null, // 'keep' | 'skip' | 'replace' | null
  duplicateApplyAll: false,
};

// ---- Debug Console ---------------------------------------------------------
const debugLog = [];
function initDebugConsole() {
  const drawer = document.getElementById('debug-drawer');
  const body = document.getElementById('debug-body');
  const toggle = document.getElementById('debug-toggle');
  const hideBtn = document.getElementById('debug-hide');
  const clearBtn = document.getElementById('debug-clear');
  const copyBtn = document.getElementById('debug-copy');
  if (!drawer || !body || !toggle) return;

  const show = () => { drawer.style.display = 'flex'; toggle.style.display = 'none'; };
  const hide = () => { drawer.style.display = 'none'; toggle.style.display = 'flex'; };

  toggle.addEventListener('click', show);
  hideBtn?.addEventListener('click', hide);
  clearBtn?.addEventListener('click', () => { debugLog.length = 0; body.innerHTML = ''; });
  copyBtn?.addEventListener('click', async () => {
    const text = debugLog.map(e => `${e.time} [${e.level.toUpperCase()}] ${e.msg}`).join('\n');
    try {
      await navigator.clipboard.writeText(text || '(empty log)');
      copyBtn.textContent = 'Copied!';
      setTimeout(() => copyBtn.textContent = 'Copy', 1500);
    } catch (err) {
      copyBtn.textContent = 'Failed';
      setTimeout(() => copyBtn.textContent = 'Copy', 1500);
    }
  });

  // Intercept console methods
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  function push(level, args) {
    const msg = Array.from(args).map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    const time = new Date().toLocaleTimeString();
    debugLog.push({ time, level, msg });
    const el = document.createElement('div');
    el.className = `log-entry log-${level}`;
    el.innerHTML = `<span class="log-time">${time}</span>${msg}`;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    // Auto-show on error
    if (level === 'error') show();
  }
  console.log = (...a) => { original.log.apply(console, a); push('info', a); };
  console.warn = (...a) => { original.warn.apply(console, a); push('warn', a); };
  console.error = (...a) => { original.error.apply(console, a); push('error', a); };

  // Show toggle by default (drawer hidden)
  toggle.style.display = 'flex';
  push('info', ['Debug console ready']);
}

const PALETTE = ['#0d7377','#14a085','#2ecc71','#3498db','#9b59b6','#e74c3c','#f39c12','#1abc9c'];

const DEFAULT_CATEGORY_COLORS = {
  'Normal':    { bg: '#d4edda', text: '#155724' },
  'Elevated':  { bg: '#fff3cd', text: '#856404' },
  'Stage 1':   { bg: '#ffeeba', text: '#856404' },
  'Stage 2':   { bg: '#f8d7da', text: '#721c24' },
  'Crisis':    { bg: '#721c24', text: '#fff' },
};

function getCategoryColors() {
  try {
    const saved = localStorage.getItem('bplog_category_colors');
    if (saved) return { ...DEFAULT_CATEGORY_COLORS, ...JSON.parse(saved) };
  } catch {}
  return { ...DEFAULT_CATEGORY_COLORS };
}

function getShowLabels() {
  return localStorage.getItem('bplog_show_labels') === 'true';
}

function renderBadge(cat, text) {
  const colors = getCategoryColors();
  const style = colors[cat] || DEFAULT_CATEGORY_COLORS[cat] || DEFAULT_CATEGORY_COLORS['Normal'];
  const label = getShowLabels() ? ` <small style="opacity:.8">${cat}</small>` : '';
  return `<span class="badge" style="background:${style.bg};color:${style.text};border:1px solid ${style.text}22">${text}${label}</span>`;
}

// =================== Theme ===================
function applyTheme() {
  const theme = localStorage.getItem('bplog_theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
}
applyTheme();

// =================== IndexedDB ===================
let db;
async function initDB() {
  db = await idb.openDB('bplog', 2, {
    upgrade(db, oldVersion, newVersion, transaction) {
      if (!db.objectStoreNames.contains('users')) db.createObjectStore('users', { keyPath: 'id' });
      let entriesStore;
      if (!db.objectStoreNames.contains('entries')) {
        entriesStore = db.createObjectStore('entries', { keyPath: 'id' });
      } else {
        entriesStore = transaction.objectStore('entries');
      }
      if (!entriesStore.indexNames.contains('user_id')) {
        entriesStore.createIndex('user_id', 'user_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'entry_id' });
      if (!db.objectStoreNames.contains('tags')) db.createObjectStore('tags', { keyPath: 'user_id' });
    }
  });
}

// =================== pHash (perceptual hash) ===================
async function computePHash(blob) {
  // Pure-JS perceptual hash using canvas + DCT on 32x32 grayscale
  const bitmap = await createImageBitmap(blob);
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, size, size);
  const imgData = ctx.getImageData(0, 0, size, size).data;
  bitmap.close();

  // Grayscale
  const gray = new Float64Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const r = imgData[i * 4], g = imgData[i * 4 + 1], b = imgData[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // 2D DCT
  function dct2D(input, N) {
    const output = new Float64Array(N * N);
    const c = new Float64Array(N);
    c[0] = 1 / Math.sqrt(N);
    for (let i = 1; i < N; i++) c[i] = Math.sqrt(2 / N);
    for (let u = 0; u < N; u++) {
      for (let v = 0; v < N; v++) {
        let sum = 0;
        for (let x = 0; x < N; x++) {
          for (let y = 0; y < N; y++) {
            sum += input[x * N + y] * Math.cos((2 * x + 1) * u * Math.PI / (2 * N)) * Math.cos((2 * y + 1) * v * Math.PI / (2 * N));
          }
        }
        output[u * N + v] = sum * c[u] * c[v];
      }
    }
    return output;
  }

  const dct = dct2D(gray, size);
  // Use top-left 8x8 (low frequencies), excluding DC component [0]
  const top = [];
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      if (i === 0 && j === 0) continue;
      top.push(dct[i * size + j]);
    }
  }
  const avg = top.reduce((a, b) => a + b, 0) / top.length;
  let hash = '';
  for (let i = 0; i < 64; i++) {
    hash += (top[i] >= avg) ? '1' : '0';
  }
  return hash;
}

function hammingDistance(a, b) {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

async function findDuplicateImage(phash, userId) {
  const allImages = await db.getAll('images');
  const userEntries = await db.getAllFromIndex('entries', 'user_id', userId);
  const userEntryIds = new Set(userEntries.map(e => e.id));
  for (const img of allImages) {
    if (!img.phash || !userEntryIds.has(img.entry_id)) continue;
    if (hammingDistance(phash, img.phash) <= 8) {
      const entry = userEntries.find(e => e.id === img.entry_id);
      return { entry, image: img };
    }
  }
  return null;
}

// =================== Image Preprocessing ===================
async function preprocessImage(blob, opts = {}) {
  const { minDimension = 1800, rotation = 0, contrast = false } = opts;
  const bitmap = await createImageBitmap(blob);
  let w = bitmap.width, h = bitmap.height;
  // Scale so min side = minDimension
  const scale = Math.max(minDimension / w, minDimension / h, 1);
  w = Math.round(w * scale); h = Math.round(h * scale);

  const canvas = document.createElement('canvas');
  if (rotation === 90 || rotation === 270) { canvas.width = h; canvas.height = w; }
  else { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  if (rotation) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
  } else {
    ctx.drawImage(bitmap, 0, 0, w, h);
  }
  bitmap.close();

  if (contrast) {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = data[i] * 1.2;
      data[i + 1] = data[i + 1] * 1.2;
      data[i + 2] = data[i + 2] * 1.2;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
}

// =================== EXIF Timestamp ===================
async function extractExifTimestamp(blob) {
  try {
    const exif = await exifr.parse(blob);
    if (exif) {
      const raw = exif.DateTimeOriginal || exif.CreateDate || exif.DateTime || exif.DateTimeDigitized;
      if (raw) return { ts: new Date(raw).toISOString(), source: 'from photo EXIF' };
    }
  } catch {}
  return { ts: new Date().toISOString(), source: 'now (no EXIF)' };
}

// =================== Helpers ===================
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
}
function fmtDateInput(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  const idx = Math.abs(h) % PALETTE.length;
  return PALETTE[idx];
}

function computeCategory(sys, dia) {
  if (sys > 180 || dia > 120) return 'Crisis';
  if (sys >= 140 || dia >= 90) return 'Stage 2';
  if (sys >= 130 || dia >= 80) return 'Stage 1';
  if (sys >= 120 && sys <= 129 && dia < 80) return 'Elevated';
  return 'Normal';
}
function badgeClass(cat) {
  return 'badge-' + cat.toLowerCase().replace(/\s+/g,'');
}

// =================== Version Check ===================
async function checkVersion() {
  const badge = document.getElementById('version-badge');

  // Prefer version.json (generated locally by `npm run dev`) over CI-injected constants
  let localVersion = APP_VERSION;
  let localSha     = BUILD_SHA;
  try {
    const vRes = await fetch('./version.json', { cache: 'no-store' });
    if (vRes.ok) {
      const v = await vRes.json();
      if (v.version) localVersion = v.version;
      if (v.sha)     localSha     = v.sha;
    }
  } catch {}

  badge.textContent = `v${localVersion}`;
  badge.title = `Build ${localSha}`;

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits/main`, { method: 'GET', cache: 'no-store' });
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    const remote = (data.sha || '').substring(0, 7);
    if (remote && remote !== localSha) {
      badge.classList.add('update');
      badge.title = `Update available • Latest: ${remote}`;
    } else {
      badge.classList.add('ok');
      badge.title = `Up to date • Build ${localSha}`;
    }
  } catch {
    badge.title = `Offline or rate-limited • ${localSha}`;
  }
}

// =================== Online Status ===================
function updateOnlineStatus() {
  const el = document.getElementById('offline-badge');
  if (!navigator.onLine) el.classList.add('active');
  else el.classList.remove('active');
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// =================== Users ===================
async function loadUsers() {
  state.users = await db.getAll('users');
  if (!state.currentUserId && state.users.length) {
    state.currentUserId = state.users[0].id;
    localStorage.setItem('bplog_current_user', state.currentUserId);
  }
  renderUsers();
}
async function addUser(name) {
  const u = {
    id: uuid(), name: name.trim(),
    avatar_color: PALETTE[state.users.length % PALETTE.length],
    created_at: new Date().toISOString(),
    date_of_birth: null, physician_name: null
  };
  await db.put('users', u);
  state.users.push(u);
  state.currentUserId = u.id;
  localStorage.setItem('bplog_current_user', u.id);
  renderUsers();
  await loadData();
}
async function renameUser(id, name) {
  const u = state.users.find(x => x.id === id);
  if (!u) return;
  u.name = name.trim();
  await db.put('users', u);
  renderUsers();
}
async function deleteUser(id) {
  const u = state.users.find(x => x.id === id);
  if (!u) return;
  const entries = await db.getAllFromIndex('entries', 'user_id', id);
  const tx = db.transaction(['entries','images','tags','users'], 'readwrite');
  for (const e of entries) {
    tx.objectStore('images').delete(e.id);
    tx.objectStore('entries').delete(e.id);
  }
  tx.objectStore('tags').delete(id);
  tx.objectStore('users').delete(id);
  await tx.done;
  state.users = state.users.filter(x => x.id !== id);
  if (state.currentUserId === id) {
    state.currentUserId = state.users[0]?.id || null;
    localStorage.setItem('bplog_current_user', state.currentUserId || '');
  }
  renderUsers();
  await loadData();
}

function renderUsers() {
  // Header dropdown
  const select = document.getElementById('header-user-select');
  select.innerHTML = '';
  if (state.users.length > 1) {
    select.style.display = 'inline-block';
    state.users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.name;
      if (u.id === state.currentUserId) opt.selected = true;
      select.appendChild(opt);
    });
  } else if (state.users.length === 1) {
    select.style.display = 'inline-block';
    const opt = document.createElement('option');
    opt.value = state.users[0].id;
    opt.textContent = state.users[0].name;
    opt.selected = true;
    select.appendChild(opt);
  } else {
    select.style.display = 'none';
  }

  // Home screen chips
  const container = document.getElementById('home-user-list');
  container.innerHTML = '';
  state.users.forEach(u => {
    const el = document.createElement('div');
    el.className = 'user-chip' + (u.id === state.currentUserId ? ' active' : '');
    el.innerHTML = `
      <div style="position:relative">
        <div class="user-avatar" style="background:${u.avatar_color}"></div>
        ${state.users.length > 1 ? `<button class="btn-delete-user" data-id="${u.id}" title="Delete user">×</button>` : ''}
      </div>
      <div class="user-name" contenteditable="${u.id === state.currentUserId}">${escapeHtml(u.name)}</div>
    `;
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.btn-delete-user')) return;
      state.currentUserId = u.id;
      localStorage.setItem('bplog_current_user', u.id);
      renderUsers();
      loadData();
    });
    const nameEl = el.querySelector('.user-name');
    if (nameEl) {
      nameEl.addEventListener('blur', (e) => renameUser(u.id, e.target.innerText));
      nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
    }
    const delBtn = el.querySelector('.btn-delete-user');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showModal(`Delete user "${u.name}" and all their data?`, () => deleteUser(u.id));
      });
    }
    container.appendChild(el);
  });
}

document.getElementById('header-user-select').addEventListener('change', (e) => {
  state.currentUserId = e.target.value;
  localStorage.setItem('bplog_current_user', state.currentUserId);
  renderUsers();
  loadData();
});

// =================== Navigation ===================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  document.querySelectorAll('header .nav-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector('header .nav-btn[data-screen="' + id + '"]');
  if (btn) btn.classList.add('active');
  if (id === 'logs') renderLogs();
  if (id === 'reports') renderReports();
  if (id === 'images') renderImages();
  if (id === 'settings') loadSettings();
  if (id === 'queue') renderQueue();
}
document.querySelectorAll('header .nav-btn').forEach(b => {
  b.addEventListener('click', () => showScreen(b.dataset.screen));
});

// =================== Data loading ===================
async function loadData() {
  if (!state.currentUserId) return;
  state.entries = (await db.getAll('entries')).filter(e => e.user_id === state.currentUserId).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
  const tagRow = await db.get('tags', state.currentUserId);
  state.allTagRegistry = new Set(tagRow?.tags || []);
  renderRecent();
  renderLogTags();
  renderReportTags();
  await refreshQueue();
}

// =================== Queue / Batch ===================
async function getQueueEntries(userId) {
  const all = await db.getAll('entries');
  return all.filter(e => e.user_id === userId && e.status && e.status !== 'done' && e.status !== 'low_confidence');
}

async function refreshQueue() {
  state.queue = await getQueueEntries(state.currentUserId);
  updateQueueBadge();
  renderQueueHomeCard();
}

function updateQueueBadge() {
  const count = state.queue.filter(q => q.status === 'pending_ocr').length;
  const badge = document.getElementById('header-queue-badge');
  const nav = document.getElementById('nav-queue');
  const countEl = document.getElementById('header-queue-count');
  if (count > 0) {
    badge.style.display = 'inline-flex';
    nav.style.display = 'inline-block';
    countEl.textContent = count;
  } else {
    badge.style.display = 'none';
    nav.style.display = 'none';
  }
}

function renderQueueHomeCard() {
  const count = state.queue.filter(q => q.status === 'pending_ocr').length;
  const card = document.getElementById('queue-home-card');
  const countEl = document.getElementById('queue-home-count');
  if (count > 0 && !localStorage.getItem('bplog_queue_card_dismissed')) {
    card.style.display = 'block';
    countEl.textContent = count;
  } else {
    card.style.display = 'none';
  }
}

async function savePendingEntry(blob, timestamp, tsSource) {
  const entryId = uuid();
  const entry = {
    id: entryId,
    user_id: state.currentUserId,
    timestamp,
    systolic: null, diastolic: null, heart_rate: null,
    pulse_pressure: null, mean_arterial_pressure: null, bp_category: null,
    note: null, tags: [], machine_brand: null,
    image_ref: entryId,
    status: 'pending_ocr',
    ts_source: tsSource,
    created_at: new Date().toISOString(),
  };
  await db.put('entries', entry);
  const phash = await computePHash(blob);
  await db.put('images', { entry_id: entryId, data: blob, phash });
  return entry;
}

// =================== Recent entries ===================
function renderRecent() {
  const container = document.getElementById('recent-entries');
  const recent = state.entries.slice(0, 5);
  if (!recent.length) { container.innerHTML = '<div class="empty">No readings yet.</div>'; return; }
  container.innerHTML = recent.map(e => entryRowHTML(e)).join('');
  recent.forEach(e => {
    const row = document.getElementById('entry-row-' + e.id);
    row.addEventListener('click', () => showDetail(e.id));
  });
  loadLogThumbnails(recent);
}

function entryRowHTML(e) {
  const isPending = e.status === 'pending_ocr' || e.status === 'processing' || e.status === 'failed' || e.status === 'skipped';
  const tags = (e.tags || []).map(t => '<span class="tag-chip" style="background:' + hashColor(t) + '22;color:' + hashColor(t) + '">' + escapeHtml(t) + '</span>').join('');
  const note = e.note ? '<div class="text-muted" style="margin-top:4px">' + escapeHtml(e.note.slice(0,60)) + (e.note.length>60?'…':'') + '</div>' : '';
  const thumbSrc = e.image_ref ? '' : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const noExif = e.ts_source === 'now (no EXIF)';
  let valuesHtml;
  if (isPending) {
    const chipMap = {
      pending_ocr: '⏳ Pending',
      processing: '🔄 Processing',
      failed: '❌ Failed',
      skipped: '⏭ Skipped',
    };
    valuesHtml = '<span class="badge" style="background:#e9ecef;color:#495057">' + (chipMap[e.status] || 'Pending') + '</span>';
  } else {
    valuesHtml = renderBadge(e.bp_category, e.systolic + '/' + e.diastolic) + '<span class="badge">' + e.heart_rate + ' bpm</span>';
  }
  return '<div class="entry-row ' + (isPending ? 'pending-entry' : '') + '" id="entry-row-' + e.id + '">' +
    '<img class="entry-thumb" src="' + thumbSrc + '" data-img="' + (e.image_ref||'') + '" id="thumb-' + e.id + '" />' +
    '<div class="entry-body">' +
      '<div class="entry-meta">' + fmtDate(e.timestamp) + (noExif ? ' <span class="badge" style="font-size:10px">(no EXIF)</span>' : '') + '</div>' +
      '<div class="entry-values">' + valuesHtml + '</div>' +
      '<div class="tag-list">' + tags + '</div>' +
      note +
    '</div>' +
  '</div>';
}

async function loadLogThumbnails(list) {
  for (const e of list) {
    if (!e.image_ref) continue;
    const img = document.getElementById('thumb-' + e.id);
    if (!img) continue;
    const blob = await db.get('images', e.id);
    if (blob && blob.data) img.src = URL.createObjectURL(blob.data);
  }
}

// =================== Landing Card ===================
function initLandingCard() {
  const card = document.getElementById('landing-card');
  if (localStorage.getItem('bplog_dismissed_landing') === '1') {
    card.style.display = 'none';
  } else {
    card.style.display = 'block';
  }
  document.getElementById('btn-dismiss-landing').addEventListener('click', () => {
    localStorage.setItem('bplog_dismissed_landing', '1');
    card.style.display = 'none';
  });
}

// =================== Disclaimer ===================
function initDisclaimer() {
  const overlay = document.getElementById('disclaimer-overlay');
  if (localStorage.getItem('bplog_disclaimer_seen') !== '1') {
    overlay.classList.add('active');
  }
  document.getElementById('btn-accept-disclaimer').addEventListener('click', () => {
    localStorage.setItem('bplog_disclaimer_seen', '1');
    overlay.classList.remove('active');
  });
}

async function processBatchFiles(files) {
  const acceptedTypes = ['image/jpeg','image/png','image/heic','image/heif','image/webp'];
  const maxSize = 20 * 1024 * 1024;
  let oversized = 0;

  for (const file of files) {
    if (!acceptedTypes.includes(file.type) && !file.name.match(/\.(jpe?g|png|heic|heif|webp)$/i)) continue;
    if (file.size > maxSize) { oversized++; continue; }

    let blob = file;
    if (file.type === 'image/heic' || file.type === 'image/heif' || file.type === 'image/webp') {
      try {
        const bmp = await createImageBitmap(file);
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close();
        blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
      } catch {
        console.warn('[Batch] Could not convert', file.name);
        continue;
      }
    }

    const phash = await computePHash(blob);
    const dup = await findDuplicateImage(phash, state.currentUserId);
    if (dup && !state.duplicateApplyAll) {
      const choice = await showDuplicateModal(file, blob, dup.entry, dup.image);
      if (choice === 'skip') continue;
      if (choice === 'replace') {
        await db.put('images', { entry_id: dup.entry.id, data: blob, phash });
        dup.entry.status = 'pending_ocr';
        dup.entry.systolic = null; dup.entry.diastolic = null; dup.entry.heart_rate = null;
        dup.entry.bp_category = null; dup.entry.pulse_pressure = null; dup.entry.mean_arterial_pressure = null;
        dup.entry.note = null; dup.entry.tags = []; dup.entry.machine_brand = null;
        await db.put('entries', dup.entry);
        continue;
      }
    } else if (dup && state.duplicateApplyAll) {
      if (state.duplicateChoice === 'skip') continue;
      if (state.duplicateChoice === 'replace') {
        await db.put('images', { entry_id: dup.entry.id, data: blob, phash });
        dup.entry.status = 'pending_ocr';
        dup.entry.systolic = null; dup.entry.diastolic = null; dup.entry.heart_rate = null;
        dup.entry.bp_category = null; dup.entry.pulse_pressure = null; dup.entry.mean_arterial_pressure = null;
        dup.entry.note = null; dup.entry.tags = []; dup.entry.machine_brand = null;
        await db.put('entries', dup.entry);
        continue;
      }
    }

    const { ts, source } = await extractExifTimestamp(blob);
    await savePendingEntry(blob, ts, source);
  }

  await refreshQueue();
  const autoProcess = localStorage.getItem('bplog_auto_process') === 'true';
  if (autoProcess && state.queue.filter(q => q.status === 'pending_ocr').length > 0) {
    showScreen('queue');
    startBatchProcessing();
  }
}

function showDuplicateModal(file, newBlob, existingEntry, existingImage) {
  return new Promise(resolve => {
    const overlay = document.getElementById('duplicate-overlay');
    const newThumb = document.getElementById('dup-new-thumb');
    const oldThumb = document.getElementById('dup-old-thumb');
    const oldMeta = document.getElementById('dup-old-meta');
    const applyAll = document.getElementById('dup-apply-all');

    newThumb.src = URL.createObjectURL(newBlob);
    if (existingImage && existingImage.data) {
      oldThumb.src = URL.createObjectURL(existingImage.data);
      oldThumb.style.display = 'block';
    } else { oldThumb.style.display = 'none'; }

    const ts = existingEntry.timestamp ? fmtDate(existingEntry.timestamp) : 'Unknown date';
    const vals = existingEntry.systolic ? `${existingEntry.systolic}/${existingEntry.diastolic} · ${existingEntry.heart_rate} bpm` : 'No readings saved';
    oldMeta.textContent = '\uD83D\uDCC5 ' + ts + ' \n\u2764\uFE0F ' + vals;

    overlay.classList.add('active');
    applyAll.checked = false;

    const cleanup = () => {
      overlay.classList.remove('active');
      URL.revokeObjectURL(newThumb.src);
      if (oldThumb.src.startsWith('blob:')) URL.revokeObjectURL(oldThumb.src);
      document.getElementById('dup-keep-both').removeEventListener('click', onKeep);
      document.getElementById('dup-skip-new').removeEventListener('click', onSkip);
      document.getElementById('dup-replace-old').removeEventListener('click', onReplace);
    };

    const onKeep = () => { state.duplicateApplyAll = applyAll.checked; state.duplicateChoice = 'keep'; cleanup(); resolve('keep'); };
    const onSkip = () => { state.duplicateApplyAll = applyAll.checked; state.duplicateChoice = 'skip'; cleanup(); resolve('skip'); };
    const onReplace = () => { state.duplicateApplyAll = applyAll.checked; state.duplicateChoice = 'replace'; cleanup(); resolve('replace'); };

    document.getElementById('dup-keep-both').addEventListener('click', onKeep);
    document.getElementById('dup-skip-new').addEventListener('click', onSkip);
    document.getElementById('dup-replace-old').addEventListener('click', onReplace);
  });
}

// =================== Capture flow ===================
document.getElementById('btn-take-photo').addEventListener('click', () => document.getElementById('input-camera').click());
document.getElementById('btn-upload-photo').addEventListener('click', () => document.getElementById('input-gallery').click());

document.getElementById('input-camera').addEventListener('change', handleFiles);
document.getElementById('input-gallery').addEventListener('change', handleFiles);

async function handleFiles(ev) {
  const files = Array.from(ev.target.files);
  if (!files.length) return;
  state.fileQueue = files.slice(1);
  await loadFileIntoOCR(files[0]);
  ev.target.value = '';
}

async function loadFileIntoOCR(file) {
  const blob = file;
  const dataUrl = await blobToDataUrl(blob);
  let timestamp = new Date().toISOString();
  let tsSource  = 'now (no EXIF)';
  try {
    const exif = await exifr.parse(blob);
    if (exif) {
      // Try fields in priority order — different cameras/phones use different tags
      const raw = exif.DateTimeOriginal || exif.CreateDate || exif.DateTime || exif.DateTimeDigitized;
      if (raw) {
        timestamp = new Date(raw).toISOString();
        tsSource  = 'from photo EXIF';
      }
    }
  } catch {}
  state.pendingImage = { blob, dataUrl, timestamp };
  state.pendingEntryId = uuid();
  document.getElementById('ocr-preview').src = dataUrl;
  document.getElementById('ocr-sys').value = '';
  document.getElementById('ocr-dia').value = '';
  document.getElementById('ocr-hr').value = '';
  document.getElementById('ocr-note').value = '';
  document.getElementById('ocr-tags').innerHTML = '';
  document.getElementById('ocr-brand').value = '';
  document.getElementById('btn-ocr-rotate').textContent = '↻ Rotate & Re-scan';
  // Populate editable timestamp field
  document.getElementById('ocr-timestamp').value = toDatetimeLocal(timestamp);
  document.getElementById('ocr-ts-source').textContent = `(${tsSource})`;
  showScreen('ocr');
  const hint = document.getElementById('ocr-hint');
  hint.style.display = 'none';
  showLoading('Running OCR…');
  try {
    // Pass 1: normal orientation only (fast)
    let values = await runOCR(dataUrl, { rotations: [0] });

    // Pass 2: if no valid reading, auto-try rotate90 silently
    if (!values.sys || !values.dia) {
      updateLoadingText('Trying rotated orientation…');
      const rotated = await runOCR(dataUrl, { rotations: [90] });
      if ((rotated.sys && rotated.dia) || (!values.sys && rotated.sys)) {
        values = rotated;
      }
    }

    if (values.sys) document.getElementById('ocr-sys').value = values.sys;
    if (values.dia) document.getElementById('ocr-dia').value = values.dia;
    if (values.hr)  document.getElementById('ocr-hr').value  = values.hr;
    if (values.brand) document.getElementById('ocr-brand').value = values.brand;
    if (values.sys && values.dia) {
      const detectedLabel = [values.brand, values.model].filter(Boolean).join(' ');
      if (detectedLabel) {
        hint.style.display = 'block';
        hint.style.background = '#d4edda';
        hint.style.color = '#155724';
        hint.textContent = `Detected: ${detectedLabel} — review values below.`;
      }
    } else {
      hint.style.display = 'block';
      hint.style.background = '#fff3cd';
      hint.style.color = '#856404';
      hint.textContent = values.rawText
        ? `OCR couldn't extract readings. Detected text: "${values.rawText.replace(/\s+/g,' ').trim().slice(0,120)}" — try rotating the image or enter values manually.`
        : 'No text detected in image. Try a clearer or closer photo, or rotate the image, then enter values manually.';
    }
  } catch (e) {
    console.warn('OCR error', e);
    hint.style.display = 'block';
    hint.style.background = '#f8d7da';
    hint.style.color = '#721c24';
    hint.textContent = `OCR failed: ${e.message || 'unknown error'}. Enter values manually.`;
  }
  hideLoading();
}

function toDatetimeLocal(iso) {
  // Convert ISO string to value suitable for <input type="datetime-local">
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

function getEnginePriority() {
  try { const saved = localStorage.getItem('bplog_engine_priority'); if (saved) return JSON.parse(saved); } catch {}
  return ['amm', 'ollama', 'api', 'template'];
}
function saveEnginePriority(list) { localStorage.setItem('bplog_engine_priority', JSON.stringify(list)); }

function getAiSettings() {
  return {
    ollamaHost: localStorage.getItem('bplog_ollama_host') || 'http://localhost:11434',
    ollamaModel: localStorage.getItem('bplog_ollama_model') || 'llava:7b',
    apiBase: localStorage.getItem('bplog_api_base_url') || '',
    apiKey: localStorage.getItem('bplog_api_key') || '',
    apiModel: localStorage.getItem('bplog_api_model') || 'gpt-4o-mini',
    prompt: localStorage.getItem('bplog_default_prompt') || 'Read the blood pressure monitor. Return JSON: {sys, dia, bpm}. No prose.',
    batchDelay: Number(localStorage.getItem('bplog_batch_delay_ms') || 500),
    autoProcess: localStorage.getItem('bplog_auto_process') === 'true',
    saveLowConfidence: localStorage.getItem('bplog_save_low_confidence') === 'true',
  };
}

async function runOCR(dataUrl, options = {}) {
  console.log('[OCR] Starting vision flow...');
  const engineInfo = await selectActiveEngine();
  if (!engineInfo) {
    throw new Error(
      'No AI vision service available.\n\n' +
      'Please ensure:\n' +
      '1. AMM app is open (bridge or HTTP)\n' +
      '2. Ollama is running locally\n' +
      '3. An OpenAI-compatible API is configured in Settings'
    );
  }

  const settings = engineInfo.settings;
  const prompt = settings.prompt;
  let values;
  if (engineInfo.engine === 'amm') {
    updateLoadingText('AMM vision…');
    values = await runAmmVision(dataUrl, prompt);
  } else if (engineInfo.engine === 'ollama') {
    updateLoadingText('Ollama vision…');
    values = await runOllamaVision(dataUrl, settings.ollamaHost, settings.ollamaModel, prompt);
  } else if (engineInfo.engine === 'api') {
    updateLoadingText('API vision…');
    values = await runApiVision(dataUrl, settings.apiBase, settings.apiKey, settings.apiModel, prompt);
  } else {
    throw new Error('No engine selected');
  }

  if (values.sys && values.dia) {
    return { ...values, brand: null, model: null };
  }
  throw new Error('Vision could not read the blood pressure values. Please try again with a clearer photo.');
}

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

async function selectActiveEngine() {
  const priority = getEnginePriority();
  const settings = getAiSettings();
  for (const engine of priority) {
    if (engine === 'amm' && state.amm) return { engine: 'amm', settings };
    if (engine === 'ollama') {
      const probe = await probeOllama(settings.ollamaHost);
      if (probe.ok) return { engine: 'ollama', settings };
    }
    if (engine === 'api' && settings.apiBase && settings.apiKey) {
      const probe = await probeApi(settings.apiBase, settings.apiKey);
      if (probe.ok) return { engine: 'api', settings };
    }
  }
  return null;
}

async function probeOllama(host) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(host + '/api/tags', { signal: controller.signal, mode: 'cors' });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
    const data = await res.json();
    const models = (data.models || []).map(m => m.name || m.model);
    return { ok: true, models };
  } catch (e) { return { ok: false, error: e.message || 'Connection failed' }; }
}

async function runOllamaVision(dataUrl, host, model, prompt) {
  const blob = dataUrlToBlob(dataUrl);
  const base64 = await blobToBase64(blob);
  const body = {
    model,
    messages: [
      { role: 'user', content: prompt || 'Read the blood pressure monitor. Return JSON: {sys, dia, bpm}. No prose.', images: [base64] }
    ],
    stream: false,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  const res = await fetch(host + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
    mode: 'cors',
  });
  clearTimeout(timer);
  if (!res.ok) throw new Error('Ollama HTTP ' + res.status);
  const data = await res.json();
  const text = data.message?.content || '';
  return parseVisionResponse(text);
}

async function probeApi(baseUrl, apiKey) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(baseUrl + '/models', {
      signal: controller.signal,
      mode: 'cors',
      headers: apiKey ? { 'Authorization': 'Bearer ' + apiKey } : {},
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
    const data = await res.json();
    const models = (data.data || []).map(m => m.id || m.model);
    return { ok: true, models };
  } catch (e) { return { ok: false, error: e.message || 'Connection failed' }; }
}

async function runApiVision(dataUrl, baseUrl, apiKey, model, prompt) {
  const blob = dataUrlToBlob(dataUrl);
  const base64 = await blobToBase64(blob);
  const body = {
    model,
    messages: [
      { role: 'user', content: [
        { type: 'text', text: prompt || 'Read the blood pressure monitor. Return JSON: {sys, dia, bpm}. No prose.' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + base64 } }
      ]}
    ],
    max_tokens: 256,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  const res = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'Authorization': 'Bearer ' + apiKey } : {}),
    },
    body: JSON.stringify(body),
    signal: controller.signal,
    mode: 'cors',
  });
  clearTimeout(timer);
  if (!res.ok) throw new Error('API HTTP ' + res.status);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return parseVisionResponse(text);
}

function parseVisionResponse(text) {
  let parsed = null;
  try {
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
  } catch {}
  if (!parsed) {
    const nums = text.match(/\d+/g)?.map(Number) || [];
    if (nums.length >= 2) {
      parsed = { sys: nums[0], dia: nums[1], bpm: nums[2] ?? null };
    }
  }
  return {
    sys: parsed?.sys ?? null,
    dia: parsed?.dia ?? null,
    hr: parsed?.bpm ?? parsed?.pulse ?? parsed?.hr ?? null,
    algo: 'vision',
    rawText: text,
  };
}

// ---- Multi-algorithm BP extraction ----------------------------------------
function extractBP(text) {
  const nums = (text.match(/\d+/g) || []).map(Number).filter(n => n >= 10 && n <= 300);

  // Algorithm D: label-proximity — Omron/similar print label next to reading
  // Matches number within ~20 chars of SYS / DIA / Pulse label (either order)
  const sysLbl   = text.match(/(\d{2,3})\s{0,20}SYS/i)            || text.match(/SYS\s{0,20}(\d{2,3})/i);
  const diaLbl   = text.match(/(\d{2,3})\s{0,20}DIA/i)            || text.match(/DIA\s{0,20}(\d{2,3})/i);
  const pulseLbl = text.match(/(\d{2,3})\s{0,20}(?:Pulse|\/min)/i) || text.match(/(?:Pulse|\/min)\s{0,20}(\d{2,3})/i);
  if (sysLbl && diaLbl) {
    const sys = +sysLbl[1], dia = +diaLbl[1];
    if (validPair(sys, dia)) return buildResult(sys, dia, nums, 'label-SYS/DIA', pulseLbl ? +pulseLbl[1] : null);
  }

  // Algorithm A: explicit separator "120/80" "120|80"
  const sepMatch = text.match(/(\d{2,3})\s*[\/|\\]\s*(\d{2,3})/);
  if (sepMatch) {
    const a = +sepMatch[1], b = +sepMatch[2];
    if (validPair(a, b)) return buildResult(a, b, nums, 'separator');
  }

  // Algorithm B: range + pulse-pressure validity (sys−dia 20–100 mmHg)
  const sysCands = nums.filter(n => n >= 90 && n <= 220).sort((a, b) => b - a);
  const diaCands = nums.filter(n => n >= 50 && n <= 130).sort((a, b) => b - a);
  for (const sys of sysCands) {
    for (const dia of diaCands.filter(n => n < sys)) {
      if (sys - dia >= 20 && sys - dia <= 100) return buildResult(sys, dia, nums, 'range+pp');
    }
  }

  // Algorithm C: range only — weakest fallback
  const sys3 = sysCands[0] ?? null;
  const dia3  = sys3 ? (diaCands.find(n => n < sys3) ?? null) : null;
  if (sys3 && dia3) return buildResult(sys3, dia3, nums, 'range-only');

  return { sys: null, dia: null, hr: null, algo: null };
}

function validPair(sys, dia) {
  return sys >= 90 && sys <= 220 && dia >= 50 && dia <= 130 && sys > dia
      && (sys - dia) >= 20 && (sys - dia) <= 100;
}

function buildResult(sys, dia, nums, algo, hrHint = null) {
  const hr = (hrHint !== null && hrHint >= 40 && hrHint <= 180)
    ? hrHint
    : (nums.find(n => n >= 40 && n <= 180 && n !== sys && n !== dia) ?? null);
  return { sys, dia, hr, algo };
}

// ---- Device detection ------------------------------------------------------
// Runs on combined OCR text from both passes for best coverage
function detectDevice(text) {
  const t = text.toLowerCase();
  let brand = null, model = null;

  // Brand
  if (t.includes('omron'))      brand = 'Omron';
  else if (t.includes('microlife')) brand = 'Microlife';
  else if (t.includes('a&d'))   brand = 'A&D';

  // Model numbers by brand family
  const hemMatch = text.match(/HEM[-\s]?\d{3,4}[A-Z]*/i);   // Omron: HEM-7121, HEM-7130, HEM-705CP
  const uaMatch  = text.match(/UA[-\s]?\d{3,4}[A-Z]*/i);    // A&D:   UA-767, UA-651
  const bpMatch  = text.match(/BP[-\s]?[A-Z]?\d{2,3}[A-Z]*/i); // Microlife: BP A100, BP B2
  model = (hemMatch || uaMatch || bpMatch)?.[0]?.toUpperCase().replace(/\s/g, '-') || null;

  return { brand, model };
}
// ---------------------------------------------------------------------------

// =================== OCR Tags ===================
const ocrTags = [];
document.getElementById('ocr-tag-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const val = e.target.value.trim().replace(/,/g,'');
    if (val && !ocrTags.includes(val)) {
      ocrTags.push(val);
      state.allTagRegistry.add(val);
      renderOcrTags();
    }
    e.target.value = '';
  }
});
function renderOcrTags() {
  const container = document.getElementById('ocr-tags');
  container.innerHTML = ocrTags.map(t => `
    <span class="tag-chip" style="background:${hashColor(t)}22;color:${hashColor(t)}">
      ${escapeHtml(t)} <button data-tag="${escapeHtml(t)}">×</button>
    </span>
  `).join('');
  container.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.tag;
    const idx = ocrTags.indexOf(t);
    if (idx > -1) ocrTags.splice(idx, 1);
    renderOcrTags();
  }));
}

document.getElementById('btn-ocr-cancel').addEventListener('click', async () => {
  // If there's a pending image, save it to the unprocessed queue instead of discarding
  if (state.pendingImage && state.pendingEntryId) {
    const entry = {
      id: state.pendingEntryId,
      user_id: state.currentUserId,
      timestamp: state.pendingImage.timestamp,
      systolic: null, diastolic: null, heart_rate: null,
      pulse_pressure: null, mean_arterial_pressure: null, bp_category: null,
      note: null, tags: [], machine_brand: null,
      image_ref: state.pendingEntryId,
      status: 'pending_ocr',
      ts_source: 'now (no EXIF)',
      created_at: new Date().toISOString(),
    };
    await db.put('entries', entry);
    const phash = await computePHash(state.pendingImage.blob);
    await db.put('images', { entry_id: state.pendingEntryId, data: state.pendingImage.blob, phash });
    await refreshQueue();
  }
  state.pendingImage = null;
  state.pendingEntryId = null;
  state.fileQueue = [];
  ocrTags.length = 0;
  renderOcrTags();
  showScreen('home');
});

document.getElementById('btn-ocr-save').addEventListener('click', async () => {
  if (!state.currentUserId) return alert('Select a user first');
  const sys = Number(document.getElementById('ocr-sys').value);
  const dia = Number(document.getElementById('ocr-dia').value);
  const hr = Number(document.getElementById('ocr-hr').value);
  if (!sys || !dia || !hr) return alert('Enter all three values');
  const note = document.getElementById('ocr-note').value.trim();
  const brand = document.getElementById('ocr-brand').value || null;
  const pp = sys - dia;
  const map = Math.round(dia + (pp / 3));
  const cat = computeCategory(sys, dia);
  const entry = {
    id: state.pendingEntryId,
    user_id: state.currentUserId,
    timestamp: (() => { const v = document.getElementById('ocr-timestamp').value; return v ? new Date(v).toISOString() : (state.pendingImage?.timestamp || new Date().toISOString()); })(),
    systolic: sys, diastolic: dia, heart_rate: hr,
    pulse_pressure: pp, mean_arterial_pressure: map, bp_category: cat,
    note, tags: [...ocrTags], machine_brand: brand,
    image_ref: state.pendingImage ? state.pendingEntryId : null,
    status: null,
  };
  await db.put('entries', entry);
  if (state.pendingImage) {
    const existingImg = await db.get('images', state.pendingEntryId);
    const phash = existingImg?.phash || await computePHash(state.pendingImage.blob);
    await db.put('images', { entry_id: state.pendingEntryId, data: state.pendingImage.blob, phash });
  }
  const existing = await db.get('tags', state.currentUserId);
  const merged = new Set([...(existing?.tags||[]), ...ocrTags]);
  await db.put('tags', { user_id: state.currentUserId, tags: Array.from(merged) });
  state.allTagRegistry = merged;
  state.pendingImage = null;
  state.pendingEntryId = null;
  ocrTags.length = 0;
  renderOcrTags();
  await loadData();
  if (state.fileQueue.length) {
    await loadFileIntoOCR(state.fileQueue.shift());
  } else {
    showScreen('home');
  }
});

// Rotate & Re-scan button — cycles through 0→90→180→270→0
let ocrRotation = 0;
document.getElementById('btn-ocr-rotate').addEventListener('click', async () => {
  if (!state.pendingImage) return;
  ocrRotation = (ocrRotation + 90) % 360;
  const rotLabel = ocrRotation === 0 ? '0°' : `${ocrRotation}°`;
  document.getElementById('btn-ocr-rotate').textContent = `↻ Re-scan @ ${rotLabel}`;
  showLoading(`Re-scanning @ ${rotLabel}…`);
  const hint = document.getElementById('ocr-hint');
  hint.style.display = 'none';
  try {
    const values = await runOCR(state.pendingImage.dataUrl, { rotations: [ocrRotation] });
    if (values.sys) document.getElementById('ocr-sys').value = values.sys;
    if (values.dia) document.getElementById('ocr-dia').value = values.dia;
    if (values.hr)  document.getElementById('ocr-hr').value  = values.hr;
    if (values.brand) document.getElementById('ocr-brand').value = values.brand;
    if (values.sys && values.dia) {
      hint.style.display = 'block';
      hint.style.background = '#d4edda';
      hint.style.color = '#155724';
      hint.textContent = `Detected @ ${rotLabel}: ${values.sys}/${values.dia} HR:${values.hr} — review values below.`;
    } else {
      hint.style.display = 'block';
      hint.style.background = '#fff3cd';
      hint.style.color = '#856404';
      hint.textContent = `No readings at ${rotLabel}. Try another rotation or enter manually.`;
    }
  } catch (e) {
    console.warn('OCR rotation error', e);
    hint.style.display = 'block';
    hint.style.background = '#f8d7da';
    hint.style.color = '#721c24';
    hint.textContent = `Re-scan failed: ${e.message || 'unknown error'}.`;
  }
  hideLoading();
});

// =================== Logs ===================
let logFilterStart = '';
let logFilterEnd = '';
let logFilterCategory = '';
let logFilterTags = [];
let logSort = 'newest';

function renderLogTags() {
  const container = document.getElementById('log-tag-filters');
  container.innerHTML = Array.from(state.allTagRegistry).map(t => `
    <button class="tag-chip ${logFilterTags.includes(t)?'active':''}" data-tag="${escapeHtml(t)}" style="background:${logFilterTags.includes(t)?hashColor(t):'#e9ecef'};color:${logFilterTags.includes(t)?'#fff':'#495057'}">
      ${escapeHtml(t)}
    </button>
  `).join('');
  container.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.tag;
    if (logFilterTags.includes(t)) logFilterTags = logFilterTags.filter(x => x !== t);
    else logFilterTags.push(t);
    renderLogTags();
    renderLogs();
  }));
}

document.getElementById('filter-start').addEventListener('change', e => { logFilterStart = e.target.value; renderLogs(); });
document.getElementById('filter-end').addEventListener('change', e => { logFilterEnd = e.target.value; renderLogs(); });
document.getElementById('filter-category').addEventListener('change', e => { logFilterCategory = e.target.value; renderLogs(); });
document.getElementById('filter-sort').addEventListener('change', e => { logSort = e.target.value; renderLogs(); });

function renderLogs() {
  let list = state.entries.slice();
  if (logFilterStart) {
    const s = new Date(logFilterStart).getTime();
    list = list.filter(e => new Date(e.timestamp).getTime() >= s);
  }
  if (logFilterEnd) {
    const en = new Date(logFilterEnd).getTime() + 86400000;
    list = list.filter(e => new Date(e.timestamp).getTime() < en);
  }
  if (logFilterCategory) list = list.filter(e => e.bp_category === logFilterCategory);
  if (logFilterTags.length) list = list.filter(e => logFilterTags.every(t => (e.tags||[]).includes(t)));
  list.sort((a,b) => logSort==='newest' ? new Date(b.timestamp)-new Date(a.timestamp) : new Date(a.timestamp)-new Date(b.timestamp));

  // Update log header
  const user = state.users.find(u => u.id === state.currentUserId);
  document.getElementById('log-user-name').textContent = user ? user.name : 'User';
  const rangeText = (logFilterStart || logFilterEnd)
    ? `${logFilterStart || 'Start'} → ${logFilterEnd || 'End'}`
    : 'All time';
  document.getElementById('log-date-range').textContent = rangeText;

  const container = document.getElementById('log-entries');
  document.getElementById('log-empty').style.display = list.length ? 'none' : 'block';
  if (!list.length) { container.innerHTML = ''; return; }
  container.innerHTML = list.map(e => entryRowHTML(e)).join('');
  list.forEach(e => {
    const row = document.getElementById('entry-row-' + e.id);
    row.addEventListener('click', () => showDetail(e.id));
  });
  loadLogThumbnails(list);
}

// =================== Detail ===================
function showDetail(id) {
  const e = state.entries.find(x => x.id === id);
  if (!e) return;
  const card = document.getElementById('detail-card');
  const tags = (e.tags || []).map(t => `<span class="tag-chip" style="background:${hashColor(t)}22;color:${hashColor(t)}">${escapeHtml(t)}</span>`).join('');
  card.innerHTML = `
    <div class="flex-between">
      <div class="card-title">Reading Detail</div>
      <button class="btn btn-secondary" id="detail-back">Back</button>
    </div>
    <div style="text-align:center;margin:12px 0">
      <img id="detail-img" style="max-width:100%;border-radius:12px;background:#dee2e6;display:none" />
    </div>
    <div class="flex gap-2">
      <div style="flex:1"><label>Systolic</label><input type="number" id="detail-sys" value="${e.systolic}" /></div>
      <div style="flex:1"><label>Diastolic</label><input type="number" id="detail-dia" value="${e.diastolic}" /></div>
      <div style="flex:1"><label>Heart Rate</label><input type="number" id="detail-hr" value="${e.heart_rate}" /></div>
    </div>
    <label>Note</label>
    <textarea id="detail-note" rows="3">${escapeHtml(e.note||'')}</textarea>
    <label>Tags</label>
    <div class="tag-list" id="detail-tags"></div>
    <div class="flex gap-2 mt-2">
      <input type="text" id="detail-tag-input" placeholder="Add tag and press Enter" style="flex:1" />
    </div>
    <div class="flex gap-2 mt-3">
      <button class="btn btn-primary btn-block" id="detail-save">Save Changes</button>
      <button class="btn btn-danger" id="detail-delete">Delete</button>
    </div>
  `;
  if (e.image_ref) {
    db.get('images', e.id).then(blob => {
      if (blob && blob.data) {
        const img = document.getElementById('detail-img');
        img.src = URL.createObjectURL(blob.data);
        img.style.display = 'block';
      }
    });
  }
  const detailTags = [...(e.tags || [])];
  function renderDetailTags() {
    const c = document.getElementById('detail-tags');
    c.innerHTML = detailTags.map(t => `
      <span class="tag-chip" style="background:${hashColor(t)}22;color:${hashColor(t)}">
        ${escapeHtml(t)} <button data-tag="${escapeHtml(t)}">×</button>
      </span>
    `).join('');
    c.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      detailTags.splice(detailTags.indexOf(b.dataset.tag), 1);
      renderDetailTags();
    }));
  }
  renderDetailTags();
  document.getElementById('detail-tag-input').addEventListener('keydown', ev => {
    if (ev.key === 'Enter' || ev.key === ',') {
      ev.preventDefault();
      const val = ev.target.value.trim().replace(/,/g,'');
      if (val && !detailTags.includes(val)) { detailTags.push(val); state.allTagRegistry.add(val); }
      ev.target.value = '';
      renderDetailTags();
    }
  });
  document.getElementById('detail-back').addEventListener('click', () => showScreen('logs'));
  document.getElementById('detail-save').addEventListener('click', async () => {
    const sys = Number(document.getElementById('detail-sys').value);
    const dia = Number(document.getElementById('detail-dia').value);
    const hr = Number(document.getElementById('detail-hr').value);
    if (!sys || !dia || !hr) return alert('Enter all three values');
    const note = document.getElementById('detail-note').value.trim();
    e.systolic = sys; e.diastolic = dia; e.heart_rate = hr;
    e.pulse_pressure = sys - dia;
    e.mean_arterial_pressure = Math.round(dia + (e.pulse_pressure / 3));
    e.bp_category = computeCategory(sys, dia);
    e.note = note; e.tags = [...detailTags];
    e.status = null;
    await db.put('entries', e);
    const existing = await db.get('tags', state.currentUserId);
    const merged = new Set([...(existing?.tags||[]), ...detailTags]);
    await db.put('tags', { user_id: state.currentUserId, tags: Array.from(merged) });
    state.allTagRegistry = merged;
    await loadData();
    showScreen('logs');
  });
  document.getElementById('detail-delete').addEventListener('click', () => {
    showModal('Delete reading?', async () => {
      await db.delete('entries', e.id);
      await db.delete('images', e.id);
      await loadData();
      showScreen('logs');
    });
  });
  showScreen('detail');
}

// =================== Reports ===================
function renderReports() {
  const end = new Date();
  const start = new Date(); start.setDate(end.getDate() - 30);
  document.getElementById('report-start').value = fmtDateInput(start);
  document.getElementById('report-end').value = fmtDateInput(end);
  const user = state.users.find(u => u.id === state.currentUserId);
  document.getElementById('report-user-name').textContent = user ? `• ${user.name}` : '';
  updateReport();
}

document.getElementById('report-start').addEventListener('change', updateReport);
document.getElementById('report-end').addEventListener('change', updateReport);
document.getElementById('btn-generate-pdf').addEventListener('click', generatePDF);
document.getElementById('btn-print-report').addEventListener('click', () => window.print());

let reportSelectedTags = [];
function renderReportTags() {
  const c = document.getElementById('report-tag-filters');
  c.innerHTML = Array.from(state.allTagRegistry).map(t => `
    <button class="tag-chip" data-tag="${escapeHtml(t)}" style="background:${reportSelectedTags.includes(t)?hashColor(t):'#e9ecef'};color:${reportSelectedTags.includes(t)?'#fff':'#495057'}">
      ${escapeHtml(t)}
    </button>
  `).join('');
  c.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.tag;
    if (reportSelectedTags.includes(t)) reportSelectedTags = reportSelectedTags.filter(x => x !== t);
    else reportSelectedTags.push(t);
    renderReportTags();
    updateReport();
  }));
}

function getReportEntries() {
  const s = new Date(document.getElementById('report-start').value).getTime();
  const e = new Date(document.getElementById('report-end').value).getTime() + 86400000;
  let list = state.entries.filter(x => {
    const t = new Date(x.timestamp).getTime();
    return t >= s && t < e && x.status !== 'pending_ocr' && x.status !== 'processing' && x.status !== 'failed' && x.status !== 'skipped';
  });
  if (reportSelectedTags.length) {
    list = list.filter(x => reportSelectedTags.every(t => (x.tags||[]).includes(t)));
  }
  return list.sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function avg(arr) {
  if (!arr.length) return 0;
  return Math.round(arr.reduce((a,b)=>a+b,0)/arr.length);
}
function stdDev(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a,b)=>a+b,0)/arr.length;
  return Math.round(Math.sqrt(arr.reduce((a,b)=>a+Math.pow(b-mean,2),0)/arr.length));
}

function updateReport() {
  const list = getReportEntries();
  const sys = list.map(x=>x.systolic);
  const dia = list.map(x=>x.diastolic);
  const hr = list.map(x=>x.heart_rate);
  const pp = list.map(x=>x.pulse_pressure);
  const map = list.map(x=>x.mean_arterial_pressure);

  const statsHtml = `
    <table style="width:100%;border-collapse:collapse;text-align:center">
      <thead><tr><th style="text-align:left">Metric</th><th>Systolic</th><th>Diastolic</th><th>Heart Rate</th></tr></thead>
      <tbody>
        <tr><td style="text-align:left;font-weight:700">Average</td><td>${avg(sys)}</td><td>${avg(dia)}</td><td>${avg(hr)}</td></tr>
        <tr><td style="text-align:left;font-weight:700">Minimum</td><td>${sys.length?Math.min(...sys):0}</td><td>${dia.length?Math.min(...dia):0}</td><td>${hr.length?Math.min(...hr):0}</td></tr>
        <tr><td style="text-align:left;font-weight:700">Maximum</td><td>${sys.length?Math.max(...sys):0}</td><td>${dia.length?Math.max(...dia):0}</td><td>${hr.length?Math.max(...hr):0}</td></tr>
        <tr><td style="text-align:left;font-weight:700">Std Dev</td><td>${stdDev(sys)}</td><td>${stdDev(dia)}</td><td>${stdDev(hr)}</td></tr>
      </tbody>
    </table>
    <div class="mt-3">
      <div><strong>Category Distribution</strong></div>
      ${['Normal','Elevated','Stage 1','Stage 2','Crisis'].map(c => {
        const n = list.filter(x=>x.bp_category===c).length;
        const pct = list.length ? Math.round(n/list.length*100) : 0;
        return `<div class="text-muted">${c}: ${n} (${pct}%)</div>`;
      }).join('')}
    </div>
    <div class="mt-2 text-muted">Avg Pulse Pressure: ${avg(pp)} mmHg • Avg MAP: ${avg(map)} mmHg</div>
  `;
  document.getElementById('report-stats').innerHTML = statsHtml;

  renderCharts(list);
  renderTagAnalytics(list);
}

function getChartColors() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    grid: isDark ? '#30363d' : '#e5e7eb',
    ticks: isDark ? '#c9d1d9' : '#374151',
    legend: isDark ? '#c9d1d9' : '#111827'
  };
}

function renderCharts(list) {
  const labels = list.map(x => fmtDate(x.timestamp));
  const destroy = id => { if (state.charts[id]) { state.charts[id].destroy(); state.charts[id]=null; } };
  destroy('sysdia'); destroy('hr'); destroy('ppmap');
  const c = getChartColors();
  const commonOptions = {
    responsive: true,
    plugins: { legend: { labels: { color: c.legend } } },
    scales: {
      x: { grid: { color: c.grid }, ticks: { color: c.ticks } },
      y: { grid: { color: c.grid }, ticks: { color: c.ticks } }
    }
  };

  state.charts.sysdia = new Chart(document.getElementById('chart-sysdia'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Systolic', data: list.map(x=>x.systolic), borderColor: '#e74c3c', backgroundColor: '#e74c3c', tension: 0.2, pointRadius: 3 },
        { label: 'Diastolic', data: list.map(x=>x.diastolic), borderColor: '#3498db', backgroundColor: '#3498db', tension: 0.2, pointRadius: 3 }
      ]
    },
    options: {
      ...commonOptions,
      plugins: { title: { display: true, text: 'Systolic & Diastolic', color: c.legend }, legend: { labels: { color: c.legend } } },
      scales: { ...commonOptions.scales, y: { ...commonOptions.scales.y, min: 40, max: 200 } }
    }
  });

  state.charts.hr = new Chart(document.getElementById('chart-hr'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Heart Rate', data: list.map(x=>x.heart_rate), borderColor: '#27ae60', backgroundColor: '#27ae60', tension: 0.2, pointRadius: 3 }] },
    options: {
      ...commonOptions,
      plugins: { title: { display: true, text: 'Heart Rate', color: c.legend }, legend: { labels: { color: c.legend } } },
      scales: { ...commonOptions.scales, y: { ...commonOptions.scales.y, min: 40, max: 140 } }
    }
  });

  state.charts.ppmap = new Chart(document.getElementById('chart-ppmap'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Pulse Pressure', data: list.map(x=>x.pulse_pressure), borderColor: '#f39c12', backgroundColor: '#f39c12', tension: 0.2, pointRadius: 3 },
        { label: 'MAP', data: list.map(x=>x.mean_arterial_pressure), borderColor: '#9b59b6', backgroundColor: '#9b59b6', tension: 0.2, pointRadius: 3 }
      ]
    },
    options: {
      ...commonOptions,
      plugins: { title: { display: true, text: 'Pulse Pressure & MAP', color: c.legend }, legend: { labels: { color: c.legend } } },
      scales: { ...commonOptions.scales, y: { ...commonOptions.scales.y, min: 20, max: 160 } }
    }
  });
}

function renderTagAnalytics(list) {
  const counts = {};
  list.forEach(e => { (e.tags || []).forEach(t => { if (!counts[t]) counts[t]=[]; counts[t].push(e); }); });
  const rows = Object.keys(counts).sort().map(t => {
    const items = counts[t];
    return `
      <tr>
        <td style="font-weight:600">${escapeHtml(t)}</td>
        <td>${items.length}</td>
        <td>${avg(items.map(x=>x.systolic))}</td>
        <td>${avg(items.map(x=>x.diastolic))}</td>
        <td>${avg(items.map(x=>x.heart_rate))}</td>
        <td>${avg(items.map(x=>x.pulse_pressure))}</td>
        <td>${avg(items.map(x=>x.mean_arterial_pressure))}</td>
      </tr>
    `;
  }).join('');
  document.getElementById('report-tag-analytics').innerHTML = rows.length ? `
    <table style="width:100%;border-collapse:collapse;text-align:center;font-size:13px">
      <thead><tr><th style="text-align:left">Tag</th><th>N</th><th>Avg Sys</th><th>Avg Dia</th><th>Avg HR</th><th>Avg PP</th><th>Avg MAP</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  ` : '<div class="empty">No tag data for selected period.</div>';
}

// =================== PDF Generation ===================
async function generatePDF() {
  showLoading('Building PDF…');
  await new Promise(r => setTimeout(r, 50));
  const list = getReportEntries();
  const user = state.users.find(u => u.id === state.currentUserId);
  const start = document.getElementById('report-start').value;
  const end = document.getElementById('report-end').value;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  let y = 14;

  doc.setFontSize(18);
  doc.text('BPLog — Blood Pressure Report', 14, y); y += 10;
  doc.setFontSize(11);
  doc.text(`Patient: ${user?.name || 'Anonymous'}`, 14, y); y += 6;
  doc.text(`Date of Birth: ${user?.date_of_birth || ''}`, 14, y); y += 6;
  doc.text(`Prepared for: ${user?.physician_name || ''}`, 14, y); y += 6;
  doc.text(`Report Period: ${start} to ${end}`, 14, y); y += 6;
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, y); y += 6;
  doc.text(`Total Readings: ${list.length}`, 14, y); y += 10;

  const sys = list.map(x=>x.systolic);
  const dia = list.map(x=>x.diastolic);
  const hr = list.map(x=>x.heart_rate);

  doc.setFontSize(12);
  doc.text('Summary Statistics', 14, y); y += 6;
  doc.autoTable({
    startY: y,
    head: [['Metric','Systolic','Diastolic','Heart Rate']],
    body: [
      ['Average', avg(sys), avg(dia), avg(hr)],
      ['Minimum', sys.length?Math.min(...sys):'-', dia.length?Math.min(...dia):'-', hr.length?Math.min(...hr):'-'],
      ['Maximum', sys.length?Math.max(...sys):'-', dia.length?Math.max(...dia):'-', hr.length?Math.max(...hr):'-'],
      ['Std Deviation', stdDev(sys), stdDev(dia), stdDev(hr)]
    ],
    theme: 'grid',
    styles: { fontSize: 10 },
    headStyles: { fillColor: [13,115,119] }
  });
  y = doc.lastAutoTable.finalY + 8;

  doc.text('BP Category Distribution', 14, y); y += 6;
  ['Normal','Elevated','Stage 1','Stage 2','Crisis'].forEach(c => {
    const n = list.filter(x=>x.bp_category===c).length;
    const pct = list.length ? Math.round(n/list.length*100) : 0;
    doc.text(`${c}: ${n} readings (${pct}%)`, 14, y); y += 5;
  });
  y += 6;
  doc.text(`Avg Pulse Pressure: ${avg(list.map(x=>x.pulse_pressure))} mmHg`, 14, y); y += 5;
  doc.text(`Avg MAP: ${avg(list.map(x=>x.mean_arterial_pressure))} mmHg`, 14, y); y += 10;

  async function addChartImage(canvasId, title) {
    if (y > 240) { doc.addPage(); y = 14; }
    doc.setFontSize(12); doc.text(title, 14, y); y += 4;
    const canvas = document.getElementById(canvasId);
    const imgData = canvas.toDataURL('image/png');
    const imgW = pageW - 28;
    const imgH = (canvas.height / canvas.width) * imgW;
    doc.addImage(imgData, 'PNG', 14, y, imgW, imgH);
    y += imgH + 10;
  }

  await addChartImage('chart-sysdia', 'Systolic & Diastolic');
  await addChartImage('chart-hr', 'Heart Rate');
  await addChartImage('chart-ppmap', 'Pulse Pressure & MAP');

  const counts = {};
  list.forEach(e => { (e.tags||[]).forEach(t => { if (!counts[t]) counts[t]=[]; counts[t].push(e); }); });
  if (Object.keys(counts).length) {
    if (y > 220) { doc.addPage(); y = 14; }
    doc.setFontSize(12); doc.text('Tag Analytics', 14, y); y += 6;
    const body = Object.keys(counts).sort().map(t => {
      const items = counts[t];
      return [t, items.length, avg(items.map(x=>x.systolic)), avg(items.map(x=>x.diastolic)), avg(items.map(x=>x.heart_rate)), avg(items.map(x=>x.pulse_pressure)), avg(items.map(x=>x.mean_arterial_pressure))];
    });
    doc.autoTable({
      startY: y,
      head: [['Tag','Readings','Avg Sys','Avg Dia','Avg HR','Avg PP','Avg MAP']],
      body,
      theme: 'grid',
      styles: { fontSize: 9 },
      headStyles: { fillColor: [13,115,119] }
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  if (y > 180) { doc.addPage(); y = 14; }
  doc.setFontSize(12); doc.text('Full Reading Log', 14, y); y += 6;
  doc.autoTable({
    startY: y,
    head: [['Date/Time','Sys','Dia','HR','PP','MAP','Category','Tags','Note']],
    body: list.map(e => [
      fmtDate(e.timestamp),
      e.systolic, e.diastolic, e.heart_rate,
      e.pulse_pressure, e.mean_arterial_pressure,
      e.bp_category,
      (e.tags||[]).join(', '),
      e.note || ''
    ]),
    theme: 'striped',
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [13,115,119] },
    columnStyles: { 8: { cellWidth: 'auto' } }
  });

  doc.save(`bplog-report-${user?.name || 'user'}-${start}.pdf`);
  hideLoading();
}

// =================== Export / Import ===================
document.getElementById('btn-export-json').addEventListener('click', exportJSON);
document.getElementById('btn-export-zip').addEventListener('click', exportImageZip);
document.getElementById('btn-export-combined').addEventListener('click', exportCombined);
document.getElementById('btn-import').addEventListener('click', doImport);
document.getElementById('btn-go-export').addEventListener('click', () => showScreen('export'));

function exportJSON() {
  const data = { exported_at: new Date().toISOString(), user_id: state.currentUserId, entries: state.entries };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `bplog-${state.currentUserId}.json`);
}

async function exportImageZip() {
  showLoading('Zipping images…');
  const zip = new JSZip();
  const imgs = await db.getAll('images');
  const mine = state.entries.map(e => e.id);
  for (const img of imgs) {
    if (mine.includes(img.entry_id) && img.data) zip.file(`${img.entry_id}.jpg`, img.data);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `bplog-images-${state.currentUserId}.zip`);
  hideLoading();
}

async function exportCombined() {
  showLoading('Zipping combined archive…');
  const zip = new JSZip();
  const data = { exported_at: new Date().toISOString(), user_id: state.currentUserId, entries: state.entries };
  zip.file('bplog.json', JSON.stringify(data, null, 2));
  const imgs = await db.getAll('images');
  const mine = state.entries.map(e => e.id);
  for (const img of imgs) {
    if (mine.includes(img.entry_id) && img.data) zip.file(`images/${img.entry_id}.jpg`, img.data);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `bplog-combined-${state.currentUserId}.zip`);
  hideLoading();
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function doImport() {
  const fileInput = document.getElementById('import-file');
  if (!fileInput.files.length) return;
  const file = fileInput.files[0];
  const overwrite = document.getElementById('import-overwrite').checked;
  const logEl = document.getElementById('import-log');
  logEl.textContent = '';
  showLoading('Importing…');

  try {
    if (file.name.endsWith('.json')) {
      const text = await file.text();
      const data = JSON.parse(text);
      let added = 0, skipped = 0;
      for (const e of (data.entries || [])) {
        e.user_id = state.currentUserId;
        const exists = await db.get('entries', e.id);
        if (exists && !overwrite) { skipped++; continue; }
        await db.put('entries', e);
        added++;
      }
      logEl.textContent = `Imported ${added} entries, skipped ${skipped}.`;
    } else if (file.name.endsWith('.zip')) {
      const zip = await JSZip.loadAsync(file);
      let imgCount = 0;
      for (const name of Object.keys(zip.files)) {
        if (name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png')) {
          const entryId = name.replace(/^(images\/)?/, '').replace(/\.(jpg|jpeg|png)$/i, '');
          const blob = await zip.files[name].async('blob');
          await db.put('images', { entry_id: entryId, data: blob });
          imgCount++;
        }
        if (name.endsWith('.json')) {
          const text = await zip.files[name].async('text');
          const data = JSON.parse(text);
          let added = 0, skipped = 0;
          for (const e of (data.entries || [])) {
            e.user_id = state.currentUserId;
            const exists = await db.get('entries', e.id);
            if (exists && !overwrite) { skipped++; continue; }
            await db.put('entries', e);
            added++;
          }
          logEl.textContent = `Imported ${added} entries, skipped ${skipped}. Images: ${imgCount}.`;
        }
      }
      if (!logEl.textContent) logEl.textContent = `Imported ${imgCount} images.`;
    }
  } catch (e) {
    logEl.textContent = 'Import error: ' + e.message;
  }
  await loadData();
  hideLoading();
}

// =================== Image Manager ===================
async function renderImages() {
  const imgs = await db.getAll('images');
  const entries = await db.getAll('entries');
  const entryIds = new Set(entries.map(e => e.id));
  const container = document.getElementById('image-list');
  container.innerHTML = '';

  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(est => {
      const used = est.usage ? Math.round(est.usage / 1048576) : 0;
      const total = est.quota ? Math.round(est.quota / 1048576) : 0;
      document.getElementById('storage-gauge').textContent = `Used ~${used} MB / ${total ? total+' MB' : '?'}`;
    });
  } else {
    document.getElementById('storage-gauge').textContent = 'Storage estimate unavailable';
  }

  if (!imgs.length) { container.innerHTML = '<div class="empty">No stored images.</div>'; return; }
  imgs.forEach(img => {
    const orphan = !entryIds.has(img.entry_id);
    const el = document.createElement('div');
    el.className = 'img-item';
    el.innerHTML = `
      <input type="checkbox" data-id="${img.entry_id}" />
      <img class="img-thumb" src="${URL.createObjectURL(img.data)}" />
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600">${img.entry_id}</div>
        <div class="text-muted">${orphan ? 'Orphaned' : 'Linked'} • ${Math.round(img.data.size/1024)} KB</div>
      </div>
    `;
    container.appendChild(el);
  });
}

document.getElementById('btn-delete-selected').addEventListener('click', async () => {
  const checked = Array.from(document.querySelectorAll('#image-list input[type=checkbox]:checked')).map(c => c.dataset.id);
  if (!checked.length) return;
  showModal(`Delete ${checked.length} image(s)?`, async () => {
    for (const id of checked) await db.delete('images', id);
    renderImages();
  });
});

document.getElementById('btn-delete-orphans').addEventListener('click', async () => {
  const imgs = await db.getAll('images');
  const entries = await db.getAll('entries');
  const entryIds = new Set(entries.map(e => e.id));
  const orphans = imgs.filter(i => !entryIds.has(i.entry_id));
  if (!orphans.length) return alert('No orphaned images found.');
  showModal(`Delete ${orphans.length} orphaned image(s)?`, async () => {
    for (const o of orphans) await db.delete('images', o.entry_id);
    renderImages();
  });
});

// =================== Settings ===================
async function loadSettings() {
  const u = state.users.find(x => x.id === state.currentUserId);
  document.getElementById('setting-name').value = u?.name || '';
  document.getElementById('setting-dob').value = u?.date_of_birth || '';
  document.getElementById('setting-physician').value = u?.physician_name || '';
  document.getElementById('settings-build-sha').textContent = APP_VERSION === 'dev' ? 'dev' : `${APP_VERSION} (${BUILD_SHA})`;
  document.getElementById('setting-dark-mode').checked = (localStorage.getItem('bplog_theme') === 'dark');
  loadAccessibilitySettings();
  checkAppUpdate();

  // AI Engine settings
  const s = getAiSettings();
  document.getElementById('setting-ollama-host').value = s.ollamaHost;
  document.getElementById('setting-ollama-model').value = s.ollamaModel;
  document.getElementById('setting-api-base').value = s.apiBase;
  document.getElementById('setting-api-key').value = s.apiKey;
  document.getElementById('setting-api-model').value = s.apiModel;
  document.getElementById('setting-prompt').value = s.prompt;
  document.getElementById('setting-batch-delay').value = String(s.batchDelay);
  document.getElementById('setting-auto-process').checked = s.autoProcess;
  document.getElementById('setting-save-low-confidence').checked = s.saveLowConfidence;
  renderEnginePriority();

  // Update AMM status pill
  const ammEl = document.getElementById('amm-status');
  if (ammEl) {
    if (state.amm) {
      const model = state.amm.models?.vision || 'vision model';
      ammEl.innerHTML = '<span style="color:var(--success)">●</span> AMM detected — ' + model;
    } else {
      ammEl.innerHTML = '<span style="color:var(--muted)">○</span> AMM not detected — install AMM app and start HTTP service';
    }
  }
}

function loadAccessibilitySettings() {
  const colors = getCategoryColors();
  document.getElementById('setting-show-labels').checked = getShowLabels();
  const container = document.getElementById('category-colors-list');
  container.innerHTML = '';
  Object.keys(DEFAULT_CATEGORY_COLORS).forEach(cat => {
    const c = colors[cat] || DEFAULT_CATEGORY_COLORS[cat];
    const row = document.createElement('div');
    row.className = 'color-row';
    row.innerHTML = `
      <label>${cat}</label>
      <input type="color" data-cat="${cat}" data-type="bg" value="${c.bg}" title="Background" />
      <input type="color" data-cat="${cat}" data-type="text" value="${c.text}" title="Text" />
      <span class="color-preview" style="background:${c.bg};color:${c.text}">120/80</span>
    `;
    container.appendChild(row);
  });
  container.querySelectorAll('input[type="color"]').forEach(input => {
    input.addEventListener('input', updateColorPreview);
  });
}

function updateColorPreview(e) {
  const cat = e.target.dataset.cat;
  const type = e.target.dataset.type;
  const row = e.target.closest('.color-row');
  const preview = row.querySelector('.color-preview');
  if (type === 'bg') preview.style.background = e.target.value;
  else preview.style.color = e.target.value;
}

function saveCategoryColors() {
  const colors = {};
  document.querySelectorAll('#category-colors-list .color-row').forEach(row => {
    const cat = row.querySelector('label').textContent;
    const bg = row.querySelector('input[data-type="bg"]').value;
    const text = row.querySelector('input[data-type="text"]').value;
    colors[cat] = { bg, text };
  });
  localStorage.setItem('bplog_category_colors', JSON.stringify(colors));
}

document.getElementById('setting-show-labels').addEventListener('change', (e) => {
  localStorage.setItem('bplog_show_labels', e.target.checked ? 'true' : 'false');
  loadData();
});

document.getElementById('btn-reset-colors').addEventListener('click', () => {
  localStorage.removeItem('bplog_category_colors');
  loadAccessibilitySettings();
  loadData();
});

document.getElementById('btn-export-colors').addEventListener('click', () => {
  const data = {
    exported_at: new Date().toISOString(),
    show_labels: getShowLabels(),
    colors: getCategoryColors(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bplog-colors-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('btn-import-colors').addEventListener('click', () => {
  document.getElementById('import-colors-file').click();
});

document.getElementById('import-colors-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (data.colors) {
      localStorage.setItem('bplog_category_colors', JSON.stringify(data.colors));
    }
    if (typeof data.show_labels === 'boolean') {
      localStorage.setItem('bplog_show_labels', data.show_labels ? 'true' : 'false');
    }
    loadAccessibilitySettings();
    loadData();
    alert('Color settings imported successfully');
  } catch (err) {
    alert('Failed to import color settings: ' + err.message);
  }
  e.target.value = '';
});

// Auto-save colors when leaving settings screen or on change
document.getElementById('category-colors-list').addEventListener('change', () => {
  saveCategoryColors();
  loadData();
});

document.getElementById('btn-save-profile').addEventListener('click', async () => {
  const u = state.users.find(x => x.id === state.currentUserId);
  if (!u) return;
  u.name = document.getElementById('setting-name').value.trim();
  u.date_of_birth = document.getElementById('setting-dob').value || null;
  u.physician_name = document.getElementById('setting-physician').value.trim() || null;
  await db.put('users', u);
  renderUsers();
  alert('Profile saved');
});

document.getElementById('setting-dark-mode').addEventListener('change', (e) => {
  const theme = e.target.checked ? 'dark' : 'light';
  localStorage.setItem('bplog_theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
  // Re-render charts if on reports screen to match theme
  if (document.getElementById('screen-reports').classList.contains('active')) {
    updateReport();
  }
});

document.getElementById('btn-install-pwa').addEventListener('click', async () => {
  if (!state.deferredInstall) return alert('Install prompt not available. Use browser menu to add to home screen.');
  state.deferredInstall.prompt();
  const { outcome } = await state.deferredInstall.userChoice;
  if (outcome === 'accepted') state.deferredInstall = null;
});

// =================== App Update / Rollback ===================
let availableVersions = null;

async function checkAppUpdate() {
  const statusEl = document.getElementById('update-status');
  const checkBtn = document.getElementById('btn-check-update');
  const updateBtn = document.getElementById('btn-update-now');
  const prevWrap = document.getElementById('previous-versions');
  const listEl = document.getElementById('versions-list');

  statusEl.textContent = 'Checking…';
  checkBtn.style.display = 'none';
  updateBtn.style.display = 'none';
  prevWrap.style.display = 'none';
  listEl.innerHTML = '';

  try {
    const res = await fetch('versions.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('versions.json not found');
    availableVersions = await res.json();
    const currentNum = parseFloat(APP_VERSION);
    const latest = availableVersions.versions[0];
    const latestNum = parseFloat(latest?.version || '0');

    if (APP_VERSION === 'dev') {
      statusEl.textContent = 'Development build — updates disabled.';
      prevWrap.style.display = 'block';
      renderVersionsList(availableVersions.versions, false);
      return;
    }

    if (latestNum > currentNum) {
      statusEl.textContent = `Update available: v${APP_VERSION} → v${latest.version}`;
      updateBtn.style.display = 'block';
      updateBtn.textContent = `Update to v${latest.version}`;
      updateBtn.onclick = () => doAppUpdate();
      prevWrap.style.display = 'block';
      renderVersionsList(availableVersions.versions, true);
    } else {
      statusEl.textContent = `You are on the latest version (v${APP_VERSION}).`;
      checkBtn.style.display = 'inline-flex';
      checkBtn.textContent = 'Check Again';
      prevWrap.style.display = 'block';
      renderVersionsList(availableVersions.versions, true);
    }
  } catch (e) {
    statusEl.textContent = 'Could not check for updates (offline or error).';
    checkBtn.style.display = 'inline-flex';
    checkBtn.textContent = 'Try Again';
  }
}

function renderVersionsList(versions, includeCurrent) {
  const listEl = document.getElementById('versions-list');
  const currentNum = parseFloat(APP_VERSION);
  listEl.innerHTML = versions.map(v => {
    const vNum = parseFloat(v.version);
    const isCurrent = v.version === APP_VERSION;
    const isNewer = vNum > currentNum;
    if (!includeCurrent && isCurrent) return '';
    let badge = '';
    if (isCurrent) badge = '<span class="badge badge-normal" style="margin-left:6px">Current</span>';
    else if (isNewer) badge = '<span class="badge badge-elevated" style="margin-left:6px">Newer</span>';
    else badge = '<span class="badge" style="margin-left:6px">Older</span>';
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
        <div>
          <strong>v${escapeHtml(v.version)}</strong> ${badge}
          <div class="text-muted">${escapeHtml(v.date)} • ${escapeHtml(v.notes)}</div>
        </div>
        ${isCurrent ? '' : `<a class="btn btn-secondary" href="${v.path}" style="font-size:12px;padding:6px 10px">Open</a>`}
      </div>
    `;
  }).join('');
}

async function doAppUpdate() {
  if (!('serviceWorker' in navigator)) {
    location.reload();
    return;
  }
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const r of regs) await r.unregister();
  const keys = await caches.keys();
  for (const k of keys) await caches.delete(k);
  location.href = './';
}

document.getElementById('btn-check-update').addEventListener('click', checkAppUpdate);

document.getElementById('btn-amm-redetect')?.addEventListener('click', async () => {
  console.log('[AMM] Manual re-detect triggered');
  state.amm = await probeAMM();
  loadSettings();
});

document.getElementById('btn-run-diagnostics')?.addEventListener('click', () => {
  console.log('[Diagnostics] Starting network diagnostics...');
  runNetworkDiagnostics();
});

function checkConfidence(values) {
  const { sys, dia, hr } = values;
  if (!sys || !dia) return { level: 'RED', reason: 'Missing values' };
  if (sys < 90 || sys > 220 || dia < 50 || dia > 130 || sys <= dia) return { level: 'RED', reason: 'Out of range' };
  if (hr && (hr < 40 || hr > 180)) return { level: 'RED', reason: 'HR out of range' };
  const pp = sys - dia;
  if (pp < 20 || pp > 100) return { level: 'AMBER', reason: 'Unusual pulse pressure' };
  return { level: 'GREEN', reason: 'OK' };
}

async function startBatchProcessing() {
  if (state.isProcessing) return;
  state.isProcessing = true;
  state.pauseRequested = false;
  updateQueueUIState();

  while (state.isProcessing) {
    if (state.pauseRequested) { state.isProcessing = false; break; }
    const pending = state.queue.filter(q => q.status === 'pending_ocr');
    if (!pending.length) { state.isProcessing = false; break; }

    const entry = pending[0];
    entry.status = 'processing';
    await db.put('entries', entry);
    await refreshQueue();
    renderQueue();

    try {
      const img = await db.get('images', entry.id);
      if (!img || !img.data) throw new Error('Image not found');

      let blob = img.data;
      try {
        blob = await preprocessImage(blob, { minDimension: 1800, rotation: 0 });
      } catch (e) { console.warn('[Batch] Preprocess failed, using original', e); }

      const dataUrl = await blobToDataUrl(blob);
      const engineInfo = await selectActiveEngine();
      if (!engineInfo) throw new Error('No AI engine available. Configure Ollama or API in Settings.');

      let values;
      const settings = engineInfo.settings;
      const prompt = settings.prompt;
      if (engineInfo.engine === 'amm') {
        values = await runAmmVision(dataUrl, prompt);
      } else if (engineInfo.engine === 'ollama') {
        values = await runOllamaVision(dataUrl, settings.ollamaHost, settings.ollamaModel, prompt);
      } else if (engineInfo.engine === 'api') {
        values = await runApiVision(dataUrl, settings.apiBase, settings.apiKey, settings.apiModel, prompt);
      } else {
        throw new Error('No engine');
      }

      let confidence = checkConfidence(values);
      if (confidence.level === 'RED') {
        console.log('[Batch] Retry with stricter prompt');
        const retryPrompt = (prompt || '') + ' Return valid JSON only.';
        let retryValues;
        if (engineInfo.engine === 'amm') retryValues = await runAmmVision(dataUrl, retryPrompt);
        else if (engineInfo.engine === 'ollama') retryValues = await runOllamaVision(dataUrl, settings.ollamaHost, settings.ollamaModel, retryPrompt);
        else retryValues = await runApiVision(dataUrl, settings.apiBase, settings.apiKey, settings.apiModel, retryPrompt);
        confidence = checkConfidence(retryValues);
        if (confidence.level !== 'RED') values = retryValues;
      }

      if (confidence.level === 'RED') {
        entry.status = 'failed';
        await db.put('entries', entry);
      } else {
        entry.systolic = values.sys;
        entry.diastolic = values.dia;
        entry.heart_rate = values.hr || null;
        entry.pulse_pressure = values.sys - values.dia;
        entry.mean_arterial_pressure = Math.round(entry.diastolic + (entry.pulse_pressure / 3));
        entry.bp_category = computeCategory(values.sys, values.dia);
        if (confidence.level === 'AMBER') {
          entry.status = settings.saveLowConfidence ? 'done' : 'low_confidence';
        } else {
          entry.status = 'done';
        }
        await db.put('entries', entry);
      }
    } catch (e) {
      console.error('[Batch] Processing error', e);
      entry.status = 'failed';
      await db.put('entries', entry);
    }

    await refreshQueue();
    renderQueue();
    if (state.pauseRequested) { state.isProcessing = false; break; }
    const delay = getAiSettings().batchDelay;
    await new Promise(r => setTimeout(r, delay));
  }

  state.isProcessing = false;
  state.pauseRequested = false;
  updateQueueUIState();
  await loadData();
}

function stopBatchProcessing() {
  state.pauseRequested = true;
}

function updateQueueUIState() {
  const processBtn = document.getElementById('btn-process-all');
  const pauseBtn = document.getElementById('btn-pause-all');
  if (!processBtn || !pauseBtn) return;
  if (state.isProcessing) {
    processBtn.style.display = 'none';
    pauseBtn.style.display = 'inline-flex';
  } else {
    processBtn.style.display = 'inline-flex';
    pauseBtn.style.display = 'none';
  }
}

// =================== Queue Screen Rendering ===================
function renderQueue() {
  const container = document.getElementById('queue-entries');
  const empty = document.getElementById('queue-empty');
  const totalCount = document.getElementById('queue-total-count');
  const progressWrap = document.getElementById('queue-progress-wrap');
  const progressBar = document.getElementById('queue-progress-bar');
  const progressText = document.getElementById('queue-progress-text');

  const list = state.queue.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  totalCount.textContent = '(' + list.length + ')';

  if (!list.length) {
    container.innerHTML = '';
    empty.style.display = 'block';
    progressWrap.style.display = 'none';
    progressText.textContent = '';
    return;
  }
  empty.style.display = 'none';

  const done = list.filter(q => q.status === 'done' || q.status === 'low_confidence').length;
  const total = list.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  progressWrap.style.display = 'flex';
  progressBar.style.width = pct + '%';
  progressText.textContent = done + ' / ' + total + ' processed';

  container.innerHTML = list.map(e => queueRowHTML(e)).join('');
  list.forEach(e => {
    const row = document.getElementById('queue-row-' + e.id);
    if (!row) return;
    const thumb = row.querySelector('.queue-thumb');
    db.get('images', e.id).then(img => {
      if (img && img.data) thumb.src = URL.createObjectURL(img.data);
    });
    row.querySelector('.btn-process')?.addEventListener('click', () => { e.status = 'pending_ocr'; db.put('entries', e).then(refreshQueue).then(renderQueue); });
    row.querySelector('.btn-retry')?.addEventListener('click', () => { e.status = 'pending_ocr'; db.put('entries', e).then(refreshQueue).then(renderQueue).then(() => { if (!state.isProcessing) startBatchProcessing(); }); });
    row.querySelector('.btn-delete')?.addEventListener('click', () => showModal('Delete this queued photo?', async () => { await db.delete('entries', e.id); await db.delete('images', e.id); await refreshQueue(); renderQueue(); }));
    row.querySelector('.btn-edit')?.addEventListener('click', () => showQueueEdit(e.id));
    row.querySelector('.btn-skip')?.addEventListener('click', () => { e.status = 'skipped'; db.put('entries', e).then(refreshQueue).then(renderQueue); });
    row.querySelector('.btn-enter')?.addEventListener('click', () => showQueueEdit(e.id));
  });
}

function queueRowHTML(e) {
  const ts = e.timestamp ? fmtDate(e.timestamp) : 'Unknown';
  const noExif = e.ts_source === 'now (no EXIF)';
  const statusMap = {
    pending_ocr: { chip: 'status-pending', icon: '\u23F3', text: 'Pending' },
    processing: { chip: 'status-processing', icon: '\uD83D\uDD04', text: 'Processing' },
    done: { chip: 'status-done', icon: '\u2705', text: 'Done — ' + (e.systolic || '?') + '/' + (e.diastolic || '?') + ' \u00B7 ' + (e.heart_rate || '?') },
    low_confidence: { chip: 'status-low-confidence', icon: '\u26A0\uFE0F', text: 'Low Confidence — ' + (e.systolic || '?') + '/' + (e.diastolic || '?') },
    failed: { chip: 'status-failed', icon: '\u274C', text: 'Failed — low confidence' },
    skipped: { chip: 'status-skipped', icon: '\u23ED\uFE0F', text: 'Skipped' },
  };
  const s = statusMap[e.status] || statusMap.pending_ocr;
  let actions = '';
  if (e.status === 'pending_ocr') {
    actions = '<button class="btn btn-outline btn-process" style="font-size:12px;padding:4px 8px;min-height:28px">Process</button><button class="btn btn-outline btn-skip" style="font-size:12px;padding:4px 8px;min-height:28px">Skip</button><button class="btn btn-danger btn-delete" style="font-size:12px;padding:4px 8px;min-height:28px">Delete</button>';
  } else if (e.status === 'processing') {
    actions = '<button class="btn btn-outline btn-delete" style="font-size:12px;padding:4px 8px;min-height:28px">Delete</button>';
  } else if (e.status === 'done' || e.status === 'low_confidence') {
    actions = '<button class="btn btn-outline btn-edit" style="font-size:12px;padding:4px 8px;min-height:28px">Edit</button><button class="btn btn-danger btn-delete" style="font-size:12px;padding:4px 8px;min-height:28px">Delete</button>';
  } else if (e.status === 'failed') {
    actions = '<button class="btn btn-outline btn-retry" style="font-size:12px;padding:4px 8px;min-height:28px">Retry</button><button class="btn btn-outline btn-enter" style="font-size:12px;padding:4px 8px;min-height:28px">Enter Manually</button><button class="btn btn-danger btn-delete" style="font-size:12px;padding:4px 8px;min-height:28px">Delete</button>';
  } else if (e.status === 'skipped') {
    actions = '<button class="btn btn-outline btn-retry" style="font-size:12px;padding:4px 8px;min-height:28px">Retry</button><button class="btn btn-danger btn-delete" style="font-size:12px;padding:4px 8px;min-height:28px">Delete</button>';
  }

  return '<div class="queue-row ' + e.status + '" id="queue-row-' + e.id + '">' +
    '<img class="queue-thumb" src="" alt="" />' +
    '<div class="queue-body">' +
      '<div class="queue-meta">' + ts + (noExif ? ' <span class="badge" style="font-size:10px">(no EXIF)</span>' : '') + '</div>' +
      '<div class="status-chip ' + s.chip + '">' + s.icon + ' ' + s.text + '</div>' +
      '<div class="queue-actions mt-2">' + actions + '</div>' +
    '</div>' +
  '</div>';
}

function showQueueEdit(entryId) {
  const e = state.queue.find(q => q.id === entryId);
  if (!e) return;
  showScreen('ocr');
  state.pendingEntryId = e.id;
  db.get('images', e.id).then(img => {
    if (img && img.data) {
      state.pendingImage = { blob: img.data, dataUrl: URL.createObjectURL(img.data), timestamp: e.timestamp };
      document.getElementById('ocr-preview').src = state.pendingImage.dataUrl;
    }
  });
  document.getElementById('ocr-timestamp').value = toDatetimeLocal(e.timestamp);
  document.getElementById('ocr-ts-source').textContent = '(' + (e.ts_source || 'unknown') + ')';
  document.getElementById('ocr-sys').value = e.systolic || '';
  document.getElementById('ocr-dia').value = e.diastolic || '';
  document.getElementById('ocr-hr').value = e.heart_rate || '';
  document.getElementById('ocr-note').value = e.note || '';
  document.getElementById('ocr-brand').value = e.machine_brand || '';
  ocrTags.length = 0;
  if (e.tags) e.tags.forEach(t => ocrTags.push(t));
  renderOcrTags();
}

// =================== Modal / Loading ===================
function showModal(message, onConfirm) {
  document.getElementById('modal-body').textContent = message;
  document.getElementById('modal-overlay').classList.add('active');
  const confirmBtn = document.getElementById('modal-confirm');
  const cancelBtn = document.getElementById('modal-cancel');
  const handler = async () => {
    document.getElementById('modal-overlay').classList.remove('active');
    confirmBtn.removeEventListener('click', handler);
    cancelBtn.removeEventListener('click', closeHandler);
    if (onConfirm) await onConfirm();
  };
  const closeHandler = () => {
    document.getElementById('modal-overlay').classList.remove('active');
    confirmBtn.removeEventListener('click', handler);
    cancelBtn.removeEventListener('click', closeHandler);
  };
  confirmBtn.addEventListener('click', handler);
  cancelBtn.addEventListener('click', closeHandler);
}
function showLoading(text='Please wait') {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading-overlay').classList.add('active');
}
function updateLoadingText(text) {
  document.getElementById('loading-text').textContent = text;
}
function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('active');
}
function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// =================== Add user button ===================
document.getElementById('btn-add-user').addEventListener('click', () => {
  const name = document.getElementById('new-user-name').value.trim();
  if (!name) return;
  addUser(name);
  document.getElementById('new-user-name').value = '';
});

// =================== Batch Upload ===================
document.getElementById('btn-batch-upload').addEventListener('click', () => {
  document.getElementById('input-batch').click();
});
document.getElementById('input-batch').addEventListener('change', async (ev) => {
  const files = Array.from(ev.target.files);
  if (!files.length) return;
  await processBatchFiles(files);
  ev.target.value = '';
});

// Drag and drop
const dropZone = document.getElementById('drop-zone');
['dragenter','dragover','dragleave','drop'].forEach(evt => {
  dropZone?.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); });
});
['dragenter','dragover'].forEach(evt => {
  dropZone?.addEventListener(evt, () => dropZone.classList.add('drag-over'));
});
['dragleave','drop'].forEach(evt => {
  dropZone?.addEventListener(evt, () => dropZone.classList.remove('drag-over'));
});
dropZone?.addEventListener('drop', async (e) => {
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  if (files.length) await processBatchFiles(files);
});

// Show drop zone on desktop
if (window.matchMedia('(min-width: 768px)').matches) {
  dropZone.style.display = 'block';
}

// Queue home card
document.getElementById('btn-queue-process-now')?.addEventListener('click', () => {
  showScreen('queue');
  startBatchProcessing();
});
document.getElementById('btn-queue-dismiss')?.addEventListener('click', () => {
  localStorage.setItem('bplog_queue_card_dismissed', '1');
  document.getElementById('queue-home-card').style.display = 'none';
});

// Header queue badge
document.getElementById('header-queue-badge')?.addEventListener('click', () => {
  showScreen('queue');
  renderQueue();
});

// Queue screen buttons
document.getElementById('btn-process-all')?.addEventListener('click', () => startBatchProcessing());
document.getElementById('btn-pause-all')?.addEventListener('click', () => stopBatchProcessing());
document.getElementById('btn-queue-settings')?.addEventListener('click', () => showScreen('settings'));

// Navigation hook for queue
document.querySelector('header .nav-btn[data-screen="queue"]')?.addEventListener('click', () => {
  showScreen('queue');
  renderQueue();
});

// =================== AI Engine Settings Events ===================
function saveAiSettings() {
  localStorage.setItem('bplog_ollama_host', document.getElementById('setting-ollama-host').value.trim() || 'http://localhost:11434');
  localStorage.setItem('bplog_ollama_model', document.getElementById('setting-ollama-model').value.trim() || 'llava:7b');
  localStorage.setItem('bplog_api_base_url', document.getElementById('setting-api-base').value.trim());
  localStorage.setItem('bplog_api_key', document.getElementById('setting-api-key').value.trim());
  localStorage.setItem('bplog_api_model', document.getElementById('setting-api-model').value.trim() || 'gpt-4o-mini');
  localStorage.setItem('bplog_default_prompt', document.getElementById('setting-prompt').value.trim());
  localStorage.setItem('bplog_batch_delay_ms', document.getElementById('setting-batch-delay').value);
  localStorage.setItem('bplog_auto_process', document.getElementById('setting-auto-process').checked ? 'true' : 'false');
  localStorage.setItem('bplog_save_low_confidence', document.getElementById('setting-save-low-confidence').checked ? 'true' : 'false');
}

['setting-ollama-host','setting-ollama-model','setting-api-base','setting-api-model','setting-prompt','setting-batch-delay'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', saveAiSettings);
});
document.getElementById('setting-api-key')?.addEventListener('input', saveAiSettings);
document.getElementById('setting-auto-process')?.addEventListener('change', saveAiSettings);
document.getElementById('setting-save-low-confidence')?.addEventListener('change', saveAiSettings);

document.getElementById('btn-api-key-show')?.addEventListener('click', () => {
  const el = document.getElementById('setting-api-key');
  el.type = el.type === 'password' ? 'text' : 'password';
});
document.getElementById('btn-api-key-clear')?.addEventListener('click', () => {
  document.getElementById('setting-api-key').value = '';
  saveAiSettings();
});

document.getElementById('btn-reset-prompt')?.addEventListener('click', () => {
  document.getElementById('setting-prompt').value = 'Read the blood pressure monitor. Return JSON: {sys, dia, bpm}. No prose.';
  saveAiSettings();
});

document.getElementById('btn-test-ollama')?.addEventListener('click', async () => {
  const status = document.getElementById('ollama-test-status');
  status.textContent = 'Testing…';
  const host = document.getElementById('setting-ollama-host').value.trim() || 'http://localhost:11434';
  const res = await probeOllama(host);
  if (res.ok) status.innerHTML = '<span style="color:var(--success)">Connected · ' + res.models.slice(0,3).join(', ') + '</span>';
  else status.innerHTML = '<span style="color:var(--danger)">Error: ' + escapeHtml(res.error) + '</span>';
});

document.getElementById('btn-test-api')?.addEventListener('click', async () => {
  const status = document.getElementById('api-test-status');
  status.textContent = 'Testing…';
  const base = document.getElementById('setting-api-base').value.trim();
  const key = document.getElementById('setting-api-key').value.trim();
  if (!base) { status.innerHTML = '<span style="color:var(--warning)">Not configured</span>'; return; }
  const res = await probeApi(base, key);
  if (res.ok) status.innerHTML = '<span style="color:var(--success)">Connected · ' + res.models.slice(0,3).join(', ') + '</span>';
  else status.innerHTML = '<span style="color:var(--danger)">Error: ' + escapeHtml(res.error) + '</span>';
});

// Engine priority drag-and-drop
function renderEnginePriority() {
  const container = document.getElementById('engine-priority-list');
  if (!container) return;
  const priority = getEnginePriority();
  const labels = { amm: '🔵 AMM Bridge', ollama: '🟢 Ollama (local)', api: '🟡 OpenAI-compatible API', template: '🟠 7-Segment Template Matcher' };
  container.innerHTML = priority.map((engine, i) =>
    '<div class="engine-priority-item" draggable="true" data-engine="' + engine + '" data-index="' + i + '">' +
      '<span class="drag-handle">☰</span>' + (labels[engine] || engine) +
    '</div>'
  ).join('');
  container.querySelectorAll('.engine-priority-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', item.dataset.index);
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('dragover', (e) => e.preventDefault());
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromIdx = Number(e.dataTransfer.getData('text/plain'));
      const toIdx = Number(item.dataset.index);
      const list = getEnginePriority();
      const moved = list.splice(fromIdx, 1)[0];
      list.splice(toIdx, 0, moved);
      saveEnginePriority(list);
      renderEnginePriority();
    });
  });
}

// =================== PWA Install Prompt ===================
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  state.deferredInstall = e;
});

// =================== Service Worker ===================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(console.error);
}

// =================== URL Shortcuts ===================
function handleUrlShortcuts() {
  const params = new URLSearchParams(window.location.search);
  const shortcut = params.get('shortcut');
  if (shortcut === 'camera') {
    setTimeout(() => document.getElementById('input-camera').click(), 300);
  } else if (shortcut === 'logs') {
    setTimeout(() => showScreen('logs'), 300);
  }
  if (shortcut) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

// =================== Window Management ===================
function initCardMinimize() {
  document.querySelectorAll('.card').forEach(card => {
    const title = card.querySelector('.card-title');
    if (!title) return;
    // Skip cards that are too small or inside OCR/detail screens
    if (card.closest('#screen-ocr') || card.closest('#screen-detail')) return;

    const btn = document.createElement('button');
    btn.className = 'btn-minimize';
    btn.innerHTML = '−';
    btn.title = 'Minimize';
    title.appendChild(btn);

    // Restore state
    const key = 'bplog_card_' + (card.closest('section')?.id || 'global') + '_' + (title.textContent?.trim() || 'card');
    if (localStorage.getItem(key) === 'collapsed') {
      card.classList.add('collapsed');
      btn.innerHTML = '+';
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const collapsed = card.classList.toggle('collapsed');
      btn.innerHTML = collapsed ? '+' : '−';
      localStorage.setItem(key, collapsed ? 'collapsed' : 'expanded');
    });
  });
}

function initScreenCloseButtons() {
  document.querySelectorAll('.screen').forEach(screen => {
    if (screen.id === 'screen-home') return;
    const btn = document.createElement('button');
    btn.className = 'btn-screen-close';
    btn.innerHTML = '×';
    btn.title = 'Close';
    btn.addEventListener('click', () => showScreen('home'));
    screen.appendChild(btn);
  });
}

// Modal dismiss on overlay click or Escape
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'modal-overlay') {
    document.getElementById('modal-overlay').classList.remove('active');
  }
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('modal-overlay').classList.remove('active');
  }
});

// =================== Helpers ===================
function dataUrlToBlob(dataUrl) {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) { u8arr[n] = bstr.charCodeAt(n); }
  return new Blob([u8arr], { type: mime });
}

// =================== AMM Detection ===================
async function probeAMM() {
  // Prefer JS bridge (no HTTP/PNA issues)
  if (window.AMMBridge) {
    try {
      const isLoaded = window.AMMBridge.isVisionModelLoaded && window.AMMBridge.isVisionModelLoaded();
      const modelName = window.AMMBridge.getLoadedModelName && window.AMMBridge.getLoadedModelName() || 'unknown';
      if (isLoaded) {
        console.log('[AMM] Bridge probe success:', modelName);
        return {
          version: window.AMMBridge.getAmmVersion ? window.AMMBridge.getAmmVersion() : '1.1.4',
          ready: true,
          capabilities: ['vision'],
          models: { vision: modelName },
          queue_depth: 0,
          inference_mode: 'local',
        };
      }
      console.warn('[AMM] Bridge probe: vision model not loaded. Load a model in AMM Vision Hub.');
    } catch (e) {
      console.warn('[AMM] Bridge probe error:', e.message || e);
    }
  }

  // Fallback: HTTP probe (may fail on HTTPS pages due to PNA)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('http://127.0.0.1:8765/v1/status', {
      signal: controller.signal,
      mode: 'cors',
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn('[AMM] HTTP probe error:', res.status);
      return null;
    }
    const data = await res.json();
    if (data.ready && Array.isArray(data.capabilities) && data.capabilities.includes('vision')) {
      console.log('[AMM] HTTP probe success:', data);
      return data;
    }
    console.warn('[AMM] HTTP probe returned but not ready:', data);
    return null;
  } catch (e) {
    console.warn('[AMM] HTTP probe failed:', e.message || e);
    return null;
  }
}

function parseAmmResponse(data) {
  const text = data.response || '';
  let parsed = null;
  try {
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    // fallback: regex extract
  }
  if (!parsed) {
    const nums = text.match(/\d+/g)?.map(Number) || [];
    if (nums.length >= 2) {
      parsed = { sys: nums[0], dia: nums[1], bpm: nums[2] ?? null };
    }
  }
  return {
    sys: parsed?.sys ?? null,
    dia: parsed?.dia ?? null,
    hr: parsed?.bpm ?? parsed?.pulse ?? null,
    algo: 'amm-vision',
    rawText: text,
  };
}

async function runAmmVision(dataUrl, prompt) {
  // Prefer JS bridge (bypasses CORS/PNA entirely), fallback to HTTP
  if (window.AMMBridge && window.AMMBridge.isVisionModelLoaded && window.AMMBridge.isVisionModelLoaded()) {
    console.log('[OCR] Using AMM JS Bridge (bypasses HTTP/CORS)...');
    const base64 = dataUrl.split(',')[1];
    const jsonStr = window.AMMBridge.ammVisionInfer(
      base64,
      prompt || 'Read the three numbers on this blood pressure monitor display. Return JSON: {"sys": <top>, "dia": <middle>, "bpm": <bottom>}. No prose, no markdown.'
    );
    const data = JSON.parse(jsonStr);
    if (!data.success) throw new Error(data.error || 'AMM bridge inference failed');
    return parseAmmResponse(data);
  }

  // Fallback: HTTP fetch (may be blocked by PNA on HTTPS pages)
  console.log('[OCR] Stage 1/4: Decoding image...');
  const blob = dataUrlToBlob(dataUrl);
  const formData = new FormData();
  formData.append('image', blob, 'bp.jpg');
  formData.append('prompt', prompt || 'Read the three numbers on this blood pressure monitor display. Return JSON: {"sys": <top>, "dia": <middle>, "bpm": <bottom>}. No prose, no markdown.');

  console.log('[OCR] Stage 2/4: Sending to AMM (127.0.0.1:8765)...');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const res = await fetch('http://127.0.0.1:8765/v1/vision/completions', {
    method: 'POST',
    body: formData,
    signal: controller.signal,
    mode: 'cors',
  });
  clearTimeout(timer);
  console.log('[OCR] Stage 3/4: AMM responded, parsing...');
  if (!res.ok) throw new Error(`AMM HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'AMM inference failed');

  console.log('[OCR] Stage 4/4: Extracting values from response...');
  return parseAmmResponse(data);
}

// =================== Diagnostics ===================
async function runNetworkDiagnostics() {
  const overlay = document.getElementById('diagnostics-overlay');
  const body = document.getElementById('diagnostics-modal-body');
  const copyBtn = document.getElementById('diagnostics-copy');
  const closeBtn = document.getElementById('diagnostics-close');
  if (!overlay || !body) return;

  overlay.classList.add('active');
  body.textContent = 'Running diagnostics...\n';
  if (copyBtn) copyBtn.textContent = '📋 Copy';

  const results = [];
  const ok = (label, detail) => { results.push(`✅ ${label}${detail ? ' — ' + detail : ''}`); };
  const fail = (label, detail) => { results.push(`❌ ${label}${detail ? ' — ' + detail : ''}`); };

  // 1. Protocol check
  const isHttps = location.protocol === 'https:';
  if (isHttps) {
    fail('Page is HTTPS', 'Mixed-content + PNA may block HTTP localhost (see workaround below)');
  } else {
    ok('Page is HTTP (no mixed-content risk)');
  }

  // 2. User agent / browser engine detection
  const ua = navigator.userAgent;
  const isWebView = /wv|WebView/.test(ua);
  const isChrome = /Chrome/.test(ua) && !isWebView;
  const isFirefox = /Firefox/.test(ua) || /Gecko/.test(ua);
  const isGeckoView = isFirefox && window.AMMBridge;
  if (isGeckoView) {
    ok('Browser is GeckoView (Firefox)', 'AMM Browser embedded Firefox engine');
  } else if (isWebView) {
    ok('Browser is WebView (Chrome)', 'AMM Browser embedded Chrome engine');
  } else if (isChrome) {
    ok('Browser is Chrome');
  } else if (isFirefox) {
    ok('Browser is Firefox');
  } else {
    ok('Browser detected', ua.slice(0, 50));
  }

  // 3. Can we reach AMM health endpoint?
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('http://127.0.0.1:8765/health', {
      signal: controller.signal,
      mode: 'cors',
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      ok('Health endpoint reachable', JSON.stringify(data));
    } else {
      fail('Health endpoint HTTP error', `status=${res.status}`);
    }
  } catch (e) {
    fail('Health endpoint unreachable', e.name === 'AbortError' ? 'Timeout (3s)' : e.message);
  }

  // 4. Can we reach AMM status endpoint?
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('http://127.0.0.1:8765/v1/status', {
      signal: controller.signal,
      mode: 'cors',
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data.ready) {
        ok('Status endpoint: READY', `model=${data.models?.vision || '?'}`);
      } else {
        fail('Status endpoint: model not loaded', 'Load a vision model in AMM Vision Hub');
      }
    } else {
      fail('Status endpoint HTTP error', `status=${res.status}`);
    }
  } catch (e) {
    fail('Status endpoint unreachable', e.name === 'AbortError' ? 'Timeout (3s)' : e.message);
  }

  // 5. CORS preflight check
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('http://127.0.0.1:8765/v1/status', {
      method: 'OPTIONS',
      signal: controller.signal,
      mode: 'cors',
    });
    clearTimeout(timer);
    const allowPrivate = res.headers.get('Access-Control-Allow-Private-Network');
    if (allowPrivate) {
      ok('CORS preflight OK', 'Access-Control-Allow-Private-Network: true');
    } else {
      fail('CORS preflight missing PNA header', 'AMM server may need update');
    }
  } catch (e) {
    fail('CORS preflight failed', e.name === 'AbortError' ? 'Timeout (3s)' : e.message);
  }

  // 6. JS Bridge check
  if (window.AMMBridge) {
    ok('AMM JS Bridge available', 'Bypasses HTTP/PNA issues entirely');
    try {
      const isLoaded = window.AMMBridge.isVisionModelLoaded && window.AMMBridge.isVisionModelLoaded();
      const modelName = window.AMMBridge.getLoadedModelName && window.AMMBridge.getLoadedModelName() || 'unknown';
      if (isLoaded) {
        ok('Vision model loaded', modelName);
      } else {
        fail('Vision model not loaded', 'Open AMM → Vision Hub → load a vision model');
      }
    } catch (e) {
      fail('Bridge vision check error', e.message || e);
    }
  } else {
    fail('AMM JS Bridge not found', 'Update AMM app to v1.1.4+ for bridge support');
  }

  // 7. AMM state from probe
  if (state.amm) {
    ok('probeAMM() state OK', `ready=true, model=${state.amm.models?.vision || '?'}`);
  } else {
    fail('probeAMM() state', 'AMM not detected');
  }

  // Summary
  const fails = results.filter(r => r.startsWith('❌')).length;
  const summary = fails === 0
    ? '\n✅ All checks passed. AMM is ready!'
    : `\n⚠️ ${fails} check(s) failed.`;
  const bridgeAvailable = !!window.AMMBridge;
  const bridgeWorkaround = bridgeAvailable
    ? '\n\n💡 Bridge is connected but AMM is not ready.\n   Open AMM → Vision Hub → load a vision model (e.g., Qwen2.5-VL-3B).'
    : '\n\n💡 WORKAROUND: You are on HTTPS. Browser PNA may block localhost.\n   Try: Open this page inside AMM Browser (uses JS bridge, no HTTP needed)\n   or serve BPLog over plain HTTP on your local network.';
  const workaround = isHttps ? bridgeWorkaround : '';

  body.textContent = results.join('\n') + summary + workaround;

  closeBtn?.addEventListener('click', () => overlay.classList.remove('active'));
  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(body.textContent);
      copyBtn.textContent = '✅ Copied!';
      setTimeout(() => copyBtn.textContent = '📋 Copy', 1500);
    } catch (err) {
      copyBtn.textContent = '❌ Failed';
      setTimeout(() => copyBtn.textContent = '📋 Copy', 1500);
    }
  });
}

// =================== Init ===================
(async () => {
  await initDB();
  // Request persistent storage so Chrome doesn't evict IndexedDB for the installed PWA
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  await loadUsers();
  if (state.currentUserId) await loadData();
  updateOnlineStatus();
  checkVersion();
  initLandingCard();
  initDisclaimer();
  handleUrlShortcuts();
  initCardMinimize();
  initScreenCloseButtons();
  initDebugConsole();
  // Probe AMM once on startup
  state.amm = await probeAMM();
  if (state.amm) {
    console.log('[AMM] Detected:', state.amm.models?.vision || 'vision model ready');
  } else {
    console.warn('[AMM] Not detected. To use vision OCR:');
    console.warn('  1. Open AMM app → Vision Hub');
    console.warn('  2. Load a vision model (Qwen2-VL or similar)');
    console.warn('  3. Toggle HTTP service ON');
    console.warn('  4. Return to BPLog and tap "AI ON" if needed');
  }
  // Check for unprocessed queue on startup
  if (state.currentUserId) await refreshQueue();
  loadSettings();
})();
