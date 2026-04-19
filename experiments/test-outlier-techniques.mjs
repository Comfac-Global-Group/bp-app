import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs';

const IMAGE_PATH = './20260414_112450.jpg';
const TARGET_NUMS = [118, 78, 59];

function extractNumbers(text) {
  const nums = text.match(/\b\d{2,3}\b/g) || [];
  return nums.map(Number);
}

function evaluate(nums) {
  const has118 = nums.includes(118);
  const has78 = nums.includes(78);
  const has59 = nums.includes(59);
  return { perfect: has118 && has78 && has59, has118, has78, has59, count: [has118, has78, has59].filter(Boolean).length };
}

async function preprocess(inputPath, technique) {
  let pipeline = sharp(inputPath);
  const meta = await pipeline.metadata();
  const w = meta.width;
  const h = meta.height;
  
  switch (technique.name) {
    // Scaling variants
    case 'scale_1x':
      break;
    case 'scale_15x':
      pipeline = pipeline.resize({ width: Math.round(w * 1.5) });
      break;
    case 'scale_2x':
      pipeline = pipeline.resize({ width: w * 2 });
      break;
    case 'scale_3x':
      pipeline = pipeline.resize({ width: w * 3 });
      break;
    
    // Threshold variants
    case 'threshold_100':
      pipeline = pipeline.grayscale().threshold(100);
      break;
    case 'threshold_128':
      pipeline = pipeline.grayscale().threshold(128);
      break;
    case 'threshold_150':
      pipeline = pipeline.grayscale().threshold(150);
      break;
    case 'threshold_180':
      pipeline = pipeline.grayscale().threshold(180);
      break;
    
    // Contrast
    case 'contrast_15':
      pipeline = pipeline.grayscale().linear(1.5, -40);
      break;
    case 'contrast_2':
      pipeline = pipeline.grayscale().linear(2.0, -60);
      break;
    case 'contrast_25':
      pipeline = pipeline.grayscale().linear(2.5, -80);
      break;
    case 'contrast_3':
      pipeline = pipeline.grayscale().linear(3.0, -100);
      break;
    
    // Gamma
    case 'gamma_08':
      pipeline = pipeline.grayscale().gamma(0.8);
      break;
    case 'gamma_12':
      pipeline = pipeline.grayscale().gamma(1.2);
      break;
    case 'gamma_15':
      pipeline = pipeline.grayscale().gamma(1.5);
      break;
    case 'gamma_20':
      pipeline = pipeline.grayscale().gamma(2.0);
      break;
    
    // Blur + threshold
    case 'blur_mild_threshold':
      pipeline = pipeline.grayscale().blur(0.5).threshold(128);
      break;
    case 'blur_med_threshold':
      pipeline = pipeline.grayscale().blur(1.0).threshold(128);
      break;
    
    // Sharpen
    case 'sharpen_mild':
      pipeline = pipeline.grayscale().sharpen({ sigma: 1, flat: 1, jagged: 1 });
      break;
    case 'sharpen_med':
      pipeline = pipeline.grayscale().sharpen({ sigma: 2, flat: 1, jagged: 2 });
      break;
    case 'sharpen_aggressive':
      pipeline = pipeline.grayscale().sharpen({ sigma: 3, flat: 2, jagged: 3 });
      break;
    
    // Crop LCD
    case 'crop_lcd':
      pipeline = pipeline.extract({ left: Math.floor(w*0.25), top: Math.floor(h*0.20), width: Math.floor(w*0.55), height: Math.floor(h*0.60) }).resize({ width: 1800 });
      break;
    case 'crop_lcd_contrast':
      pipeline = pipeline.extract({ left: Math.floor(w*0.25), top: Math.floor(h*0.20), width: Math.floor(w*0.55), height: Math.floor(h*0.60) }).resize({ width: 1800 }).grayscale().linear(2.5, -80);
      break;
    case 'crop_lcd_sharpen':
      pipeline = pipeline.extract({ left: Math.floor(w*0.25), top: Math.floor(h*0.20), width: Math.floor(w*0.55), height: Math.floor(h*0.60) }).resize({ width: 1800 }).grayscale().sharpen({ sigma: 2, flat: 1, jagged: 2 });
      break;
    
    // Rotate90 combinations
    case 'rotate90':
      pipeline = pipeline.rotate(90).resize({ height: Math.round(h * 1.5) });
      break;
    case 'rotate90_contrast':
      pipeline = pipeline.rotate(90).resize({ height: Math.round(h * 1.5) }).grayscale().linear(2.5, -80);
      break;
    case 'rotate90_threshold_128':
      pipeline = pipeline.rotate(90).resize({ height: Math.round(h * 1.5) }).grayscale().threshold(128);
      break;
    case 'rotate90_crop_lcd':
      pipeline = pipeline.extract({ left: Math.floor(w*0.25), top: Math.floor(h*0.20), width: Math.floor(w*0.55), height: Math.floor(h*0.60) }).rotate(90).resize({ height: 1800 });
      break;
    
    // Combined
    case 'scale2x_contrast':
      pipeline = pipeline.grayscale().resize({ width: w * 2 }).linear(2.5, -80);
      break;
    case 'scale2x_threshold':
      pipeline = pipeline.grayscale().resize({ width: w * 2 }).threshold(128);
      break;
    case 'scale2x_sharpen_threshold':
      pipeline = pipeline.grayscale().resize({ width: w * 2 }).sharpen({ sigma: 2, flat: 1, jagged: 2 }).threshold(128);
      break;
    
    // Normalization
    case 'normalize':
      pipeline = pipeline.grayscale().normalize();
      break;
    case 'normalize_threshold':
      pipeline = pipeline.grayscale().normalize().threshold(128);
      break;
    case 'clahe':
      pipeline = pipeline.grayscale().clahe({ width: 50, height: 50, maxSlope: 3 });
      break;
    
    // Inverted
    case 'inverted':
      pipeline = pipeline.grayscale().negate();
      break;
    case 'inverted_threshold':
      pipeline = pipeline.grayscale().negate().threshold(128);
      break;
    
    default:
      break;
  }
  
  return await pipeline.toBuffer();
}

