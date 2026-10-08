// Dev-only browser E2E for the Kick integration (feature/live-pins).
// Requires `pnpm dev` running (API :4000 + Vite :5173). Never part of runtime.
//
// Kick API creds are intentionally ABSENT in this run, so we stub the Kick-derived
// endpoints (GET /api/kick/live + a kick-backed room) via Playwright route
// interception and prove the REAL-UI behaviors deterministically:
//   1. The persistent rail lists a real "live on Kick" channel from /api/kick/live
//      (Kick exposes NO per-stream thumbnail, so it surfaces through the RAIL and
//      the /watch page — never a fabricated Discover thumbnail tile).
//   2. /watch/kick/<slug> mounts the OFFICIAL player.kick.com iframe with the
//      correct channel (KickVideo data-*) and an HONEST chat note that LINKS OUT
//      to kick.com (Kick has no chat-only embed — we never fake a chat box, §4).
//   3. A Kick-backed MARKET room shows the real video AND the working market panel
//      side by side (trading affordances present), with the Kick chat link-out card.
// The embed itself points at a real Kick URL; whether its remote content loads
// (needs public internet + a live channel) is reported separately and does NOT
// gate correctness of OUR integration.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const WEB = 'http://localhost:5173';
const _API = 'http://localhost:4000'; // documented base; assertions go through WEB pages
const SHOTS = 'audit/screenshots-kick';
mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const rec = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`); };

// Normalized LiveChannel rows exactly as /api/kick/live returns them (NO thumbnail).
const KICK_FEED = {
  enabled: true, source: 'kick', count: 2,
  items: [
    { id: 'kick:1', source: 'kick', channelSlug: 'amouranth', channelName: 'Amouranth', title: 'just chatting', category: 'IRL', viewerCount: 24187 },
    { id: 'kick:2', source: 'kick', channelSlug: 'xqc', channelName: 'xQc', title: 'reacting', category: 'Just Chatting', viewerCount: 3412 },
  ],
};

// A market-backed room bound to a real Kick channel.
const KICK_MARKET_ROOM_ID = 'kick-market-room-1';
const KICK_MARKET_ROOM = {
  id: KICK_MARKET_ROOM_ID,
  title: 'Amouranth — will the next sub goal hit?',
  video_url: null,
  kick_channel: 'amouranth',
  kickVerified: true,
  status: 'live',
  isSeed: false,
  owner: { displayName: 'StreamerSeed' },
  viewers: 3,
  markets: [{ id: 'm1', question: 'Will the next sub goal hit?', resolution_rule: 'YES if reached', sources_of_truth: ['x'], category: 'irl', image_url: null, yes_price: 0.5, no_price: 0.5, q_yes: 0, q_no: 0, volume: 0, status: 'open', outcome: null, graduated: false, creator_fees_accrued: 0, isSeed: false, end_time: null, resolution_time: null }],
  chat: [],
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Stub ONLY the Kick-derived endpoints; leave the rest of the real API alone.
  await page.route('**/api/kick/live*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(KICK_FEED) }));
  await page.route('**/api/rooms', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([KICK_MARKET_ROOM]) }));
  await page.route(`**/api/rooms/${KICK_MARKET_ROOM_ID}`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(KICK_MARKET_ROOM) }));

  // ---- 1. The rail lists a real Kick channel (thumbnail-free surfacing) ----
  await page.goto(WEB + '/', { waitUntil: 'domcontentloaded' });
  const rail = page.getByTestId('side-rail');
  const railOk = await rail.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  rec('Rail renders from the /api/kick/live feed', railOk);
  const kickLink = rail.locator('a[href="/watch/kick/amouranth"]');
  const kickLinkOk = await kickLink.first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  rec('Rail lists the Kick channel linked to /watch/kick/<slug>', kickLinkOk);
  if (kickLinkOk) {
    const text = await kickLink.first().innerText();
    rec('Rail entry is labeled REAL (live badge) with a viewer count', /live/i.test(text) && /watching/i.test(text), `text=${text.replace(/\s+/g, ' ').trim()}`);
  }
  await page.screenshot({ path: `${SHOTS}/01-rail-kick.png`, fullPage: true });

  // ---- 2. /watch/kick page: official player iframe + honest chat link-out ----
  await page.goto(`${WEB}/watch/kick/amouranth`, { waitUntil: 'domcontentloaded' });
  const video = page.getByTestId('kick-video-embed');
  const videoOk = await video.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  rec('Watch page mounts the Kick video embed', videoOk);
  const vChannel = await video.getAttribute('data-channel');
  rec('Video embed carries the correct channel', vChannel === 'amouranth', `channel=${vChannel}`);
  const playerSrc = await video.getAttribute('data-player-src');
  rec('Video player URL is the official player.kick.com iframe (no parent needed)',
    /^https:\/\/player\.kick\.com\/amouranth\?/.test(playerSrc || ''), `src=${playerSrc}`);
  const chatNote = page.getByTestId('chat-note');
  const noteOk = await chatNote.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  rec('Kick chat degrades to an HONEST note (no fake chat box, §4)', noteOk);
  if (noteOk) {
    const out = page.locator('a[href="https://kick.com/amouranth"]');
    rec('Chat note LINKS OUT to the real channel page on Kick', (await out.count()) >= 1);
  }
  await page.screenshot({ path: `${SHOTS}/02-watch-kick.png`, fullPage: true });

  // ---- 3. Kick-backed MARKET room: video + market together ----
  await page.goto(`${WEB}/room/${KICK_MARKET_ROOM_ID}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('kick-video-embed').waitFor({ state: 'attached', timeout: 8000 }).catch(() => {});
  const mVideo = await page.getByTestId('kick-video-embed').count();
  const mChatLink = await page.getByTestId('kick-chat-linkout').count();
  const yesBtn = await page.getByRole('button', { name: 'YES', exact: true }).count();
  rec('Market room shows the real Kick video embed', mVideo >= 1, `videos=${mVideo}`);
  rec('Market room shows the Kick chat link-out card (not a fake frame)', mChatLink >= 1, `chatlinks=${mChatLink}`);
  rec('Market panel still renders beside the stream (tradeable market present)', yesBtn >= 1, `yes-buttons=${yesBtn}`);
  await page.screenshot({ path: `${SHOTS}/03-market-room-desktop.png`, fullPage: true });

  // ---- 4. Mobile layout ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${WEB}/room/${KICK_MARKET_ROOM_ID}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Chat' }).first().waitFor({ state: 'attached', timeout: 8000 }).catch(() => {});
  const hasToggle = await page.getByRole('button', { name: 'Chat' }).count();
  rec('Mobile shows the Chat/Market toggle (no permanent sidebar overlap)', hasToggle >= 1, `toggle=${hasToggle}`);
  await page.screenshot({ path: `${SHOTS}/04-market-room-mobile.png`, fullPage: true });

  await browser.close();
  console.log(`\n# KICK BROWSER TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('KICK BROWSER E2E crashed:', e); process.exit(2); });
