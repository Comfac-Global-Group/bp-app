import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs';

const IMAGE_PATH = './20260414_112450.jpg';

async function preprocessImage(inputPath, variant) {
  let pipeline = sharp(inputPath);
  const meta = await pipeline.metadata();
  const w = meta.width;
  const h = meta.height;
  
  switch (variant) {
    case 'original':
      break;
    case 'grayscale':
      pipeline = pipeline.grayscale();
      break;
    case 'contrast':
      pipeline = pipeline.grayscale().linear(2.5, -50);
      break;
    case 'inverted':
      pipeline = pipeline.grayscale().negate();
      break;
    case 'threshold':
      pipeline = pipeline.grayscale().threshold(128);
      break;
    case 'rotate90':
      pipeline = pipeline.rotate(90);
      break;
    case 'crop_lcd':
      pipeline = pipeline.extract({ left: Math.floor(w*0.25), top: Math.floor(h*0.20), width: Math.floor(w*0.55), height: Math.floor(h*0.60) });
      break;
    case 'crop_lcd_contrast':
      pipeline = pipeline.extract({ left: Math.floor(w*0.25), top: Math.floor(h*0.20), width: Math.floor(w*0.55), height: Math.floor(h*0.60) }).grayscale().linear(2.5, -50);
      break;
    case 'crop_lcd_threshold':
      pipeline = pipeline.extract({ left: Math.floor(w*0.25), top: Math.floor(h*0.20), width: Math.floor(w*0.55), height: Math.floor(h*0.60) }).grayscale().threshold(128);
      break;
    case 'sharpen':
      pipeline = pipeline.grayscale().sharpen({ sigma: 2, flat: 1, jagged: 2 });
      break;
    case 'resize2x':
      pipeline = pipeline.grayscale().resize({ width: w * 2, height: h * 2 });
      break;
    case 'resize2x_threshold':
      pipeline = pipeline.grayscale().resize({ width: w * 2, height: h * 2 }).threshold(128);
      break;
    case 'resize2x_contrast':
      pipeline = pipeline.grayscale().resize({ width: w * 2, height: h * 2 }).linear(2.5, -50);
      break;
    default:
      break;
  }
  
  return await pipeline.toBuffer();
}

function extractNumbers(text) {
  const nums = text.match(/\b\d{2,3}\b/g) || [];
  return nums.map(Number);
}

function evaluate(nums) {
  if (nums.length < 3) return { perfect: false, nums };
  // Check if 118, 78, 59 are all present
  const has118 = nums.includes(118);
  const has78 = nums.includes(78);
  const has59 = nums.includes(59);
  return { perfect: has118 && has78 && has59, has118, has78, has59, nums };
}

async function testTesseractVariant(worker, buffer, variant, whitelist = null) {
  try {
    if (whitelist) {
      await worker.setParameters({
        tessedit_char_whitelist: whitelist,
      });
    } else {
      await worker.setParameters({
        tessedit_char_whitelist: '',
      });
    }
    
    const result = await worker.recognize(buffer);
    const nums = extractNumbers(result.data.text);
    const ev = evaluate(nums);
    
    return {
      variant,
      whitelist,
      text: result.data.text.slice(0, 500),
      confidence: result.data.confidence,
      nums,
      perfect: ev.perfect
    };
  } catch (err) {
    return { variant, whitelist, error: err.message };
  }
}

async function main() {
  console.log('========================================');
  console.log('FOCUSED OCR TEST — Omron HEM-7121');
  console.log('Target numbers: 118, 78, 59');
  console.log('========================================\n');
  
  const workerDefault = await createWorker('eng');
  const workerDigits = await createWorker('eng');
  
  const variants = [
    'original', 'grayscale', 'contrast', 'inverted', 'threshold',
    'rotate90', 'crop_lcd', 'crop_lcd_contrast', 'crop_lcd_threshold',
    'sharpen', 'resize2x', 'resize2x_threshold', 'resize2x_contrast'
  ];
  
  const results = [];
  
  for (const variant of variants) {
    const buffer = await preprocessImage(IMAGE_PATH, variant);
    await sharp(buffer).toFile(`./test-ocr2-${variant}.jpg`);
    
    const rDefault = await testTesseractVariant(workerDefault, buffer, variant, null);
    const rDigits = await testTesseractVariant(workerDigits, buffer, variant, '0123456789');
    
    results.push(rDefault, rDigits);
    
    const statusDefault = rDefault.perfect ? '✅' : (rDefault.nums?.length > 0 ? '⚠️' : '❌');
    const statusDigits = rDigits.perfect ? '✅' : (rDigits.nums?.length > 0 ? '⚠️' : '❌');
    
    console.log(`\n[${variant}]`);
    console.log(`  Default ${statusDefault} nums=${JSON.stringify(rDefault.nums)} conf=${rDefault.confidence ?? 'N/A'}`);
    if (rDefault.perfect) console.log('    TEXT:', JSON.stringify(rDefault.text));
    console.log(`  Digits  ${statusDigits} nums=${JSON.stringify(rDigits.nums)} conf=${rDigits.confidence ?? 'N/A'}`);
    if (rDigits.perfect) console.log('    TEXT:', JSON.stringify(rDigits.text));
  }
  
  await workerDefault.terminate();
  await workerDigits.terminate();
  
  const perfect = results.filter(r => r.perfect);
  
  console.log('\n\n========================================');
  console.log('SUMMARY');
  console.log('========================================');
  
  if (perfect.length === 0) {
    console.log('❌ No combination found the target numbers.');
    console.log('\nBest attempts (most numbers found):');
    const best = results
      .map(r => ({ ...r, score: (r.nums || []).filter(n => [118, 78, 59].includes(n)).length }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    best.forEach(r => {
      console.log(`  ${r.variant} ${r.whitelist ? '(digits)' : '(default)'}: found ${r.score}/3 numbers → ${JSON.stringify(r.nums)}`);
    });
  } else {
    console.log(`✅ ${perfect.length} successful combinations:`);
    perfect.forEach(r => {
      console.log(`  ${r.variant} ${r.whitelist ? '(digits whitelist)' : '(default)'}`);
    });
  }
  
  fs.writeFileSync('./test-ocr2-results.json', JSON.stringify(results, null, 2));
  console.log('\nSaved: test-ocr2-results.json');
}

main().catch(console.error);
