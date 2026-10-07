// Dev-only browser E2E (Playwright, headless Chromium). Drives the REAL web UI
// against the REAL API and captures a screenshot at every step plus console
// errors and failed requests. Requires the stack on :4000 (API) and :5173 (vite)
// — `pnpm dev`, or `node scripts/audit-api-server.mjs` + `pnpm --dir web dev`.
// Never part of runtime, never part of `pnpm test`.
//
// CONTRACT (docs/PRIVY_AUTH_SPEC.md Amendments 2-3, docs/ONBOARDING_PLAN.md §2-§4,
// as shipped by Agent C + the lead's fixes):
//   * no guest mode: a logged-out visitor browses, and the word "guest" never
//     appears in the UI;
//   * an account whose server setup_completed is false is TAKEN OVER by the
//     full-screen /welcome cover, starting at the REQUIRED username step with an
//     EMPTY field (the server's wallet-derived placeholder must not count as a
//     chosen name, and must never be pre-filled);
//   * terms are LAST and the CTA stays disabled until the 18+/agree box is ticked;
//   * success lands on the one congrats screen that counts up to $100.00 with
//     mandatory play-money wording, and the header chip mirrors it and then shows
//     the REAL balance;
//   * a finished account arriving at /welcome by reload/bookmark/back is handed
//     back to the app instead of being re-onboarded;
//   * bet submission renders an HONEST disabled state until the lead's signing
//     spike flips EMBEDDED_SIGNING_VERIFIED (web/src/lib/privy.js).
//
// Sessions are bootstrapped over the legacy wallet API (/api/auth/nonce +
// /verify) and injected into sessionStorage, because Privy's email-OTP modal
// cannot be completed headlessly. That is the same our-JWT the app hydrates from
// after a real Privy exchange, so the UI path under test is unchanged.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const WEB = process.env.E2E_WEB || 'http://localhost:5173';
const API = process.env.E2E_API || 'http://localhost:4000';
const HANDLE = `e2e_${Date.now().toString(36).slice(-6)}`; // <=20 chars, regex-safe
const SHOTS = 'audit/screenshots-live';
mkdirSync(SHOTS, { recursive: true });

let pass = 0;
let fail = 0;
const consoleErrors = [];
const failedRequests = [];
// Static-asset noise (a missing favicon) is not a React runtime error; keep the
// "0 console errors" gate about app health.
const isAppError = (e) => !/Failed to load resource|favicon|DevTools/i.test(e);
function rec(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
}

// ---- legacy wallet session bootstrap (API side) ---------------------------
async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function mintSession() {
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const sign = (msg) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey));
  const n = await api('/api/auth/nonce', { method: 'POST', body: { wallet } });
  if (n.status !== 200 || !n.json.message) throw new Error(`nonce failed: ${n.status} ${JSON.stringify(n.json)}`);
  const v = await api('/api/auth/verify', { method: 'POST', body: { wallet, signature: sign(n.json.message) } });
  if (v.status !== 200 || !v.json.token) throw new Error(`verify failed: ${v.status} ${JSON.stringify(v.json)}`);
  return { token: v.json.token, wallet, userId: v.json.user?.id };
}

async function preflight() {
  const health = await api('/health').catch(() => null);
  if (!health || health.status !== 200) throw new Error(`API not answering on ${API} — start the stack (pnpm dev).`);
  const web = await fetch(WEB).catch(() => null);
  if (!web || web.status >= 500) throw new Error(`vite not answering on ${WEB} — start the stack (pnpm dev).`);
}

async function pickRoom() {
  const { json } = await api('/api/rooms');
  const list = Array.isArray(json) ? json : [];
  const open = list.find((r) => r.heroMarket && r.heroMarket.status === 'open') || list[0];
  return open ? open.id : '';
}

const STEP_LABEL = '[data-testid="step-indicator"]:visible, [data-testid="step-indicator-desktop"]:visible';
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }).catch(() => {});
// Pages here hold an open EventSource (/api/stream/<room>), so "networkidle"
// NEVER settles — and upstream provider calls can take seconds. Load on
// domcontentloaded and wait for the specific hook each checkpoint needs instead.
async function settle(page, selector, timeout = 20000) {
  await page.waitForSelector(selector, { timeout }).catch(() => {});
}
const RAIL = '[data-testid="rail-live"], [data-testid="livenow-empty"], [data-testid="livenow-collapse"]';

