#!/usr/bin/env python3
"""
BPLog OCR Benchmark — scripts/ocr_bench.py
============================================
Exhaustive test of every OCR engine × every preprocessing strategy × every
sample image. Designed to be run repeatedly as new engines/strategies are
added. Results are accumulated in scripts/ocr_results.json so each session
builds on the last.

USAGE
-----
  python3 scripts/ocr_bench.py                   # run all
  python3 scripts/ocr_bench.py --image 20260414  # one image only
  python3 scripts/ocr_bench.py --engine tesseract_eng     # one engine
  python3 scripts/ocr_bench.py --strategy lcd_crop_inv    # one strategy
  python3 scripts/ocr_bench.py --save-debug               # write /tmp/bp_debug/*.png

INSTALL ALL ENGINES (run once, requires sudo)
----------------------------------------------
  sudo apt-get install -y tesseract-ocr ocrad

  # LCD-specific tessdata (7-segment trained):
  sudo wget -O /usr/share/tesseract-ocr/5/tessdata/letsgodigital.traineddata \
    "https://github.com/arturaugusto/display_ocr/raw/master/letsgodigital/letsgodigital.traineddata"

  # Digit-only tessdata:
  sudo wget -O /usr/share/tesseract-ocr/5/tessdata/digits.traineddata \
    "https://github.com/tesseract-ocr/tessdata/raw/main/digits.traineddata"

  # Python packages:
  sudo pip3 install pytesseract --break-system-packages

ADDING A NEW ENGINE
-------------------
Add an entry to ENGINES dict. Each engine is a callable:
  fn(processed_pil_image) -> str   (raw OCR text)

ADDING A NEW PREPROCESSING STRATEGY
-------------------------------------
Add an entry to STRATEGIES dict. Each strategy is a callable:
  fn(original_pil_image) -> PIL.Image

ADDING A NEW SAMPLE IMAGE
--------------------------
Drop the .jpg in "Bloodpressure Samples/" and add its ground truth to
GROUND_TRUTH. Use (sys, dia, pulse) for confirmed readings, None for discards.

REPORTING RESULTS
-----------------
After running, paste the printed SUMMARY block into QA-log.md under a new
dated heading:  ## OCR Bench Run — YYYY-MM-DD — <model name>
"""

import re
import os
import sys
import json
import time
import shutil
import subprocess
import argparse
from pathlib import Path
from datetime import datetime

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

try:
    from PIL import Image, ImageFilter, ImageEnhance, ImageOps
    HAS_PIL = True
except ImportError:
    print("FATAL: Pillow not installed. Run: sudo pip3 install Pillow --break-system-packages")
    sys.exit(1)

try:
    import pytesseract
    HAS_PYTESSERACT = True
except ImportError:
    HAS_PYTESSERACT = False

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR   = Path(__file__).parent
REPO_DIR     = SCRIPT_DIR.parent
SAMPLE_DIR   = REPO_DIR / "Bloodpressure Samples"
RESULTS_FILE = SCRIPT_DIR / "ocr_results.json"
DEBUG_DIR    = Path("/tmp/bp_debug")

# ---------------------------------------------------------------------------
# Ground truth
# Naming convention: YYYYMMDD_HHMMSS-brand-SYS-DIA-PULSE.jpg
# All values ✅ confirmed by user (encoded in filename).
# None = no final reading (discard image — skip in bench).
# ---------------------------------------------------------------------------
GROUND_TRUTH = {
    "20260409_215943-omron-135-82-73.jpg": (135, 82, 73),  # ✅ confirmed in filename
    "20260410_120217-omron-134-90-61.jpg": (134, 90, 61),  # ✅ confirmed in filename
    "20260411_195510-omron-128-75-85.jpg": (128, 75, 85),  # ✅ confirmed in filename
    "20260413_201728-omron-149-86-75.jpg": (149, 86, 75),  # ✅ confirmed in filename
    "20260414_112450-omron-118-78-59.jpg": (118, 78, 59),  # ✅ confirmed in filename
}

