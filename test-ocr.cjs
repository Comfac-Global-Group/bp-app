const Tesseract = require('tesseract.js');
const ocrad = require('ocrad.js');
const sharp = require('sharp');
const fs = require('fs');

const IMAGE_PATH = './20260414_112450.jpg';

// =================== Extraction Algorithms ===================

function algoLabelProximity(text) {
  // Look for numbers near SYS, DIA, PULSE labels
  const sysMatch = text.match(/SYS.*?mmHg\s*(\d{2,3})/i) || text.match(/SYS\s*(\d{2,3})/i);
  const diaMatch = text.match(/DIA.*?mmHg\s*(\d{2,3})/i) || text.match(/DIA\s*(\d{2,3})/i);
  const pulseMatch = text.match(/PULSE.*?\/min\s*(\d{2,3})/i) || text.match(/PULSE\s*(\d{2,3})/i) || text.match(/Pulse\s*(\d{2,3})/i);
  
  return {
    name: 'Label-Proximity',
    sys: sysMatch ? parseInt(sysMatch[1]) : null,
    dia: diaMatch ? parseInt(diaMatch[1]) : null,
    hr: pulseMatch ? parseInt(pulseMatch[1]) : null,
    raw: { sysMatch, diaMatch, pulseMatch }
  };
}

function algoSeparator(text) {
  // Look for NNN/NN or NNN|NN patterns
  const sepMatch = text.match(/(\d{2,3})\s*[/|\\]\s*(\d{2,3})/);
  if (sepMatch) {
    const nums = text.match(/\b\d{2,3}\b/g) || [];
    return {
      name: 'Separator',
      sys: parseInt(sepMatch[1]),
      dia: parseInt(sepMatch[2]),
      hr: nums.length >= 3 ? parseInt(nums[nums.length - 1]) : null,
      raw: { sepMatch, nums }
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
        const hrCandidates = nums.map(Number).filter(x => x !== sys && x !== dia && x >= 40 && x <= 200);
        return {
          name: 'Range+PP',
          sys,
          dia,
          hr: hrCandidates.length ? hrCandidates[0] : null,
          raw: { nums, pair: [sys, dia] }
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

function runAllAlgos(text) {
  return [
    algoLabelProximity(text),
    algoSeparator(text),
    algoRangePP(text),
    algoRangeOnly(text)
  ];
}

// =================== Preprocessing ===================

async function preprocessImage(inputPath, variant) {
  let pipeline = sharp(inputPath);
  
  switch (variant) {
    case 'original':
      break;
    case 'grayscale':
      pipeline = pipeline.grayscale();
      break;
    case 'contrast':
      pipeline = pipeline.grayscale().linear(1.5, -30);
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
      // Approximate crop to LCD region (image is 4080x3060)
      // LCD appears roughly in center, let's try cropping center 60% x 50%
      pipeline = pipeline.extract({ left: 800, top: 700, width: 2400, height: 1600 });
      break;
    case 'crop_lcd_contrast':
      pipeline = pipeline.extract({ left: 800, top: 700, width: 2400, height: 1600 }).grayscale().linear(1.5, -30);
      break;
    default:
      break;
  }
  
  const buffer = await pipeline.toBuffer();
  return buffer;
}

// =================== OCR Tests ===================

async function testTesseract(buffer, variant) {
  try {
    const result = await Tesseract.recognize(buffer, 'eng', {
      logger: m => {}
    });
    return {
      engine: 'Tesseract.js',
      variant,
      text: result.data.text,
      confidence: result.data.confidence,
      words: result.data.words.map(w => w.text)
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
    // ocrad.js expects a canvas-like object or can work with image data
    // For Node.js, we'll use a simple approach with sharp -> raw pixels
    // But ocrad.js is browser-oriented. Let's try feeding it via a simple canvas emulation
    
    const { data, info } = await sharp(buffer).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    
    // Create a fake canvas context
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
    'crop_lcd',
    'crop_lcd_contrast'
  ];
  
  const allResults = [];
  
  for (const variant of variants) {
    console.log(`\n--- Variant: ${variant} ---`);
    const buffer = await preprocessImage(IMAGE_PATH, variant);
    
    // Save preprocessed image for manual inspection
    await sharp(buffer).toFile(`./test-ocr-${variant}.jpg`);
    
    const tResult = await testTesseract(buffer, variant);
    const oResult = await testOcrad(buffer, variant);
    
    console.log(`\n[Tesseract.js ${variant}]`);
    console.log('Text:', JSON.stringify(tResult.text));
    console.log('Confidence:', tResult.confidence || 'N/A');
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
  
  // Summary
  console.log('\n\n========================================');
  console.log('SUMMARY');
  console.log('========================================');
  
  let perfectCount = 0;
  allResults.forEach(r => {
    [...r.tesseract.algos, ...r.ocrad.algos].forEach(a => {
      if (a.sys === 118 && a.dia === 78 && a.hr === 59) {
        console.log(`✅ ${r.variant} | ${a.name}`);
        perfectCount++;
      }
    });
  });
  
  if (perfectCount === 0) {
    console.log('❌ No variant + algorithm combination achieved PERFECT extraction.');
  } else {
    console.log(`\nTotal perfect hits: ${perfectCount}`);
  }
  
  // Write detailed results to JSON
  fs.writeFileSync('./test-ocr-results.json', JSON.stringify(allResults, null, 2));
  console.log('\nDetailed results saved to: test-ocr-results.json');
  console.log('Preprocessed images saved as: test-ocr-*.jpg');
}

main().catch(console.error);