async function main() {
  await preflight();
  const session = await mintSession();
  const me0 = await api('/api/auth/me', { token: session.token });
  console.log(`session minted: user=${session.userId} setup_completed=${me0.json.user?.setup_completed} display_name=${JSON.stringify(me0.json.user?.display_name)}`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(`HTTP ${r.status()} ${r.url()}`); });

  // ---- 1. logged-out browsing, with no trace of guest mode ----------------
  await page.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' });
  await settle(page, RAIL);
  rec('logged-out visitor is NOT taken over by /welcome', !page.url().includes('/welcome'), page.url());
  const guestText = await page.evaluate(() => (/guest/i.test(document.body.innerText) ? 'FOUND' : '')).catch(() => 'ERR');
  rec('no "guest" wording in the logged-out UI (Amendment 2)', guestText === '', `match=${guestText}`);
  // The feed is asserted by its testids, not by heading text: the rail renders one
  // of three HONEST states (real cards / empty / streams-failed collapse) and every
  // one of them is a valid page, so the gate is "a rail exists and says what it is".
  const rail = await page.getByTestId('rail-live').count();
  const grid = await page.getByTestId('livenow-grid').count();
  const empty = await page.getByTestId('livenow-empty').count();
  const collapsed = await page.getByTestId('livenow-collapse').count();
  rec('Discover renders the "Live now" rail', rail === 1, `rails=${rail}`);
  rec('the rail shows real cards or an honest no-data state', grid + empty + collapsed >= 1, `grid=${grid} empty=${empty} collapse=${collapsed}`);
  await shot(page, '01-logged-out-discover');

  // ---- 2. the takeover: session whose setup is incomplete ------------------
  await page.addInitScript((tok) => window.sessionStorage.setItem('liveedge_token', tok), session.token);
  await page.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/welcome', { timeout: 15000 }).catch(() => {});
  rec('unfinished account is taken over by the /welcome cover', page.url().includes('/welcome'), page.url());

  // Step 1 is REQUIRED: the server-stored wallet placeholder must NOT be treated
  // as a chosen username, and must NOT pre-fill the field. (The label is rendered
  // twice in the DOM — mobile strip + desktop rail — so only the VISIBLE one
  // counts; asserting on both would be a false failure.)
  await page.getByTestId('welcome-username').waitFor({ timeout: 8000 });
  const label = await page.locator(STEP_LABEL).first().innerText().catch(() => '');
  const prefill = await page.getByTestId('welcome-username').inputValue();
  rec('resume starts at the REQUIRED username step', /Step 1 of 3/.test(label), `label=${JSON.stringify(label)}`);
  rec('username field is empty (placeholder not pre-filled)', prefill === '', `value=${JSON.stringify(prefill)}`);
  await shot(page, '02-step1-username');

  // ---- 3. inline validation before the required field is valid ------------
  await page.getByTestId('welcome-username').fill('a b');
  await page.getByTestId('welcome-username').blur();
  const errVisible = await page.getByTestId('username-error').count();
  const ctaDisabled = await page.getByTestId('welcome-continue-1').isDisabled().catch(() => false);
  rec('invalid username shows the inline error', errVisible === 1);
  rec('Continue stays disabled while the username is invalid', ctaDisabled === true);
  await page.getByTestId('welcome-username').fill(HANDLE);
  await page.getByTestId('welcome-continue-1').click();

  // ---- 4. interests (step 2) ----------------------------------------------
  await page.getByTestId('welcome-continue-2').waitFor({ timeout: 6000 });
  const chip = page.getByTestId('interest-trading');
  await chip.first().click();
  const pressed = await chip.first().getAttribute('aria-pressed');
  rec('interest chip reports its selected state', pressed === 'true', `aria-pressed=${pressed}`);
  await shot(page, '03-step2-interests');
  await page.getByTestId('welcome-continue-2').click();

  // ---- 5. terms LAST, CTA gated by the checkbox ---------------------------
  await page.getByTestId('welcome-terms-checkbox').waitFor({ timeout: 6000 });
  const createDisabledBefore = await page.getByTestId('welcome-create').isDisabled().catch(() => true);
  rec('"Create my account" is disabled before the Terms are accepted', createDisabledBefore === true);
  const legal = await page.getByTestId('welcome-legal-link').count();
  rec('the Terms paragraph links to the full /legal text', legal === 1);
  await shot(page, '04-step3-terms-unticked');
  await page.getByTestId('welcome-terms-checkbox').check();
  await page.getByTestId('welcome-create').click();

  // ---- 6. the funded congrats moment --------------------------------------
  await page.getByTestId('welcome-congrats').waitFor({ timeout: 8000 });
  // rAF can be suspended in a headless/background tab: the contract is that the
  // promise LANDS on $100.00, not that every eased frame is observed.
  let frame = '';
  for (let i = 0; i < 12; i++) {
    frame = await page.getByTestId('congrats-countup').innerText().catch(() => '');
    if (frame.trim() === '$100.00') break;
    await page.waitForTimeout(400);
  }
  rec('count-up lands on the promised $100.00', frame.trim() === '$100.00', `final=${JSON.stringify(frame)}`);
  const body = await page.evaluate(() => document.body.innerText);
  rec('congrats states the funded amount in play money', /funded with \$100 in play money/i.test(body));
  rec('play-money wording is shown next to the amount', /not real money/i.test(body));
  await shot(page, '05-congrats');

  // ---- 7. into the app, and the header chip hands back to the real number --
  await page.getByTestId('first-prediction-cta').click();
  await settle(page, '[data-testid="header-balance"]', 8000);
  let chipText = '';
  for (let i = 0; i < 12; i++) {
    chipText = await page.getByTestId('header-balance').innerText().catch(() => '');
    if (/\$100\.00/.test(chipText)) break;
    await page.waitForTimeout(400);
  }
  rec('header chip settles on the real balance', /\$100\.00/.test(chipText), `chip=${JSON.stringify(chipText)}`);
  // The tuning note is a ONE-SHOT channel consumed by Discover's mount, so a
  // single snapshot can miss it. Poll and remember whether it EVER appeared —
  // that, not "is it on screen right now", is the contract under test.
  let tunedSeen = false;
  let tunedProbe = {};
  for (let i = 0; i < 20; i++) {
    tunedProbe = await page.evaluate(() => ({
      path: location.pathname,
      note: (document.querySelector('[data-testid="livenow-note"]') || {}).innerText || '',
      key: window.sessionStorage.getItem('liveedge_tuned_for') || '',
    }));
    if (tunedProbe.note && tunedProbe.note.includes(`Tuned for ${HANDLE}`)) { tunedSeen = true; break; }
    await page.waitForTimeout(250);
  }
  rec('one-shot "Tuned for <name>" note appears after the tuning', tunedSeen, `probe=${JSON.stringify(tunedProbe)}`);

  // ---- 8. a finished account must not be re-onboarded ----------------------
  await page.goto(`${WEB}/welcome`, { waitUntil: 'domcontentloaded' });
  await settle(page, RAIL, 8000);
  await page.waitForTimeout(1200);
  rec('a completed account reloading /welcome is handed back to the app', !page.url().includes('/welcome'), page.url());
  const stepsAgain = await page.locator(STEP_LABEL).count();
  rec('no congrats/re-onboarding flash for a finished account', stepsAgain === 0, `visible-step-labels=${stepsAgain}`);
  await shot(page, '06-back-to-app');

  // ---- 9. congrats and the tuning note never repeat ------------------------
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page, RAIL, 8000);
  await page.waitForTimeout(1200);
  const congratsAgain = await page.getByTestId('welcome-congrats').count();
  const tunedAgain = await page.evaluate(() => document.body.innerText.includes('Tuned for')).catch(() => false);
  rec('the funded congrats moment does not repeat on reload', congratsAgain === 0, `congrats=${congratsAgain}`);
  rec('the tuning note is consumed once', tunedAgain === false, `tuned-on-reload=${tunedAgain}`);

  // ---- 10. betting shows the honest, pre-launch state ----------------------
  const roomId = (await pickRoom()) || process.argv[2] || '';
  if (roomId) {
    // Desktop first: the sticky pill is md:hidden BY DESIGN (mobile thumb zone), so
    // the desktop path is the in-panel YES/NO buttons. Both go through the same
    // handleTrade login gate and the same honest signing-disabled sheet.
    await page.goto(`${WEB}/room/${roomId}`, { waitUntil: 'domcontentloaded' });
    await settle(page, '[data-testid="bet-pill"], [data-testid="in-room-create"]');
    const pillHiddenOnDesktop = await page.locator('[data-testid="bet-pill"]:visible').count();
    rec('the sticky bet pill stays mobile-only on a desktop viewport', pillHiddenOnDesktop === 0, `visible-pills=${pillHiddenOnDesktop}`);
    await page.getByRole('button', { name: 'YES', exact: true }).first().click().catch(() => {});
    const disabledNote = await page.getByTestId('bet-signing-disabled-note').count();
    const openNote = await page.getByTestId('bet-signing-open').count();
    const claimedSuccess = await page.getByText(/Order confirmed|Bet placed/i).count();
    rec('the trade sheet renders EXACTLY ONE signing state', disabledNote + openNote === 1, `disabled=${disabledNote} open=${openNote}`);
    rec('nothing pretends a bet was placed', claimedSuccess === 0, `fake-success=${claimedSuccess}`);
    if (disabledNote === 1) {
      const sheetText = await page.getByTestId('bet-signing-disabled-note').innerText();
      rec('the disabled state says signing is not yet available', /not yet available/i.test(sheetText), JSON.stringify(sheetText.split('\n')[0]));
    } else if (openNote === 1) {
      rec('signing reports OPEN — the spike has flipped EMBEDDED_SIGNING_VERIFIED', true, 'bet-signing-open present');
    } else {
      rec('NEITHER signing state rendered — the sheet did not open', false, 'check the bet entry points');
    }
    await shot(page, '07-bet-signing-state-desktop');

    // Mobile viewport: the pill is the entry point, and it must open the SAME sheet.
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mpage = await mctx.newPage();
    await mpage.addInitScript((tok) => window.sessionStorage.setItem('liveedge_token', tok), session.token);
    await mpage.goto(`${WEB}/room/${roomId}`, { waitUntil: 'domcontentloaded' });
    await settle(mpage, '[data-testid="bet-pill"]');
    await mpage.waitForTimeout(800);
    const pillVisible = await mpage.locator('[data-testid="bet-pill"]:visible').count();
    rec('the sticky bet pill is visible in the mobile thumb zone', pillVisible === 1, `visible-pills=${pillVisible}`);
    await mpage.getByTestId('bet-pill-yes').click().catch(() => {});
    const mDisabled = await mpage.getByTestId('bet-signing-disabled-note').count();
    const mOpen = await mpage.getByTestId('bet-signing-open').count();
    rec('the pill opens the same honest signing state (mobile)', mDisabled + mOpen === 1, `disabled=${mDisabled} open=${mOpen}`);
    const tabs = await mpage.locator('[data-testid^="tab-"]:visible').count();
    rec('4-tab mobile nav renders', tabs === 4, `visible-tabs=${tabs}`);
    await mpage.screenshot({ path: `${SHOTS}/08-mobile-room-betsheet.png`, fullPage: true }).catch(() => {});
    await mctx.close();
  } else {
    rec('room under test exists', false, 'no rooms returned from /api/rooms');
  }

  // ---- 11. server truth after the UI flow ----------------------------------
  const me1 = await api('/api/auth/me', { token: session.token });
  rec('server recorded the chosen username', me1.json.user?.display_name === HANDLE, `name=${me1.json.user?.display_name}`);
  rec('server marked setup complete', me1.json.user?.setup_completed === true, `setup_completed=${me1.json.user?.setup_completed}`);

  // ---- 12. clean console ---------------------------------------------------
  const appErrors = consoleErrors.filter(isAppError);
  rec('0 app console errors across the whole flow', appErrors.length === 0, `errors=${appErrors.slice(0, 3).join(' || ')}`);
  const api4xx = failedRequests.filter((r) => !/favicon|\.png|\.ico/i.test(r));
  rec('no failed API requests', api4xx.length === 0, `failed=${api4xx.slice(0, 3).join(' || ')}`);

  await browser.close();
  console.log(`\nE2E ${fail === 0 ? 'PASSED' : 'FAILED'} | pass=${pass} fail=${fail} | user=${HANDLE}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('E2E ERROR', e.message);
  process.exit(1);
});