async function main() {
  console.log('========================================');
  console.log('OUTLIER PREPROCESSING TECHNIQUES TEST');
  console.log('Target: 118, 78, 59');
  console.log('========================================\n');
  
  const techniques = [
    { name: 'scale_1x', desc: 'Original size' },
    { name: 'scale_15x', desc: '1.5x upscale' },
    { name: 'scale_2x', desc: '2x upscale' },
    { name: 'scale_3x', desc: '3x upscale' },
    { name: 'threshold_100', desc: 'Threshold @ 100' },
    { name: 'threshold_128', desc: 'Threshold @ 128' },
    { name: 'threshold_150', desc: 'Threshold @ 150' },
    { name: 'threshold_180', desc: 'Threshold @ 180' },
    { name: 'contrast_15', desc: 'Contrast 1.5x' },
    { name: 'contrast_2', desc: 'Contrast 2x' },
    { name: 'contrast_25', desc: 'Contrast 2.5x' },
    { name: 'contrast_3', desc: 'Contrast 3x' },
    { name: 'gamma_08', desc: 'Gamma 0.8' },
    { name: 'gamma_12', desc: 'Gamma 1.2' },
    { name: 'gamma_15', desc: 'Gamma 1.5' },
    { name: 'gamma_20', desc: 'Gamma 2.0' },
    { name: 'blur_mild_threshold', desc: 'Blur 0.5 + threshold' },
    { name: 'blur_med_threshold', desc: 'Blur 1.0 + threshold' },
    { name: 'sharpen_mild', desc: 'Sharpen mild' },
    { name: 'sharpen_med', desc: 'Sharpen medium' },
    { name: 'sharpen_aggressive', desc: 'Sharpen aggressive' },
    { name: 'crop_lcd', desc: 'Crop to LCD' },
    { name: 'crop_lcd_contrast', desc: 'Crop + contrast' },
    { name: 'crop_lcd_sharpen', desc: 'Crop + sharpen' },
    { name: 'rotate90', desc: 'Rotate 90°' },
    { name: 'rotate90_contrast', desc: 'Rotate 90° + contrast' },
    { name: 'rotate90_threshold_128', desc: 'Rotate 90° + threshold' },
    { name: 'rotate90_crop_lcd', desc: 'Crop + rotate 90°' },
    { name: 'scale2x_contrast', desc: '2x + contrast' },
    { name: 'scale2x_threshold', desc: '2x + threshold' },
    { name: 'scale2x_sharpen_threshold', desc: '2x + sharpen + threshold' },
    { name: 'normalize', desc: 'Histogram normalize' },
    { name: 'normalize_threshold', desc: 'Normalize + threshold' },
    { name: 'clahe', desc: 'CLAHE adaptive contrast' },
    { name: 'inverted', desc: 'Color inverted' },
    { name: 'inverted_threshold', desc: 'Inverted + threshold' },
  ];
  
  const worker = await createWorker('eng');
  const results = [];
  
  for (const tech of techniques) {
    try {
      const buffer = await preprocess(IMAGE_PATH, tech);
      const result = await worker.recognize(buffer);
      const nums = extractNumbers(result.data.text);
      const ev = evaluate(nums);
      
      results.push({ ...tech, nums, ...ev, confidence: result.data.confidence });
      
      const status = ev.perfect ? '✅' : ev.count > 0 ? '⚠️' : '❌';
      console.log(`${status} ${tech.name.padEnd(28)} | found ${ev.count}/3 | ${JSON.stringify(nums.slice(0, 8))}`);
    } catch (err) {
      console.log(`💥 ${tech.name.padEnd(28)} | ERROR: ${err.message}`);
    }
  }
  
  await worker.terminate();
  
  console.log('\n========================================');
  console.log('SUMMARY');
  console.log('========================================');
  
  const perfect = results.filter(r => r.perfect);
  const partial = results.filter(r => !r.perfect && r.count > 0).sort((a, b) => b.count - a.count);
  
  if (perfect.length) {
    console.log(`\n✅ PERFECT (${perfect.length} techniques):`);
    perfect.forEach(r => console.log(`   ${r.name} — ${r.desc}`));
  }
  
  console.log(`\n⚠️  BEST PARTIAL (top 10):`);
  partial.slice(0, 10).forEach(r => {
    const missing = [];
    if (!r.has118) missing.push('118');
    if (!r.has78) missing.push('78');
    if (!r.has59) missing.push('59');
    console.log(`   ${r.name.padEnd(28)} | ${r.count}/3 | missing: ${missing.join(', ') || 'none'} | nums: ${JSON.stringify(r.nums.slice(0, 6))}`);
  });
  
  fs.writeFileSync('./outlier-techniques-results.json', JSON.stringify(results, null, 2));
  console.log('\nSaved: outlier-techniques-results.json');
}

main().catch(console.error);
