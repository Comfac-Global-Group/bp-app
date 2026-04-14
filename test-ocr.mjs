import { createWorker } from 'tesseract.js';
import ocrad from 'ocrad.js';
import sharp from 'sharp';
import fs from 'fs';

const IMAGE_PATH = './20260414_112450.jpg';

// =================== Extraction Algorithms ===================

function algoLabelProximity(text) {
  const sysMatch = text.match(/SYS[^\d]*(\d{2,3})/i) || text.match(/systolic[^\d]*(\d{2,3})/i);
  const diaMatch = text.match(/DIA[^\d]*(\d{2,3})/i) || text.match(/diastolic[^\d]*(\d{2,3})/i);
  const pulseMatch = text.match(/PULSE[^\d]*(\d{2,3})/i) || text.match(/pulse[^\d]*(\d{2,3})/i) || text.match(/\/min[^\d]*(\d{2,3})/i);
  
  return {
    name: 'Label-Proximity',
    sys: sysMatch ? parseInt(sysMatch[1]) : null,
    dia: diaMatch ? parseInt(diaMatch[1]) : null,
    hr: pulseMatch ? parseInt(pulseMatch[1]) : null,
    raw: { sysMatch: sysMatch?.[0], diaMatch: diaMatch?.[0], pulseMatch: pulseMatch?.[0] }
  };
}

function algoSeparator(text) {
  const sepMatch = text.match(/(\d{2,3})\s*[/|\\]\s*(\d{2,3})/);
  if (sepMatch) {
    const nums = text.match(/\b\d{2,3}\b/g) || [];
    return {
      name: 'Separator',
      sys: parseInt(sepMatch[1]),
      dia: parseInt(sepMatch[2]),
      hr: nums.length >= 3 ? parseInt(nums[nums.length - 1]) : null,
      raw: { sepMatch: sepMatch[0], nums }
    };
  }
  return { name: 'Separator', sys: null, dia: null, hr: null, raw: {} };
}

function algoRangePP(text) {
  const nums = text.match(/\b\d{2,3}\b/g) || [];
  const n = nums.map(Number).sort((a, b) => b - a);
  
  for (let i = 0; i < n.length - 1; i++) {
    for (let j = i + 1; j < n.length; j++) {
      const sys = n[i];
      const dia = n[j];
      const pp = sys - dia;
      if (sys >= 70 && sys <= 250 && dia >= 40 && dia <= 150 && pp >= 20 && pp <= 100) {
        const allNums = nums.map(Number);
        const hrCandidates = allNums.filter(x => x !== sys && x !== dia && x >= 40 && x <= 200);
        return {
          name: 'Range+PP',
          sys,
          dia,
          hr: hrCandidates.length ? hrCandidates[0] : null,
          raw: { nums, pair: [sys, dia], hrCandidates }
        };
      }
    }
  }
  return { name: 'Range+PP', sys: null, dia: null, hr: null, raw: { nums } };
}

function algoRangeOnly(text) {
  const nums = text.match(/\b\d{2,3}\b/g) || [];
  const valid = nums.map(Number).filter(x => x >= 40 && x <= 250).sort((a, b) => b - a);
  if (valid.length >= 3) {
    return {
      name: 'Range-Only',
      sys: valid[0],
      dia: valid[1],
      hr: valid[2],
      raw: { valid }
    };
  }
  return { name: 'Range-Only', sys: null, dia: null, hr: null, raw: { valid } };
}

function algoOmronLayout(text) {
  // Omron HEM-7121 specific: numbers appear in order SYS (top), DIA (middle), PULSE (bottom)
  // Try to extract the first 3 valid numbers in order of appearance
  const nums = text.match(/\b\d{2,3}\b/g) || [];
  const valid = nums.map(Number).filter(x => x >= 40 && x <= 250);
  if (valid.length >= 3) {
    // First is likely sys, second dia, third pulse
    return {
      name: 'Omron-Layout-Order',
      sys: valid[0],
      dia: valid[1],
      hr: valid[2],
      raw: { valid }
    };
  }
  return { name: 'Omron-Layout-Order', sys: null, dia: null, hr: null, raw: { valid } };
}

function runAllAlgos(text) {
  return [
    algoLabelProximity(text),
    algoSeparator(text),
    algoRangePP(text),
    algoRangeOnly(text),
    algoOmronLayout(text)
  ];
}

// =================== Preprocessing ===================

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
      pipeline = pipeline.grayscale().linear(2.0, -40);
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
    case 'rotate90_contrast':
      pipeline = pipeline.rotate(90).grayscale().linear(2.0, -40);
      break;
    case 'crop_lcd':
      // LCD is roughly central, crop to the display area
      pipeline = pipeline.extract({ left: Math.floor(w*0.25), top: Math.floor(h*0.20), width: Math.floor(w*0.55), height: Math.floor(h*0.60) });
      break;
    case 'crop_lcd_contrast':
      pipeline = pipeline.extract({ left: Math.floor(w*0.25), top: Math.floor(h*0.20), width: Math.floor(w*0.55), height: Math.floor(h*0.60) }).grayscale().linear(2.0, -40);
      break;
    case 'crop_lcd_threshold':
      pipeline = pipeline.extract({ left: Math.floor(w*0.25), top: Math.floor(h*0.20), width: Math.floor(w*0.55), height: Math.floor(h*0.60) }).grayscale().threshold(128);
      break;
    case 'sharpen':
      pipeline = pipeline.grayscale().sharpen({ sigma: 2, flat: 1, jagged: 2 });
      break;
    default:
      break;
  }
  
  return await pipeline.toBuffer();
}

