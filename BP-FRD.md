# BP-FRD — BPLog Functional Requirements Document
**Version:** 1.3 | **Status:** Ready for Build | **Domain:** bp.comfac-it.com
**Author:** Justin / CGG R&D | **Date:** 2026-04-20

---

## 1. Overview

BPLog is a self-hosted Progressive Web App (PWA) for capturing and logging blood pressure readings from photos. Images are sent to **vision-language models** — **Android Matrix Model (AMM)** for fully offline on-device inference, **local Ollama**, or any **OpenAI-compatible API** — for structured extraction of systolic, diastolic, and heart-rate values. A **browser-based 7-segment template matcher** serves as a zero-network fallback when no VLM is available. Manual entry is always available as the final fallback. All data — images, logs, charts, PDF generation — stays local unless the user explicitly chooses a remote API. No data is ever transmitted to any external server without explicit user configuration.

**Deployment target:** Static file bundle behind NPM on PC03 → `bp.comfac-it.com`

---

## 2. Goals & Non-Goals

### Goals
- Frictionless photo-to-log workflow (camera capture or gallery upload)
- Vision-language model extraction of systolic, diastolic, heart rate (AMM / Ollama / API), with 7-segment template matcher fallback
- Multi-user support with local user profile selector
- Self-hosted, mobile-first, fully offline-capable after first load
- Image storage with optional bulk cleanup
- JSON-based import/export per user
- Free-text notes and user-defined tags per entry, editable at any time
- Printable/exportable medical-grade report with time-series charts
- **Automated version tracking** against GitHub `main` to confirm deployed build sync
- **Night / dark theme** option for low-light usage
- **Clear landing instructions** for saving to home screen and understanding local-only storage

### Non-Goals (v1.3)
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

#### Honest Assessment
Traditional OCR (Tesseract.js, ocrad.js) achieves **0% full-match** on 7-segment LCD blood pressure monitors. 843+ preprocessing combinations were tested (scale, threshold, contrast, crop, sharpen, invert, histogram normalize, CLAHE) with zero success. The digits are too thin, contrast too low, and noise too high for engines trained on printed/antialiased text.

**Real engine ladder:**
1. Vision-language models (AMM, Ollama, OpenAI API)
2. Browser-based 7-segment template matcher (~80% with manual ROI)
3. Manual entry

#### Pre-processing Pipeline
All images sent to VLMs are pre-processed as follows:

1. **Rotate 90° clockwise** — critical unlock for larger models (Qwen 3.5 4B, Gemma 4). The "7" digit in DIA becomes distinguishable when rotated. In experiments, Gemma 4 went from 0/16 full-match (original) to 4/4 (rotate90).
2. **Try both orientations** — send `rotate90` first; if client-side confidence is low, also try original and keep the better result. Smaller models (MedGemma, Qwen 0.8B) may prefer original orientation.
3. **Contrast enhancement** (optional) — helps MedGemma on original orientation; not needed for rotate90 path with larger models.
4. **Scale to minimum 1800 px width** — ensures LCD digits are large enough for the model to resolve.

#### 7-Segment Template Matcher (Browser Fallback)
A pure-JavaScript fallback when no VLM is available or all VLMs fail:

- User draws a rectangle around the LCD display
- Auto-tunes binary threshold for optimal contrast
- Samples 7 segment zones (a-g) per digit and matches against known templates via Hamming distance
- **Accuracy:** ~80% on tested samples with correct ROI
- **Speed:** <1s, zero network, zero model download

This is presented as a **"Couldn't read automatically — tap the display to help us"** screen after VLM engines fail. The user draws the LCD region; the matcher attempts extraction immediately.

#### Known Device Layout — Omron HEM-7121
The primary test device is the **Omron HEM-7121**, an upper-arm blood pressure monitor with an LCD display. Understanding its fixed label layout drives the extraction algorithm:

```
┌──────────────────────────────────┐
│  OMRON           Intelli Sense   │
│                                  │
│         123      ← Systolic      │
│  SYS mmHg                        │
│          80      ← Diastolic     │
│  DIA mmHg                        │
│          72      ← Pulse         │
│  Pulse /min                      │
│                                  │
│  Start       Stop        OK      │
│            HEM-7121              │
└──────────────────────────────────┘
```

