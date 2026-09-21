import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

let failed=false;

function checkFile(p) {
  if (!fs.existsSync(p)) return;
  const content = fs.readFileSync(p, 'utf8');
  
  // Check for actual secrets (not placeholders or examples)
  const patterns = [
    /PANTA_API_KEY\s*=\s*[a-zA-Z0-9_-]{20,}/,  // Real API keys
    /sk_live_[a-zA-Z0-9]{30,}/,      // Real Stripe live keys are long
    /pk_live_[a-zA-Z0-9]{30,}/,      // Real Stripe publishable keys are long
    /pk_test_[a-zA-Z0-9]{30,}/,      // Real Stripe test keys are long
    /BEGIN PRIVATE KEY/,            // Actual private key block
    /-----BEGIN.*PRIVATE KEY-----/, // Alternative private key format
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
  if (f.includes('.env') && !f.includes('.env.example')) { 
    console.error('tracked .env file', f); 
    failed=true; 
  }
  // Skip check-secrets.mjs itself from pattern checks (it contains the patterns to detect)
  if (f.includes('check-secrets.mjs')) continue;
  checkFile(f);
}

const webDist = path.join('web','dist');
if (fs.existsSync(webDist)) {
  const files = fs.readdirSync(webDist, { recursive:true });
  for (const f of files) {
    const full = path.join(webDist, f);
    if (fs.statSync(full).isFile() && (full.endsWith('.js') || full.endsWith('.html'))) {
      const c = fs.readFileSync(full,'utf8');
      if (c.includes('sk_live_') || c.includes('pk_live_') || c.includes('pk_test_') || c.includes('BEGIN PRIVATE KEY')) { 
        console.error('secret in web build', full); 
        failed=true; 
      }
    }
  }
}

if (failed) { console.error('check-secrets FAILED'); process.exit(1); }
console.log('check-secrets PASSED');