def gt_from_filename(fname):
    """Parse (sys, dia, pulse) from filename like 20260414_112450-omron-118-78-59.jpg"""
    import re
    m = re.search(r'-(\d+)-(\d+)-(\d+)\.jpg$', fname, re.I)
    if m:
        return int(m[1]), int(m[2]), int(m[3])
    return None

# ---------------------------------------------------------------------------
# Preprocessing strategies
# Each returns a grayscale PIL Image ready for OCR.
# The original colour image is passed in — each function must handle its own
# conversion, cropping, and scaling.
# ---------------------------------------------------------------------------

def _grayscale_scale_threshold(img, scale_to=2000, threshold=128, invert=False):
    g = img.convert("L")
    w, h = g.size
    if w < scale_to:
        g = g.resize((int(w * scale_to / w), int(h * scale_to / w)), Image.LANCZOS)
    g = g.point(lambda p: 255 if p > threshold else 0)
    return ImageOps.invert(g) if invert else g

def _lcd_crop(img):
    """Crop to approximate LCD region for HEM-7121."""
    w, h = img.size
    return img.crop((int(w * 0.27), int(h * 0.12), int(w * 0.88), int(h * 0.63)))

def _colour_segment_lcd(img):
    """
    Isolate LCD segment pixels by colour range.
    HEM-7121 LCD segments are dark grey (~40–100 luminance) on a light
    grey-green background (~160–220 luminance). Segment pixels appear as
    a darker region with a slight warm-grey hue.
    Returns greyscale image with segments as dark pixels (OCR-ready).
    """
    if not HAS_NUMPY:
        return img.convert("L")
    arr = np.array(img.convert("RGB"), dtype=np.float32)
    r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    lum = 0.299*r + 0.587*g + 0.114*b
    # LCD segments are darker than background but not black
    segment_mask = (lum < 140).astype(np.uint8) * 255
    return Image.fromarray(segment_mask.astype(np.uint8), mode="L")

def _deskew(img):
    """
    Detect and correct rotation using Hough-line approach.
    Falls back to identity if numpy not available.
    """
    if not HAS_NUMPY:
        return img
    g = img.convert("L")
    arr = np.array(g)
    # Edge detection via simple gradient
    gy = np.diff(arr.astype(np.int16), axis=0)
    gx = np.diff(arr.astype(np.int16), axis=1)
    # Estimate dominant angle via column-wise variance
    # (Simple heuristic: find angle where row variance is maximised)
    best_angle = 0
    best_var = 0
    for angle in range(-15, 16):
        rotated = g.rotate(angle, expand=False, fillcolor=255)
        arr_r = np.array(rotated)
        var = arr_r.var(axis=1).mean()
        if var > best_var:
            best_var = var
            best_angle = angle
    if abs(best_angle) > 1:
        img = img.rotate(best_angle, expand=False, fillcolor=(255, 255, 255))
    return img

def _adaptive_threshold(img):
    """Local contrast: Gaussian blur as local mean, threshold relative to local bg."""
    if not HAS_NUMPY:
        return img.convert("L")
    g = img.convert("L")
    blur = g.filter(ImageFilter.GaussianBlur(radius=25))
    arr  = np.array(g, dtype=np.int16)
    blr  = np.array(blur, dtype=np.int16)
    diff = blr - arr  # positive = darker than local bg = likely a segment
    out  = np.clip(diff * 3 + 128, 0, 255).astype(np.uint8)
    result = Image.fromarray(out)
    return result.point(lambda p: 0 if p > 140 else 255)

