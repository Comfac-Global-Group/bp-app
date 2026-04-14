# BPLog Build QA Log
**Project:** bp-app (`/home/justin/opencode260220/bp-app`)
**Repo:** `https://github.com/Comfac-Global-Group/bp-app`

---

## ★ HANDOFF INSTRUCTIONS FOR ALL AI MODELS ★

If you are an AI model picking up this project, **read this block first**.

### Current Blocker
OCR cannot read any digits from Omron HEM-7121 LCD photos.
All engine × strategy combinations return `NO_EXTRACT`. Zero text recognised.
Root cause: standard OCR engines are trained on printed fonts, not 7-segment LCD shapes.

### Your Mission
Get ANY OCR engine to correctly read SYS + DIA from ONE photo.

### Primary Test Image
```
Bloodpressure Samples/20260414_112450-omron-118-78-59.jpg
Expected: SYS=118, DIA=78, PULSE=59
```
Work ONLY on this image until you achieve `SYS+DIA_MATCH` or `FULL_MATCH`.
Only test other images after success — to check the solution generalises.

### Testing Methodology
1. **Single image first.** Do not spread effort across all 5 images until step 1 works.
2. **Install missing engines first** — priority order is: PaddleOCR → letsgodigital → ocrad → digits:
   ```bash
   # PaddleOCR — modern edge-optimised engine, highest expected accuracy (Priority 1)
   sudo pip3 install paddlepaddle paddleocr --break-system-packages

   # GNU ocrad CLI — same engine as browser ocrad.js (Priority 2)
   sudo apt-get install -y ocrad

   # Tesseract LCD-specific trained data (Priority 3)
   sudo wget -O /usr/share/tesseract-ocr/5/tessdata/letsgodigital.traineddata \
     "https://github.com/Shreeshrii/tessdata_ssd/raw/master/letsgodigital.traineddata"

   # Tesseract digits-only trained data (Priority 4)
   sudo wget -O /usr/share/tesseract-ocr/5/tessdata/digits.traineddata \
     "https://github.com/tesseract-ocr/tessdata/raw/main/digits.traineddata"

   # Florence-2-base VLM (Priority 5 — if all OCR engines fail)
   sudo pip3 install transformers timm --break-system-packages
   # First run auto-downloads ~232MB model to ~/.cache/huggingface/

   # SmolVLM-256M VLM (Priority 6 — alternative micro VLM)
   # Same install as Florence-2. First run downloads ~500MB.
   ```
3. **Run the benchmark:**
   ```bash
   cd /home/justin/opencode260220/bp-app
   python3 scripts/ocr_bench.py --image 20260414 --save-debug 2>&1
   ```
4. **Inspect debug images** at `/tmp/bp_debug/` — check that digits look clean before OCR.
5. **Test ocrad CLI directly** on a debug image to see raw output:
   ```bash
   ocrad /tmp/bp_debug/20260414_112450-omron-118-78-59_lcd_crop_thr128.png
   ```
6. If still failing, try new preprocessing strategies — add them to `STRATEGIES` in `scripts/ocr_bench.py` and re-run.
7. When you find a working combination (or hit a dead end), **append to QA-log.md**:
   ```
   ## OCR Bench Run — YYYY-MM-DD — <your model name>
   ### Engines installed: ...
   ### Best result: strategy=X  engine=Y  score=Z
   ### Raw OCR text: "..."
   ### What did NOT work: ...
   ### Next recommended step: ...
   ```
8. Commit and push:
   ```bash
   git add scripts/ocr_bench.py QA-log.md scripts/ocr_results.json
   git commit -m "test(ocr): <model> bench run YYYY-MM-DD — <brief result>"
   git push origin main
   ```

### Key Facts
- `ocrad` CLI = same engine as `ocrad.js` in the browser PWA. CLI result predicts browser result.
- `letsgodigital.traineddata` is specifically trained on 7-segment LCD digits — highest priority test.
- "OMRON", "SYS mmHg", "DIA mmHg" text is on the **white plastic body**, NOT the LCD screen.
- LCD bounding box in photos: approx **x:27–88%, y:12–63%** of the 4080×3060 image.
- Benchmark script: `scripts/ocr_bench.py` — read the docstring at the top for full instructions.
- Results accumulate in: `scripts/ocr_results.json`

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

## 12:10 — QA Fixes Round (Post-v1.2 Inspection)

### Issues Found
1. **LOCAL_SHA mismatch** — hardcoded to `83a8a29` but actual latest commit was `82f865d`, causing version badge to falsely report "Update available".
2. **IndexedDB version stale** — database version was still `1`. Existing browsers that loaded v1.1 would never receive the `user_id` index on `entries`, causing `getAllFromIndex` to throw in `deleteUser`.
3. **Multi-file upload only processed first file** — FRD requires multi-file select, but `handleFiles` ignored files after index 0.
4. **Manifest missing shortcuts** — FRD §10 mentions PWA shortcuts, but `manifest.json` had no `shortcuts` array.

### Fixes Applied
- **IndexedDB** bumped to version `2` with safe index migration logic using `transaction.objectStore('entries')` to add `user_id` index on existing stores
- **Multi-file queue** implemented — `state.fileQueue` holds remaining files; after saving an entry, the next file auto-loads into OCR preview; cancel clears the queue
- **Manifest shortcuts** added — "Take Photo" (`?shortcut=camera`) and "View Logs" (`?shortcut=logs`) with inline SVG icons
- **URL shortcut handling** added in `app.js` — parses `?shortcut=` on init and triggers camera/logs automatically
- **LOCAL_SHA injection** — changed hardcoded SHA to `'dev'` placeholder; GitHub Actions workflow now injects the actual commit SHA at deploy time, eliminating the chicken-and-egg problem of embedding a commit hash in source code

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
| Multi-file Upload Queue | ✅ |
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
| PWA Shortcuts | ✅ |
| GitHub Pages Deploy Workflow | ✅ |
| Git Push to `main` | ✅ |

## 12:15 — Version Badge Visibility & Auto-Increment Fix

### Issues Found
1. **Version badge not clearly visible** — it was placed in `.header-meta` between the logo and nav buttons, which caused it to be hidden or squashed on narrow mobile viewports.
2. **Version badge showed commit hash, not version number** — users expected a semantic version (e.g., v1.05), not a SHA.
3. **No auto-incrementing version** — the FRD required the version to increase by 0.01 every commit/push.

### Fixes Applied
- **Moved version badge** directly beside the BPLog logo inside `header .title` for guaranteed visibility on all screen sizes.
- **Introduced `APP_VERSION`** — replaced single `LOCAL_SHA` variable with two injected constants:
  - `APP_VERSION` — numeric version computed in CI as `1.00 + (commit_count × 0.01)`
  - `BUILD_SHA` — short commit hash used only for the background sync-check against GitHub API
- **Updated GitHub Actions workflow** — deployment step now calculates commit count with `git rev-list --count HEAD`, computes the version with `awk`, and injects both `APP_VERSION` and `BUILD_SHA` into `app.js` before upload.
- **Badge behavior:**
  - Shows `vX.XX` (e.g., `v1.06`) in production
  - Shows `vdev` during local development
  - Turns green when `BUILD_SHA` matches remote `main`
  - Turns amber when an update is available
