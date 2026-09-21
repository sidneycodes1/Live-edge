import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

let failed=false;
function checkFile(p) {
  if (!fs.existsSync(p)) return;
  const content = fs.readFileSync(p, 'utf8');
  const patterns = [
    /PANTA_API_KEY\s*=\s*.+/,
    /JWT_SECRET\s*=\s*.+/,
    /BEGIN PRIVATE KEY/,
    /sk_live/,
  ];
  for (const pat of patterns) {
    if (pat.test(content)) {
      console.error(`Secret pattern ${pat} found in ${p}`);
      failed=true;
    }
  }
}

const tracked = execSync('git ls-files 2> nul || echo ""', { encoding:'utf8' }).split('\n').filter(Boolean);
for (const f of tracked) {
  if (f.includes('.env') && !f.includes('.env.example')) { console.error('tracked .env file', f); failed=true; }
  checkFile(f);
}
const webDist = path.join('web','dist');
if (fs.existsSync(webDist)) {
  const files = fs.readdirSync(webDist, { recursive:true });
  for (const f of files) {
    const full = path.join(webDist, f);
    if (fs.statSync(full).isFile() && (full.endsWith('.js') || full.endsWith('.html'))) {
      const c = fs.readFileSync(full,'utf8');
      if (c.includes('PANTA_API_KEY') || c.includes('JWT_SECRET')) { console.error('secret in web build', full); failed=true; }
    }
  }
}
if (failed) { console.error('check-secrets FAILED'); process.exit(1); }
console.log('check-secrets PASSED');