# ---- Strategy registry -------------------------------------------------------
STRATEGIES = {
    # name: (description, fn)

    # ── Raw / grayscale ──────────────────────────────────────────────────────
    "raw_colour":
        ("Raw colour image — best for PaddleOCR and VLM engines",
         lambda img: img.convert("RGB")),
    "raw_gray":
        ("Raw grayscale, no threshold",
         lambda img: img.convert("L")),
    "lcd_crop_colour":
        ("LCD crop, colour — best for PaddleOCR and VLM engines",
         lambda img: _lcd_crop(img).convert("RGB")),

    # ── Threshold variants (full image) ──────────────────────────────────────
    "gray_thr128":
        ("Grayscale + threshold 128",
         lambda img: _grayscale_scale_threshold(img, threshold=128)),
    "gray_thr128_inv":
        ("Grayscale + threshold 128 + invert",
         lambda img: _grayscale_scale_threshold(img, threshold=128, invert=True)),
    "gray_thr100":
        ("Grayscale + lower threshold 100 (catches dim segments)",
         lambda img: _grayscale_scale_threshold(img, threshold=100)),
    "gray_thr100_inv":
        ("Grayscale + lower threshold 100 + invert",
         lambda img: _grayscale_scale_threshold(img, threshold=100, invert=True)),
    "gray_thr150":
        ("Grayscale + higher threshold 150",
         lambda img: _grayscale_scale_threshold(img, threshold=150)),
    "gray_thr150_inv":
        ("Grayscale + higher threshold 150 + invert",
         lambda img: _grayscale_scale_threshold(img, threshold=150, invert=True)),

    # ── Contrast + threshold ─────────────────────────────────────────────────
    "contrast2_thr":
        ("Contrast ×2 → threshold 128",
         lambda img: _grayscale_scale_threshold(
             ImageEnhance.Contrast(img).enhance(2.0), threshold=128)),
    "contrast3_thr":
        ("Contrast ×3 → threshold 128",
         lambda img: _grayscale_scale_threshold(
             ImageEnhance.Contrast(img).enhance(3.0), threshold=128)),
    "contrast4_thr":
        ("Contrast ×4 → threshold 128",
         lambda img: _grayscale_scale_threshold(
             ImageEnhance.Contrast(img).enhance(4.0), threshold=128)),
    "contrast3_thr_inv":
        ("Contrast ×3 → threshold 128 → invert",
         lambda img: _grayscale_scale_threshold(
             ImageEnhance.Contrast(img).enhance(3.0), threshold=128, invert=True)),

    # ── Sharpen ───────────────────────────────────────────────────────────────
    "sharpen_thr":
        ("Sharpen → threshold 128",
         lambda img: _grayscale_scale_threshold(
             img.filter(ImageFilter.SHARPEN), threshold=128)),

    # ── Adaptive threshold ───────────────────────────────────────────────────
    "adaptive":
        ("Adaptive local-contrast threshold (Gaussian subtract)",
         _adaptive_threshold),
    "adaptive_lcd_crop":
        ("LCD crop → adaptive threshold",
         lambda img: _adaptive_threshold(_lcd_crop(img))),

    # ── LCD crop variants ─────────────────────────────────────────────────────
    "lcd_crop_thr128":
        ("LCD crop → threshold 128",
         lambda img: _grayscale_scale_threshold(_lcd_crop(img), threshold=128)),
    "lcd_crop_thr128_inv":
        ("LCD crop → threshold 128 → invert",
         lambda img: _grayscale_scale_threshold(_lcd_crop(img), threshold=128, invert=True)),
    "lcd_crop_contrast3":
        ("LCD crop → contrast ×3 → threshold",
         lambda img: _grayscale_scale_threshold(
             ImageEnhance.Contrast(_lcd_crop(img)).enhance(3.0), threshold=128)),
    "lcd_crop_contrast3_inv":
        ("LCD crop → contrast ×3 → threshold → invert",
         lambda img: _grayscale_scale_threshold(
             ImageEnhance.Contrast(_lcd_crop(img)).enhance(3.0), threshold=128, invert=True)),

    # ── Colour segmentation ───────────────────────────────────────────────────
    "colour_seg":
        ("Colour-range LCD segment isolation",
         _colour_segment_lcd),
    "colour_seg_lcd_crop":
        ("LCD crop → colour-range segment isolation",
         lambda img: _colour_segment_lcd(_lcd_crop(img))),

    # ── Deskew ────────────────────────────────────────────────────────────────
    "deskew_thr128":
        ("Auto-deskew rotation → threshold 128",
         lambda img: _grayscale_scale_threshold(_deskew(img), threshold=128)),
    "deskew_lcd_crop_thr128":
        ("Auto-deskew → LCD crop → threshold 128",
         lambda img: _grayscale_scale_threshold(_lcd_crop(_deskew(img)), threshold=128)),
}

