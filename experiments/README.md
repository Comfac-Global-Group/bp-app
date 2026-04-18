# Tier 0 — BP Monitor OCR Validation Spike

**Goal:** In 1 day, determine which OCR engine (if any) reliably reads 7-segment LCD digits from BP monitor photos, using evidence instead of assumptions.

**Hard constraint:** No CMake, no JNI, no NDK, no GGUF bundling, no architecture commits. Just experiments.

---

## Test Harnesses

### 1. Tesseract.js (Browser)

**File:** `test_tesseract.html`

Open in any browser (Chrome recommended). Select the `Bloodpressure Samples/` folder. The harness runs Tesseract.js v5 with:
- Digit whitelist (`0123456789`)
- Optional rotate90 preprocessing
- Optional binary threshold
- Optional 2× upscale

**Outputs:** Per-image results table + accuracy score. Click "Export JSON" to save `tesseract_results.json`.

```bash
# Serve locally so relative paths work
cd /path/to/bp-app
python3 -m http.server 8080
# Then open http://localhost:8080/experiments/test_tesseract.html
```

### 2. MediaPipe Text Recognition (Browser)

**File:** `test_mediapipe.html`

Same workflow. Uses Google MediaPipe Tasks Vision text recognition (~10 MB model download on first run).

**Outputs:** Per-image results table + accuracy score. Click "Export JSON" to save `mediapipe_results.json`.

### 3. Gemini Flash (Python)

**File:** `test_gemini.py`

Requires a free Google API key.

```bash
# 1. Get key: https://aistudio.google.com/app/apikey
export GOOGLE_API_KEY="your-key-here"

# 2. Install deps
pip install google-genai pillow

# 3. Run
python3 experiments/test_gemini.py
```

**Outputs:** `gemini_results.json`

---

## Scoring

Once you have at least one `*_results.json`, run:

```bash
python3 experiments/parse_and_score.py
```

**Outputs:**
- `results.csv` — per-image, per-engine comparison
- `SUMMARY.md` — executive summary with decision guide

---

## Image Manifest

Ground truth extracted from filenames:

| Image | SYS | DIA | PULSE |
|-------|-----|-----|-------|
| 20260409_215943-omron-135-82-73.jpg | 135 | 82 | 73 |
| 20260410_120217-omron-134-90-61.jpg | 134 | 90 | 61 |
| 20260411_195510-omron-128-75-85.jpg | 128 | 75 | 85 |
| 20260413_201728-omron-149-86-75.jpg | 149 | 86 | 75 |
| 20260414_112450-omron-118-78-59.jpg | 118 | 78 | 59 |
| 20260414_112450.jpg | 118 | 78 | 59 |

---

## Decision Rules

| Best engine accuracy | Next action |
|---------------------|-------------|
| ≥ 95% digits, ≥ 80% full match | Integrate winning engine into bp-app |
| 80–95% digits | Add rotate90 + retry logic, then integrate |
| 60–80% digits | Combine engine + manual fallback UI |
| < 60% digits | Try 7-segment traineddata or cloud API |
| All engines < 50% | Problem is lighting/angle/camera, not OCR |

---

## What This Replaces

This 1-day spike replaces the FDR's 3–6 week unvalidated plan with evidence. No JNI, no CMake, no GGUFs, no HTTP services — until data says they're needed.