**Key text labels present on the display:**
- `OMRON` — brand identifier (top)
- `Intelli Sense` — model feature label (top)
- `SYS` / `SYS mmHg` — systolic label (appears below the systolic reading)
- `DIA` / `DIA mmHg` — diastolic label (appears below the diastolic reading)
- `Pulse /min` — heart-rate label (appears below the pulse reading)
- `Start`, `Stop`, `OK` — button labels (bottom row)
- `HEM-7121` — model number (bottom)

**Model number regex:** `/HEM[-\s]?\d{3,4}[A-Z]*/i` — matches HEM-7121, HEM7121, HEM-705, etc.

#### Device Detection
`detectDevice()` attempts to identify the monitor brand and model from VLM-extracted text or from the image itself:
- Brand: keyword match (`omron`, `microlife`, `a&d`)
- Model: regex match against `HEM-NNN`, `UA-NNN`, `BP-NNN` patterns

If both brand and model are detected and readings are successfully extracted, a **green confirmation hint** is shown: `"Detected: Omron HEM-7121 — review values below."`

If extraction fails, an **amber warning hint** offers the 7-segment template matcher or manual entry.

#### Testing Plan
OCR accuracy is inherently device-specific. Testing strategy:

1. **Per-device test log** — photograph each supported monitor model (HEM-7121, HEM-705, UA-651, BP652) under good lighting; record model, orientation (original vs rotate90), and extraction accuracy.
2. **Edge-case photos** — low light, angled/glare shots, partial occlusion.
3. **Model-size sweep** — larger models (Qwen 3.5 4B, Gemma 4) need rotate90; smaller models (MedGemma, Qwen 0.8B) may prefer original. Document which model/orientation pairs work.
4. **Prompt A/B test** — before locking the default prompt, run the current 4-model leaderboard with (a) minimal prompt `"Read the monitor. Return JSON: {sys, dia, bpm}. No prose."` and (b) verbose range-describing prompt. Keep whichever wins.
5. **User correction rate** — track (via QA-log) how often users must edit VLM-extracted values before saving.

All extracted values remain **editable before save** — VLM extraction is advisory, not authoritative.

#### EXIF Timestamp Extraction
Via `exifr`. Fallback chain: `DateTimeOriginal → CreateDate → DateTime → DateTimeDigitized → Date.now()`.
Displayed in an editable `<input type="datetime-local">` with source label `(from photo EXIF)` or `(now — no EXIF)`. User can correct before saving.

#### External Vision-Language Model Engines
BPLog sends images to vision-language model (VLM) endpoints for structured extraction of systolic, diastolic, and heart-rate values.

**Supported endpoints:**

| Engine | Connection | Requirements | Best For |
|--------|-----------|--------------|----------|
| **AMM (Android Matrix Model)** | HTTP `127.0.0.1:8765` | AMM installed and running on the same phone | Fully offline, on-device VLM inference |
| **Local Ollama** | HTTP `localhost:11434` (configurable) | Ollama running on phone (Termux) or same LAN | Users who already run Ollama locally |
| **OpenAI-compatible API** | Any HTTPS endpoint + API key | Internet connection + valid API key | Highest accuracy when offline is not required |

**Default prompt (editable):**

> Read the blood pressure monitor. Return JSON: {sys, dia, bpm}. No prose.

The prompt is **pre-filled but fully editable** by the user before sending. Experiments show minimal prompts outperform verbose ones for 7-segment LCD extraction. Users can adjust for their device. Edited prompts are remembered per-session and can be reset to default.

**A/B test before locking:** Run the 4-model leaderboard (Qwen 3.5 4B, Gemma 4, MedGemma, Qwen 0.8B) with (a) the minimal prompt above and (b) a verbose range-describing prompt. Keep whichever wins.

**Engine selection priority (configurable in Settings):**

1. **AMM** — probed at app startup via `GET http://127.0.0.1:8765/v1/status`; if `ready: true`, use it (best accuracy, fully offline).
2. **Ollama** — probed at `GET /api/tags`; if a vision model is loaded, use it.
3. **OpenAI-compatible API** — used if API key is configured and `navigator.onLine === true`.
4. **7-segment template matcher** — presented when all VLMs fail; user draws LCD ROI.
5. **Manual entry** — user types values if all engines fail or are disabled.