# ---------------------------------------------------------------------------
# OCR engines
# Each engine is a callable: fn(pil_image) -> str (raw text)
# If the engine binary is not installed, fn should raise RuntimeError with
# a message that includes the install command.
# ---------------------------------------------------------------------------

def _engine_tesseract(config):
    """Factory: returns a tesseract OCR function for a given config string."""
    def fn(img):
        if not HAS_PYTESSERACT:
            raise RuntimeError(
                "pytesseract not installed. Run: sudo pip3 install pytesseract --break-system-packages")
        return pytesseract.image_to_string(img, config=config)
    fn.__name__ = f"tess:{config}"
    return fn

def _engine_ocrad():
    """ocrad CLI engine. Install: sudo apt-get install ocrad"""
    def fn(img):
        if not shutil.which("ocrad"):
            raise RuntimeError("ocrad not installed. Run: sudo apt-get install -y ocrad")
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".ppm", delete=False) as f:
            tmp = f.name
        try:
            img.save(tmp)
            result = subprocess.run(["ocrad", tmp], capture_output=True, text=True, timeout=10)
            return result.stdout
        finally:
            os.unlink(tmp)
    fn.__name__ = "ocrad"
    return fn

def _tess_lang_available(lang):
    td = Path("/usr/share/tesseract-ocr/5/tessdata")
    return (td / f"{lang}.traineddata").exists()

def _engine_paddleocr():
    """
    PaddleOCR PP-OCRv4 — modern edge-optimised two-stage pipeline.
    Install: sudo pip3 install paddlepaddle paddleocr --break-system-packages
    First run downloads ~24MB of model files to ~/.paddleocr/
    """
    def fn(img):
        try:
            from paddleocr import PaddleOCR
        except ImportError:
            raise RuntimeError(
                "PaddleOCR not installed. Run: "
                "sudo pip3 install paddlepaddle paddleocr --break-system-packages")
        import tempfile
        # PaddleOCR works best on colour images — pass the original RGB
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            tmp = f.name
        try:
            # Save as RGB (PaddleOCR handles its own preprocessing internally)
            if img.mode != "RGB":
                img = img.convert("RGB")
            img.save(tmp)
            ocr = PaddleOCR(use_angle_cls=True, lang="en")
            result = ocr.ocr(tmp, cls=True)
            # result is list of lists: [[[x,y],...], (text, confidence)]
            lines = []
            if result and result[0]:
                for line in result[0]:
                    if line and len(line) >= 2:
                        lines.append(line[1][0])  # text string
            return "\n".join(lines)
        finally:
            os.unlink(tmp)
    fn.__name__ = "paddleocr"
    return fn

def _engine_florence2():
    """
    Microsoft Florence-2-base VLM — OCR via vision-language model.
    Install: sudo pip3 install transformers timm --break-system-packages
    First run downloads ~232MB to ~/.cache/huggingface/
    """
    def fn(img):
        try:
            from transformers import AutoProcessor, AutoModelForCausalLM
            import torch
        except ImportError:
            raise RuntimeError(
                "transformers not installed. Run: "
                "sudo pip3 install transformers timm --break-system-packages")
        if img.mode != "RGB":
            img = img.convert("RGB")
        model = AutoModelForCausalLM.from_pretrained(
            "microsoft/Florence-2-base",
            torch_dtype=torch.float32,
            trust_remote_code=True)
        processor = AutoProcessor.from_pretrained(
            "microsoft/Florence-2-base", trust_remote_code=True)
        inputs = processor(text="<OCR>", images=img, return_tensors="pt")
        with torch.no_grad():
            out = model.generate(**inputs, max_new_tokens=200,
                                 num_beams=3, early_stopping=True)
        return processor.decode(out[0], skip_special_tokens=True)
    fn.__name__ = "florence2"
    return fn