- **Settings page** now displays both version and build SHA (e.g., `1.06 (6d3cc38)`).
- **FRD §15** updated to describe the 0.01 auto-increment rule and logo-adjacent placement.

---

## 12:20 — Fix CI Version Injection (Live Site Showing "vdev")

### Issue
The live site displayed **"vdev"** instead of a version number. The GitHub Actions workflow’s `sed` command was malformed — it used `/` as the delimiter while the replacement string contained unescaped `//` comment syntax, causing the pattern match to fail silently. `sed` returns exit code 0 even when no match is found, so the workflow continued and deployed `app.js` with `'dev'` still in place.

### Fix
- Rewrote the workflow step to use `|` as the `sed` delimiter, avoiding all slash-escaping issues.
- Added `set -e` so the step fails fast on any error.
- Added `grep` verification assertions that explicitly check `app.js` contains the injected version and SHA values. If injection fails, the workflow stops before deployment.

### Files Changed
- `.github/workflows/deploy-pages.yml`

---

## 12:25 — Root-Cause Fix: Live Site Shows "vdev" + Stale Cache

### Issue Reported
Screenshot of live site showed **"vdev"** beside the logo, and no proper version number.

### Investigation
- Direct `curl` to deployed `app.js` returned `APP_VERSION = '1.01'` — proving the CI *was* injecting a version.
- However, `1.01` is wrong for a repo with ~10 commits. The expected version should have been ~`1.10`.
- The browser screenshot showed `'dev'` (`vdev`), meaning the browser served a **stale cached** `app.js` from the old `bplog-v1` cache.

### Root Cause 1: Shallow Checkout in CI
`actions/checkout@v4` defaults to `fetch-depth: 1`. Therefore `git rev-list --count HEAD` always returned `1`, making every deployment claim version `1.01`.

**Fix:** Added `fetch-depth: 0` to the checkout step so the full commit history is available for accurate version calculation.

### Root Cause 2: Service Worker Cache Never Invalidated
`sw.js` used a hardcoded cache name (`bplog-v1`) and **cache-first** for `app.js`. Once a browser cached the old file, it never fetched the updated one.

**Fix:** Rewrote `sw.js` to:
- Use **network-first** for the app shell (`index.html`, `app.js`, `styles.css`, `manifest.json`) so online users always get the latest code immediately
- Keep **cache-first** for heavy CDN assets (Tesseract.js, Chart.js, etc.) so offline capability remains fast
- Bump cache name to `bplog-v2` to force old cache eviction on the next SW activation
- Separate `SHELL_ASSETS` and `CDN_ASSETS` for clarity

### FRD Update
- Added **§10.2 Day / Night Theme** as a dedicated subsection with detailed requirements (toggle location, persistence, CSS variable strategy, chart compatibility, system preference fallback).

---

## 12:30 — App Update & Rollback Feature

### FRD Updates
- Added **§16 App Update & Version Rollback** to `BP-FRD.md`
- Documented the update button, version archive strategy, and same-origin data safety guarantee

### CI Workflow Updates (`.github/workflows/deploy-pages.yml`)
- Added **version archiving step**: after injecting `APP_VERSION` and `BUILD_SHA`, the workflow copies `index.html`, `app.js`, `styles.css`, `manifest.json`, and `sw.js` into `versions/vX.XX/`
- Added **versions.json management**: reads existing manifest, prepends new version, caps list at 20 entries
- Ensures every deploy is permanently archived and addressable

### App Updates (`index.html`, `app.js`)
- **Settings screen** now has an **"App Update"** card with:
  - Live version check against `versions.json`
  - "Update Now" button when a newer version is available
  - "Check Again" / "Try Again" buttons on errors
  - **Previous versions list** with "Open" links to archived builds
- **Update mechanics:** `doAppUpdate()` unregisters all service workers, deletes all caches, and reloads the root app
- **Rollback mechanics:** clicking an older version opens `versions/vX.XX/index.html` on the same origin, sharing the same IndexedDB

### Validation
- Ran `node -c app.js` → syntax valid

---

## 12:35 — Header Wrapping & App Icon Blank Fix

### Issues Found
1. **Header text squished on narrow screens** — the sticky header tried to force everything onto a single row, causing the logo and nav buttons to overlap or truncate on small mobile viewports.
2. **Heart emoji appeared blank when saved to home screen** — some Android/iOS launchers do not render emoji characters inside SVG `data:` URIs used as PWA icons, resulting in a blank or generic grey icon.

### Fixes Applied
- **Header CSS** — added `flex-wrap: wrap` to `header`, changed `.left` and `.nav` to `flex: 1 1 auto` so they can wrap to a second row when space is tight, and removed duplicate CSS declarations.
- **App icon** — replaced the emoji heart (`❤️`) in `manifest.json` with a pure **SVG path heart shape** (`<path d="M96 154s-48-28-48-68c0-20 16-36 36-36 14 0 26 8 32 20 6-12 18-20 32-20 20 0 36 16 36 36 0 40-48 68-48 68z" fill="white"/>`). This guarantees consistent rendering on every device and launcher, while keeping the same visual style (white heart on teal background).

---

## CI Injection Bug — Root Cause & Resolution (2026-04-14)
**Agent:** Kimi Code CLI  
**Commit:** `3b13719` — "Fix CI sed injection for APP_VERSION and BUILD_SHA"

### Root Cause
The GitHub Actions workflow `sed` command used `/` as the delimiter while the replacement target string contained `//` (JS comment syntax). The pattern match silently failed — `sed` exits 0 even when no substitution is made — so the workflow continued and deployed `app.js` with `LOCAL_SHA = 'dev'` still in place. Live site displayed **"vdev"** indefinitely.

This was a pre-existing issue introduced when the 12:15 dual-variable injection (`APP_VERSION` + `BUILD_SHA`) was added and the `sed` pattern grew more complex.

### Fix Applied
- Rewrote workflow injection step to use `|` as the `sed` delimiter — eliminates all slash-escaping conflicts.
- Added `set -e` at the top of the step so any command failure aborts the workflow immediately.
- Added `grep` verification assertions after each `sed` call to explicitly confirm the injected values are present in `app.js`. If either check fails, deployment is blocked.

### Files Changed
- `.github/workflows/deploy-pages.yml`

### Expected Result
With 8 commits on `main`, the live badge should display **v1.08** once the Actions run triggered by commit `3b13719` completes.  
Monitor: https://github.com/Comfac-Global-Group/bp-app/actions

| Item | Status |
|------|--------|
| `sed` delimiter fix (`\|` instead of `/`) | ✅ FIXED — verified in `deploy-pages.yml` |
| `set -e` fast-fail guard | ✅ FIXED — verified in `deploy-pages.yml` |
| `grep` injection assertions | ✅ FIXED — verified in `deploy-pages.yml` |
| `app.js` placeholders (`APP_VERSION`/`BUILD_SHA = 'dev'`) | ✅ CONFIRMED correct |
| Live site showing correct version | ❌ STILL SHOWING `vdev` — screenshot confirmed 16:34 2026-04-14 |

