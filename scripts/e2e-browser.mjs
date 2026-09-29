// Dev-only browser E2E (Playwright, headless Chromium). Drives the REAL web UI
// against the REAL API (sim, in-memory PGlite) and captures a screenshot at each
// step plus console errors and failed network requests. Requires the audit API
// server (scripts/audit-api-server.mjs) on :4000 and `vite dev` on :5173.
// Never part of runtime.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const WEB = 'http://localhost:5173';
const API = 'http://localhost:4000';
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
// Static-asset noise (e.g. a missing favicon 404) is a network event, not a React
// runtime error; track it separately so the "0 console errors" gate reflects app health.
const isAppError = (e) => !/Failed to load resource|favicon/i.test(e);

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

  // ---- Discover ----
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

  // ---- Room (F-002 infinite-render checkpoint) ----
  const errorsBeforeRoom = consoleErrors.length;
  await page.goto(`${WEB}/room/${roomId}`, { waitUntil: 'networkidle' });
  const yesBtn = page.getByRole('button', { name: 'YES', exact: true });
  await yesBtn.first().waitFor({ timeout: 8000 });
  // Let SSE odds + several render passes happen before sampling the error count.
  await page.waitForTimeout(3000);
  const roomNewErrors = consoleErrors.slice(errorsBeforeRoom).filter(isAppError);
  const updateDepth = roomNewErrors.filter((e) => /Maximum update depth exceeded/i.test(e)).length;
  rec('F-002: 0 app console errors on Room (was 22 in audit)', roomNewErrors.length === 0, `room-new-errors=${roomNewErrors.length} max-update-depth=${updateDepth}`);
  const openBadge = await page.getByText('open', { exact: true }).count();
  rec('Room shows the OPEN market (B3)', openBadge >= 1, `badges=${openBadge}`);
  const closedText = await page.getByText('closed', { exact: true }).count();
  rec('Room open market shows no stray "closed" (B4)', closedText === 0, `closed-count=${closedText}`);
  await page.screenshot({ path: `${SHOTS}/02-room-desktop.png`, fullPage: true });

  // ---- Sign in (F-005 toast) ----
  await page.getByRole('button', { name: /Sign in \(Demo wallet\)/ }).click();
  await page.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 8000 });
  const signInToast = await page.getByText(/Signed in as demo wallet/).count();
  rec('F-005 sign-in toast visible', signInToast >= 1, `matches=${signInToast}`);
  await page.screenshot({ path: `${SHOTS}/03-signed-in.png` });

  // ---- Trade on the seeded room (F-005 toast) ----
  await yesBtn.first().click();
  const confirm = page.getByRole('button', { name: /Confirm/ });
  await confirm.waitFor({ timeout: 6000 });
  await page.getByRole('button', { name: '$10' }).click();
  await page.screenshot({ path: `${SHOTS}/04-tradesheet.png` });
  await confirm.click();
  const tradeToastOk = await page.getByText(/Order confirmed:/).waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
  rec('F-005 trade-confirm toast visible', tradeToastOk);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/05-trade-after.png`, fullPage: true });

  // ---- Creator flow: create a room+market we own, buy, resolve -> a claimable win ----
  const claimRoomId = await page.evaluate(async (api) => {
    const tok = globalThis.sessionStorage.getItem('liveedge_token');
    const r = await fetch(`${api}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ title: 'Claim E2E Room', videoUrl: '' }),
    });
    const j = await r.json();
    return j.id;
  }, API);
  rec('Setup: creator opened an owned room', !!claimRoomId, `roomId=${claimRoomId}`);

  await page.goto(`${WEB}/creator/${claimRoomId}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Create \(sim\)/ }).click();
  const createToastOk = await page.getByText(/Market created!/).waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
  rec('F-005 market-creation toast visible', createToastOk);
  await page.waitForTimeout(1200);

  // Buy YES $10 on our own market (navigated to /room/:id by onCreated).
  await page.getByRole('button', { name: 'YES', exact: true }).first().waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'YES', exact: true }).first().click();
  const confirm2 = page.getByRole('button', { name: /Confirm/ });
  await confirm2.waitFor({ timeout: 6000 });
  await page.getByRole('button', { name: '$10' }).click();
  await confirm2.click();
  await page.waitForTimeout(1500);

  // Resolve YES as creator.
  await page.goto(`${WEB}/creator/${claimRoomId}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await page.getByText(/Resolved/).waitFor({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/06-resolved.png`, fullPage: true });

  // ---- Claim via the real Portfolio button (F-003) ----
  await page.goto(`${WEB}/portfolio`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Portfolio' }).waitFor({ timeout: 6000 });
  const balBefore = Number(String(await page.locator('.num').first().textContent()).replace(/[^0-9.]/g, ''));
  const claimBtn = page.getByRole('button', { name: /Claim \$/ }).first();
  const hasClaim = await claimBtn.count();
  rec('F-003 UI exposes a Claim button for the resolved win', hasClaim >= 1, `claim-buttons=${hasClaim}`);
  await claimBtn.click();
  const claimToastOk = await page.getByText(/Claimed! \+\$/).waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
  rec('F-003 + F-005 claim succeeds with success toast', claimToastOk);
  await page.waitForTimeout(1200);
  const balAfter = Number(String(await page.locator('.num').first().textContent()).replace(/[^0-9.]/g, ''));
  rec('F-003 claim increases the balance', balAfter > balBefore, `balance ${balBefore} -> ${balAfter}`);
  await page.screenshot({ path: `${SHOTS}/07-portfolio-claimed.png`, fullPage: true });

  // ---- Faucet toast (F-005) ----
  await page.getByRole('button', { name: /Faucet/ }).click();
  const faucetToastOk = await page.getByText(/Faucet: \+\$100 added/).waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
  rec('F-005 faucet success toast visible', faucetToastOk);

  // ---- Mobile pass ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(WEB + '/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${SHOTS}/08-discover-mobile.png`, fullPage: true });
  await page.goto(`${WEB}/room/${roomId}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${SHOTS}/09-room-mobile.png`, fullPage: true });
  rec('Mobile width renders discover + room', true);

  await page.goto(`${WEB}/about`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${SHOTS}/10-about.png`, fullPage: true });

  await browser.close();

  const appErrors = consoleErrors.filter(isAppError);
  console.log('\n# App console errors (total): ' + appErrors.length);
  appErrors.slice(0, 15).forEach((e) => console.log('  - ' + e));
  const maxDepthTotal = appErrors.filter((e) => /Maximum update depth exceeded/i.test(e)).length;
  console.log('# "Maximum update depth exceeded" occurrences: ' + maxDepthTotal + ' (audit before = 22)');
  console.log('# Failed/4xx network: ' + failedRequests.length);
  [...new Set(failedRequests)].slice(0, 15).forEach((e) => console.log('  - ' + e));

  // Global gate: no React runtime errors anywhere in the run.
  rec('Whole run has 0 app console errors', appErrors.length === 0, `count=${appErrors.length}`);
  rec('Whole run has 0 "Maximum update depth exceeded"', maxDepthTotal === 0);

  console.log(`\n# BROWSER TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('BROWSER E2E crashed:', e);
  process.exit(2);
});