def _engine_smolvlm():
    """
    HuggingFace SmolVLM-256M-Instruct — micro VLM for edge devices.
    Install: sudo pip3 install transformers --break-system-packages
    First run downloads ~500MB to ~/.cache/huggingface/
    """
    def fn(img):
        try:
            from transformers import AutoProcessor, AutoModelForVision2Seq
            import torch
        except ImportError:
            raise RuntimeError(
                "transformers not installed. Run: "
                "sudo pip3 install transformers --break-system-packages")
        if img.mode != "RGB":
            img = img.convert("RGB")
        model_id = "HuggingFaceTB/SmolVLM-256M-Instruct"
        processor = AutoProcessor.from_pretrained(model_id)
        model = AutoModelForVision2Seq.from_pretrained(
            model_id, torch_dtype=torch.float32)
        msgs = [{"role": "user", "content": [
            {"type": "image"},
            {"type": "text",
             "text": ("This is a photo of an Omron HEM-7121 blood pressure monitor. "
                      "The LCD display shows three numbers. "
                      "What are the systolic (SYS), diastolic (DIA), "
                      "and pulse numbers shown?")}
        ]}]
        prompt = processor.apply_chat_template(msgs, add_generation_prompt=True)
        inputs = processor(text=prompt, images=[img], return_tensors="pt")
        with torch.no_grad():
            out = model.generate(**inputs, max_new_tokens=80)
        return processor.decode(out[0], skip_special_tokens=True)
    fn.__name__ = "smolvlm"
    return fn

ENGINES = {
    # name: (description, install_cmd, fn)

    "tesseract_eng_psm6":
        ("Tesseract eng PSM6 (full block)",
         "sudo apt-get install -y tesseract-ocr",
         _engine_tesseract("--psm 6 -l eng")),
    "tesseract_eng_psm11":
        ("Tesseract eng PSM11 (sparse text)",
         "sudo apt-get install -y tesseract-ocr",
         _engine_tesseract("--psm 11 -l eng")),
    "tesseract_eng_psm6_digits":
        ("Tesseract eng PSM6 digit-whitelist",
         "sudo apt-get install -y tesseract-ocr",
         _engine_tesseract("--psm 6 -l eng -c tessedit_char_whitelist=0123456789")),
    "tesseract_eng_psm7_digits":
        ("Tesseract eng PSM7 (single line) digit-whitelist",
         "sudo apt-get install -y tesseract-ocr",
         _engine_tesseract("--psm 7 -l eng -c tessedit_char_whitelist=0123456789")),
    "tesseract_eng_psm8_digits":
        ("Tesseract eng PSM8 (single word) digit-whitelist",
         "sudo apt-get install -y tesseract-ocr",
         _engine_tesseract("--psm 8 -l eng -c tessedit_char_whitelist=0123456789")),

    "tesseract_lcd_psm6":
        ("Tesseract letsgodigital (LCD-trained) PSM6",
         "sudo wget -O /usr/share/tesseract-ocr/5/tessdata/letsgodigital.traineddata "
         "https://github.com/arturaugusto/display_ocr/raw/master/letsgodigital/letsgodigital.traineddata",
         _engine_tesseract("--psm 6 -l letsgodigital")),
    "tesseract_lcd_psm8":
        ("Tesseract letsgodigital (LCD-trained) PSM8 single-word",
         "sudo wget -O /usr/share/tesseract-ocr/5/tessdata/letsgodigital.traineddata "
         "https://github.com/arturaugusto/display_ocr/raw/master/letsgodigital/letsgodigital.traineddata",
         _engine_tesseract("--psm 8 -l letsgodigital")),
    "tesseract_lcd_psm11":
        ("Tesseract letsgodigital (LCD-trained) PSM11 sparse",
         "sudo wget -O /usr/share/tesseract-ocr/5/tessdata/letsgodigital.traineddata "
         "https://github.com/arturaugusto/display_ocr/raw/master/letsgodigital/letsgodigital.traineddata",
         _engine_tesseract("--psm 11 -l letsgodigital")),

    "tesseract_digits_psm8":
        ("Tesseract digits.traineddata PSM8",
         "sudo wget -O /usr/share/tesseract-ocr/5/tessdata/digits.traineddata "
         "https://github.com/tesseract-ocr/tessdata/raw/main/digits.traineddata",
         _engine_tesseract("--psm 8 -l digits")),

    "ocrad":
        ("GNU OCRAD — general-purpose OCR (same engine as browser ocrad.js)",
         "sudo apt-get install -y ocrad",
         _engine_ocrad()),

    # ── Tier 1: Modern edge-optimised engines ────────────────────────────────
    "paddleocr":
        ("PaddleOCR PP-OCRv4 — edge-optimised, two-stage detection+recognition",
         "sudo pip3 install paddlepaddle paddleocr --break-system-packages",
         _engine_paddleocr()),

    "florence2":
        ("Microsoft Florence-2-base VLM (~232MB) — OCR via vision-language model",
         "sudo pip3 install transformers timm --break-system-packages",
         _engine_florence2()),

    "smolvlm":
        ("HuggingFace SmolVLM-256M-Instruct (~500MB) — micro VLM, natural-language query",
         "sudo pip3 install transformers --break-system-packages",
         _engine_smolvlm()),
}