**Request shape (AMM / Ollama / OpenAI):**

```js
const body = {
  image: "<base64-jpg>",           // JPEG, max 1920px on long edge
  prompt: userPrompt || defaultPrompt,
  temperature: 0.1,                // low creativity for extraction
  max_tokens: 256
};
```

**Response handling:**
- Raw text is parsed for three numbers; JSON extraction attempted if the model returns JSON.
- If parsing fails, a single retry with an appended instruction: `"Return valid JSON only. No markdown, no prose."`
- If the retry also fails, offer the 7-segment template matcher or manual entry.
- All VLM-extracted values remain **editable before save** — the VLM is advisory, not authoritative.

**Client-side confidence derivation (not model-reported):**
Confidence is computed from the extracted values, not from a VLM self-assessment string:

| Check | Rule |
|-------|------|
| SYS range | 90–220 mmHg |
| DIA range | 50–130 mmHg |
| BPM range | 40–180 bpm |
| DIA < SYS | Always |
| Pulse pressure | 20–100 mmHg (SYS − DIA) |

**Confidence badge:**
- **Green** — all checks pass
- **Amber** — one check fails
- **Red** — two+ checks fail or a value is null

This is more reliable than asking a 1–3 GB VLM to self-report confidence.

**Privacy note:** AMM runs entirely on-device; Ollama on Termux is also on-device. Only the OpenAI-compatible path leaves the phone, and only if the user explicitly configures it.

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
| **Shortcut** | If the OS supports it, the installed PWA may offer shortcut actions (camera, logs) via manifest `shortcuts` |

### 10.2 Day / Night Theme

BPLog supports a user-configurable dark mode for low-light usage.

- **Toggle location:** Settings screen
- **Persistence:** `localStorage` key `bplog_theme`
- **Values:** `light` (default) or `dark`
- **Implementation:** CSS custom properties (variables) switch via `html[data-theme="dark"]` attribute
- **Chart compatibility:** Chart.js canvases re-render with theme-aware axis, grid, and legend colors when the toggle changes or when the Reports screen is visited
- **System preference fallback:** On first launch, if no manual preference is stored, the app respects `prefers-color-scheme: dark`
- **Scope:** All screens, modals, charts, and printed PDF views must remain readable in both themes

---

## 11. Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | Vanilla JS + Web Components (or Preact) | No build step; lightweight; small bundle |
| OCR / VLM | AMM / Ollama / OpenAI API | Vision-language models for 7-segment LCD extraction; minimal prompts work best |
| OCR fallback | 7-seg template matcher | Pure JS, zero network, ~80% accuracy with user-drawn LCD ROI |
| OCR baseline | ocrad.js | Retained in bundle for legacy; 0% observed accuracy on 7-segment LCDs |
| Storage | IndexedDB via `idb` wrapper | Blob support for images; no storage limit beyond device |
| ZIP | JSZip | Client-side ZIP; no server |
| EXIF | exifr | Lightweight; reads `DateTimeOriginal` |
| Charting | Chart.js | Canvas-based; offline; `toDataURL()` for PDF embed |
| PDF | jsPDF + jsPDF-AutoTable | Client-side PDF; table plugin for log listing |
| Styling | Custom CSS | Full control; minimal footprint |
| Hosting | Static files — Nginx / Forgejo Pages | Behind NPM on PC03 |

> **Bundle size estimate:** ~500–800 KB after minification (ocrad.js ~300 KB retained for legacy; 7-seg template matcher ~50 KB; CDN assets cached by Service Worker after first load).

---

## 12. Screen Inventory

