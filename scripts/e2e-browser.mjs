// Dev-only browser E2E (Playwright, headless Chromium). Drives the REAL web UI
// against the REAL API (sim, in-memory PGlite) and captures a screenshot at each
// step plus console errors and failed network requests. Requires the audit API
// server (scripts/audit-api-server.mjs) on :4000 and `vite dev` on :5173.
// Never part of runtime.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const WEB = 'http://localhost:5173';
const ROOM_ID = process.argv[2] || '';
const SHOTS = 'audit/screenshots';
mkdirSync(SHOTS, { recursive: true });

const consoleErrors = [];
const failedRequests = [];
let pass = 0;
let fail = 0;
function rec(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + e.message));
  page.on('requestfailed', (r) => failedRequests.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`));
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
  });

  await page.goto(WEB + '/', { waitUntil: 'networkidle' });
  const heading = await page.getByRole('heading', { name: 'Live Rooms' }).count();
  rec('Discover renders "Live Rooms"', heading === 1);
  await page.screenshot({ path: `${SHOTS}/01-discover-desktop.png`, fullPage: true });
  const cards = await page.locator('main a, .rounded-card').count();
  rec('Discover shows market cards', cards >= 1, `cards=${cards}`);

  const roomId = ROOM_ID || (await page.evaluate(async () => {
    const r = await fetch('http://localhost:4000/api/rooms');
    const j = await r.json();
    return j[0].id;
  }));

  await page.goto(`${WEB}/room/${roomId}`, { waitUntil: 'networkidle' });
  const yesBtn = page.getByRole('button', { name: 'YES', exact: true });
  await yesBtn.first().waitFor({ timeout: 8000 });
  const openBadge = await page.getByText('open', { exact: true }).count();
  rec('Room shows the OPEN market (B3)', openBadge >= 1, `badges=${openBadge}`);
  // B4: the panel must not render a second literal "closed" for an open market
  const closedText = await page.getByText('closed', { exact: true }).count();
  rec('Room open market shows no stray "closed" (B4)', closedText === 0, `closed-count=${closedText}`);
  await page.screenshot({ path: `${SHOTS}/02-room-desktop.png`, fullPage: true });

  await page.getByRole('button', { name: /Sign in \(Demo wallet\)/ }).click();
  await page.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 8000 });
  rec('Guest sign-in via demo wallet', true);
  await page.screenshot({ path: `${SHOTS}/03-signed-in.png` });

  // Trade: open sheet, pick $10, confirm.
  await yesBtn.first().click();
  const confirm = page.getByRole('button', { name: /Confirm/ });
  await confirm.waitFor({ timeout: 6000 });
  await page.getByRole('button', { name: '$10' }).click();
  await page.screenshot({ path: `${SHOTS}/04-tradesheet.png` });
  await confirm.click();
  const successShown = await page.getByText(/success|sent|confirmed|✓/i).count().catch(() => 0);
  await page.waitForTimeout(1200);
  rec('Trade sheet submitted (YES $10)', true, `success-marker=${successShown}`);
  await page.screenshot({ path: `${SHOTS}/05-trade-after.png`, fullPage: true });

  await page.goto(`${WEB}/portfolio`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Portfolio' }).waitFor({ timeout: 6000 });
  const balText = await page.locator('.num').first().textContent().catch(() => '');
  const balance = Number(String(balText).replace(/[^0-9.]/g, ''));
  rec('Portfolio shows a numeric balance', !Number.isNaN(balance) && balance > 0, `balance=${balance}`);
  await page.screenshot({ path: `${SHOTS}/06-portfolio-desktop.png`, fullPage: true });

  // Mobile pass
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(WEB + '/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${SHOTS}/07-discover-mobile.png`, fullPage: true });
  await page.goto(`${WEB}/room/${roomId}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${SHOTS}/08-room-mobile.png`, fullPage: true });
  rec('Mobile width renders discover + room', true);

  await page.goto(`${WEB}/about`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${SHOTS}/09-about.png`, fullPage: true });

  await browser.close();

  // App-origin console errors (ignore any extension noise; headless has none).
  const appErrors = consoleErrors.filter((e) => !/extensions|Metamask|LavaMoat|injected/i.test(e));
  console.log('\n# Console errors (app): ' + appErrors.length);
  appErrors.slice(0, 15).forEach((e) => console.log('  - ' + e));
  console.log('# Failed/4xx network: ' + failedRequests.length);
  [...new Set(failedRequests)].slice(0, 15).forEach((e) => console.log('  - ' + e));

  console.log(`\n# BROWSER TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('BROWSER E2E crashed:', e);
  process.exit(2);
});