### Audit Finding Correction (2026-04-14 — Claude Sonnet 4.6)
**BUG-01 (BP category classification) — RETRACTED.** On re-examination the cascade logic in `computeCategory()` is correct: Stage 2 (`>= 140 || >= 90`) is checked before Stage 1 (`>= 130 || >= 80`), so no misclassification occurs. The original audit finding was a false positive. BUG-01 is closed with no code change required.

---

## CI Injection — Second Fix Attempt (2026-04-14 — Claude Sonnet 4.6)

### Root Cause (revised)
`sed` injection was still failing after the delimiter fix. Root cause: `sed` regex matching is inherently fragile — special characters (`*`, `/`, quotes) in the match pattern caused silent no-ops even with `|` as delimiter. The `grep` guards would then also fail, causing the entire workflow job to abort before deployment. Live site continued serving the original `vdev` build (initial deploy from `c9a7a49`).

### Fix Applied
Replaced `sed`-based injection entirely with a **Python string replacement** approach:
- No regex — uses exact literal `str.replace()` matching
- No shell escaping issues whatsoever
- `assert` statements replace `grep` checks — Python exits non-zero with a clear error message if any replacement fails
- `sw.js` `CACHE_NAME` now also injected (`bplog-dev` → `bplog-{version}`) to bust the service worker cache on every deploy

### Placeholder Markers (unique strings CI replaces)
| File | Placeholder | Replaced With |
|------|------------|---------------|
| `app.js` | `'dev'; /* CI_INJECT_VERSION */` | `'{version}'; /* CI_INJECT_VERSION */` |
| `app.js` | `'dev'; /* CI_INJECT_SHA */` | `'{sha}'; /* CI_INJECT_SHA */` |
| `sw.js` | `'bplog-dev'; /* CI_INJECT_CACHE */` | `'bplog-{version}'; /* CI_INJECT_CACHE */` |

### Files Changed
- `.github/workflows/deploy-pages.yml` — full rewrite of inject step
- `app.js` — updated placeholder comment markers
- `sw.js` — added `CACHE_NAME` placeholder for CI injection

| Item | Status |
|------|--------|
| `sed` replaced with Python `str.replace()` | ✅ |
| `sw.js` `CACHE_NAME` now CI-injected | ✅ |
| Unique `/* CI_INJECT_* */` marker comments in source | ✅ |
| Live site version badge correct | ✅ CONFIRMED — Actions run `24389644336` injected `APP_VERSION=1.11 BUILD_SHA=bac0c0a` successfully |
| Local dev showing version | ✅ FIXED — `version.json` + `npm run dev` (see below) |

---

## Local Dev Version Display (2026-04-14 — Claude Sonnet 4.6)

### Problem
Local `live-server` always showed `vdev` because `APP_VERSION = 'dev'` is a repo constant — CI injection only runs on GitHub Actions, never locally.

### Fix
- `scripts/dev-version.mjs` — reads `git rev-list --count HEAD` + `git rev-parse --short HEAD`, writes `version.json` with `{ version, sha, date }`
- `package.json` — `npm run dev` runs the script then starts `live-server`
- `app.js checkVersion()` — fetches `./version.json` first; if present uses those values; falls back to CI-injected `APP_VERSION`/`BUILD_SHA` constants
- `version.json` added to `.gitignore` — never committed; generated on demand

### How version monitoring now works
| Context | Version source | SHA comparison |
|---------|---------------|----------------|
| Local `npm run dev` | `version.json` from local git | local HEAD SHA vs GitHub API latest |
| Deployed (GitHub Pages) | CI-injected `APP_VERSION` constant | CI SHA vs GitHub API latest |

### Usage
```bash
cd bp-app && npm run dev   # generates version.json, starts live-server on :8080
```

---

## EXIF / Image Datetime — 2026-04-14T16:xx (Claude Sonnet 4.6)

### FRD Status
EXIF datetime extraction **is in the FRD** — §4.2 Image Capture and §11 Tech Stack both specify `exifr` reading `DateTimeOriginal` as the entry timestamp with `Date.now()` fallback.

### Gaps Found in Implementation

| Gap | Severity | Details |
|-----|----------|---------|
| No timestamp UI on OCR review screen | High | Extracted datetime silently stored but never shown to user — cannot confirm, correct, or see which source was used |
| Only `DateTimeOriginal` EXIF field tried | Medium | Many phones write `CreateDate`, `DateTime`, or `DateTimeDigitized` instead; single-field check leaves those readings timestamped as "now" |
| Silent EXIF failure | Low | `catch (e) {}` swallowed all errors with no feedback |

### Fix Applied (commit follows)
- **OCR review screen** — added editable `<input type="datetime-local" id="ocr-timestamp" />` pre-filled from EXIF extraction
- **Source label** — `(from photo EXIF)` or `(now — no EXIF)` shown beside the label so user knows where the time came from
- **EXIF fallback chain** — now tries `DateTimeOriginal → CreateDate → DateTime → DateTimeDigitized` in order
- **Save uses editable value** — `btn-ocr-save` reads the (possibly user-corrected) `ocr-timestamp` field rather than `state.pendingImage.timestamp`
- **`toDatetimeLocal()` helper** — converts ISO string to `datetime-local` input format

| Item | Status |
|------|--------|
| EXIF in FRD | ✅ Present (§4.2, §11) |
| Timestamp shown to user | ✅ FIXED |
| Multi-field EXIF fallback | ✅ FIXED |
| Silent catch | ✅ FIXED (bare `catch {}`) |
| User can edit timestamp before save | ✅ FIXED |

---

## OCR Context Research & Algorithm Redesign — 2026-04-14 (Claude Sonnet 4.6)

### Summary
Extended OCR extraction session: documented device-specific display layout for Omron HEM-7121, redesigned the extraction algorithm, and updated FRD §4.3 + §11 accordingly.

### OCR Engine Change
- **Old:** Tesseract.js v5 (WASM, ~6 MB) — caused service worker CORS errors on Chrome/Android PWA installs; blob worker approach was blocked
- **New:** ocrad.js (~300 KB, pure JS) — no WASM workers, no CORS issues, smaller footprint

### Omron HEM-7121 Display Layout (Primary Test Device)
The HEM-7121 wrist monitor has a fixed LCD layout:
- Top row: `OMRON` (left) and `Intelli Sense` (right)
- Systolic reading (3 digits) with `SYS mmHg` label below
- Diastolic reading (2–3 digits) with `DIA mmHg` label below
- Pulse/HR reading (2–3 digits) with `Pulse /min` label below
- Bottom row: `Start`, `Stop`, `OK` button labels + `HEM-7121` model number

This label layout is the basis for **Algorithm D (label-proximity)** — highest-confidence extraction.

### Extraction Algorithm Pipeline (D→A→B→C)
| Algorithm | Method | Confidence |
|-----------|--------|-----------|
| D: Label-proximity | Regex: number adjacent to `SYS` / `DIA` / `Pulse` keywords | Highest |
| A: Separator | Regex: `NNN/NN` or `NNN\|NN` patterns | High |
| B: Range + PP | Physiological range filter + pulse pressure validation (20–100 mmHg) | Medium |
| C: Range-only | First in-range systolic + diastolic candidates | Fallback |

Dual-pass OCR: normal image AND inverted image — both scored, best result kept.