| Screen | Key Elements |
|--------|-------------|
| User Select | Avatar card row, add/rename/delete user |
| Home / Capture | Landing instruction card, Take Photo, Upload Photo, recent 5 entries with tags + note preview |
| OCR Preview | Image preview, editable sys/dia/HR fields, note input, tag input, machine brand, rotate90 toggle, save |
| Log List | **User + date-range header**, infinite scroll, filter bar (date + tag chips + category), inline note/tag edit on tap |
| Entry Detail | Full image, all fields, complete note, all tags, edit and delete |
| Reports | Date range + tag filter config, interactive Chart.js charts, tag analytics table, Generate PDF |
| Image Manager | Storage gauge, image list with size + entry link, bulk delete, delete orphans |
| Export / Import | Per-user export buttons (JSON / ZIP / Combined / PDF), import picker + conflict strategy |
| Settings | User profile (name, DOB, physician), **Dark mode toggle**, **Version badge**, Install PWA, storage info, **VLM engine priority**, **default prompt editor**, **template matcher toggle**, API key management |

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
- A version badge is displayed **beside the BPLog logo** in the sticky header.
- The badge shows a numeric version (e.g., **v1.05**) that auto-increments by **0.01** for every commit pushed to `main`.
- **Version formula:** `1.00 + (total_commit_count × 0.01)` — computed and injected into `app.js` automatically by the GitHub Actions deployment workflow.
- **Sync status** — on load, the app fetches the latest commit SHA from the GitHub API (`repos/Comfac-Global-Group/bp-app/commits/main`) and compares it to the build SHA injected at deploy time:
  - If local build SHA matches remote → badge turns **green** with tooltip "Up to date"
  - If mismatch or fetch fails → badge turns **amber** with tooltip "Update available"
- This allows users and testers to instantly verify whether the live site has received the latest pushed changes.

## 16. App Update & Version Rollback

### 16.1 Update Button
- A dedicated **"App Update"** card is shown in **Settings**.
- On opening Settings, the app fetches `versions.json` (cache-bypass) from the live site.
- If a newer version exists, it displays:
  - Current version → Latest version
  - An **"Update Now"** button
- Tapping **"Update Now"** unregisters all service workers, clears all caches, and reloads the root app (`./`). All IndexedDB data is preserved because it lives on the same origin.

### 16.2 Version Archive (Rollback Safety)
- The CI workflow archives every deployed version into a subfolder: `versions/vX.XX/`
- A `versions.json` manifest on the root tracks the last 20 deployed versions with metadata: version number, path, commit SHA, date, and release notes.
- In Settings, a **"Previous versions"** list shows all archived builds.
- Each version entry has an **"Open"** link that loads that specific version.
- **Critical:** Because all versions are served from the **same origin** (`comfac-global-group.github.io`), they share the same IndexedDB and `localStorage`. Opening an older version does **not** delete or isolate any user data.
- This gives users a safe escape hatch: if a new release breaks something, they can immediately roll back to the last known-good version without losing logs, images, or profiles.

---

## 17. Offline / Local Status

### 17.1 Status Indicator
- A small **"Local / Offline"** pill appears in the header whenever `navigator.onLine === false`.
- When online, the indicator is hidden (the app functions identically either way).
- Reinforces the privacy promise: the app works fully without a connection.

---

## 18. Landing Instructions & Disclaimer

### 18.1 Home Screen Instruction Card
- A dismissible card on the Home screen explains:
  - "To use BPLog like an app, open your browser menu and choose **Add to Home Screen** (or **Install**)."
  - "This site will not save your settings — only your device will. All data stays on this device."
- This sets expectations for first-time visitors using the web version.

### 18.2 Medical Disclaimer
- A disclaimer modal is shown **once per device** on first load (tracked via `localStorage`).
- Text:
  > **This is not a medical app.** BPLog is a personal logging tool. It does not provide diagnosis, medical advice, or clinical decision support. Always consult a qualified healthcare professional for medical concerns.
- The disclaimer must be acknowledged before interacting with the app.
- A shorter version of the disclaimer is also shown in the footer of Settings and the README.

---

## 19. LLM-Based Image Extraction (AMM / VLM Integration)

BPLog supports sending BP-monitor photos to vision-language models for structured extraction of systolic, diastolic, and heart-rate values. This is implemented as a **configurable engine tier** rather than a separate feature — all details (supported providers, pre-processing with rotate90, 7-segment template matcher fallback, client-side confidence derivation, minimal prompt spec, and request/response format) are documented in §4.3 "External Vision-Language Model Engines".

---

## 20. Out of Scope / Future Roadmap (Post-v1.2)

These features are explicitly **not in v1.3** but are tracked for future releases.

