#!/usr/bin/env python3
"""
Tier 0 — Gemini Flash BP OCR Test Harness

Tests Google's Gemini 2.0 Flash vision model on BP monitor photos.
Requires: GOOGLE_API_KEY environment variable (free tier: 1500 req/day)
Install:  pip install google-genai pillow

Usage:
    export GOOGLE_API_KEY="your-key-here"
    python3 test_gemini.py

Outputs:
    gemini_results.json — per-image results
"""

import json
import os
import re
import sys
from pathlib import Path

try:
    from google import genai
    from google.genai import types
    from PIL import Image
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install: pip install google-genai pillow")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
API_KEY = os.environ.get("GOOGLE_API_KEY", "")
MODEL = "gemini-2.0-flash"
SAMPLES_DIR = Path(__file__).parent.parent / "Bloodpressure Samples"
ADDITIONAL_IMAGES = [Path(__file__).parent.parent / "20260414_112450.jpg"]
PROMPT = (
    "Read the blood pressure monitor display carefully. "
    "The top number is systolic (SYS), middle is diastolic (DIA), bottom is pulse (PULSE). "
    "These are 7-segment LCD digits. Pay attention to thin strokes. "
    "Reply with ONLY the three numbers in this exact format:\n"
    "SYS: <number>, DIA: <number>, PULSE: <number>"
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def parse_ground_truth(filename: str):
    m = re.search(r"omron-(\d+)-(\d+)-(\d+)", filename)
    if m:
        return {"sys": int(m.group(1)), "dia": int(m.group(2)), "pulse": int(m.group(3))}
    if "20260414_112450" in filename:
        return {"sys": 118, "dia": 78, "pulse": 59}
    return None


def extract_numbers(text: str):
    return [int(n) for n in re.findall(r"\b\d{2,3}\b", text)]


def score_numbers(nums, gt):
    has_sys = gt["sys"] in nums
    has_dia = gt["dia"] in nums
    has_pulse = gt["pulse"] in nums
    count = sum([has_sys, has_dia, has_pulse])
    label = "pass" if count == 3 else "partial" if count > 0 else "fail"
    return {"hasSys": has_sys, "hasDia": has_dia, "hasPulse": has_pulse, "count": count, "label": label}


def resize_if_needed(image_path: Path, max_dim=1024):
    """Gemini has a 20MB file limit; resize large photos."""
    img = Image.open(image_path)
    w, h = img.size
    if max(w, h) > max_dim:
        ratio = max_dim / max(w, h)
        new_size = (int(w * ratio), int(h * ratio))
        img = img.resize(new_size, Image.LANCZOS)
    return img


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if not API_KEY:
        print("ERROR: Set GOOGLE_API_KEY environment variable.")
        print("Get a free key at: https://aistudio.google.com/app/apikey")
        sys.exit(1)

    client = genai.Client(api_key=API_KEY)
    results = []

    # Collect image files
    image_files = sorted(SAMPLES_DIR.glob("*.jpg")) if SAMPLES_DIR.exists() else []
    for extra in ADDITIONAL_IMAGES:
        if extra.exists() and extra not in image_files:
            image_files.append(extra)

    print(f"Running Gemini Flash ({MODEL}) on {len(image_files)} images...")
    print(f"Prompt: {PROMPT[:80]}...\n")

    for img_path in image_files:
        gt = parse_ground_truth(img_path.name)
        if not gt:
            print(f"  SKIP {img_path.name} — no ground truth")
            continue

        print(f"  → {img_path.name} (GT: {gt['sys']}/{gt['dia']}/{gt['pulse']})", end=" ")

        try:
            img = resize_if_needed(img_path)
            response = client.models.generate_content(
                model=MODEL,
                contents=[PROMPT, img],
                config=types.GenerateContentConfig(
                    temperature=0.1,
                    max_output_tokens=50,
                ),
            )
            text = response.text or ""
            nums = extract_numbers(text)
            score = score_numbers(nums, gt)

            results.append({
                "engine": "gemini-flash",
                "filename": img_path.name,
                "groundTruth": gt,
                "rawText": text,
                "numbers": nums,
                "score": score,
            })
            print(f"→ {score['label'].upper()} ({score['count']}/3) → {text[:60]}")

        except Exception as e:
            print(f"→ ERROR: {e}")
            results.append({
                "engine": "gemini-flash",
                "filename": img_path.name,
                "groundTruth": gt,
                "rawText": f"ERROR: {e}",
                "numbers": [],
                "score": {"hasSys": False, "hasDia": False, "hasPulse": False, "count": 0, "label": "fail"},
            })

    # Summary
    total = len(results) * 3
    correct = sum(r["score"]["count"] for r in results)
    full_match = sum(1 for r in results if r["score"]["count"] == 3)
    partial = sum(1 for r in results if 0 < r["score"]["count"] < 3)
    none = sum(1 for r in results if r["score"]["count"] == 0)

    print(f"\n{'='*60}")
    print("GEMINI FLASH SUMMARY")
    print(f"{'='*60}")
    print(f"Images tested:    {len(results)}")
    print(f"Full match:       {full_match}")
    print(f"Partial:          {partial}")
    print(f"None:             {none}")
    print(f"Digit accuracy:   {correct}/{total} = {correct/total*100:.1f}%")

    # Save results
    out_path = Path(__file__).parent / "gemini_results.json"
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved: {out_path}")


if __name__ == "__main__":
    main()
