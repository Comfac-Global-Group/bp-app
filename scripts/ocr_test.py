#!/usr/bin/env python3
"""
BPLog OCR Test Suite — Omron HEM-7121
Tests multiple preprocessing strategies + regex extraction algorithms against
known ground-truth readings from sample photos.

Ground truth (verified visually from LCD display in each photo):
  20260409_215943.jpg  — rotated 90°, measuring in progress (dashes)  → SKIP (no final reading)
  20260410_120217.jpg  — tilted, shows reading                        → VERIFY
  20260411_195510.jpg  — shows reading                                → VERIFY
  20260413_201728.jpg  — clear upright photo                          → VERIFY
  20260414_112450.jpg  — clear upright photo                          → SYS=118 DIA=78 PULSE=59

Usage:  python3 scripts/ocr_test.py
Output: prints per-image, per-strategy results + match vs ground truth.
        Append results to QA-log.md manually (see bottom of output).

Instructions for other AI models running this test:
  1. Add entries to GROUND_TRUTH dict if you can read additional images.
  2. Add new preprocessing strategies to STRATEGIES list.
  3. Add new extraction functions to extract_bp().
  4. Run the script; paste the SUMMARY section into QA-log.md.
"""

import re, sys, os
import pytesseract
from PIL import Image, ImageFilter, ImageEnhance, ImageOps
from pathlib import Path

# ---------------------------------------------------------------------------
# Ground truth — populate as readings are confirmed visually or by user
# ---------------------------------------------------------------------------
GROUND_TRUTH = {
    # filename: (sys, dia, pulse)  or  None if no final reading / unknown
    # ✅ = user-confirmed   ⚠️ = visual estimate only (AI reading of LCD in image)
    "20260409_215943.jpg": None,             # ✅ mid-measurement, dashes on display — discard
    "20260410_120217.jpg": (153, 97, 76),    # ⚠️ visual estimate — tilted photo, needs user confirmation
    "20260411_195510.jpg": (105, 72, 58),    # ⚠️ visual estimate — needs user confirmation
    "20260413_201728.jpg": (97,  78, 65),    # ⚠️ visual estimate — SYS may be 127, needs user confirmation
    "20260414_112450.jpg": (118, 78, 59),    # ✅ confirmed by user
}

SAMPLE_DIR = Path(__file__).parent.parent / "Bloodpressure Samples"

# ---------------------------------------------------------------------------
# Preprocessing strategies
# ---------------------------------------------------------------------------
def prep_grayscale_threshold(img, threshold=128, upscale=1800, invert=False):
    """Grayscale → upscale → binary threshold (mirrors app.js preprocessForOCR)."""
    img = img.convert("L")
    w, h = img.size
    if w < upscale:
        scale = upscale / w
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    img = img.point(lambda p: 255 if p > threshold else 0)
    if invert:
        img = ImageOps.invert(img)
    return img

def prep_contrast_sharpen(img, upscale=1800, invert=False):
    """Enhance contrast + sharpen before thresholding."""
    img = img.convert("L")
    w, h = img.size
    if w < upscale:
        scale = upscale / w
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    img = ImageEnhance.Contrast(img).enhance(3.0)
    img = img.filter(ImageFilter.SHARPEN)
    img = img.point(lambda p: 255 if p > 128 else 0)
    if invert:
        img = ImageOps.invert(img)
    return img

def prep_lcd_crop(img, upscale=1800):
    """Crop to the LCD screen region (approx top 55% of image, centre 70%)."""
    w, h = img.size
    # Approximate LCD bounding box on HEM-7121 photos (empirical)
    left   = int(w * 0.15)
    right  = int(w * 0.85)
    top    = int(h * 0.10)
    bottom = int(h * 0.60)
    img = img.crop((left, top, right, bottom))
    img = img.convert("L")
    cw, ch = img.size
    if cw < upscale:
        scale = upscale / cw
        img = img.resize((int(cw * scale), int(ch * scale)), Image.LANCZOS)
    img = img.point(lambda p: 255 if p > 128 else 0)
    return img