# ---------------------------------------------------------------------------
# BP extraction (mirrors app.js extractBP — keep in sync)
# ---------------------------------------------------------------------------
def valid_pair(s, d):
    return 90 <= s <= 220 and 50 <= d <= 130 and d < s and 20 <= (s - d) <= 100

def extract_bp(text):
    nums = [int(n) for n in re.findall(r'\d+', text) if 10 <= int(n) <= 300]
    # D: label proximity
    ms = re.search(r'(\d{2,3})\s{0,20}SYS', text, re.I) or re.search(r'SYS\s{0,20}(\d{2,3})', text, re.I)
    md = re.search(r'(\d{2,3})\s{0,20}DIA', text, re.I) or re.search(r'DIA\s{0,20}(\d{2,3})', text, re.I)
    mp = re.search(r'(\d{2,3})\s{0,20}(?:Pulse|/min)', text, re.I) or re.search(r'(?:Pulse|/min)\s{0,20}(\d{2,3})', text, re.I)
    if ms and md:
        s, d = int(ms[1]), int(md[1])
        if valid_pair(s, d):
            return s, d, int(mp[1]) if mp else None, "D:label"
    # A: separator
    m = re.search(r'(\d{2,3})\s*[/|\\]\s*(\d{2,3})', text)
    if m:
        a, b = int(m[1]), int(m[2])
        if valid_pair(a, b): return a, b, None, "A:sep"
    # B: range + pp
    sc = sorted([n for n in nums if 90 <= n <= 220], reverse=True)
    dc = sorted([n for n in nums if 50 <= n <= 130], reverse=True)
    for s in sc:
        for d in (x for x in dc if x < s):
            if 20 <= s-d <= 100: return s, d, None, "B:range+pp"
    # C: range only
    s = sc[0] if sc else None
    d = next((x for x in dc if s and x < s), None) if s else None
    if s and d: return s, d, None, "C:range"
    return None, None, None, "FAIL"

def rescue_sys_leading_one(sys_e, dia_e):
    """Prepend '1' to a dropped-leading-1 SYS reading and revalidate.
    LCD digit '1' = only segments b+c (right-side bars) — looks like noise to OCR.
    If SYS comes back as 2 digits in range 18-99, it's almost certainly 118-199."""
    if sys_e is not None and 18 <= sys_e <= 99:
        candidate = sys_e + 100
        if dia_e is not None and valid_pair(candidate, dia_e):
            return candidate
    return sys_e

def extract_bp_with_rescue(text):
    sys_e, dia_e, pulse_e, algo = extract_bp(text)
    sys_e = rescue_sys_leading_one(sys_e, dia_e)
    return sys_e, dia_e, pulse_e, algo

# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------
SCORE_RANK = {"FULL_MATCH": 4, "SYS+DIA_MATCH": 3, "PARTIAL": 2, "NO_MATCH": 1,
              "NO_EXTRACT": 0, "SKIP": -1}

