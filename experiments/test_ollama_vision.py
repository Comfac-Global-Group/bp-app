#!/usr/bin/env python3
"""
Ollama Vision Model Benchmark — BP Monitor OCR

Tests any Ollama vision model on BP monitor photos with multiple
preprocessing variants. Compares against ground truth extracted from
filenames.

Usage:
    python3 test_ollama_vision.py --model qwen3.5-4b-instruct:latest
    python3 test_ollama_vision.py --model gemma4:e2b --variants rotate90,original
    python3 test_ollama_vision.py --model qwen3-vl:2b --all-samples

Requires:
    - Ollama running locally on http://localhost:11434
    - Pillow (pip install pillow)
    - A vision-capable model pulled in Ollama
"""

import argparse
import base64
import io
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image, ImageEnhance

OLLAMA_URL = "http://localhost:11434/api/generate"
SAMPLES_DIR = Path(__file__).parent.parent / "Bloodpressure Samples"
DEFAULT_IMAGE = Path(__file__).parent / "20260414_112450.jpg"

PROMPT = (
    "This is a photo of a blood pressure monitor LCD display. "
    "Read the three numbers shown: systolic (SYS), diastolic (DIA), and pulse (PULSE). "
    "Respond with ONLY the three numbers separated by commas in order: SYS,DIA,PULSE. "
    "No extra text."
)

VARIANTS = {
    "original": lambda img: img,
    "rotate90": lambda img: img.rotate(-90, expand=True),
    "contrast": lambda img: ImageEnhance.Contrast(img).enhance(2.5),
    "threshold": lambda img: img.convert("L").point(lambda p: 255 if p > 128 else 0),
    "rotate90_contrast": lambda img: ImageEnhance.Contrast(img.rotate(-90, expand=True)).enhance(2.5),
    "rotate90_threshold": lambda img: img.rotate(-90, expand=True).convert("L").point(lambda p: 255 if p > 128 else 0),
}


def parse_ground_truth(filename):
    """Extract SYS/DIA/PULSE from filename like 20260414_112450-omron-118-78-59.jpg"""
    m = re.search(r"omron[\s-](\d+)[\s-](\d+)[\s-](\d+)", filename)
    if m:
        return {"sys": int(m.group(1)), "dia": int(m.group(2)), "pulse": int(m.group(3))}
    if "20260414_112450" in filename:
        return {"sys": 118, "dia": 78, "pulse": 59}
    return None


def encode_image(img):
    """PIL Image → base64 JPEG string"""
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()


def ollama_generate(model, prompt, image_b64, timeout=120):
    """Send image + prompt to Ollama and return response text."""
    payload = {
        "model": model,
        "prompt": prompt,
        "images": [image_b64],
        "stream": False,
    }
    req = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    resp = urllib.request.urlopen(req, timeout=timeout)
    data = json.loads(resp.read())
    return data.get("response", ""), data.get("total_duration", 0)


def extract_numbers(text):
    """Extract up to 3 two-or-three-digit numbers from response text."""
    nums = re.findall(r"\b\d{2,3}\b", text)
    return [int(n) for n in nums[:3]]


def score_result(nums, gt):
    """Score extracted numbers against ground truth."""
    if len(nums) < 3:
        return {"label": "NO_EXTRACT", "matches": 0, "nums": nums}

    matches = 0
    if nums[0] == gt["sys"]:
        matches += 1
    if nums[1] == gt["dia"]:
        matches += 1
    if nums[2] == gt["pulse"]:
        matches += 1

    if matches == 3:
        label = "FULL_MATCH"
    elif matches >= 2:
        label = "SYS+DIA_MATCH" if nums[0] == gt["sys"] and nums[1] == gt["dia"] else "PARTIAL"
    elif matches == 1:
        label = "PARTIAL"
    else:
        label = "NO_MATCH"

    return {"label": label, "matches": matches, "nums": nums}