| Feature | Description | Priority | Notes |
|---------|-------------|----------|-------|
| AI trend interpretation | Send log history to a local LLM (via AMM or Ollama) for plain-language trend summaries | Medium | No data leaves device if using local endpoint |
| Nextcloud WebDAV sync | Push encrypted JSON exports to a self-hosted Nextcloud instance | Medium | CGG holds Bronze partner status; feasible via WebDAV PUT |
| Bluetooth BP monitor | Web Bluetooth API integration for supported monitors | Low | Bypasses camera/OCR for supported devices |
| Medication module | Full medication log with schedule tracking | Low | Tags serve as proxy in v1.3; full med log in v2 |
| Reminders / alarms | Web Push + Service Worker for reading reminders | Low | HTTPS already covered |
| Physician portal | Generate shareable read-only report links | Low | Needs minimal backend |
| PDF → Nextcloud auto-upload | Post-generation "Save to Nextcloud" via WebDAV PUT | Low | Post-report action |

---

## 22. Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-14 | v1.2 baseline — ocrad.js-only OCR | Pure JS, no WASM, no network, no external dependencies |
| 2026-04-20 | Added VLM engine tier (AMM / Ollama / OpenAI) | 7-segment LCD displays defeat traditional OCR too often; VLM extraction with editable prompts gives users control while preserving privacy via on-device options |
| 2026-04-20 | Prompt is caller-provided and editable | Different BP monitors have different layouts; users need to tweak prompts for their device without waiting for an app update |
| 2026-04-20 | Multi-engine fallback with configurable priority | No single engine works on every phone or in every lighting condition; graceful degradation ensures the app never blocks the user |
| 2026-04-20 | AMM is auto-detected, not required | bp-app must remain fully functional on any phone; AMM is a power-user enhancement, not a hard dependency |
| 2026-04-20 | rotate90 is required preprocessing | Experimental evidence: Gemma 4 went from 0/16 full-match (original) to 4/4 (rotate90). Larger models need it; smaller models may prefer original. Try rotate90 first, fall back to original |
| 2026-04-20 | Minimal prompts beat verbose prompts | "Only the 3 numbers, comma-separated" outperforms 7-seg descriptions and range instructions. A/B test before locking the default |
| 2026-04-20 | Client-side confidence, not model-reported | Range checks + pulse-pressure sanity are more reliable than a 1–3 GB VLM self-assessing "high|medium|low" |
| 2026-04-20 | 7-seg template matcher is a real fallback tier | ~80% accuracy, zero network, <1s — deserves a UI slot between "VLM failed" and "type it yourself" |
| 2026-04-20 | ocrad.js removed from engine ladder | 0/11 full-match across 843+ combinations. Traditional OCR is dead on 7-segment LCDs. Template matcher replaces it as the practical fallback |
| 2026-04-22 | Migrated AMM browser from WebView (Chrome) to GeckoView (Firefox) | GeckoView is isolated from system Chrome, has different PNA policies, and aligns with privacy-first ethos. JS bridge uses `window.prompt()` interception because GeckoView has no `addJavascriptInterface` |
| 2026-04-22 | AMM JS bridge is primary path; HTTP is fallback only | Bridge bypasses all CORS/PNA/mixed-content issues entirely. HTTP endpoints exist only for external browsers and debugging |

---

## 23. AMM Integration & JS Bridge Specification

### 23.1 Architecture

BPLog runs inside AMM in two possible contexts:

| Context | Engine | `window.AMMBridge` | Network Path |
|---------|--------|-------------------|--------------|
| **Inside AMM Browser** (Chat drawer → 🩺 BP Log) | GeckoView (Firefox) | ✅ Injected automatically | JS bridge — **zero HTTP** |
| **External browser** (Chrome, Safari, Firefox app) | System browser | ❌ Missing | HTTPS→HTTP fetch — **blocked by PNA** |

**Key principle:** When `window.AMMBridge` is present, BPLog must **never** call `fetch()` to localhost. The bridge runs inference on the native thread via `VisionLMManager.infer()` directly.

### 23.2 Detection Ladder (`probeAMM()`)