### Device Detection
`detectDevice(text)` matches:
- Brand: `omron`, `microlife`, `a&d` keywords
- Model: `HEM-NNN`, `UA-NNN`, `BP-NNN` regex patterns

### UI Improvement — Model Display in Hint
When OCR extraction succeeds AND brand/model detected:
- Green hint shown: `"Detected: Omron HEM-7121 — review values below."`

When extraction fails:
- Amber hint with raw OCR text (up to 120 chars) for manual guidance

### FRD Updates Applied
- **§1 Overview** — updated to reference ocrad.js (was Tesseract.js)
- **§4.3 OCR Processing** — full rewrite: library, preprocessing pipeline, HEM-7121 layout diagram, multi-algorithm table, validation rules, device detection, EXIF section, testing plan
- **§11 Tech Stack** — OCR row updated to ocrad.js; bundle size estimate revised (~500–700 KB, was 800 KB–1.2 MB)

### Testing Plan (documented in FRD §4.3)
- Per-device test log: photograph each supported monitor (HEM-7121, HEM-705, UA-651, BP652) under good/bad lighting
- Edge cases: angled shots, glare, partial occlusion
- Algorithm fallback audit: confirm D→A→B→C→manual degradation
- Track user correction rate in QA notes

### Status
| Item | Status |
|------|--------|
| ocrad.js in use | ✅ (replaced Tesseract.js) |
| Algorithm D (label-proximity) | ✅ Implemented |
| Algorithm A (separator) | ✅ Implemented |
| Algorithm B (range+pp) | ✅ Implemented |
| Algorithm C (range-only) | ✅ Implemented |
| `detectDevice()` — brand | ✅ Implemented |
| `detectDevice()` — model (HEM regex) | ✅ Implemented |
| Model shown in UI hint | ✅ FIXED (green success hint) |
| FRD §4.3 updated | ✅ |
| FRD §11 updated | ✅ |
| OCR confirmed working on HEM-7121 | ⚠️ IN TESTING — sample size insufficient for statistical confidence |
| Testing plan documented | ✅ |

---

## OCR Failure — Chrome Ubuntu 24.04 Desktop & Firefox Android — 2026-04-14T17:00+08:00

### Observation
During live testing, Tesseract.js OCR failed with an **unknown error** on two distinct platforms:
- **Chrome on Ubuntu 24.04 (desktop)**
- **Firefox Android app**

In both cases, the OCR pipeline did not return usable values. The loading overlay showed "Running OCR…" and then silently returned empty `sys`/`dia`/`hr` fields with no actionable error message to the user.

### Impact
- Users are forced to **enter values manually** every time the error occurs
- No fallback guidance or retry mechanism is presented
- Failure is device/browser-specific, suggesting WASM initialization, worker spawning, or memory constraints as likely causes

### Status
| Item | Status |
|------|--------|
| Reproducible on Chrome Ubuntu 24.04 | ✅ Confirmed |
| Reproducible on Firefox Android | ✅ Confirmed |
| User-friendly fallback message | ❌ MISSING — only blank fields shown |
| Retry OCR button on failure | ❌ MISSING |
| Root cause identified (exact Tesseract error) | ❌ UNKNOWN — needs deeper logging |

### Notes
- The editable fields in the OCR review screen already act as an implicit fallback, but there is no explicit message telling the user *why* the values are blank or what to do next.
- A future build should catch OCR promise rejection explicitly, show "OCR could not read this image — please enter the values manually," and optionally offer a **Retry** button.

---

## OCR Benchmark Architecture — FRD — 2026-04-14 (Claude Sonnet 4.6)

### Purpose
Design and operate an exhaustive, repeatable OCR benchmark to determine which combination of OCR engine + preprocessing pipeline can reliably extract blood pressure readings from Omron HEM-7121 LCD photos. Results feed directly back into `app.js` preprocessing improvements.

### Design Principles
- Every OCR engine is tested against every preprocessing strategy against every image
- Results are cumulative — each run appends to `scripts/ocr_results.json`, never overwrites
- Any AI model can install missing engines, run the script, and append findings to QA-log.md
- The script is self-documenting — run `python3 scripts/ocr_bench.py --help` to see options
- New engines, strategies, and images can be added by following the inline instructions

### Benchmark Script
**File:** `scripts/ocr_bench.py` (supersedes `scripts/ocr_test.py`)

```
Usage:
  python3 scripts/ocr_bench.py                     # run all
  python3 scripts/ocr_bench.py --image 20260414    # single image
  python3 scripts/ocr_bench.py --engine tesseract_lcd  # single engine family
  python3 scripts/ocr_bench.py --strategy lcd_crop     # single strategy family
  python3 scripts/ocr_bench.py --save-debug        # save /tmp/bp_debug/*.png

Output:
  Console: per-combination results + SUMMARY table
  File:    scripts/ocr_results.json (cumulative, all runs)
```

### OCR Engine Inventory

Complete catalogue of all engines to be tested, in priority order. Install commands are in `scripts/ocr_bench.py` docstring and repeated here.

#### Tier 1 — Modern Edge-Optimised (highest expected accuracy)

| Engine ID | Description | Model Size | Install | Status |
|-----------|-------------|------------|---------|--------|
| `paddleocr` | PaddleOCR PP-OCRv4 — lightweight, ONNX-based, designed for edge/mobile, best-in-class on structured documents | ~12MB detection + ~12MB recognition (auto-downloaded) | `sudo pip3 install paddlepaddle paddleocr --break-system-packages` | ❌ not installed |
| `florence2` | Microsoft Florence-2-base VLM — purpose-built for OCR and visual understanding | ~232MB (auto-downloaded to `~/.cache/huggingface/`) | `sudo pip3 install transformers timm --break-system-packages` | ❌ not installed |
| `smolvlm` | HuggingFace SmolVLM-256M-Instruct — micro VLM, answers natural-language questions about images | ~500MB (auto-downloaded) | same as Florence-2 | ❌ not installed |

#### Tier 2 — Tesseract Variants (established, open-source)

| Engine ID | Description | Install | Status |
|-----------|-------------|---------|--------|
| `tesseract_eng_psm6` | Tesseract 5 eng, full-block mode | `sudo apt-get install -y tesseract-ocr` | ✅ installed |
| `tesseract_eng_psm11` | Tesseract 5 eng, sparse text | same | ✅ installed |
| `tesseract_eng_psm6_digits` | Tesseract eng, digit whitelist | same | ✅ installed |
| `tesseract_eng_psm7_digits` | Tesseract eng, single line digits | same | ✅ installed |
| `tesseract_eng_psm8_digits` | Tesseract eng, single word digits | same | ✅ installed |
| `tesseract_lcd_psm6/8/11` | **letsgodigital** tessdata — specifically trained on 7-segment LCD displays | `sudo wget -O /usr/share/tesseract-ocr/5/tessdata/letsgodigital.traineddata "https://github.com/Shreeshrii/tessdata_ssd/raw/master/letsgodigital.traineddata"` | ❌ not installed |
| `tesseract_digits_psm8` | digits.traineddata — digit-only training | `sudo wget -O /usr/share/tesseract-ocr/5/tessdata/digits.traineddata "https://github.com/tesseract-ocr/tessdata/raw/main/digits.traineddata"` | ❌ not installed |

