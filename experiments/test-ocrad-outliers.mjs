import ocrad from 'ocrad.js';
import sharp from 'sharp';
import fs from 'fs';

const IMAGE_PATH = './20260414_112450.jpg';

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
    case 'original':
      pipeline = pipeline.resize({ width: Math.round(w * 1.5) });
      break;
    case 'grayscale':
      pipeline = pipeline.resize({ width: Math.round(w * 1.5) }).grayscale();
      break;
    case 'contrast_15':
      pipeline = pipeline.resize({ width: Math.round(w * 1.5) }).grayscale().linear(1.5, -40);
      break;
    case 'contrast_2':
      pipeline = pipeline.resize({ width: Math.round(w * 1.5) }).grayscale().linear(2.0, -60);
      break;
    case 'contrast_25':
      pipeline = pipeline.resize({ width: Math.round(w * 1.5) }).grayscale().linear(2.5, -80);
      break;
    case 'threshold_128':
      pipeline = pipeline.resize({ width: Math.round(w * 1.5) }).grayscale().threshold(128);
      break;
    case 'threshold_150':
      pipeline = pipeline.resize({ width: Math.round(w * 1.5) }).grayscale().threshold(150);
      break;
    case 'threshold_180':
      pipeline = pipeline.resize({ width: Math.round(w * 1.5) }).grayscale().threshold(180);
      break;
    case 'normalize':
      pipeline = pipeline.resize({ width: Math.round(w * 1.5) }).grayscale().normalize();
      break;
    case 'normalize_threshold':
      pipeline = pipeline.resize({ width: Math.round(w * 1.5) }).grayscale().normalize().threshold(128);
      break;
    case 'sharpen_mild':
      pipeline = pipeline.resize({ width: Math.round(w * 1.5) }).grayscale().sharpen({ sigma: 1, flat: 1, jagged: 1 });
      break;
    case 'sharpen_med':
      pipeline = pipeline.resize({ width: Math.round(w * 1.5) }).grayscale().sharpen({ sigma: 2, flat: 1, jagged: 2 });
      break;
    case 'crop_lcd':
      pipeline = pipeline.extract({ left: Math.floor(w*0.25), top: Math.floor(h*0.20), width: Math.floor(w*0.55), height: Math.floor(h*0.60) }).resize({ width: 1800 });
      break;
    case 'crop_lcd_contrast':
      pipeline = pipeline.extract({ left: Math.floor(w*0.25), top: Math.floor(h*0.20), width: Math.floor(w*0.55), height: Math.floor(h*0.60) }).resize({ width: 1800 }).grayscale().linear(2.5, -80);
      break;
    case 'crop_lcd_threshold':
      pipeline = pipeline.extract({ left: Math.floor(w*0.25), top: Math.floor(h*0.20), width: Math.floor(w*0.55), height: Math.floor(h*0.60) }).resize({ width: 1800 }).grayscale().threshold(128);
      break;
    case 'rotate90':
      pipeline = pipeline.rotate(90).resize({ height: Math.round(h * 1.5) });
      break;
    case 'rotate90_contrast':
      pipeline = pipeline.rotate(90).resize({ height: Math.round(h * 1.5) }).grayscale().linear(2.5, -80);
      break;
    case 'rotate90_threshold':
      pipeline = pipeline.rotate(90).resize({ height: Math.round(h * 1.5) }).grayscale().threshold(128);
      break;
    case 'scale2x':
      pipeline = pipeline.grayscale().resize({ width: w * 2 });
      break;
    case 'scale2x_contrast':
      pipeline = pipeline.grayscale().resize({ width: w * 2 }).linear(2.5, -80);
      break;
    case 'scale2x_threshold':
      pipeline = pipeline.grayscale().resize({ width: w * 2 }).threshold(128);
      break;
    case 'inverted':
      pipeline = pipeline.resize({ width: Math.round(w * 1.5) }).grayscale().negate();
      break;
    case 'inverted_threshold':
      pipeline = pipeline.resize({ width: Math.round(w * 1.5) }).grayscale().negate().threshold(128);
      break;
    case 'clahe':
      pipeline = pipeline.resize({ width: Math.round(w * 1.5) }).grayscale().clahe({ width: 50, height: 50, maxSlope: 3 });
      break;
    default:
      break;
  }
  
  // For ocrad, we need RGBA canvas-like data
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
}

