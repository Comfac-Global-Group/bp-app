# BPLog Build QA Log
**Session Date:** 2026-04-14  
**Agent:** Kimi Code CLI  
**Project:** bp-app (`/home/justin/opencode260220/bp-app`)

---

## 11:24 — Discovery
- Read `/home/justin/opencode260220/bp-app/BP-FRD.md` (380 lines)
- Confirmed repo exists at `/home/justin/opencode260220/bp-app`
- Verified remote: `https://github.com/Comfac-Global-Group/bp-app`

## 11:25 — PWA Shell Created
- `manifest.json` — PWA manifest with `theme_color: #0d7377`, icons (192px + 512px SVG), `display: standalone`
- `sw.js` — Cache-first service worker for app shell + CDN assets

## 11:26 — UI Shell Created
- `styles.css` — Mobile-first CSS (360–430px viewport), touch targets ≥44×44px, badge color-coding for BP categories
- `index.html` — Single-page app with 8 screens: Home, OCR, Logs, Detail, Reports, Images, Export/Import, Settings

## 11:27 — Core Application Logic (Part 1)
- `app.js` — Added:
  - IndexedDB schema (`idb` UMD) with stores: `users`, `entries` (+ `user_id` index), `images`, `tags`
  - User CRUD (add, rename, delete with confirmation)
  - Navigation router (`showScreen`)
  - Data loading pipeline
  - Recent entries renderer
  - Capture flow: camera/gallery → EXIF timestamp extraction (`exifr`) → canvas preprocessing → Tesseract.js OCR
  - Editable OCR fields + tag input system
  - Entry save with derived metrics (PP, MAP, BP category)

## 11:30 — Core Application Logic (Part 2)
- `app.js` — Added:
  - Log list with infinite-scroll-style rendering
  - Filters: date range, category, multi-select tags, sort toggle
  - Entry detail view with inline editing (values, notes, tags)
  - Reports screen with Chart.js line charts (Sys/Dia, HR, PP/MAP)
  - Summary statistics (avg, min, max, std dev)
  - Tag analytics table
  - PDF generation via jsPDF + AutoTable (cover → stats → charts → tag analytics → full log table)

## 11:32 — Core Application Logic (Part 3)
- `app.js` — Added:
  - Export: JSON, Image ZIP, Combined ZIP (`JSZip`)
  - Import: JSON/ZIP with skip/overwrite conflict strategy
  - Image Manager: storage gauge (`navigator.storage.estimate`), bulk delete, orphan cleanup
  - Settings: profile editing, PWA install prompt (`beforeinstallprompt`)
  - Modal/loading overlay utilities

## 11:33 — Validation & Fixes
- Ran `node -c app.js` → syntax valid
- Ran `git status --short` → 7 untracked files
- Verified CDN URL for `idb@8` → switched from `build/index.js` to `build/umd.js` in both `index.html` and `sw.js`
- Fixed empty thumbnail `src` to use transparent 1×1 GIF placeholder
- Fixed `entries` object store to include `user_id` index (required for `getAllFromIndex`)
- Enhanced user selector with inline delete button (+ CSS)
- Re-ran `node -c app.js` → syntax valid

## 11:35 — Git Commit & Push (Initial Build)
```
git add -A
git commit -m "Initial build of BPLog PWA v1.1"
git push origin main
```
- **Commit hash:** `c9a7a49`
- **Files committed (7):**
  1. `BP-FRD.docx`
  2. `BP-FRD.md`
  3. `app.js`
  4. `index.html`
  5. `manifest.json`
  6. `styles.css`
  7. `sw.js`

## 11:36 — QA Log Generated
- Created `QA-log.md` (this file)

## 11:37 — GitHub Pages 404 Fix
- Diagnosed Pages deployment: repo was set to `build_type: "workflow"` but had no Actions workflow file.
- Created `.github/workflows/deploy-pages.yml` (standard static Pages deploy action).
- Committed and pushed. Workflow queued.
- **Commit hash:** `83a8a29`

---

## 12:00 — v1.2 Feature Round: Version Tracking, Dark Mode, UX Polish, Disclaimer

### FRD Updates (`BP-FRD.md`)
- Bumped version to **1.2**
- Added §15 **Version Tracking** — automated version badge comparing local build SHA to GitHub API `commits/main`
- Added §16 **Offline / Local Status** — header pill indicator when `navigator.onLine === false`
- Added §17 **Landing Instructions & Disclaimer** — home-screen instruction card + medical disclaimer modal
- Updated §3.1 User Selector — header dropdown with selected user as default
- Updated §6.1 Log List — header banner showing active user name + date range
- Updated §10 PWA Requirements — night theme toggle
- Updated §12 Screen Inventory — landing card, log header, dark mode, version badge

### README Updates (`README.md`)
- Expanded problem statement (frictionless, device-agnostic, privacy-first)
- Documented core principles (self-hosted, data ownership, no tracking, portable, GPL3)
- Added quick-start guide
- Added tech stack, credits (Comfac-IT.com with Kimi, Claude, DeepSeek), license, and medical disclaimer

### App Updates (`index.html`, `styles.css`, `app.js`)
- **Header** — added version badge (`#version-badge`), offline badge (`#offline-badge`), and user dropdown (`#header-user-select`)
- **Landing card** — dismissible home-screen instructions with local-storage persistence
- **Disclaimer modal** — shown once per device on first load; must be acknowledged
- **Dark mode** — toggle in Settings, persisted to `localStorage`, CSS variables switch via `[data-theme="dark"]`, charts re-render with theme-aware colors
- **Log header banner** — dynamically shows selected user name and active filter date range
- **Reports** — user name shown in report options card
- **Settings** — added dark mode toggle, build SHA display, disclaimer footer card
- **Version check** — fetches GitHub API on load; shows "Up to date" (green) or "Update available" (amber)
- **Online status** — live header pill when offline

### Validation
- Ran `node -c app.js` → syntax valid

---

## Build Summary
| Component | Status |
|-----------|--------|
| PWA Shell (manifest + SW) | ✅ |
| IndexedDB Schema | ✅ |
| User Profiles + Header Dropdown | ✅ |
| Camera / Gallery Capture | ✅ |
| Tesseract.js OCR (on-device) | ✅ |
| EXIF Timestamp Extraction | ✅ |
| Log CRUD + Filters + User/Date Header | ✅ |
| Interactive Charts (theme-aware) | ✅ |
| PDF Report (jsPDF + AutoTable) | ✅ |
| Export / Import (JSON + ZIP) | ✅ |
| Image Manager + Orphan Cleanup | ✅ |
| Settings + Dark Mode + Version Badge | ✅ |
| Offline Indicator | ✅ |
| Landing Instructions | ✅ |
| Disclaimer (modal + footer) | ✅ |
| GitHub Pages Deploy Workflow | ✅ |
| Git Push to `main` | ✅ |

## Known Limitations / Notes
- OCR accuracy depends on image quality and contrast; values are always presented in editable fields before save.
- PWA install prompt requires HTTPS and a supporting browser; fallback is manual "Add to Home Screen."
- Chart.js zoom plugin not included in v1.2.
- GitHub API version check may be rate-limited or fail offline gracefully.
- Bundle relies on CDN libraries; first load caches all assets via Service Worker for full offline use.