def score_result(sys_e, dia_e, pulse_e, gt):
    if gt is None: return "SKIP"
    if sys_e is None and dia_e is None: return "NO_EXTRACT"
    sys_t, dia_t, pulse_t = gt
    sys_ok  = sys_e   is not None and abs(sys_e   - sys_t)   <= 3
    dia_ok  = dia_e   is not None and abs(dia_e   - dia_t)   <= 3
    pulse_ok= pulse_e is not None and abs(pulse_e - pulse_t) <= 3
    if sys_ok and dia_ok and pulse_ok: return "FULL_MATCH"
    if sys_ok and dia_ok:              return "SYS+DIA_MATCH"
    if sys_ok or dia_ok:               return "PARTIAL"
    return "NO_MATCH"

# ---------------------------------------------------------------------------
# Main runner
# ---------------------------------------------------------------------------
def run_bench(filter_image=None, filter_engine=None, filter_strategy=None,
              save_debug=False):
    run_id   = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    hostname = os.uname().nodename if hasattr(os, 'uname') else "unknown"
    records  = []

    if save_debug:
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*90}")
    print(f"  BPLog OCR Benchmark  |  run_id={run_id}  |  host={hostname}")
    print(f"{'='*90}")

    # Engine availability check
    print("\nEngine availability:")
    for ename, (edesc, einstall, efn) in ENGINES.items():
        if filter_engine and filter_engine not in ename:
            continue
        # Quick probe
        try:
            probe = Image.new("L", (10, 10), 255)
            efn(probe)
            status = "✅ available"
        except RuntimeError as e:
            status = f"❌ NOT INSTALLED — {einstall}"
        except Exception:
            status = "✅ available"
        print(f"  {ename:<35} {status}")

    print()

    for fname, gt in GROUND_TRUTH.items():
        if filter_image and filter_image not in fname:
            continue
        if gt is None:
            print(f"[SKIP] {fname} — no ground truth (mid-measurement or discard)\n")
            continue

        img_path = SAMPLE_DIR / fname
        if not img_path.exists():
            print(f"[MISSING] {fname}\n")
            continue

        gt_str = f"{gt[0]}/{gt[1]}/{gt[2]}"
        print(f"{'─'*90}")
        print(f"  {fname}   GT: SYS={gt[0]} DIA={gt[1]} PULSE={gt[2]}")
        print(f"{'─'*90}")

        original = Image.open(img_path)
        best_score = -1
        best_rec   = None

        for sname, (sdesc, sfn) in STRATEGIES.items():
            if filter_strategy and filter_strategy not in sname:
                continue

            # Preprocessing
            t0 = time.perf_counter()
            try:
                processed = sfn(original.copy())
            except Exception as e:
                print(f"  [PREP FAIL] {sname}: {e}")
                continue
            prep_ms = int((time.perf_counter() - t0) * 1000)

            if save_debug:
                processed.save(DEBUG_DIR / f"{fname[:-4]}_{sname}.png")

            for ename, (edesc, einstall, efn) in ENGINES.items():
                if filter_engine and filter_engine not in ename:
                    continue

                t1 = time.perf_counter()
                try:
                    raw_text = efn(processed)
                except RuntimeError:
                    # Engine not installed — record and skip
                    rec = {
                        "run_id": run_id, "image": fname, "gt": gt_str,
                        "strategy": sname, "engine": ename,
                        "sys": None, "dia": None, "pulse": None,
                        "algo": "ENGINE_MISSING", "score": "ENGINE_MISSING",
                        "score_rank": -2, "raw_text": "",
                        "prep_ms": prep_ms, "ocr_ms": 0,
                    }
                    records.append(rec)
                    continue
                except Exception as e:
                    continue

                ocr_ms = int((time.perf_counter() - t1) * 1000)
                text   = raw_text.strip().replace("\n", " ")
                sys_e, dia_e, pulse_e, algo = extract_bp_with_rescue(text)
                sc     = score_result(sys_e, dia_e, pulse_e, gt)
                rank   = SCORE_RANK.get(sc, 0)

                rec = {
                    "run_id": run_id, "image": fname, "gt": gt_str,
                    "strategy": sname, "engine": ename,
                    "sys": sys_e, "dia": dia_e, "pulse": pulse_e,
                    "algo": algo, "score": sc, "score_rank": rank,
                    "raw_text": text[:120],
                    "prep_ms": prep_ms, "ocr_ms": ocr_ms,
                }
                records.append(rec)

                if rank > 0:  # any meaningful result
                    print(f"  [{sc}] {sname} × {ename}")
                    print(f"    Extracted: SYS={sys_e} DIA={dia_e} PULSE={pulse_e}  algo={algo}")
                    print(f"    Raw: {text[:80]!r}")
                    print(f"    Timing: prep={prep_ms}ms  ocr={ocr_ms}ms")

                if rank > best_score:
                    best_score = rank
                    best_rec   = rec

        if best_rec and best_rec["score_rank"] > 0:
            print(f"\n  ★ BEST for {fname}: [{best_rec['score']}]  "
                  f"strategy={best_rec['strategy']}  engine={best_rec['engine']}  "
                  f"SYS={best_rec['sys']} DIA={best_rec['dia']} PULSE={best_rec['pulse']}")
        else:
            print(f"\n  ✗ No extractable reading for {fname}")
        print()

    # ── Summary table ──────────────────────────────────────────────────────
    print(f"\n{'='*90}")
    print(f"SUMMARY  run_id={run_id}")
    print(f"{'='*90}")
    scored = [r for r in records if r["score_rank"] >= 0 and r["score"] != "ENGINE_MISSING"]
    if scored:
        best_per_image = {}
        for r in scored:
            key = r["image"]
            if key not in best_per_image or r["score_rank"] > best_per_image[key]["score_rank"]:
                best_per_image[key] = r
        print(f"{'Image':<30} {'GT':>12}  {'Best Score':<18} {'Strategy':<28} {'Engine':<30}")
        print(f"{'-'*30} {'-'*12}  {'-'*18} {'-'*28} {'-'*30}")
        for img, r in best_per_image.items():
            print(f"{img:<30} {r['gt']:>12}  {r['score']:<18} {r['strategy']:<28} {r['engine']:<30}")
    else:
        print("  No scored results.")

    missing = [e for e, (_, _, fn) in ENGINES.items()
               if any(r["score"]=="ENGINE_MISSING" and r["engine"]==e for r in records)]
    if missing:
        print(f"\n  Engines NOT installed (skipped): {', '.join(set(missing))}")

    total = len([r for r in records if r["score"] not in ("ENGINE_MISSING","SKIP")])
    full  = len([r for r in records if r["score"] == "FULL_MATCH"])
    sd    = len([r for r in records if r["score"] == "SYS+DIA_MATCH"])
    part  = len([r for r in records if r["score"] == "PARTIAL"])
    print(f"\n  Combinations run: {total}  |  FULL_MATCH: {full}  |  "
          f"SYS+DIA: {sd}  |  PARTIAL: {part}")
    print(f"\n{'='*90}\n")

    # ── Persist results ────────────────────────────────────────────────────
    existing = []
    if RESULTS_FILE.exists():
        try:
            existing = json.loads(RESULTS_FILE.read_text())
        except Exception:
            pass
    existing.extend(records)
    RESULTS_FILE.write_text(json.dumps(existing, indent=2))
    print(f"Results appended to {RESULTS_FILE}  ({len(records)} new records, {len(existing)} total)\n")

    return records

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    os.chdir(REPO_DIR)
    parser = argparse.ArgumentParser(description="BPLog OCR Benchmark")
    parser.add_argument("--image",    help="Filter: only run images containing this string")
    parser.add_argument("--engine",   help="Filter: only run engines containing this string")
    parser.add_argument("--strategy", help="Filter: only run strategies containing this string")
    parser.add_argument("--save-debug", action="store_true",
                        help=f"Save preprocessed images to {DEBUG_DIR}/")
    args = parser.parse_args()
    run_bench(
        filter_image    = args.image,
        filter_engine   = args.engine,
        filter_strategy = args.strategy,
        save_debug      = args.save_debug,
    )
