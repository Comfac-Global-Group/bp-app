import ocrad from 'ocrad.js';
import sharp from 'sharp';

const IMAGE_PATH = './20260414_112450.jpg';

async function preprocess(inputPath, variant) {
  let pipeline = sharp(inputPath);
  const meta = await pipeline.metadata();
  const w = meta.width;
  const h = meta.height;
  
  switch (variant) {
    case 'normal':
      pipeline = pipeline.resize({ width: Math.round(w * 1.5) });
      break;
    case 'normal_inverted':
      pipeline = pipeline.resize({ width: Math.round(w * 1.5) }).grayscale().negate();
      break;
    case 'rotate90':
      pipeline = pipeline.rotate(90).resize({ height: Math.round(h * 1.5) });
      break;
    case 'rotate90_inverted':
      pipeline = pipeline.rotate(90).resize({ height: Math.round(h * 1.5) }).grayscale().negate();
      break;
    case 'crop_lcd':
      pipeline = pipeline.extract({ left: Math.floor(w*0.25), top: Math.floor(h*0.20), width: Math.floor(w*0.55), height: Math.floor(h*0.60) }).resize({ width: 1800 });
      break;
    case 'crop_lcd_rotate90':
      pipeline = pipeline.extract({ left: Math.floor(w*0.25), top: Math.floor(h*0.20), width: Math.floor(w*0.55), height: Math.floor(h*0.60) }).rotate(90).resize({ height: 1800 });
      break;
    case 'crop_lcd_rotate90_inverted':
      pipeline = pipeline.extract({ left: Math.floor(w*0.25), top: Math.floor(h*0.20), width: Math.floor(w*0.55), height: Math.floor(h*0.60) }).rotate(90).resize({ height: 1800 }).grayscale().negate();
      break;
  }
  
  pipeline = pipeline.grayscale().threshold(128);
  return await pipeline.toBuffer();
}

async function runOcrad(buffer) {
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
  return ocrad(canvas);
}

function extractBP(text) {
  const nums = (text.match(/\b\d{2,3}\b/g) || []).map(Number);
  const has118 = nums.includes(118);
  const has78 = nums.includes(78);
  const has59 = nums.includes(59);
  return { nums, has118, has78, has59, perfect: has118 && has78 && has59, text: text.slice(0, 200) };
}

async function main() {
  console.log('Testing ocrad.js with rotate90 variants...\n');
  
  const variants = [
    'normal',
    'normal_inverted', 
    'rotate90',
    'rotate90_inverted',
    'crop_lcd',
    'crop_lcd_rotate90',
    'crop_lcd_rotate90_inverted'
  ];
  
  for (const variant of variants) {
    const buffer = await preprocess(IMAGE_PATH, variant);
    await sharp(buffer).toFile(`./test-ocrad-${variant}.jpg`);
    const text = await runOcrad(buffer);
    const result = extractBP(text);
    
    const status = result.perfect ? '✅ FULL_MATCH' : 
                   (result.has118 || result.has78 || result.has59) ? '⚠️ PARTIAL' : '❌ NONE';
    
    console.log(`[${variant}] ${status}`);
    console.log(`  nums: ${JSON.stringify(result.nums)}`);
    console.log(`  text: ${result.text.replace(/\n/g, ' | ')}`);
    console.log();
  }
}

main().catch(console.error);
