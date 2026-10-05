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

// Build-output check. A generic key-PREFIX scan is wrong here: third-party SDKs
// embed their own publishable vendor keys (Privy's bundle ships Moonpay `pk_live_…`
// onramp constants), so prefix matching fails OUR build for code we don't own.
// What actually matters is that no real credential VALUE from .env leaks into a
// client artifact, and that no private-key MATERIAL is present. So: scan the built
// bundle for the literal secret values our .env defines (server-side vars only —
// anything VITE_-prefixed is public by design), plus a real PEM private-key body.
const webDist = path.join('web','dist');
if (fs.existsSync(webDist)) {
  const secretValues = [];
  const envPath = path.join('.');
  if (fs.existsSync(path.join(envPath, '.env'))) {
    for (const line of fs.readFileSync(path.join(envPath, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const [, key, rawVal] = m;
      const val = rawVal.trim().replace(/^['"]|['"]$/g, '');
      // VITE_* is deliberately exposed to the browser; short/placeholder values are noise.
      if (val.length < 12 || key.startsWith('VITE_')) continue;
      if (/(SECRET|PRIVATE|TOKEN|PASSWORD|API_KEY)/.test(key)) secretValues.push({ key, val });
    }
  }
  const pemBody = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]{20,}?-----END/;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!(full.endsWith('.js') || full.endsWith('.html'))) continue;
      const c = fs.readFileSync(full, 'utf8');
      for (const { key, val } of secretValues) {
        if (c.includes(val)) {
          console.error(`leaked .env value for ${key} into web build ${full}`);
          failed = true;
        }
      }
      if (pemBody.test(c)) {
        console.error('PEM private-key material in web build', full);
        failed = true;
      }
    }
  };
  walk(webDist);
}

if (failed) { console.error('check-secrets FAILED'); process.exit(1); }
console.log('check-secrets PASSED');
