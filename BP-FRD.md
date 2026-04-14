# BP-FRD — BPLog Functional Requirements Document
**Version:** 1.2 | **Status:** Ready for Build | **Domain:** bp.comfac-it.com
**Author:** Justin / CGG R&D | **Date:** 2026-04-14

---

## 1. Overview

BPLog is a self-hosted Progressive Web App (PWA) for capturing and logging blood pressure readings from photos. Tesseract.js (WebAssembly) performs OCR entirely on-device. All data — images, logs, charts, PDF generation — stays local. No data is ever transmitted to any external server.

**Deployment target:** Static file bundle behind NPM on PC03 → `bp.comfac-it.com`

---

## 2. Goals & Non-Goals

### Goals
- Frictionless photo-to-log workflow (camera capture or gallery upload)
- On-device OCR extraction of systolic, diastolic, heart rate
- Multi-user support with local user profile selector
- Self-hosted, mobile-first, fully offline-capable after first load
- Image storage with optional bulk cleanup
- JSON-based import/export per user
- Free-text notes and user-defined tags per entry, editable at any time
- Printable/exportable medical-grade report with time-series charts
- **Automated version tracking** against GitHub `main` to confirm deployed build sync
- **Night / dark theme** option for low-light usage
- **Clear landing instructions** for saving to home screen and understanding local-only storage

### Non-Goals (v1.2)
- Cloud sync or remote backend
- Medical advice, diagnosis, clinical decision support
- Automated medication reminders
- Bluetooth BP monitor integration

---

## 3. User Profiles

### 3.1 User Selector
- **Header dropdown:** the currently selected user is shown as the default; tapping opens a dropdown to switch to any other user.
- Selected user persists in `localStorage`
- Always accessible from the sticky header on every screen
- User add/rename/delete remains available on the Home screen

### 3.2 User Schema
```json
{
  "id": "uuid",
  "name": "string",
  "avatar_color": "string (hex, auto-assigned)",
  "created_at": "ISO8601",
  "date_of_birth": "string | null",
  "physician_name": "string | null"
}
```
`date_of_birth` and `physician_name` are optional; used only in the report header.

### 3.3 User CRUD
- **Add:** name input, avatar color auto-assigned from palette
- **Rename:** inline edit
- **Delete:** confirmation dialog; deletes all entries and images for that user

---

## 4. Core Workflow

### 4.1 Home Screen
- **Landing instruction card:**
  - "To use BPLog like an app, open your browser menu and choose **Add to Home Screen** (or **Install**)."
  - "This site does not save your settings — only your device does. All data stays on this device."
- **"Take Photo"** — `<input type="file" accept="image/*" capture="environment">`
- **"Upload Photo"** — file picker, supports multi-file select
- Recent entries list (last 5): thumbnail, date/time, sys/dia/HR badge, tag chips, note preview (60 chars)
- Nav: Logs · Reports · Images · Export/Import · Settings

### 4.2 Image Capture
- Captured/uploaded image stored as **Blob in IndexedDB** `images` object store, keyed by `entry.id`
- EXIF extracted via **exifr**: `DateTimeOriginal` used as entry timestamp; fallback to `Date.now()`
- Image shown in preview panel; OCR triggered only after user confirms preview

### 4.3 OCR Processing
- **Library:** Tesseract.js v5 (WASM, fully on-device)
- **Pre-processing pipeline:**
  1. Grayscale via Canvas API
  2. Contrast enhancement
  3. Optional user crop box before OCR
- **Parse target:** three numeric groups → systolic / diastolic / heart rate
- All extracted values shown in **editable fields** before save — no auto-save without confirmation
- **Machine brand detection:** best-effort color/logo signature vs local registry (Omron, A&D, Microlife); user can set manually via dropdown

### 4.4 Log Entry Schema
```json
{
  "id": "uuid",
  "user_id": "string",
  "timestamp": "ISO8601",
  "systolic": "number (mmHg)",
  "diastolic": "number (mmHg)",
  "heart_rate": "number (bpm)",
  "pulse_pressure": "number — derived: systolic − diastolic",
  "mean_arterial_pressure": "number — derived: diastolic + (PP / 3)",
  "bp_category": "string — derived: Normal | Elevated | Stage 1 | Stage 2 | Crisis",
  "note": "string — free text, always editable",
  "tags": ["string"],
  "machine_brand": "string | null",
  "image_ref": "IndexedDB key | null"
}
```
> **Note:** `pulse_pressure`, `mean_arterial_pressure`, `bp_category` are computed at save time and stored — not recalculated on read.

---

## 5. Tags & Notes System