def prep_lcd_crop_inverted(img, upscale=1800):
    result = prep_lcd_crop(img, upscale)
    return ImageOps.invert(result)

STRATEGIES = [
    ("gray_thresh_normal",    lambda img: prep_grayscale_threshold(img, invert=False)),
    ("gray_thresh_inverted",  lambda img: prep_grayscale_threshold(img, invert=True)),
    ("contrast_normal",       lambda img: prep_contrast_sharpen(img, invert=False)),
    ("contrast_inverted",     lambda img: prep_contrast_sharpen(img, invert=True)),
    ("lcd_crop_normal",       prep_lcd_crop),
    ("lcd_crop_inverted",     prep_lcd_crop_inverted),
]

# ---------------------------------------------------------------------------
# Tesseract configs to try
# ---------------------------------------------------------------------------
TESS_CONFIGS = [
    ("psm6_digits",   "--psm 6 -c tessedit_char_whitelist=0123456789 "),
    ("psm11_digits",  "--psm 11 -c tessedit_char_whitelist=0123456789 "),
    ("psm6_full",     "--psm 6"),
    ("psm11_full",    "--psm 11"),
    ("psm4_full",     "--psm 4"),
]

# ---------------------------------------------------------------------------
# BP extraction algorithms (mirrors app.js extractBP)
# ---------------------------------------------------------------------------
def valid_pair(sys, dia):
    return (90 <= sys <= 220 and 50 <= dia <= 130
            and dia < sys and 20 <= (sys - dia) <= 100)

def extract_bp(text):
    nums = [int(n) for n in re.findall(r'\d+', text) if 10 <= int(n) <= 300]

    # Algorithm D: label proximity
    m_sys  = re.search(r'(\d{2,3})\s{0,20}SYS', text, re.I) or re.search(r'SYS\s{0,20}(\d{2,3})', text, re.I)
    m_dia  = re.search(r'(\d{2,3})\s{0,20}DIA', text, re.I) or re.search(r'DIA\s{0,20}(\d{2,3})', text, re.I)
    m_pls  = re.search(r'(\d{2,3})\s{0,20}(?:Pulse|/min)', text, re.I) or re.search(r'(?:Pulse|/min)\s{0,20}(\d{2,3})', text, re.I)
    if m_sys and m_dia:
        s, d = int(m_sys[1]), int(m_dia[1])
        if valid_pair(s, d):
            return s, d, int(m_pls[1]) if m_pls else None, "D:label"

    # Algorithm A: separator NNN/NN
    m = re.search(r'(\d{2,3})\s*[/|\\]\s*(\d{2,3})', text)
    if m:
        a, b = int(m[1]), int(m[2])
        if valid_pair(a, b):
            return a, b, None, "A:separator"

    # Algorithm B: range + pulse pressure
    sys_cands = sorted([n for n in nums if 90 <= n <= 220], reverse=True)
    dia_cands = sorted([n for n in nums if 50 <= n <= 130], reverse=True)
    for s in sys_cands:
        for d in (x for x in dia_cands if x < s):
            if 20 <= s - d <= 100:
                return s, d, None, "B:range+pp"

    # Algorithm C: range only
    s = sys_cands[0] if sys_cands else None
    d = next((x for x in dia_cands if s and x < s), None) if s else None
    if s and d:
        return s, d, None, "C:range-only"

    return None, None, None, "FAIL"