```javascript
async function probeAMM() {
  // Tier 1: JS bridge (preferred — no network, no PNA)
  if (window.AMMBridge) {
    const isRunning = window.AMMBridge.isHttpServiceRunning();
    const isLoaded  = window.AMMBridge.isVisionModelLoaded();
    const modelName = window.AMMBridge.getLoadedModelName();
    if (isRunning && isLoaded) {
      return { ready: true, models: { vision: modelName }, mode: 'bridge' };
    }
  }
  // Tier 2: HTTP fallback (only works on HTTP origins or permissive browsers)
  try {
    const res = await fetch('http://127.0.0.1:8765/v1/status', { mode: 'cors' });
    const data = await res.json();
    if (data.ready) return { ...data, mode: 'http' };
  } catch (e) { /* expected failure on HTTPS */ }
  return null;
}
```

### 23.3 Bridge API Contract

**Interface name:** `window.AMMBridge`  
**Injection method:** Injected by AMM BrowserActivity via `javascript:` URL after `onPageStop`  
**Communication mechanism (GeckoView):** `window.prompt('amm-bridge', payload)` intercepted by `PromptDelegate.onTextPrompt`

| Method | Arguments | Return | Description |
|--------|-----------|--------|-------------|
| `isEmbedded()` | — | `boolean` | Always `true` |
| `getAmmVersion()` | — | `string` | e.g., `"1.1.4"` |
| `isHttpServiceRunning()` | — | `boolean` | Reads `HttpService.isRunning` |
| `isVisionModelLoaded()` | — | `boolean` | Reads `VisionLMManager.isModelLoaded` |
| `getLoadedModelName()` | — | `string` | Reads `VisionLMManager.loadedModelName` |
| `ammVisionInfer(base64Image, prompt)` | `base64Image`: JPEG as base64 string<br>`prompt`: VLM prompt string | `string` (JSON) | Runs inference natively. Returns JSON string: `{ success, response, tokens_per_sec, context_used, error? }` |

**Example inference call:**
```javascript
const jsonStr = window.AMMBridge.ammVisionInfer(
  dataUrl.split(',')[1],  // strip "data:image/jpeg;base64,"
  'Read the three numbers on this blood pressure monitor. Return JSON: {"sys":<top>,"dia":<middle>,"bpm":<bottom>}'
);
const result = JSON.parse(jsonStr);
if (result.success) {
  const values = parseAmmResponse(result); // → { sys, dia, hr }
}
```

### 23.4 HTTP Fallback Contract (for external browsers)

**Base URL:** `http://127.0.0.1:8765`

| Endpoint | Method | Request | Response |
|----------|--------|---------|----------|
| `/v1/status` | GET | — | `{ version, ready, capabilities, models, queue_depth, inference_mode }` |
| `/v1/vision/completions` | POST | `multipart/form-data`: `image` (file), `prompt` (text) | `{ success, response, tokens_per_sec, context_used, error? }` |
| `/health` | GET | — | `{ status: "ok" }` |
| `/status` | GET | — | `{ vision_model_loaded, model_name }` (legacy) |

**Required CORS headers for HTTPS→loopback:**
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
Access-Control-Allow-Private-Network: true   ← Chrome PNA requirement
```

### 23.5 Known Limitations

| Scenario | Behavior | Workaround |
|----------|----------|------------|
| BPLog opened in Chrome (external) | `window.AMMBridge` missing; HTTP fetch blocked by PNA | Open BPLog from AMM Chat drawer |
| BPLog opened in Safari iOS | HTTPS→loopback is **never** permitted by Apple | Use AMM Browser (JS bridge) or switch to HTTP origin |
| AMM HTTP service off, model loaded | Bridge still works; `isHttpServiceRunning()` returns `false` but inference succeeds | Bridge does not require HTTP service |
| No vision model loaded in AMM | Bridge available but `isVisionModelLoaded()` = `false` | Load a model in AMM Vision Hub |

### 23.6 Verification Steps (QA)

1. Install AMM APK → Vision Hub → download Qwen2.5-VL-3B → load model
2. Chat drawer → 🩺 BP Log
3. Settings → "Run Network Diagnostics"
4. **Expected:**
   - ✅ Browser is GeckoView (Firefox)
   - ✅ AMM JS Bridge available
   - ✅ probeAMM() state OK
   - Health/Status/CORS may show ❌ (these test HTTP path; expected on HTTPS)
5. Take BP monitor photo → OCR review screen auto-populates values

---

*End of document — BPLog FRD v1.3*