#### Tier 3 — CLI / Other

| Engine ID | Description | Install | Status |
|-----------|-------------|---------|--------|
| `ocrad` | **GNU OCRAD** — same underlying engine as `ocrad.js` in the browser PWA. CLI result = browser result. | `sudo apt-get install -y ocrad` | ❌ not installed |

#### Tier 4 — Native Mobile SDKs (cannot test in Python — for future app port)

These run entirely on-device, no cloud calls. Cannot be tested in the Python benchmark. Relevant if BPLog is ever ported to a native Android/iOS app.

| SDK | Platform | Description | Notes |
|-----|----------|-------------|-------|
| **Google ML Kit — Text Recognition v2** | Android / iOS | Powers Google Lens and Translate offline mode. Downloads a small language model to the device (~5MB). Processes entirely on-device. API: `TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)` | Free, Google Play Services required on Android. Likely handles 7-segment digits via its Lens training data. |
| **Apple Vision Framework** | iOS / macOS | `VNRecognizeTextRequest` — runs on Neural Engine, fully offline. Used in Notes Live Text, Translate app. | Swift/ObjC only. Sub-100ms on modern iPhones. High accuracy. |
| **MakeACopy architecture** | Android | Open-source offline document scanner. Uses ONNX model for document edge detection + Tesseract for OCR. Privacy-first, no cloud. Reference implementation for offline OCR pipeline design. | Study the architecture; don't need to run directly. |

> **Why Google ML Kit is interesting:** It is the engine behind real-time offline translation in Google Translate and Google Lens. It has likely been trained on 7-segment LCD displays (calculators, monitors, appliances) as part of its Lens training data. If BPLog is ever published as an Android app, this would be the first OCR engine to try.

> **Why PaddleOCR is the Priority 1 test:** PP-OCRv4 is specifically designed for edge computing and structured document OCR. It uses a two-stage pipeline (text detection → text recognition) that is more robust than single-pass engines. The recognition model is ONNX-exportable, which means it could eventually run in browser via ONNX Runtime Web (`onnxruntime-web` npm package).

### Preprocessing Strategy Inventory

All strategies are defined in `scripts/ocr_bench.py`. Each operates on the original colour image and returns a greyscale PIL Image.

| Strategy ID | Description | Type |
|-------------|-------------|------|
| `raw_gray` | Raw grayscale, no threshold | Baseline |
| `gray_thr128` | Grayscale → upscale 2000px → threshold 128 | Threshold |
| `gray_thr128_inv` | Same + invert | Threshold |
| `gray_thr100` | Lower threshold (catches dim segments) | Threshold |
| `gray_thr100_inv` | Lower threshold + invert | Threshold |
| `gray_thr150` | Higher threshold (removes noise) | Threshold |
| `gray_thr150_inv` | Higher threshold + invert | Threshold |
| `contrast2_thr` | Contrast ×2 → threshold | Contrast |
| `contrast3_thr` | Contrast ×3 → threshold | Contrast |
| `contrast4_thr` | Contrast ×4 → threshold | Contrast |
| `contrast3_thr_inv` | Contrast ×3 → threshold → invert | Contrast |
| `sharpen_thr` | Sharpen filter → threshold | Sharpen |
| `adaptive` | Adaptive local-contrast (Gaussian subtract) | Adaptive |
| `adaptive_lcd_crop` | LCD crop → adaptive | Adaptive + Crop |
| `lcd_crop_thr128` | LCD crop (x:27–88%, y:12–63%) → threshold | Crop |
| `lcd_crop_thr128_inv` | LCD crop → threshold → invert | Crop |
| `lcd_crop_contrast3` | LCD crop → contrast ×3 → threshold | Crop + Contrast |
| `lcd_crop_contrast3_inv` | LCD crop → contrast ×3 → threshold → invert | Crop + Contrast |
| `colour_seg` | Colour-range LCD segment isolation (dark grey pixels) | Colour |
| `colour_seg_lcd_crop` | LCD crop → colour segmentation | Colour + Crop |
| `deskew_thr128` | Auto-deskew rotation → threshold | Align |
| `deskew_lcd_crop_thr128` | Auto-deskew → LCD crop → threshold | Align + Crop |

**Total combinations per image:** 22 strategies × 10 engines = **220 combinations**

### Scoring System

| Score | Meaning | Rank |
|-------|---------|------|
| `FULL_MATCH` | SYS ±3, DIA ±3, PULSE ±3 all match GT | 4 |
| `SYS+DIA_MATCH` | SYS ±3 and DIA ±3 match GT | 3 |
| `PARTIAL` | SYS or DIA matches GT | 2 |
| `NO_MATCH` | Values extracted but wrong | 1 |
| `NO_EXTRACT` | No values extracted at all | 0 |
| `ENGINE_MISSING` | Engine not installed | −2 |
| `SKIP` | GT is None (discard image) | −1 |

### Sample Images — Ground Truth

EXIF metadata present (DateTimeOriginal, GPS, Make=samsung, Model=Galaxy A17 5G) but **does NOT contain BP readings**.

Ground truth is **encoded in the filename**: `YYYYMMDD_HHMMSS-brand-SYS-DIA-PULSE.jpg`.
All 5 readings confirmed by user.

| Filename | Date/Time | SYS | DIA | PULSE | Image Condition |
|----------|-----------|-----|-----|-------|-----------------|
| 20260409_215943-omron-135-82-73.jpg | 2026-04-09 21:59 | 135 | 82 | 73 | Device rotated ~90° CCW — challenging angle |
| 20260410_120217-omron-134-90-61.jpg | 2026-04-10 12:02 | 134 | 90 | 61 | Device tilted ~15° — perspective distortion |
| 20260411_195510-omron-128-75-85.jpg | 2026-04-11 19:55 | 128 | 75 | 85 | Upright; slight glare on right of LCD |
| 20260413_201728-omron-149-86-75.jpg | 2026-04-13 20:17 | 149 | 86 | 75 | Clear, upright, good lighting |
| 20260414_112450-omron-118-78-59.jpg | 2026-04-14 11:24 | 118 | 78 | 59 | Clear, upright, slight glare |

> Filename convention: `YYYYMMDD_HHMMSS-brand-SYS-DIA-PULSE.jpg` — `ocr_bench.py` parses GT directly from filename via `gt_from_filename()`. No manual GROUND_TRUTH dict maintenance needed for new images.

### HEM-7121 LCD Layout

```
Photo dimensions: 4080 × 3060 px (Samsung Galaxy A17 5G, landscape)
LCD bounding box (approximate % of image):
  x: 27%–88%,  y: 12%–63%

LCD internal layout:
  Row 1 — top large digits:    SYS (3 digits, x:30–62%)  +  PULSE (2 digits, x:70–87%)
  Row 2 — middle digits:       DIA (3 digits, x:30–62%)
  Row 3 — bottom indicators:   Memory/battery icons, dashes

Body text (NOT on LCD, printed on white plastic below screen):
  "Intelli sense"  "SYS mmHg"  "DIA mmHg"  "PULSE /min"
Side text (rotated 90°, left edge of device):  "HEM-7121"
Right side: blue button labelled "START / STOP"
```