// =================== OCR Tests ===================

async function testTesseract(buffer, variant, worker) {
  try {
    const result = await worker.recognize(buffer);
    return {
      engine: 'Tesseract.js',
      variant,
      text: result.data.text,
      confidence: result.data.confidence,
      words: result.data.words?.map(w => w.text) || []
    };
  } catch (err) {
    return {
      engine: 'Tesseract.js',
      variant,
      text: '',
      error: err.message
    };
  }
}

async function testOcrad(buffer, variant) {
  try {
    const { data, info } = await sharp(buffer).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    const canvas = {
      width: info.width,
      height: info.height,
      getContext: () => ({
        getImageData: () => ({
          width: info.width,
          height: info.height,
          data: new Uint8ClampedArray(data)
        })
      })
    };
    const text = ocrad(canvas);
    return {
      engine: 'ocrad.js',
      variant,
      text,
      confidence: null
    };
  } catch (err) {
    return {
      engine: 'ocrad.js',
      variant,
      text: '',
      error: err.message
    };
  }
}

// =================== Main ===================

async function main() {
  console.log('========================================');
  console.log('BPLog OCR Test — Omron HEM-7121');
  console.log('Target: SYS=118, DIA=78, PULSE=59');
  console.log('========================================\n');
  
  const variants = [
    'original',
    'grayscale',
    'contrast',
    'inverted',
    'threshold',
    'rotate90',
    'rotate90_contrast',
    'crop_lcd',
    'crop_lcd_contrast',
    'crop_lcd_threshold',
    'sharpen'
  ];
  
  const worker = await createWorker('eng');
  const allResults = [];
  
  for (const variant of variants) {
    console.log(`\n--- Variant: ${variant} ---`);
    const buffer = await preprocessImage(IMAGE_PATH, variant);
    await sharp(buffer).toFile(`./test-ocr-${variant}.jpg`);
    
    const tResult = await testTesseract(buffer, variant, worker);
    const oResult = await testOcrad(buffer, variant);
    
    console.log(`\n[Tesseract.js ${variant}]`);
    console.log('Text:', JSON.stringify(tResult.text));
    console.log('Confidence:', tResult.confidence ?? 'N/A');
    if (tResult.error) console.log('ERROR:', tResult.error);
    
    const tAlgos = runAllAlgos(tResult.text);
    console.log('Algorithms:');
    tAlgos.forEach(a => {
      const status = (a.sys === 118 && a.dia === 78 && a.hr === 59) ? '✅ PERFECT' : 
                     (a.sys && a.dia && a.hr) ? `⚠️  Got ${a.sys}/${a.dia} HR:${a.hr}` : '❌ FAILED';
      console.log(`  ${a.name}: sys=${a.sys} dia=${a.dia} hr=${a.hr} ${status}`);
    });
    
    console.log(`\n[ocrad.js ${variant}]`);
    console.log('Text:', JSON.stringify(oResult.text));
    if (oResult.error) console.log('ERROR:', oResult.error);
    
    const oAlgos = runAllAlgos(oResult.text);
    console.log('Algorithms:');
    oAlgos.forEach(a => {
      const status = (a.sys === 118 && a.dia === 78 && a.hr === 59) ? '✅ PERFECT' : 
                     (a.sys && a.dia && a.hr) ? `⚠️  Got ${a.sys}/${a.dia} HR:${a.hr}` : '❌ FAILED';
      console.log(`  ${a.name}: sys=${a.sys} dia=${a.dia} hr=${a.hr} ${status}`);
    });
    
    allResults.push({ variant, tesseract: { ...tResult, algos: tAlgos }, ocrad: { ...oResult, algos: oAlgos } });
  }
  
  await worker.terminate();
  
  console.log('\n\n========================================');
  console.log('SUMMARY');
  console.log('========================================');
  
  let perfectCount = 0;
  const perfectHits = [];
  allResults.forEach(r => {
    [...r.tesseract.algos, ...r.ocrad.algos].forEach(a => {
      if (a.sys === 118 && a.dia === 78 && a.hr === 59) {
        const line = `✅ ${r.variant} | ${a.engine || 'Unknown Engine'} | ${a.name}`;
        console.log(line);
        perfectHits.push({ variant: r.variant, engine: a.engine || 'Unknown', algo: a.name });
        perfectCount++;
      }
    });
  });
  
  if (perfectCount === 0) {
    console.log('❌ No variant + algorithm combination achieved PERFECT extraction.');
  } else {
    console.log(`\nTotal perfect hits: ${perfectCount}`);
  }
  
  // Best near-misses
  console.log('\n--- Best Near-Misses ---');
  allResults.forEach(r => {
    [...r.tesseract.algos, ...r.ocrad.algos].forEach(a => {
      if (a.sys || a.dia || a.hr) {
        if (!(a.sys === 118 && a.dia === 78 && a.hr === 59)) {
          console.log(`⚠️  ${r.variant} | ${a.engine || 'Unknown'} | ${a.name}: ${a.sys}/${a.dia} HR:${a.hr}`);
        }
      }
    });
  });
  
  fs.writeFileSync('./test-ocr-results.json', JSON.stringify(allResults, null, 2));
  console.log('\nDetailed results saved to: test-ocr-results.json');
  console.log('Preprocessed images saved as: test-ocr-*.jpg');
}

main().catch(console.error);
