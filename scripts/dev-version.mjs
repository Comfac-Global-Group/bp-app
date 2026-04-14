import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const count = parseInt(execSync('git rev-list --count HEAD').toString().trim());
const sha   = execSync('git rev-parse --short HEAD').toString().trim();
const version = (1.0 + count * 0.01).toFixed(2);
const date    = new Date().toISOString().slice(0, 10);

writeFileSync('version.json', JSON.stringify({ version, sha, date }, null, 2) + '\n');
console.log(`version.json → v${version} (${sha}) ${date}`);