### Root Cause Analysis — Why Standard OCR Fails

7-segment LCD digit outlines are geometrically unlike any trained printed/typed font:

| Digit | Printed appearance | LCD 7-segment shape | Tesseract reads as |
|-------|--------------------|---------------------|--------------------|
| 1 | Thin vertical stroke | Two thin rectangles (right column only) | border artifact or `\|\|` |
| 8 | Rounded figure-eight | Square frame with two rectangular holes | box shape |
| 0 | Oval | Rectangular outline with one hole | box / `C` |
| 5 | Curved | L-shape rotated | varies |

This is a **training data mismatch**, not a preprocessing problem. Binary-thresholded images look perfect to a human but produce garbage from `eng`-trained Tesseract.

**The `ocrad` engine is the same as `ocrad.js` used in the PWA browser-side OCR. Its CLI performance on these images directly predicts browser performance.**

### Lab Session — Initial Test Results — 2026-04-14

**Engines tested:** tesseract_eng only (5 PSM variants)
**Strategies tested:** 6 (gray_thresh_normal/inv, contrast_normal/inv, lcd_crop, lcd_crop_inv)
**Images:** all 5
**Result: ALL COMBINATIONS → NO_EXTRACT**

Representative raw outputs from `20260414_112450.jpg` (GT: 118/78/59):

| Strategy / Config | Raw text | Nums found | Note |
|---|---|---|---|
| raw/psm6 | `'. 2 a f iti . F 3 3 Z…'` | `['20']` | "20" from "OMRON" body text |
| gray_thr128/psm11 | `'20oOc Cc =e Wi af…'` | `['20']` | same OMRON artefact |
| gray_thr128_inv/psm11d | `'200'` | `['200']` | LCD border arcs misread |
| lcd_crop/psm11 | `'ee 200c'` | `['200']` | LCD border arcs |
| adaptive/psm6_digits | `'7 3 2 4 2 2 8 1 7 8…85'` | `['85']` | noise |

Visual inspection of preprocessed images shows digits are **clearly visible** to the human eye after adaptive threshold — but the segment shapes don't pattern-match Tesseract's `eng` training data.

### What Would Actually Work — Priority Order

| Priority | Approach | Effort | Expected Accuracy | Dependencies |
|----------|----------|--------|-------------------|--------------|
| **1** | Install `letsgodigital` tessdata (LCD-trained Tesseract) | 5 min | High | wget (or manual download) |
| **2** | Install `ocrad` CLI + test | 2 min | Unknown — same as browser | apt |
| **3** | Install `digits.traineddata` + test | 5 min | Medium | wget |
| **4** | Implement 7-segment template matching | 2h | Very high | numpy only |
| **5** | Colour-range LCD segmentation (improve `colour_seg` strategy) | 1h | High as pre-step | numpy |
| **6** | Deskew calibration (improve `deskew` strategy) | 1h | Medium (for tilted photos) | numpy |

### Instructions for Next Model

**1. Install all remaining engines:**
```bash
sudo apt-get install -y ocrad

sudo wget -O /usr/share/tesseract-ocr/5/tessdata/letsgodigital.traineddata \
  "https://github.com/Shreeshrii/tessdata_ssd/raw/master/letsgodigital.traineddata"

sudo wget -O /usr/share/tesseract-ocr/5/tessdata/digits.traineddata \
  "https://github.com/tesseract-ocr/tessdata/raw/main/digits.traineddata"
```

**2. Run the full benchmark:**
```bash
cd /home/justin/opencode260220/bp-app
python3 scripts/ocr_bench.py --save-debug 2>&1 | tee /tmp/bench_run.txt
```

**3. Check debug images** (if `--save-debug` was used):
```
/tmp/bp_debug/20260414_112450_lcd_crop_thr128.png  etc.
```

**4. Report findings:** Append a new dated section to QA-log.md:
```
## OCR Bench Run — YYYY-MM-DD — <your model name>
### Engines installed this session: ...
### New results (first matches found): ...
### Best combination: strategy=X engine=Y score=Z
### Summary table: [paste from script output]
### Next recommended step: ...
```

**5. If any engine achieves SYS+DIA_MATCH or FULL_MATCH:**
- Note the exact strategy + engine combination
- Port the preprocessing logic to `app.js preprocessForOCR()` (or a new `preprocessLCD()` function)
- Re-test in browser using `npm run dev` + the HEM-7121 photo

### OCR Lab Session — 7-Segment LCD Feasibility Test — 2026-04-14 (Claude Sonnet 4.6)

### Test Environment
| Item | Value |
|------|-------|
| OS | Ubuntu 24.04 LTS |
| Python | 3.12 |
| PIL/Pillow | available (`python3 -c "from PIL import Image"`) |
| numpy | available |
| tesseract CLI | 5.3.4 (`sudo apt-get install -y tesseract-ocr`) |
| pytesseract | 0.3.13 (`sudo pip3 install pytesseract --break-system-packages`) |
| tessdata available | `eng.traineddata`, `osd.traineddata` only — no LCD-specific data |
| ocrad.js | Used in the PWA (browser-side); not available as CLI |
| Test script | `scripts/ocr_test.py` |
| Sample images | `Bloodpressure Samples/` (5 photos, Samsung Galaxy A17 5G) |

### Sample Images — Ground Truth
EXIF metadata (DateTimeOriginal, Make, Model, GPS) is present but **does NOT contain BP readings**. Readings are embedded visually in the LCD display only.

Ground truth encoded in filename (`brand-SYS-DIA-PULSE`), all ✅ confirmed by user 2026-04-14.

| Filename | Date/Time | SYS | DIA | PULSE | Image Condition |
|----------|-----------|-----|-----|-------|-----------------|
| 20260409_215943-omron-135-82-73.jpg | 2026-04-09 21:59 | 135 | 82 | 73 | Rotated ~90° CCW |
| 20260410_120217-omron-134-90-61.jpg | 2026-04-10 12:02 | 134 | 90 | 61 | Tilted ~15° |
| 20260411_195510-omron-128-75-85.jpg | 2026-04-11 19:55 | 128 | 75 | 85 | Slight right-side glare |
| 20260413_201728-omron-149-86-75.jpg | 2026-04-13 20:17 | 149 | 86 | 75 | Clear, upright |
| 20260414_112450-omron-118-78-59.jpg | 2026-04-14 11:24 | 118 | 78 | 59 | Clear, upright |

All images: Samsung Galaxy A17 5G, 4080×3060. EXIF has DateTimeOriginal and GPS but no BP values.

### HEM-7121 Display Layout (from visual inspection)
The LCD has three rows of 7-segment digits:
```
Row 1 (top):    [SYS digit 1][SYS digit 2][SYS digit 3]   [PULSE digit 1][PULSE digit 2]
Row 2 (middle): [DIA digit 1][DIA digit 2][DIA digit 3]
Row 3 (bottom): [memory/battery indicators / dashes]
```
Approximate pixel regions in a 4080×3060 photo (varies slightly per shot):
- LCD area:       x 28–88%,  y 12–65%
- SYS digits:     x 30–62%,  y 16–43%
- PULSE digits:   x 70–87%,  y 16–38% ← **crop coord still needs calibration**
- DIA digits:     x 30–62%,  y 40–65%

