import { createWorker } from 'tesseract.js';
import sharp from 'sharp';

const IMAGE_PATH = './test-ocr2-rotate90.jpg';

async function main() {
  console.log('Testing tesseract on rotate90 image with different PSM modes...\n');
  
  const psmModes = [
    { psm: '3', name: 'Auto (default)' },
    { psm: '6', name: 'Uniform block of text' },
    { psm: '7', name: 'Single text line' },
    { psm: '8', name: 'Single word' },
    { psm: '11', name: 'Sparse text - find as much text as possible' },
    { psm: '12', name: 'Sparse text with OSD' },
    { psm: '13', name: 'Raw line' },
  ];
  
  for (const { psm, name } of psmModes) {
    const worker = await createWorker('eng');
    await worker.setParameters({
      tessedit_pageseg_mode: psm,
      tessedit_char_whitelist: '0123456789'
    });
    
    const result = await worker.recognize(IMAGE_PATH);
    const nums = (result.data.text.match(/\b\d{2,3}\b/g) || []).map(Number);
    const has118 = nums.includes(118);
    const has78 = nums.includes(78);
    const has59 = nums.includes(59);
    
    console.log(`PSM ${psm} (${name}):`);
    console.log(`  nums: ${JSON.stringify(nums)}`);
    console.log(`  has 118: ${has118}, has 78: ${has78}, has 59: ${has59}`);
    console.log(`  text: ${result.data.text.slice(0, 150).replace(/\n/g, ' | ')}`);
    console.log();
    
    await worker.terminate();
  }
}

main().catch(console.error);
