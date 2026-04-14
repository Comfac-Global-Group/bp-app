/* BPLog — app.js */
'use strict';

// =================== Build Info ===================
const APP_VERSION = 'dev'; /* CI_INJECT_VERSION */
const BUILD_SHA = 'dev'; /* CI_INJECT_SHA */
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
};

const PALETTE = ['#0d7377','#14a085','#2ecc71','#3498db','#9b59b6','#e74c3c','#f39c12','#1abc9c'];

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
  const btn = document.querySelector(`header .nav-btn[data-screen="${id}"]`);
  if (btn) btn.classList.add('active');
  if (id === 'logs') renderLogs();
  if (id === 'reports') renderReports();
  if (id === 'images') renderImages();
  if (id === 'settings') loadSettings();
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
  const tags = (e.tags || []).map(t => `<span class="tag-chip" style="background:${hashColor(t)}22;color:${hashColor(t)}">${escapeHtml(t)}</span>`).join('');
  const note = e.note ? `<div class="text-muted" style="margin-top:4px">${escapeHtml(e.note.slice(0,60))}${e.note.length>60?'…':''}</div>` : '';
  const thumbSrc = e.image_ref ? '' : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  return `
    <div class="entry-row" id="entry-row-${e.id}">
      <img class="entry-thumb" src="${thumbSrc}" data-img="${e.image_ref||''}" id="thumb-${e.id}" />
      <div class="entry-body">
        <div class="entry-meta">${fmtDate(e.timestamp)}</div>
        <div class="entry-values">
          <span class="badge ${badgeClass(e.bp_category)}">${e.systolic}/${e.diastolic}</span>
          <span class="badge">${e.heart_rate} bpm</span>
        </div>
        <div class="tag-list">${tags}</div>
        ${note}
      </div>
    </div>
  `;
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
  try {
    const exif = await exifr.parse(blob);
    if (exif && exif.DateTimeOriginal) timestamp = new Date(exif.DateTimeOriginal).toISOString();
  } catch (e) {}
  state.pendingImage = { blob, dataUrl, timestamp };
  state.pendingEntryId = uuid();
  document.getElementById('ocr-preview').src = dataUrl;
  document.getElementById('ocr-sys').value = '';
  document.getElementById('ocr-dia').value = '';
  document.getElementById('ocr-hr').value = '';
  document.getElementById('ocr-note').value = '';
  document.getElementById('ocr-tags').innerHTML = '';
  document.getElementById('ocr-brand').value = '';
  showScreen('ocr');
  showLoading('Running OCR…');
  try {
    const values = await runOCR(dataUrl);
    if (values.sys) document.getElementById('ocr-sys').value = values.sys;
    if (values.dia) document.getElementById('ocr-dia').value = values.dia;
    if (values.hr) document.getElementById('ocr-hr').value = values.hr;
    if (values.brand) document.getElementById('ocr-brand').value = values.brand;
  } catch (e) {
    console.error('OCR error', e);
  }
  hideLoading();
}

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

async function runOCR(dataUrl) {
  const canvas = await preprocessImage(dataUrl);
  const result = await Tesseract.recognize(canvas.toDataURL('image/png'), 'eng', {
    logger: m => { if (m.status === 'recognizing text') updateLoadingText(`OCR ${Math.round(m.progress*100)}%`); }
  });
  const text = result.data.text;
  const nums = text.match(/\b\d{2,3}\b/g) || [];
  const brand = detectBrand(text);
  if (nums.length >= 3) {
    const n = nums.map(Number).sort((a,b) => b-a);
    return { sys: n[0], dia: n[1], hr: n[2], brand };
  }
  return { sys: null, dia: null, hr: null, brand };
}

function detectBrand(text) {
  const t = text.toLowerCase();
  if (t.includes('omron')) return 'Omron';
  if (t.includes('microlife')) return 'Microlife';
  if (t.includes('a&d')) return 'A&D';
  return null;
}

async function preprocessImage(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  await new Promise(r => img.onload = r);
  const canvas = document.createElement('canvas');
  const max = 1200;
  let w = img.naturalWidth, h = img.naturalHeight;
  if (w > max || h > max) { const s = max / Math.max(w,h); w *= s; h *= s; }
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const idata = ctx.getImageData(0,0,w,h);
  const d = idata.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
    const c = ((gray - 128) * 1.4) + 128;
    const v = Math.max(0, Math.min(255, c));
    d[i] = d[i+1] = d[i+2] = v;
  }
  ctx.putImageData(idata, 0, 0);
  return canvas;
}

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

document.getElementById('btn-ocr-cancel').addEventListener('click', () => {
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
    timestamp: state.pendingImage?.timestamp || new Date().toISOString(),
    systolic: sys, diastolic: dia, heart_rate: hr,
    pulse_pressure: pp, mean_arterial_pressure: map, bp_category: cat,
    note, tags: [...ocrTags], machine_brand: brand,
    image_ref: state.pendingImage ? state.pendingEntryId : null
  };
  await db.put('entries', entry);
  if (state.pendingImage) {
    await db.put('images', { entry_id: state.pendingEntryId, data: state.pendingImage.blob });
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
    const note = document.getElementById('detail-note').value.trim();
    e.systolic = sys; e.diastolic = dia; e.heart_rate = hr;
    e.pulse_pressure = sys - dia;
    e.mean_arterial_pressure = Math.round(dia + (e.pulse_pressure / 3));
    e.bp_category = computeCategory(sys, dia);
    e.note = note; e.tags = [...detailTags];
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
    return t >= s && t < e;
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
}

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

// =================== Init ===================
(async () => {
  await initDB();
  await loadUsers();
  if (state.currentUserId) await loadData();
  updateOnlineStatus();
  checkVersion();
  initLandingCard();
  initDisclaimer();
  handleUrlShortcuts();
})();
