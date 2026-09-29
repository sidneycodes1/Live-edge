// Phase-3 checkpoint browser E2E (Playwright, headless Chromium) — dev-only.
// Proves the FULL creator journey through the REAL UI (not API-only): open a
// room, quote + pay the creation fee (F-010), see the market on Discover and in
// Portfolio's Created Markets, trade against it as a DIFFERENT account until it
// graduates, resolve it, and claim the creator fee share (T5) from Portfolio.
// Also asserts the F-014/F-015 polish: no "placeholder" text, correct viewer
// pluralization, red LIVE dot, working favicon, and no stray "closed" on an open
// market. Requires the audit API server (scripts/audit-api-server.mjs) on :4000
// (sim + in-memory PGlite) and `vite dev` on :5173. Never part of runtime.
import { chromium } from 'playwright';

const WEB = 'http://localhost:5173';
const API = 'http://localhost:4000';
const TS = Date.now();
const Q_A = `E2E P3 market ${TS}?`; // creator's unique question (avoids DUPLICATE_MARKET)

let pass = 0;
let fail = 0;
function rec(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
}
const balanceNum = async (page) => {
  const t = await page.getByTestId('header-balance').textContent();
  return Number(String(t).replace(/[^0-9.]/g, ''));
};
const waitBalance = (page, expected) =>
  page
    .waitForFunction(
      (want) => {
        const el = globalThis.document.querySelector('[data-testid="header-balance"]');
        return el && Math.abs(Number(el.textContent.replace(/[^0-9.]/g, '')) - Number(want)) < 0.005;
      },
      expected,
      { timeout: 8000 },
    )
    .then(() => true)
    .catch(() => false);