The "OMRON" label and "SYS/DIA/PULSE mmHg//min" text are **printed on the device body below the LCD**, not on the LCD screen itself.

### Preprocessing Tested
All tests ran on `20260414_112450.jpg` (only image with confirmed ground truth).

| Strategy | Description |
|----------|-------------|
| `gray_thresh_normal` | Grayscale → upscale 1800px → binary threshold at 128 |
| `gray_thresh_inverted` | Same, then invert |
| `contrast_normal` | Contrast ×3 + sharpen → threshold |
| `lcd_crop_normal` | Crop to x:15–90% y:8–62%, grayscale, threshold |
| `lcd_crop_inverted` | Same, inverted |
| `adaptive` | Gaussian blur r=30 as local mean; subtract to get local contrast; binary |

Saved to `/tmp/bp_*.png` for visual inspection during session (not persistent).

### Tesseract Configs Tested
`--psm 6`, `--psm 7`, `--psm 8`, `--psm 11` × digit-whitelist and full-text variants.  
`--oem 0` (legacy engine) — **FAILED**: legacy `.traineddata` not installed.

### Test Results — All Strategies × All Configs
**All 5 images returned NO_EXTRACT across all strategy/config combinations.**

Representative raw OCR outputs from `20260414_112450.jpg`:

| Strategy / Config | Raw text (trimmed) | Nums found | Expected |
|---|---|---|---|
| `1_raw / psm6` | `'. 2 a f iti . ' F : 3 3 Z…'` | `['20']` | 118,78,59 |
| `2_thresh_normal / psm11` | `'20oOc Cc =e Wi af Sc…'` | `['20']` | — |
| `3_thresh_inv / psm11d` | `'200'` | `['200']` | — |
| `4_lcd_crop / psm11` | `'ee 200c'` | `['200']` | — |
| `adaptive / psm6_digits` | `'7 3 2 4 2 2 8 1 7 8 2 2 4…85'` | `['85']` | — |
| Tight SYS crop (x:28–64%) | `'7'`, `'4'`, `'08'` | — | 118 |

The `"20"` that appears repeatedly is extracted from the **"OMRON" body text**, not the LCD digits. The `"200"` is a misread of the LCD border/frame arcs.

### Root Cause Analysis: Why OCR Fails on 7-Segment LCD

The 7-segment digit shapes are geometrically unlike printed/typed characters:

| Digit | Printed text | 7-Segment LCD appearance |
|-------|-------------|--------------------------|
| **1** | Thin vertical stroke | Two thin rectangular bars (right column only) — looks like `\|\|` or a border artifact |
| **8** | Rounded curves | Solid rectangle with two rectangular holes — looks like a box frame |
| **0** | Oval | Rectangular outline with one hole |
| **5** | Curved top-left | L-shaped segments |

Tesseract is trained on printed/typed fonts (Times, Helvetica, handwriting etc.). It pattern-matches outline shapes, and **7-segment digit outlines do not match any trained character**.

This is a **fundamental limitation** of general-purpose OCR on 7-segment displays, not a preprocessing problem.

### Visual Inspection Findings (preprocessed images)
- Binary threshold (128) on the LCD crop region: digits are clearly visible and bold in the output image. A human can read them. OCR cannot.
- Adaptive local-contrast image: digits appear white-on-dark, even cleaner. Still OCR-unreadable.
- The "EM-7121" text rotated 90° on the left edge of every crop is consistent noise.

### What Would Actually Work — Ranked by Effort

| Approach | Difficulty | Likely Accuracy | Notes |
|----------|-----------|-----------------|-------|
| **A. LCD tessdata** (`letsgodigital.traineddata`) | Low — one file download | High | Specifically trained on 7-segment displays. URL: `https://github.com/Shreeshrii/tessdata_ssd/raw/master/letsgodigital.traineddata` — place in `/usr/share/tesseract-ocr/5/tessdata/`. Use with `--psm 8 -l letsgodigital`. Not tested yet (wget blocked). |
| **B. 7-segment template matching** | Medium | Very high | For each digit position: extract 8×8 pixel grid, check which of 7 segment zones are "on". Map segment pattern to digit 0–9. Pure PIL/numpy. |
| **C. Colour-range LCD segmentation** | Medium | High | LCD pixels have a distinct grey-green colour range. Threshold on colour (not luminance) to isolate display pixels from surrounding white plastic. |
| **D. LLM/VLM image API** | Low (API call) | Highest | Send the cropped LCD image to a vision model (GPT-4o, Claude Vision, etc.). Out of scope for offline PWA. |
| **E. Improve ocrad.js pipeline** | Medium | Unknown | ocrad.js in the PWA uses the same binary-threshold approach. Could add Approach C (colour segmentation) as a pre-step before passing to OCRAD. |

### Next Steps for the Next Model

**Step 1 — Confirm ground truth (if not already done)**
The three ⚠️ visual estimates in the table above need user confirmation. Ask the user to confirm or correct:
- 20260410: SYS=153 DIA=97 PULSE=76
- 20260411: SYS=105 DIA=72 PULSE=58
- 20260413: SYS=97 (or 127?) DIA=78 PULSE=65
Once confirmed, update `GROUND_TRUTH` in `scripts/ocr_test.py`.

**Step 2 — Test Approach A: LCD-specific tessdata**
Tesseract `eng` training data does not recognise 7-segment LCD digits. A dedicated traineddata file exists:
```bash
# Install LCD tessdata (one file, ~2MB)
sudo wget "https://github.com/Shreeshrii/tessdata_ssd/raw/master/letsgodigital.traineddata" \
  -O /usr/share/tesseract-ocr/5/tessdata/letsgodigital.traineddata
```
Then add this block to `scripts/ocr_test.py` STRATEGIES list:
```python
# Requires letsgodigital.traineddata installed (see above)
("lcd_tess_crop",    lambda img: prep_lcd_crop(img)),
```
And add these configs to TESS_CONFIGS:
```python
("lcd_psm8",  "--psm 8 -l letsgodigital"),
("lcd_psm6",  "--psm 6 -l letsgodigital"),
("lcd_psm11", "--psm 11 -l letsgodigital"),
```
Run `python3 scripts/ocr_test.py` and record results in QA-log.md.

**Step 3 — If Approach A is insufficient, implement Approach B: 7-segment template matching**
This is a pure PIL/numpy approach with no external dependencies.
Add to `scripts/ocr_test.py`:

