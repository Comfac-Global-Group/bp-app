#!/usr/bin/env node
/**
 * Tier 0 — Tesseract.js Node.js BP OCR Test
 *
 * Runs tesseract.js (already in project deps) on all BP monitor photos
 * with multiple preprocessing variants: normal, rotate90, threshold, upscale.
 *
 * Usage:
 *   node experiments/test_tesseract_node.mjs
 *
 * Outputs:
 *   tesseract_results.json
 */

import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = path.join(__dirname, '..', 'Bloodpressure Samples');
const ADDITIONAL = [path.join(__dirname, '20260414_112450.jpg')];

function parseGroundTruth(filename) {
  const m = filename.match(/omron-(\d+)-(\d+)-(\d+)/);
  if (m) return { sys: +m[1], dia: +m[2], pulse: +m[3] };
  if (filename.includes('20260414_112450')) return { sys: 118, dia: 78, pulse: 59 };
  return null;
}

function extractNumbers(text) {
  const nums = text.match(/\b\d{2,3}\b/g) || [];
  return nums.map(Number);
}

function scoreNumbers(nums, gt) {
  const hasSys = nums.includes(gt.sys);
  const hasDia = nums.includes(gt.dia);
  const hasPulse = nums.includes(gt.pulse);
  const count = [hasSys, hasDia, hasPulse].filter(Boolean).length;
  const label = count === 3 ? 'pass' : count > 0 ? 'partial' : 'fail';
  return { hasSys, hasDia, hasPulse, count, label };
}

async function preprocess(buffer, variant) {
  let pipeline = sharp(buffer);
  const meta = await pipeline.metadata();
  const w = meta.width;
  const h = meta.height;

  switch (variant) {
    case 'normal':
      pipeline = pipeline.resize({ width: Math.round(w * 1.5) });
      break;
    case 'rotate90':
      pipeline = pipeline.rotate(90).resize({ height: Math.round(h * 1.5) });
      break;
    case 'threshold':
      pipeline = pipeline.resize({ width: Math.round(w * 1.5) }).grayscale().threshold(128);
      break;
    case 'rotate90_threshold':
      pipeline = pipeline.rotate(90).resize({ height: Math.round(h * 1.5) }).grayscale().threshold(128);
      break;
    case 'upscale2x':
      pipeline = pipeline.resize({ width: w * 2 });
      break;
    case 'upscale2x_threshold':
      pipeline = pipeline.resize({ width: w * 2 }).grayscale().threshold(128);
      break;
    case 'rotate90_upscale2x':
      pipeline = pipeline.rotate(90).resize({ height: h * 2 });
      break;
    default:
      break;
  }
  return await pipeline.toBuffer();
}

async function main() {
  // Collect images
  let imageFiles = [];
  if (fs.existsSync(SAMPLES_DIR)) {
    imageFiles = fs.readdirSync(SAMPLES_DIR)
      .filter(f => f.endsWith('.jpg'))
      .map(f => path.join(SAMPLES_DIR, f));
  }
  for (const extra of ADDITIONAL) {
    if (fs.existsSync(extra) && !imageFiles.includes(extra)) {
      imageFiles.push(extra);
    }
  }

  const variants = [
    'normal',
    'rotate90',
    'threshold',
    'rotate90_threshold',
    'upscale2x',
    'upscale2x_threshold',
    'rotate90_upscale2x',
  ];

  console.log(`Testing Tesseract.js on ${imageFiles.length} images × ${variants.length} variants...\n`);

  const worker = await createWorker('eng');
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789',
  });

  const allResults = [];

  for (const imgPath of imageFiles) {
    const basename = path.basename(imgPath);
    const gt = parseGroundTruth(basename);
    if (!gt) {
      console.log(`SKIP ${basename} — no ground truth`);
      continue;
    }

    const buffer = fs.readFileSync(imgPath);
    console.log(`\n→ ${basename} (GT: ${gt.sys}/${gt.dia}/${gt.pulse})`);

    let bestVariant = null;
    let bestScore = -1;

    for (const variant of variants) {
      const processed = await preprocess(buffer, variant);
      const result = await worker.recognize(processed);
      const nums = extractNumbers(result.data.text);
      const score = scoreNumbers(nums, gt);

      const marker = score.count === 3 ? '✅' : score.count > 0 ? '⚠️' : '❌';
      console.log(`  ${marker} ${variant.padEnd(20)} | ${score.count}/3 | nums=[${nums.slice(0, 8).join(', ')}]`);

      if (score.count > bestScore) {
        bestScore = score.count;
        bestVariant = { variant, nums, score, rawText: result.data.text, confidence: result.data.confidence };
      }
    }

    allResults.push({
      engine: 'tesseract.js',
      filename: basename,
      groundTruth: gt,
      bestVariant: bestVariant.variant,
      numbers: bestVariant.nums,
      rawText: bestVariant.rawText,
      score: bestVariant.score,
      confidence: bestVariant.confidence,
    });

    console.log(`  BEST: ${bestVariant.variant} → ${bestVariant.score.label.toUpperCase()} (${bestVariant.score.count}/3)`);
  }

  await worker.terminate();

  // Summary
  const total = allResults.length * 3;
  const correct = allResults.reduce((s, r) => s + r.score.count, 0);
  const fullMatch = allResults.filter(r => r.score.count === 3).length;
  const partial = allResults.filter(r => r.score.count > 0 && r.score.count < 3).length;
  const none = allResults.filter(r => r.score.count === 0).length;

  console.log(`\n${'='.repeat(60)}`);
  console.log('TESSERAT.JS SUMMARY (best variant per image)');
  console.log(`${'='.repeat(60)}`);
  console.log(`Images tested:    ${allResults.length}`);
  console.log(`Full match:       ${fullMatch}`);
  console.log(`Partial:          ${partial}`);
  console.log(`None:             ${none}`);
  console.log(`Digit accuracy:   ${correct}/${total} = ${(correct / total * 100).toFixed(1)}%`);

  // Save
  const outPath = path.join(__dirname, 'tesseract_results.json');
  fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2));
  console.log(`\nSaved: ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