### 5.1 Notes
- Free-text, no length limit
- Editable at any time: single tap → edit mode → auto-save on blur
- Displayed in full on Entry Detail; truncated with "read more" in Log List
- Included in JSON export and PDF report

### 5.2 Tags
User-defined free-form strings. Intended examples:
- `meds` — medication taken before reading
- `maintenance` — routine, no special context
- `morning` / `evening` / `after-walk` — time or activity
- `stressed` / `decaf` / `salt` — lifestyle markers

**Tag input behavior:**
- Type → Enter or comma to add; tap ✕ chip to remove
- Autocomplete from user's full tag history (tag registry in IndexedDB)
- Tag colors: deterministic hash → palette; consistent across sessions
- **Tag registry** per user maintained in IndexedDB, aggregated from all entries

### 5.3 Tag Analytics
Shown in Reports screen. Per tag, for the selected period:
- Number of readings
- Average systolic, diastolic, heart rate
- Average pulse pressure and MAP

Goal: "When I log `meds`, my average systolic is X mmHg lower than baseline."

---

## 6. Log View

### 6.1 Log List
Infinite scroll, newest first. Each row:
- Thumbnail (if image exists)
- Date/time
- sys/dia/HR badge (color-coded by BP category)
- Tag chips
- Note preview — 60 chars, "read more" expands inline

Tap row → expand: full image, all fields, complete note, all tags, edit/delete buttons.

**Log header banner:**
- Displays the **currently selected user name** and the **active date range** (or "All time" if no filter).

### 6.2 Filters
- Date range (start/end date pickers)
- Tag filter: multi-select chips; shows entries matching ALL selected tags
- BP category filter: Normal / Elevated / Stage 1 / Stage 2 / Crisis
- Sort: newest / oldest toggle

### 6.3 BP Category Classification (AHA 2017)

| Category              | Systolic (mmHg) |     | Diastolic (mmHg) |
|-----------------------|-----------------|-----|------------------|
| Normal                | < 120           | and | < 80             |
| Elevated              | 120 – 129       | and | < 80             |
| High — Stage 1        | 130 – 139       | or  | 80 – 89          |
| High — Stage 2        | ≥ 140           | or  | ≥ 90             |
| Hypertensive Crisis   | > 180           | or  | > 120            |

---

## 7. Image Storage & Cleanup

### 7.1 Storage Model
- Images stored as Blobs in IndexedDB `images` object store, keyed by `entry.id`
- Orphan images (entry deleted, image retained) tracked separately
- Storage usage estimated via `navigator.storage.estimate()`

### 7.2 Image Manager Screen
- Lists all stored images: size, date, linked entry status
- Bulk select → delete selected
- "Delete all orphaned images" one-click
- Storage gauge: used / available estimate

---

## 8. Export / Import

### 8.1 Export Options

| Type             | Format       | Contents                                              |
|------------------|--------------|-------------------------------------------------------|
| JSON Log         | `.json`      | All entries incl. notes, tags, derived fields. No images. |
| Image Archive    | `.zip`       | All photos, filenames = entry ID                      |
| Combined         | `.zip`       | JSON + all images                                     |
| Medical Report   | `.pdf`       | Full physician report (see §9)                        |

### 8.2 Import
- **JSON:** parse and merge into selected user's store
  - Conflict strategy: skip duplicates by `id` (default) or overwrite (user chooses)
- **Image ZIP:** images matched by filename = entry ID → stored in IndexedDB
- Tags merged into tag registry on import
- Validation: schema check per entry; errors listed with option to skip or abort

---

## 9. Medical Report Generation

### 9.1 Purpose
Clean, printable PDF for physician use. Generated entirely client-side via **jsPDF + jsPDF-AutoTable**. No data leaves the device.

### 9.2 Report Configuration
Before generating, user sets:
- Date range (defaults: last 30 days)
- Tag filter — optionally scope to selected tags only
- Include images toggle (significantly increases PDF size)
- Patient info — pulled from user profile: name, DOB, physician name (all optional)

### 9.3 Report Structure

#### Page 1 — Cover & Summary Statistics
```
BPLog — Blood Pressure Report

Patient:         [Name or "Anonymous"]
Date of Birth:   [DOB or blank]
Prepared for:    [Physician name or blank]
Report Period:   [Start] to [End]
Generated:       [Timestamp]
Total Readings:  [N]

─── SUMMARY STATISTICS ─────────────────────────────────────
                 Systolic    Diastolic    Heart Rate
Average            NNN          NN           NN
Minimum            NNN          NN           NN
Maximum            NNN          NN           NN
Std Deviation      NNN          NN           NN

─── BP CATEGORY DISTRIBUTION ───────────────────────────────
  Normal:              N readings  (X%)
  Elevated:            N readings  (X%)
  High — Stage 1:      N readings  (X%)
  High — Stage 2:      N readings  (X%)
  Crisis:              N readings  (X%)

─── DERIVED METRICS (period average) ───────────────────────
  Pulse Pressure (PP):          NN mmHg
  Mean Arterial Pressure (MAP): NN mmHg
```