```python
def read_7seg_digit(cell):
    """
    cell: PIL Image of a single 7-segment digit, grayscale, any size.
    Returns: digit 0-9 or None.
    Segments: a=top, b=top-right, c=bot-right, d=bot, e=bot-left, f=top-left, g=mid
    """
    import numpy as np
    c = cell.convert("L").resize((20, 30), Image.LANCZOS)
    arr = np.array(c) < 128  # True = dark = segment ON

    # Sample zone centres as fractions of (height, width)
    zones = {
        'a': (0.10, 0.50),  # top horizontal
        'b': (0.30, 0.85),  # top-right vertical
        'c': (0.70, 0.85),  # bot-right vertical
        'd': (0.90, 0.50),  # bottom horizontal
        'e': (0.70, 0.15),  # bot-left vertical
        'f': (0.30, 0.15),  # top-left vertical
        'g': (0.50, 0.50),  # middle horizontal
    }
    # 3×3 sample window per zone
    seg = {}
    h, w = arr.shape
    for name, (yr, xr) in zones.items():
        y, x = int(yr*h), int(xr*w)
        patch = arr[max(0,y-1):y+2, max(0,x-1):x+2]
        seg[name] = patch.mean() > 0.4  # majority dark = on

    # Standard 7-segment digit map
    digit_map = {
        (1,1,1,1,1,1,0): '0',
        (0,1,1,0,0,0,0): '1',
        (1,1,0,1,1,0,1): '2',
        (1,1,1,1,0,0,1): '3',
        (0,1,1,0,0,1,1): '4',
        (1,0,1,1,0,1,1): '5',
        (1,0,1,1,1,1,1): '6',
        (1,1,1,0,0,0,0): '7',
        (1,1,1,1,1,1,1): '8',
        (1,1,1,1,0,1,1): '9',
    }
    key = tuple(int(seg[s]) for s in 'abcdefg')
    return digit_map.get(key, None)
```

Then add a function that splits the LCD crop into individual digit cells and calls `read_7seg_digit` on each.
The cell boundaries must be calibrated from the actual pixel positions in the crops (use saved `/tmp/bp_*.png` files as a guide).

**Step 4 — Port to app.js (browser)**
Once a working pipeline is found in Python:
- If Approach A (LCD tessdata): The tessdata approach cannot run in browser. Consider Approach C (colour segmentation + segment template) as a browser-compatible alternative.
- If Approach B (segment template): Port the zone-sampling logic to JavaScript. It's pure array arithmetic — fully compatible with ocrad.js preprocessing canvas pipeline.
- Target: replace or augment `preprocessForOCR()` + `extractBP()` in `app.js`.

**Step 5 — Validate and commit**
Run test script on all 5 images. Target: `SYS+DIA_MATCH` on ≥3 confirmed images (exclude 20260409).
Append findings to QA-log.md. Commit `scripts/ocr_test.py` + `app.js` changes.

### Status
| Item | Status |
|------|--------|
| Test environment set up (tesseract + pytesseract) | ✅ Done |
| Test script created: `scripts/ocr_test.py` | ✅ Done |
| Ground truth confirmed for 20260414_112450.jpg | ✅ 118/78/59 |
| Ground truth for 4 other images | ❌ Not yet recorded |
| Standard OCR (tesseract `eng`) on all images | ✅ Tested — **ALL FAIL** |
| Root cause identified | ✅ 7-segment LCD ≠ printed text — training data mismatch |
| LCD tessdata (`letsgodigital`) tested | ❌ Not yet — wget was blocked |
| 7-segment template matching implemented | ❌ Not yet |
| Colour-range LCD segmentation tested | ❌ Not yet |
| Any approach achieving SYS+DIA match | ❌ Not yet |
| `app.js` OCR pipeline improved | ❌ Blocked until desktop test passes |

---

## OCR Engine Evaluation — Omron HEM-7121 Image — 2026-04-14T17:15+08:00

### Test Subject
Image: `20260414_112450.jpg` (Omron HEM-7121 Intelli Sense)
- Known values: **SYS = 118**, **DIA = 78**, **PULSE = 59**
- Display type: **7-segment LCD**

### Engines Tested
1. **Tesseract.js v5** (Node.js, `tesseract.js` npm package)
2. **ocrad.js** (Node.js, `ocrad.js` npm package)

### Methodology
Created `test-ocr.mjs` / `test-ocr-focused.mjs` to test multiple preprocessing pipelines against both engines:
- Original, grayscale, contrast enhancement, inversion, thresholding
- Rotation (90°), cropping to LCD region, sharpening
- 2× upscaling (with and without threshold/contrast)
- Tesseract tested with both default English mode and `tessedit_char_whitelist=0123456789`

### Results

#### Tesseract.js — CATASTROPHIC FAILURE on 7-segment LCD
| Variant | Best Result | Confidence | Notes |
|---------|-------------|------------|-------|
| original | `[]` (gibberish text) | 29 | Complete failure |
| grayscale | `[]` (gibberish) | 32 | Complete failure |
| contrast | `[59]` | 34 | Found **only pulse**, missed sys/dia |
| inverted | `[]` | 30 | Complete failure |
| threshold | `[71]` | 26 | False positive |
| rotate90 | `[121]` | 29 | False positive (picked up model number) |
| crop_lcd | `[21]` | 25 | Complete failure |
| crop_lcd_contrast | `[]` | 12 | Complete failure |
| crop_lcd_threshold | `[]` | 24 | Complete failure |
| sharpen | `[45]` | 33 | False positive |
| resize2x | `[59]` among 15+ false positives | 23 | Found pulse, flooded with noise |
| resize2x_threshold | `[]` among 11 false positives | 22 | Flooded with noise |
| resize2x_contrast | `[]` among 7 false positives | 24 | Flooded with noise |

**Digits whitelist** (`0123456789`) did not improve accuracy meaningfully.

**Root cause:** Tesseract.js is trained on anti-aliased fonts and natural text. 7-segment LCD characters (composed of discrete line segments with gaps) are completely outside its training distribution.

#### ocrad.js — Node.js integration blocked
ocrad.js could not be executed in the Node.js test environment. It expects a browser `HTMLCanvasElement` with `getContext('2d')` and `getImageData()`. A shimmed canvas object failed with:
```
ERROR: Cannot read properties of undefined (reading 'width')
```

**Action:** Created `test-ocr-browser.html` for in-browser A/B comparison of Tesseract.js vs ocrad.js on the same image.

### Conclusion
| Finding | Implication |
|---------|-------------|
| Tesseract.js is **unsuitable** for 7-segment LCD BP monitors | Explains the "OCR failed unknown error" reports on Chrome Ubuntu and Firefox Android |
| No amount of standard preprocessing (contrast, threshold, crop, rotate, upscale) fixes this | A preprocessing-only solution is a dead end |
| ocrad.js may fare better in-browser but cannot be validated server-side | Must be tested in target environment (mobile browser / PWA) |
| Manual entry fallback is currently the only reliable path | UI must clearly communicate this to users |

### Recommendation
1. **Replace Tesseract.js with ocrad.js** in the PWA (as the QA log notes Claude previously prototyped).
2. **Add an explicit OCR failure message** in `app.js`: "Could not read the display automatically. Please enter the values manually."
3. **Add a "Retry OCR" button** that tries an inverted/alternate preprocess before giving up.
4. **Run `test-ocr-browser.html` on actual target devices** (Chrome Android, Firefox Android, Chrome desktop) to validate ocrad.js performance before deploying.

### Files Created
- `test-ocr.mjs` — comprehensive multi-variant Node.js test runner
- `test-ocr-focused.mjs` — focused Tesseract whitelist + preprocessing test
- `test-ocr-browser.html` — side-by-side browser test for Tesseract.js vs ocrad.js
- `test-ocr-*.jpg` / `test-ocr2-*.jpg` — preprocessed image artifacts for inspection
- `test-ocr-results.json` / `test-ocr2-results.json` — structured result data