async function guestSignIn(page) {
  await page.goto(WEB + '/', { waitUntil: 'networkidle' });
  await page.locator('nav').getByRole('button', { name: 'Continue as guest' }).click();
  await page.waitForURL('**/portfolio', { timeout: 8000 });
  await waitBalance(page, 100);
}
async function apiFetch(page, path) {
  return page.evaluate(async ([api, p]) => {
    const tok = globalThis.sessionStorage.getItem('liveedge_token');
    const r = await fetch(`${api}${p}`, { headers: { Authorization: `Bearer ${tok}` } });
    return { status: r.status, json: await r.json() };
  }, [API, path]);
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  // ---------- Context A: the creator ----------
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const A = await ctxA.newPage();
  const errorsA = [];
  A.on('pageerror', (e) => errorsA.push('PAGEERROR ' + e.message));
  const faviconStatus = [];
  A.on('response', (r) => {
    if (/favicon/i.test(r.url())) faviconStatus.push(`${r.status()} ${r.url()}`);
  });

  await guestSignIn(A);
  rec('P3 setup: creator signed in as guest ($100)', (await balanceNum(A)) === 100);

  // Open a room through the real Creator page (no roomId -> "Start a room" form).
  await A.goto(WEB + '/creator', { waitUntil: 'networkidle' });
  await A.getByPlaceholder(/Room title/).fill(`P3 E2E Room ${TS}`);
  await A.getByRole('button', { name: /Create room & open cockpit/ }).click();
  await A.waitForURL(/\/creator\//, { timeout: 8000 });
  const roomId = (await A.url()).split('/creator/')[1];
  rec('T1 creator opened a room via the UI', !!roomId, `roomId=${roomId}`);

  // Creator Panel: set a unique question, preview the fee, then confirm.
  await A.getByRole('heading', { name: 'Creator Panel' }).waitFor({ timeout: 6000 });
  await A.getByPlaceholder('Question').fill(Q_A);
  await A.getByRole('button', { name: /Preview creation fee/ }).click();
  const preview = A.getByTestId('fee-preview');
  await preview.waitFor({ timeout: 6000 });
  const feeText = await preview.locator('.num').first().textContent();
  const fee = Number(String(feeText).replace(/[^0-9.]/g, ''));
  rec('F-010 creation fee is quoted BEFORE confirm', fee > 0, `fee=${fee}`);
  rec('F-010 fee preview is labeled as a cost', /deducted from your balance/i.test(await preview.textContent()));

  const balBefore = await balanceNum(A);
  await A.getByTestId('confirm-create').click();
  const createdToast = await A.getByText(/Market created! \$[\d.]+ creation fee deducted/).waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
  rec('F-010 confirm shows the fee-deducted toast', createdToast);
  await waitBalance(A, balBefore - fee);
  const balAfterCreate = await balanceNum(A);
  rec('F-010 balance dropped by EXACTLY the quoted fee', Math.abs(balBefore - balAfterCreate - fee) < 0.005, `${balBefore} -> ${balAfterCreate} (fee ${fee})`);

  // Ledger records the creation fee as a debit (F-006 + F-010).
  const ledgerA = await apiFetch(A, '/api/ledger?limit=20');
  const feeRow = ledgerA.json.items.find((i) => i.kind === 'creation_fee');
  rec('F-010 ledger has a creation_fee debit', !!feeRow && feeRow.delta < 0, feeRow ? `delta=${feeRow.delta} label=${feeRow.label}` : 'missing');

  // Appears on Discover (rooms list, heroMarket) and in Portfolio Created Markets.
  const rooms = await apiFetch(A, '/api/rooms');
  const onDiscover = (rooms.json || []).some((r) => r.heroMarket && r.heroMarket.question === Q_A && r.heroMarket.status === 'open');
  rec('F-010 created market appears on Discover (rooms heroMarket)', onDiscover);
  const pf1 = await apiFetch(A, '/api/portfolio');
  const created = pf1.json.createdMarkets.find((c) => c.market.question === Q_A);
  rec('F-010 created market shows in Portfolio Created Markets', !!created);

  // F-014 / F-015 polish, checked on the room WHILE its market is still open.
  await A.goto(`${WEB}/room/${roomId}`, { waitUntil: 'networkidle' });
  await A.waitForTimeout(600);
  const openRoomBody = await A.locator('body').innerText();
  rec('F-014 stream area no longer says "placeholder"', !/placeholder/i.test(openRoomBody));
  rec('F-014 animated "Live stream preview" is shown', /Live stream preview/i.test(openRoomBody));
  rec('F-015 no "1 viewers" mis-pluralization on an open room', !/\b1 viewers\b/.test(openRoomBody), `snippet=${(openRoomBody.match(/\d+ view\w*/) || ['n/a'])[0]}`);
  rec('F-015 open market shows no stray "closed"', !/\bclosed\b/i.test(openRoomBody));
  rec('F-015 LIVE indicator dot is red (not amber)', await A.evaluate(() => !!globalThis.document.querySelector('span.bg-red-500')));
  await A.screenshot({ path: 'audit/screenshots/p3-room-open.png', fullPage: true }).catch(() => {});

  // ---------- Context B: a DIFFERENT account trades it to graduation ----------
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const B = await ctxB.newPage();
  const errorsB = [];
  B.on('pageerror', (e) => errorsB.push('PAGEERROR ' + e.message));

  await guestSignIn(B);
  // Headroom so a single buy can cross the 100-volume graduation threshold.
  await B.goto(WEB + '/portfolio', { waitUntil: 'networkidle' });
  await B.getByRole('button', { name: /Faucet \+\$100/ }).click();
  await waitBalance(B, 200);
  rec('P3 setup: trader topped up to $200', (await balanceNum(B)) === 200);

  // Open the creator's room and buy YES with a $100 stake (volume 0 -> 100).
  await B.goto(`${WEB}/room/${roomId}`, { waitUntil: 'networkidle' });
  await B.getByRole('button', { name: 'YES', exact: true }).first().waitFor({ timeout: 8000 });
  await B.getByRole('button', { name: 'YES', exact: true }).first().click();
  await B.locator('input[type="number"]').fill('100');
  await B.getByRole('button', { name: /^Confirm \$100$/ }).click();
  const tradeToast = await B.getByText(/Order confirmed: \$100 on YES/).waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
  rec('F-010 a different account traded the created market', tradeToast);

  // Confirm the market graduated (volume >= 100) via the room detail endpoint.
  const roomDetail = await apiFetch(B, `/api/rooms/${roomId}`);
  const mk = (roomDetail.json.markets || []).find((m) => m.question === Q_A);
  rec('T5 market graduates after >=100 volume', !!mk && mk.graduated === true, mk ? `volume=${mk.volume} graduated=${mk.graduated}` : 'missing');

  // ---------- Back to creator A: resolve, then claim the fee share ----------
  await A.goto(`${WEB}/creator/${roomId}`, { waitUntil: 'networkidle' });
  await A.getByRole('button', { name: 'Resolve', exact: true }).click();
  const resolvedMsg = await A.getByText(/Resolved yes/).waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
  rec('T5 creator resolves the market via the UI', resolvedMsg);

  const balBeforeClaim = await balanceNum(A);
  await A.goto(WEB + '/portfolio', { waitUntil: 'networkidle' });
  await A.getByRole('heading', { name: 'Portfolio' }).waitFor({ timeout: 6000 });
  const claimBtn = A.getByRole('button', { name: /Claim fees/ });
  const hasClaim = await claimBtn.count();
  rec('T5 Portfolio exposes Claim fees once graduated + resolved', hasClaim >= 1, `buttons=${hasClaim}`);
  if (hasClaim >= 1) await claimBtn.first().click();
  const feeClaimToast = await A.getByText(/Creator fees claimed: \+\$/).waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
  rec('T5 creator fee share claim succeeds with toast', feeClaimToast);
  await A.waitForTimeout(500);
  const balAfterClaim = await balanceNum(A);
  rec('T5 creator fee share increases the balance', balAfterClaim > balBeforeClaim, `${balBeforeClaim} -> ${balAfterClaim}`);
  const ledgerA2 = await apiFetch(A, '/api/ledger?limit=20');
  rec('T5 creator_fee_claim appears in the ledger', ledgerA2.json.items.some((i) => i.kind === 'creator_fee_claim'));

  rec('Context A produced 0 uncaught page errors', errorsA.length === 0, `errors=${errorsA.length}`);
  rec('Context B produced 0 uncaught page errors', errorsB.length === 0, `errors=${errorsB.length}`);

  // ---------- F-015 favicon: assert the asset actually resolves ----------
  // Headless Chromium does not reliably auto-request favicons, so fetch it
  // directly and require a real 200 (previously /favicon.ico 404'd).
  const fav = await A.request.get(`${WEB}/favicon.svg`);
  const favBody = await fav.text();
  rec(
    'F-015 favicon (svg) resolves 200 with svg body',
    fav.status() === 200 && /<svg/i.test(favBody),
    `status=${fav.status()} bytes=${favBody.length}`,
  );

  await ctxA.close();
  await ctxB.close();
  await browser.close();

  console.log(`\n# PHASE-3 BROWSER TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('PHASE-3 BROWSER E2E crashed:', e);
  process.exit(2);
});