#### Page 2 — Charts
Three stacked time-series charts. Rendered off-screen to hidden `<canvas>` via Chart.js, then embedded as PNG in PDF.

| # | Chart | Series | Reference Bands | Tag Markers |
|---|-------|--------|-----------------|-------------|
| 1 | Systolic & Diastolic over time | Red = sys, Blue = dia | Shaded bands for Normal / Elevated / Stage 1 / Stage 2 thresholds | Vertical dotted lines or icons at tagged readings (e.g. 💊 for `meds`) |
| 2 | Heart Rate over time | Green = HR | Normal resting HR: 60–100 bpm shaded | Same markers, X-axis aligned to chart 1 |
| 3 | Pulse Pressure & MAP over time | Orange = PP, Purple = MAP | Normal PP range: 30–50 mmHg shaded | Same markers, X-axis aligned |

#### Page 3 — Tag Analytics Table
```
Tag           Readings  Avg Sys  Avg Dia  Avg HR  Avg PP  Avg MAP
───────────── ───────── ──────── ──────── ─────── ─────── ───────
meds               12     128       82       71      46      97
maintenance         8     135       85       74      50     101
morning            20     122       79       68      43      96
after-walk          5     118       76       82      42     89
```

#### Page 4+ — Full Reading Log Table
Columns: Date/Time · Sys · Dia · HR · PP · MAP · Category · Tags · Note

If "Include images" is on: thumbnails appended per row or on a following page grid.

### 9.4 Generation Flow
1. User configures → taps **"Generate Report"**
2. Chart.js renders all three charts to hidden off-screen `<canvas>` elements
3. `canvas.toDataURL('image/png')` exports each chart
4. jsPDF assembles: cover text → stats block → chart PNGs → tag table → AutoTable log
5. PDF downloaded as `bplog-report-[username]-[YYYY-MM-DD].pdf`
6. Fallback: **"Print"** triggers `window.print()` on a print-optimized HTML view

### 9.5 Interactive Charts (Pre-Report, On-Screen)
- Tap/hover data points → reading detail popover
- Pinch-to-zoom on mobile (Chart.js zoom plugin)
- Legend toggles individual series
- Tag filter chips update all three charts in real time

---

## 10. PWA Requirements

| Feature | Requirement |
|---------|-------------|
| Manifest | `name`, `short_name`, icons (192px + 512px), `display: standalone`, `theme_color`, `background_color` |
| Service Worker | Cache-first for app shell, all JS/CSS/WASM. Full offline after first load. |
| Install Prompt | Intercept `beforeinstallprompt`; custom "Add to Home Screen" button in Settings |
| Offline | All features work offline: OCR, charting, PDF, log CRUD |
| Mobile-first | 360–430px viewport; all touch targets min 44×44px |
| HTTPS | Required for `getUserMedia` + PWA install; NPM + Let's Encrypt on PC03 |
| **Night Theme** | Toggle in Settings; persists in `localStorage`; CSS variables switch via `[data-theme="dark"]` |
| **Shortcut** | If the OS supports it, the installed PWA may offer shortcut actions (camera, logs) via manifest `shortcuts` |

---

## 11. Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | Vanilla JS + Web Components (or Preact) | No build step; lightweight; small bundle |
| OCR | Tesseract.js v5 | WASM; fully on-device; no external API |
| Storage | IndexedDB via `idb` wrapper | Blob support for images; no storage limit beyond device |
| ZIP | JSZip | Client-side ZIP; no server |
| EXIF | exifr | Lightweight; reads `DateTimeOriginal` |
| Charting | Chart.js | Canvas-based; offline; `toDataURL()` for PDF embed |
| PDF | jsPDF + jsPDF-AutoTable | Client-side PDF; table plugin for log listing |
| Styling | Custom CSS | Full control; minimal footprint |
| Hosting | Static files — Nginx / Forgejo Pages | Behind NPM on PC03 |

> **Bundle size estimate:** ~800KB–1.2MB after minification (Tesseract.js WASM is the largest component). Cached by Service Worker after first load.

---

## 12. Screen Inventory