# ---------------------------------------------------------------------------
# Score a result vs ground truth
# ---------------------------------------------------------------------------
def score(extracted, truth):
    if truth is None:
        return "GT_UNKNOWN"
    sys_e, dia_e, pulse_e, _ = extracted
    sys_t, dia_t, pulse_t = truth
    parts = []
    sys_ok  = sys_e  is not None and abs(sys_e  - sys_t)  <= 3
    dia_ok  = dia_e  is not None and abs(dia_e  - dia_t)  <= 3
    puls_ok = pulse_e is not None and abs(pulse_e - pulse_t) <= 3
    if sys_ok and dia_ok and puls_ok:
        return "FULL_MATCH"
    if sys_ok and dia_ok:
        return "SYS+DIA_MATCH"
    if sys_ok or dia_ok:
        return "PARTIAL"
    return "NO_MATCH"

# ---------------------------------------------------------------------------
# Main test runner
# ---------------------------------------------------------------------------
def run_tests():
    results = []
    print(f"\n{'='*80}")
    print("BPLog OCR Test Suite — Omron HEM-7121")
    print(f"{'='*80}\n")

    for fname, gt in GROUND_TRUTH.items():
        img_path = SAMPLE_DIR / fname
        if not img_path.exists():
            # also try without subdirectory
            img_path = Path(__file__).parent.parent / fname
        if not img_path.exists():
            print(f"[SKIP] {fname} — file not found\n")
            continue

        gt_str = f"SYS={gt[0]} DIA={gt[1]} PULSE={gt[2]}" if gt else "UNKNOWN"
        print(f"{'─'*60}")
        print(f"  Image:  {fname}")
        print(f"  GT:     {gt_str}")
        print(f"{'─'*60}")

        original = Image.open(img_path)
        best = None

        for strat_name, strat_fn in STRATEGIES:
            try:
                processed = strat_fn(original.copy())
            except Exception as e:
                print(f"    [{strat_name}] preprocessing error: {e}")
                continue

            for cfg_name, cfg in TESS_CONFIGS:
                try:
                    raw = pytesseract.image_to_string(processed, config=cfg)
                    text = raw.strip().replace('\n', ' ')
                    sys_e, dia_e, pulse_e, algo = extract_bp(text)
                    sc = score((sys_e, dia_e, pulse_e, algo), gt)

                    # Only print interesting results
                    if sys_e is not None:
                        label = f"    [{strat_name} / {cfg_name}]"
                        print(f"{label}")
                        print(f"      Raw text: {text[:100]!r}")
                        print(f"      Extracted: SYS={sys_e} DIA={dia_e} PULSE={pulse_e}  algo={algo}")
                        print(f"      Score: {sc}")

                        if best is None or sc in ("FULL_MATCH","SYS+DIA_MATCH") and (best[4] not in ("FULL_MATCH","SYS+DIA_MATCH")):
                            best = (strat_name, cfg_name, sys_e, dia_e, pulse_e, sc, algo, text[:100])

                except Exception as e:
                    pass  # silently skip failed combos

        if best:
            results.append({"file": fname, "gt": gt_str, "best": best})
            print(f"\n  *** BEST: {best[0]}/{best[1]}  SYS={best[2]} DIA={best[3]} PULSE={best[4]}  score={best[5]}  algo={best[6]}")
        else:
            results.append({"file": fname, "gt": gt_str, "best": None})
            print(f"\n  *** No extractable readings found for this image.")
        print()

    # Summary table
    print(f"\n{'='*80}")
    print("SUMMARY")
    print(f"{'='*80}")
    print(f"{'File':<35} {'GT':>25} {'Score':<20} {'Algo':<15}")
    print(f"{'-'*35} {'-'*25} {'-'*20} {'-'*15}")
    for r in results:
        b = r["best"]
        if b:
            print(f"{r['file']:<35} {r['gt']:>25} {b[5]:<20} {b[6]:<15}")
        else:
            print(f"{r['file']:<35} {r['gt']:>25} {'NO_EXTRACT':<20} {'—':<15}")

    print(f"\n{'='*80}\n")
    return results

if __name__ == "__main__":
    os.chdir(Path(__file__).parent.parent)
    run_tests()