function runOcrad(imageData) {
  const canvas = {
    width: imageData.width,
    height: imageData.height,
    getContext: () => ({
      getImageData: () => imageData
    })
  };
  return ocrad(canvas);
}

async function main() {
  console.log('========================================');
  console.log('OCRAD.JS OUTLIER TECHNIQUES TEST');
  console.log('Target: 118, 78, 59');
  console.log('========================================\n');
  
  const techniques = [
    { name: 'original', desc: 'Original + 1.5x scale' },
    { name: 'grayscale', desc: 'Grayscale' },
    { name: 'contrast_15', desc: 'Contrast 1.5x' },
    { name: 'contrast_2', desc: 'Contrast 2x' },
    { name: 'contrast_25', desc: 'Contrast 2.5x' },
    { name: 'threshold_128', desc: 'Threshold @ 128' },
    { name: 'threshold_150', desc: 'Threshold @ 150' },
    { name: 'threshold_180', desc: 'Threshold @ 180' },
    { name: 'normalize', desc: 'Histogram normalize' },
    { name: 'normalize_threshold', desc: 'Normalize + threshold' },
    { name: 'sharpen_mild', desc: 'Sharpen mild' },
    { name: 'sharpen_med', desc: 'Sharpen medium' },
    { name: 'crop_lcd', desc: 'Crop to LCD' },
    { name: 'crop_lcd_contrast', desc: 'Crop + contrast' },
    { name: 'crop_lcd_threshold', desc: 'Crop + threshold' },
    { name: 'rotate90', desc: 'Rotate 90°' },
    { name: 'rotate90_contrast', desc: 'Rotate 90° + contrast' },
    { name: 'rotate90_threshold', desc: 'Rotate 90° + threshold' },
    { name: 'scale2x', desc: '2x scale' },
    { name: 'scale2x_contrast', desc: '2x + contrast' },
    { name: 'scale2x_threshold', desc: '2x + threshold' },
    { name: 'inverted', desc: 'Inverted' },
    { name: 'inverted_threshold', desc: 'Inverted + threshold' },
    { name: 'clahe', desc: 'CLAHE' },
  ];
  
  const results = [];
  
  for (const tech of techniques) {
    try {
      const imageData = await preprocess(IMAGE_PATH, tech);
      const text = runOcrad(imageData);
      const nums = extractNumbers(text);
      const ev = evaluate(nums);
      
      results.push({ ...tech, nums, ...ev });
      
      const status = ev.perfect ? '✅' : ev.count > 0 ? '⚠️' : '❌';
      console.log(`${status} ${tech.name.padEnd(24)} | found ${ev.count}/3 | ${JSON.stringify(nums.slice(0, 8))}`);
    } catch (err) {
      console.log(`💥 ${tech.name.padEnd(24)} | ERROR: ${err.message}`);
    }
  }
  
  console.log('\n========================================');
  console.log('SUMMARY');
  console.log('========================================');
  
  const perfect = results.filter(r => r.perfect);
  const partial = results.filter(r => !r.perfect && r.count > 0).sort((a, b) => b.count - a.count);
  
  if (perfect.length) {
    console.log(`\n✅ PERFECT (${perfect.length} techniques):`);
    perfect.forEach(r => console.log(`   ${r.name} — ${r.desc}`));
  } else {
    console.log('\n❌ No perfect matches.');
  }
  
  console.log(`\n⚠️  BEST PARTIAL (top 10):`);
  partial.slice(0, 10).forEach(r => {
    const missing = [];
    if (!r.has118) missing.push('118');
    if (!r.has78) missing.push('78');
    if (!r.has59) missing.push('59');
    console.log(`   ${r.name.padEnd(24)} | ${r.count}/3 | missing: ${missing.join(', ')} | nums: ${JSON.stringify(r.nums.slice(0, 6))}`);
  });
  
  fs.writeFileSync('./ocrad-outlier-results.json', JSON.stringify(results, null, 2));
  console.log('\nSaved: ocrad-outlier-results.json');
}

main().catch(console.error);
