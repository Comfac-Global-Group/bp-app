#!/usr/bin/env python3
"""
Tier 0 — Parse and Score BP OCR Results

Aggregates JSON results from multiple OCR engines and produces:
  - results.csv      (per-image, per-engine comparison)
  - SUMMARY.md       (executive summary with accuracy tables)

Usage:
    python3 parse_and_score.py

Expects these JSON files in the same directory:
  - tesseract_results.json   (from test_tesseract.html → Export)
  - mediapipe_results.json   (from test_mediapipe.html → Export)
  - gemini_results.json      (from test_gemini.py)
"""

import csv
import json
import sys
from pathlib import Path
from collections import defaultdict

RESULTS_DIR = Path(__file__).parent


def load_results(filename: str):
    path = RESULTS_DIR / filename
    if not path.exists():
        return []
    with open(path) as f:
        data = json.load(f)
        return data if isinstance(data, list) else data.get("images", [])


def format_gt(gt):
    return f"{gt['sys']}/{gt['dia']}/{gt['pulse']}"


def format_nums(nums):
    return ", ".join(str(n) for n in nums[:8])


def main():
    engines = {
        "Tesseract.js": load_results("tesseract_results.json"),
        "MediaPipe": load_results("mediapipe_results.json"),
        "Gemini Flash": load_results("gemini_results.json"),
    }

    available = {k: len(v) for k, v in engines.items() if v}
    if not available:
        print("No result files found. Run the test harnesses first.")
        print("Expected: tesseract_results.json, mediapipe_results.json, gemini_results.json")
        sys.exit(1)

    print(f"Loaded results: {available}")

    # ------------------------------------------------------------------
    # Build per-image records
    # ------------------------------------------------------------------
    all_images = defaultdict(dict)
    for engine_name, results in engines.items():
        for r in results:
            fname = r.get("filename", "unknown")
            gt = r.get("groundTruth", {})
            score = r.get("score", {})
            all_images[fname]["gt"] = gt
            all_images[fname][engine_name] = {
                "numbers": r.get("numbers", []),
                "rawText": r.get("rawText", "")[:120],
                "count": score.get("count", 0),
                "label": score.get("label", "fail"),
            }

    # ------------------------------------------------------------------
    # Write CSV
    # ------------------------------------------------------------------
    csv_path = RESULTS_DIR / "results.csv"
    with open(csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        headers = ["Image", "Ground Truth"]
        for name in engines:
            headers += [f"{name} Numbers", f"{name} Match"]
        writer.writerow(headers)

        for fname in sorted(all_images.keys()):
            row = [fname, format_gt(all_images[fname]["gt"])]
            for name in engines:
                data = all_images[fname].get(name, {})
                row += [format_nums(data.get("numbers", [])), data.get("label", "N/A")]
            writer.writerow(row)

    print(f"Wrote: {csv_path}")

    # ------------------------------------------------------------------
    # Compute aggregates
    # ------------------------------------------------------------------
    def aggregate(engine_results):
        if not engine_results:
            return None
        total_digits = len(engine_results) * 3
        correct = sum(r.get("score", {}).get("count", 0) for r in engine_results)
        full = sum(1 for r in engine_results if r.get("score", {}).get("count", 0) == 3)
        partial = sum(1 for r in engine_results if 0 < r.get("score", {}).get("count", 0) < 3)
        none = sum(1 for r in engine_results if r.get("score", {}).get("count", 0) == 0)
        return {
            "images": len(engine_results),
            "digit_acc": correct / total_digits if total_digits else 0,
            "full_match": full,
            "partial": partial,
            "none": none,
        }

    stats = {name: aggregate(res) for name, res in engines.items()}

    # ------------------------------------------------------------------
    # Write SUMMARY.md
    # ------------------------------------------------------------------
    summary_path = RESULTS_DIR / "SUMMARY.md"
    with open(summary_path, "w") as f:
        f.write("# Tier 0 — BP Monitor OCR Engine Comparison\n\n")
        f.write("**Date:** Auto-generated\n\n")
        f.write("## Executive Summary\n\n")

        best = max(
            ((n, s) for n, s in stats.items() if s),
            key=lambda x: x[1]["digit_acc"],
            default=(None, None),
        )

        if best[0]:
            f.write(
                f"**Best engine:** {best[0]} with {best[1]['digit_acc']*100:.1f}% digit accuracy "
                f"({best[1]['full_match']}/{best[1]['images']} full matches).\n\n"
            )
        else:
            f.write("No engine results available yet.\n\n")

        f.write("## Per-Engine Results\n\n")
        f.write("| Engine | Images | Digit Acc | Full Match | Partial | None |\n")
        f.write("|--------|--------|-----------|------------|---------|------|\n")
        for name, s in stats.items():
            if s:
                f.write(
                    f"| {name} | {s['images']} | {s['digit_acc']*100:.1f}% | "
                    f"{s['full_match']} | {s['partial']} | {s['none']} |\n"
                )
            else:
                f.write(f"| {name} | — | — | — | — | — |\n")

        f.write("\n## Per-Image Breakdown\n\n")
        f.write("| Image | Ground Truth |")
        for name in engines:
            f.write(f" {name} |")
        f.write("\n|-------|--------------|")
        for _ in engines:
            f.write("--------|")
        f.write("\n")

        for fname in sorted(all_images.keys()):
            gt = all_images[fname].get("gt", {})
            f.write(f"| {fname[:40]} | {format_gt(gt)} |")
            for name in engines:
                data = all_images[fname].get(name, {})
                nums = data.get("numbers", [])
                label = data.get("label", "N/A")
                f.write(f" {format_nums(nums)} ({label}) |")
            f.write("\n")

        f.write("\n## Decision Guide\n\n")
        f.write("| If best engine hits... | Next step |\n")
        f.write("|------------------------|-----------|\n")
        f.write("| ≥ 95% digit accuracy, ≥ 80% full match | Integrate into bp-app immediately |\n")
        f.write("| 80–95% digit accuracy | Add rotate90 preprocessing + retry logic |\n")
        f.write("| 60–80% digit accuracy | Combine best engine + manual fallback |\n")
        f.write("| < 60% digit accuracy | Try 7-segment traineddata or cloud API |\n")
        f.write("| All engines < 50% | Reconsider problem: lighting, angle, camera quality |\n")
        f.write("\n")

        f.write("## Raw Data\n\n")
        f.write("See `results.csv` for full per-image breakdown.\n")

    print(f"Wrote: {summary_path}")


if __name__ == "__main__":
    main()