| Screen | Key Elements |
|--------|-------------|
| User Select | Avatar card row, add/rename/delete user |
| Home / Capture | Landing instruction card, Take Photo, Upload Photo, recent 5 entries with tags + note preview |
| OCR Preview | Image preview, editable sys/dia/HR fields, note input, tag input, machine brand, save |
| Log List | **User + date-range header**, infinite scroll, filter bar (date + tag chips + category), inline note/tag edit on tap |
| Entry Detail | Full image, all fields, complete note, all tags, edit and delete |
| Reports | Date range + tag filter config, interactive Chart.js charts, tag analytics table, Generate PDF |
| Image Manager | Storage gauge, image list with size + entry link, bulk delete, delete orphans |
| Export / Import | Per-user export buttons (JSON / ZIP / Combined / PDF), import picker + conflict strategy |
| Settings | User profile (name, DOB, physician), **Dark mode toggle**, **Version badge**, Install PWA, storage info |

---

## 13. Deployment

### 13.1 NPM Proxy Config
```
Domain:      bp.comfac-it.com
Forward to:  [PC03 local IP]:[port]
SSL:         Let's Encrypt (NPM automated)
WebSockets:  off
Cache:       off at proxy level (Service Worker handles caching)
```

### 13.2 Deployment Options
- **Option A — Single HTML file:** everything inlined; drop one file in a folder. Easiest first deploy.
- **Option B — Multi-file bundle:** `manifest.json`, `sw.js`, separated JS modules. Tracked in Forgejo. Recommended for production.

---

## 14. Build Order

Recommended sequencing for incremental build and testing:

1. **PWA shell** — `manifest.json`, `sw.js`, IndexedDB schema (`idb`), user profile CRUD
2. **Capture flow** — camera input, EXIF extraction, Tesseract.js OCR, note/tag input, save entry
3. **Log list** — infinite scroll, filter bar, inline note/tag editing, BP category badges, user/date header
4. **Reports screen** — interactive Chart.js charts, tag analytics table, date/tag filter wiring
5. **PDF generator** — jsPDF report assembly: cover → stats → charts → tag table → log AutoTable
6. **Export / Import** — JSON export/import, JSZip image archive, conflict resolution UI
7. **Image Manager** — storage gauge, bulk delete, orphan cleanup
8. **Settings + PWA polish** — install prompt, user profile edit, **dark mode**, **version badge**, offline indicator, landing instructions, disclaimer, offline testing

---

## 15. Version Tracking

### 15.1 Automated Version Badge
- A version badge is displayed in the **top-right corner** of the app (inside the sticky header).
- The badge shows:
  - **Local build SHA** (short hash, hardcoded in `app.js` at build time)
  - **Sync status** — on load, the app fetches the latest commit SHA from the GitHub API (`repos/Comfac-Global-Group/bp-app/commits/main`)
  - If local SHA matches remote → **"Up to date"** (green)
  - If mismatch or fetch fails → **"Update available"** (amber)
- This allows users and testers to instantly verify whether the live site has received the latest pushed changes.

---

## 16. Offline / Local Status

### 16.1 Status Indicator
- A small **"Local / Offline"** pill appears in the header whenever `navigator.onLine === false`.
- When online, the indicator is hidden (the app functions identically either way).
- Reinforces the privacy promise: the app works fully without a connection.

---

## 17. Landing Instructions & Disclaimer

### 17.1 Home Screen Instruction Card
- A dismissible card on the Home screen explains:
  - "To use BPLog like an app, open your browser menu and choose **Add to Home Screen** (or **Install**)."
  - "This site will not save your settings — only your device will. All data stays on this device."
- This sets expectations for first-time visitors using the web version.

### 17.2 Medical Disclaimer
- A disclaimer modal is shown **once per device** on first load (tracked via `localStorage`).
- Text:
  > **This is not a medical app.** BPLog is a personal logging tool. It does not provide diagnosis, medical advice, or clinical decision support. Always consult a qualified healthcare professional for medical concerns.
- The disclaimer must be acknowledged before interacting with the app.
- A shorter version of the disclaimer is also shown in the footer of Settings and the README.

---

## 18. Out of Scope — v2 Candidates

| Feature | Notes |
|---------|-------|
| AI trend interpretation | Could use local Ollama API — no data leaves device |
| Nextcloud WebDAV sync | CGG holds Bronze partner status; feasible via WebDAV PUT |
| Bluetooth BP monitor | Web Bluetooth API; bypasses camera/OCR for supported devices |
| Medication module | Tags serve as proxy in v1.2; full med log in v2 |
| Reminders / alarms | Web Push + Service Worker; HTTPS already covered |
| Physician portal | Shared read-only report URL; needs minimal backend |
| PDF → Nextcloud auto-upload | Post-generation "Save to Nextcloud" via WebDAV PUT |

---

*End of document — BPLog FRD v1.2*
