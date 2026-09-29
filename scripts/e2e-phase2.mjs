// Phase-2 checkpoint browser E2E (Playwright, headless Chromium) — dev-only.
// Drives the REAL web UI against the REAL API (sim + in-memory PGlite) to prove
// F-004 (email register/login/upgrade), F-005 (bell >=3 kinds), T2 (live header
// balance) and F-006 (transaction history). Requires the audit API server on :4000
// and `vite dev` on :5173. Never part of runtime, never touches the test suite.
import { chromium } from 'playwright';

const WEB = 'http://localhost:5173';
const API = 'http://localhost:4000';
const PW = 'phase2secret';

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
// The header reads from BalanceContext, which fetches asynchronously on login /
// refresh. Wait until it settles on the expected value so we assert the LIVE number.
const waitBalance = (page, expected) =>
  page
    .waitForFunction(
      (want) => {
        const el = globalThis.document.querySelector('[data-testid="header-balance"]');
        return el && el.textContent.replace(/[^0-9.]/g, '') === want;
      },
      expected.toFixed(2),
      { timeout: 8000 },
    )
    .then(() => true)
    .catch(() => false);

async function main() {
  const browser = await chromium.launch({ headless: true });

  // ================= Context A: guest -> faucet -> upgrade -> bell -> logout -> re-login =========
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const A = await ctxA.newPage();
  const appErrorsA = [];
  A.on('pageerror', (e) => appErrorsA.push('PAGEERROR ' + e.message));
  const emailA = `guestA-${Date.now()}@example.com`;

  await A.goto(WEB + '/', { waitUntil: 'networkidle' });
  await A.locator('nav').getByRole('button', { name: 'Continue as guest' }).click();
  await A.waitForURL('**/portfolio', { timeout: 8000 });
  const guestToast = await A.getByText(/Signed in as demo wallet/).count();
  rec('F-004 guest sign-in toast', guestToast >= 1, `matches=${guestToast}`);

  await waitBalance(A, 100);
  const balStart = await balanceNum(A);
  rec('T2 header balance present + correct after guest (=$100)', balStart === 100, `header=${balStart}`);

  // Faucet -> balance should update LIVE in the header (T2, one source of truth).
  await A.getByRole('button', { name: /Faucet \+\$100/ }).click();
  const faucetToast = await A.getByText(/Faucet: \+\$100 added/).waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
  rec('F-005 faucet success toast', faucetToast);
  await waitBalance(A, 200);
  const balAfterFaucet = await balanceNum(A);
  rec('T2 header balance updates live after faucet (=$200)', balAfterFaucet === 200, `header=${balAfterFaucet}`);

  // Upgrade guest -> attaches email (kind email) and fires account_upgraded notification.
  await A.getByPlaceholder('Email').fill(emailA);
  await A.getByPlaceholder('Password (min 8)').fill(PW);
  await A.getByRole('button', { name: 'Upgrade', exact: true }).click();
  const upToast = await A.getByText(/Account upgraded/).waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
  rec('F-004 guest upgrade toast', upToast);
  // Upgrade form disappears once kind flips to email (proof the account upgraded).
  await A.waitForTimeout(600);
  const upgradeFormGone = (await A.getByRole('button', { name: 'Upgrade', exact: true }).count()) === 0;
  rec('F-004 upgrade removes the guest upgrade form', upgradeFormGone);

  // Bell: >=3 distinct kinds (welcome, faucet, account_upgraded) for this user.
  const notif = await A.evaluate(async (api) => {
    const tok = globalThis.sessionStorage.getItem('liveedge_token');
    const r = await fetch(`${api}/api/notifications`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, API);
  const kinds = new Set(notif.items.map((i) => i.kind));
  rec('F-005 bell has >=3 distinct notification kinds', kinds.size >= 3, `kinds=${[...kinds].join(',')}`);
  const badge = await A.getByTestId('notification-count').count();
  rec('F-005 unread badge rendered', badge >= 1, `badge-count=${badge}`);
  await A.getByTestId('notification-bell').click();
  await A.getByTestId('notification-panel').waitFor({ timeout: 4000 });
  // Each row has one timestamp <p> reading "just now" or "… ago".
  const panelRows = await A.getByTestId('notification-panel').getByText(/(just now|ago)/).count();
  rec('F-005 bell dropdown lists notifications', panelRows >= 3, `rows=${panelRows}`);

  // F-006 transaction history visible and includes the faucet + welcome mints.
  await A.getByRole('heading', { name: 'Transaction history' }).waitFor({ timeout: 4000 });
  const ledgerLabels = await A.evaluate(async (api) => {
    const tok = globalThis.sessionStorage.getItem('liveedge_token');
    const r = await fetch(`${api}/api/ledger?limit=20`, { headers: { Authorization: `Bearer ${tok}` } });
    return (await r.json()).items.map((i) => i.kind);
  }, API);
  rec('F-006 ledger shows faucet + welcome', ledgerLabels.includes('faucet') && ledgerLabels.includes('welcome'), `kinds=${ledgerLabels.join(',')}`);

  // Logout.
  await A.locator('nav').getByRole('button', { name: 'Sign out' }).click();
  await A.waitForTimeout(500);
  const signedOut = (await A.locator('nav').getByRole('link', { name: 'Sign in' }).count()) >= 1;
  rec('F-004 logout clears the session (Sign in shown)', signedOut);

  // Re-login with email/password (works without the wallet — proves email auth).
  await A.goto(WEB + '/signin', { waitUntil: 'networkidle' });
  await A.getByRole('button', { name: 'Log in', exact: true }).click(); // switch to login tab
  await A.getByPlaceholder('Email').fill(emailA);
  await A.getByPlaceholder('Password').fill(PW);
  await A.keyboard.press('Enter');
  await A.waitForURL('**/portfolio', { timeout: 8000 });
  await waitBalance(A, 200);
  const balRelogin = await balanceNum(A);
  rec('F-004 re-login restores the SAME account + balance (=$200)', balRelogin === 200, `header=${balRelogin}`);
  const reloginToast = await A.getByText(/Welcome back/).count();
  rec('F-004 re-login welcome-back toast', reloginToast >= 1);

  rec('Context A produced 0 uncaught page errors', appErrorsA.length === 0, `errors=${appErrorsA.length}`);
  await ctxA.close();

  // ================= Context B: brand-new email register =====================================
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const B = await ctxB.newPage();
  const appErrorsB = [];
  B.on('pageerror', (e) => appErrorsB.push('PAGEERROR ' + e.message));
  const emailB = `registerB-${Date.now()}@example.com`;

  await B.goto(WEB + '/signin', { waitUntil: 'networkidle' });
  await B.getByPlaceholder('Email').fill(emailB);
  await B.getByPlaceholder(/Password \(min 8/).fill(PW);
  await B.keyboard.press('Enter'); // submit the "Create account" form
  await B.waitForURL('**/portfolio', { timeout: 8000 });
  const regToast = await B.getByText(/Account created/).waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
  rec('F-004 register creates account + toast', regToast);
  await waitBalance(B, 100);
  const balB = await balanceNum(B);
  rec('T2 header balance for new email account (=$100)', balB === 100, `header=${balB}`);
  const notifB = await B.evaluate(async (api) => {
    const tok = globalThis.sessionStorage.getItem('liveedge_token');
    const r = await fetch(`${api}/api/notifications`, { headers: { Authorization: `Bearer ${tok}` } });
    return r.json();
  }, API);
  rec('F-005 register fires a welcome notification', notifB.items.some((i) => i.kind === 'welcome'), `count=${notifB.items.length}`);
  rec('Context B produced 0 uncaught page errors', appErrorsB.length === 0, `errors=${appErrorsB.length}`);
  await ctxB.close();

  await browser.close();
  console.log(`\n# PHASE-2 BROWSER TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('PHASE-2 BROWSER E2E crashed:', e);
  process.exit(2);
});