def run_variant(model, image_path, variant_name, variant_fn):
    """Run a single model + image + variant combination."""
    img = Image.open(image_path)
    processed = variant_fn(img)
    b64 = encode_image(processed)

    start = time.time()
    text, duration_ns = ollama_generate(model, PROMPT, b64)
    elapsed = time.time() - start

    nums = extract_numbers(text)
    gt = parse_ground_truth(image_path.name)
    score = score_result(nums, gt) if gt else {"label": "NO_GT", "matches": 0, "nums": nums}

    return {
        "variant": variant_name,
        "raw_text": text.strip(),
        "nums": nums,
        "ground_truth": gt,
        "score": score,
        "duration_sec": round(elapsed, 2),
        "ollama_duration_ms": round(duration_ns / 1e6, 1) if duration_ns else None,
    }


def main():
    parser = argparse.ArgumentParser(description="Benchmark Ollama vision models on BP monitor OCR")
    parser.add_argument("--model", required=True, help="Ollama model name (e.g., qwen3.5-4b-instruct:latest)")
    parser.add_argument("--variants", default="all", help="Comma-separated variants or 'all'")
    parser.add_argument("--all-samples", action="store_true", help="Test all images in Bloodpressure Samples/")
    parser.add_argument("--output", default="ollama_vision_results.json", help="Output JSON file")
    args = parser.parse_args()

    # Collect images
    images = []
    if args.all_samples and SAMPLES_DIR.exists():
        images += sorted(SAMPLES_DIR.glob("*.jpg"))
    images.append(DEFAULT_IMAGE)
    images = list(dict.fromkeys(images))  # dedupe while preserving order

    # Select variants
    if args.variants == "all":
        variants = VARIANTS
    else:
        names = [v.strip() for v in args.variants.split(",")]
        variants = {k: VARIANTS[k] for k in names if k in VARIANTS}
        missing = [k for k in names if k not in VARIANTS]
        if missing:
            print(f"Unknown variants: {missing}", file=sys.stderr)
            print(f"Available: {list(VARIANTS.keys())}", file=sys.stderr)
            sys.exit(1)

    print(f"Model: {args.model}")
    print(f"Images: {[p.name for p in images]}")
    print(f"Variants: {list(variants.keys())}")
    print("-" * 60)

    all_results = []
    full_matches = 0

    for img_path in images:
        gt = parse_ground_truth(img_path.name)
        gt_str = f"{gt['sys']}/{gt['dia']}/{gt['pulse']}" if gt else "?"
        print(f"\n📷 {img_path.name} (GT: {gt_str})")

        for vname, vfn in variants.items():
            result = run_variant(args.model, img_path, vname, vfn)
            result["image"] = img_path.name
            all_results.append(result)

            sc = result["score"]
            icon = "✅" if sc["label"] == "FULL_MATCH" else "⚠️" if sc["label"] == "PARTIAL" else "❌"
            if sc["label"] == "FULL_MATCH":
                full_matches += 1

            print(
                f"  {icon} {vname:20s} | {sc['label']:15s} | "
                f"nums={result['nums']} | raw=\"{result['raw_text'][:60]}\" | "
                f"{result['duration_sec']}s"
            )

    # Summary
    total = len(all_results)
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Model:        {args.model}")
    print(f"Images:       {len(images)}")
    print(f"Variants:     {len(variants)}")
    print(f"Total runs:   {total}")
    print(f"FULL_MATCH:   {full_matches}")
    print(f"Accuracy:     {full_matches}/{total} = {full_matches/total*100:.1f}%")

    # Save
    output_path = Path(args.output)
    with open(output_path, "w") as f:
        json.dump(
            {
                "model": args.model,
                "total_runs": total,
                "full_matches": full_matches,
                "results": all_results,
            },
            f,
            indent=2,
        )
    print(f"\nSaved: {output_path}")


if __name__ == "__main__":
    main()
