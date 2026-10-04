// Dev-only browser E2E for the Twitch integration (feature/twitch-live-integration).
// Requires `pnpm dev` running (API :4000 + Vite :5173). Never part of runtime.
//
// Twitch API creds are intentionally ABSENT in this run, so per the feature spec
// (§Phase C/E "mock the actual Twitch response if no real credentials") we stub
// GET /api/twitch/live and the room detail via Playwright route interception to
// prove the REAL-UI behaviors deterministically:
//   1. Discover renders a clearly-labeled "Live on Twitch" grid from the feed.
//   2. A browsed channel room mounts the real video + chat embeds with the correct
//      channel/parent params (TwitchVideo data-* + TwitchChat iframe src).
//   3. A Twitch-backed MARKET room shows video + chat AND the working market panel
//      side by side (trading affordances present).
// The embeds themselves point at real Twitch URLs; whether their remote content
// loads (needs public internet + a live channel) is reported separately and does
// NOT gate correctness of OUR integration.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const WEB = 'http://localhost:5173';
const _API = 'http://localhost:4000'; // documented base; assertions go through WEB pages
const SHOTS = 'audit/screenshots-twitch';
mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const rec = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`); };

const TWITCH_FEED = {
  enabled: true, source: 'twitch', count: 2,
  items: [
    { id: 's1', userLogin: 'lofigirl', userName: 'Lofi Girl', title: 'lofi hip hop radio 📚 beats to relax/study to', gameName: 'Music', viewerCount: 24187, startedAt: '2026-09-30T00:00:00Z', thumbnailUrl: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_lofigirl-320x180.jpg' },
    { id: 's2', userLogin: 'monstercat', userName: 'Monstercat', title: '🔵 Electronic Music Live 24/7', gameName: 'Music', viewerCount: 3412, startedAt: '2026-09-30T00:00:00Z', thumbnailUrl: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_monstercat-320x180.jpg' },
  ],
};

// A market-backed room bound to a real channel.
const TWITCH_MARKET_ROOM_ID = 'twitch-market-room-1';
const TWITCH_MARKET_ROOM = {
  id: TWITCH_MARKET_ROOM_ID,
  title: 'Lofi Girl — will the next track be instrumental?',
  video_url: null,
  twitch_channel: 'lofigirl',
  status: 'live',
  isSeed: false,
  owner: { displayName: 'StreamerSeed' },
  viewers: 3,
  markets: [{ id: 'm1', question: 'Will the next track be instrumental?', resolution_rule: 'YES if instrumental', sources_of_truth: ['x'], category: 'music', image_url: null, yes_price: 0.5, no_price: 0.5, q_yes: 0, q_no: 0, volume: 0, status: 'open', outcome: null, graduated: false, creator_fees_accrued: 0, isSeed: false, end_time: null, resolution_time: null }],
  chat: [],
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Stub ONLY the Twitch-derived endpoints; leave the rest of the real API alone.
  await page.route(`**/api/twitch/live*`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TWITCH_FEED) }));
  await page.route(`**/api/rooms`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([TWITCH_MARKET_ROOM]) }));
  await page.route(`**/api/rooms/${TWITCH_MARKET_ROOM_ID}`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TWITCH_MARKET_ROOM) }));

  // ---- 1. Discover "Live on Twitch" grid ----
  await page.goto(WEB + '/', { waitUntil: 'domcontentloaded' });
  const section = page.getByTestId('twitch-live-section');
  const sectionOk = await section.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  rec('Discover renders the "Live on Twitch" section from the feed', sectionOk);
  const cardCount = await page.getByTestId('twitch-live-card').count();
  rec('Discover shows Twitch live cards (fixture=2)', cardCount === 2, `cards=${cardCount}`);
  const realBadge = await section.getByText('real', { exact: false }).count();
  rec('Twitch section is clearly labeled as REAL (distinct from simulated rooms)', realBadge >= 1);
  const viewersOverlay = await section.getByText(/viewers/).count();
  rec('Cards overlay real viewer counts', viewersOverlay >= 1, `overlays=${viewersOverlay}`);
  await page.screenshot({ path: `${SHOTS}/01-discover-twitch.png`, fullPage: true });

  // ---- 2. Browsed channel room: real video + chat embeds with correct params ----
  await page.goto(`${WEB}/twitch/lofigirl`, { waitUntil: 'domcontentloaded' });
  const video = page.getByTestId('twitch-video-embed');
  const videoOk = await video.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  rec('Channel room mounts the Twitch video embed', videoOk);
  const vChannel = await video.getAttribute('data-channel');
  const vParent = await video.getAttribute('data-parent');
  rec('Video embed carries correct channel', vChannel === 'lofigirl', `channel=${vChannel}`);
  rec('Video embed carries a non-empty parent (env/hostname-driven)', Boolean(vParent), `parent=${vParent}`);
  const playerSrc = await video.getAttribute('data-player-src');
  rec('Video player URL includes channel+parent params', /channel=lofigirl/.test(playerSrc || '') && /parent=/.test(playerSrc || ''), `src=${playerSrc}`);
  const chatFrame = page.locator('iframe[src*="/embed/lofigirl/chat"]');
  const chatOk = await chatFrame.waitFor({ state: 'attached', timeout: 8000 }).then(() => true).catch(() => false);
  rec('Chat iframe mounts with the documented embed URL', chatOk);
  if (chatOk) {
    const chatSrc = await chatFrame.first().getAttribute('src');
    rec('Chat iframe src carries channel+parent', /\/embed\/lofigirl\/chat\?parent=/.test(chatSrc || ''), `src=${chatSrc}`);
  }
  await page.screenshot({ path: `${SHOTS}/02-twitch-room.png`, fullPage: true });

  // ---- 3. Twitch-backed MARKET room: video + chat + working market together ----
  await page.goto(`${WEB}/room/${TWITCH_MARKET_ROOM_ID}`, { waitUntil: 'domcontentloaded' });
  // Video, chat and the market commit in the SAME render once the (stubbed) room
  // fetch resolves. Wait for the branch to mount before sampling so this isn't a
  // race against first paint — the assertion itself (>=1) is unchanged.
  await page.getByTestId('twitch-video-embed').waitFor({ state: 'attached', timeout: 8000 }).catch(() => {});
  const mVideo = await page.getByTestId('twitch-video-embed').count();
  const mChat = await page.locator('iframe[src*="/embed/lofigirl/chat"]').count();
  const yesBtn = await page.getByRole('button', { name: 'YES', exact: true }).count();
  rec('Market room shows real video embed', mVideo >= 1, `videos=${mVideo}`);
  rec('Market room shows real chat embed', mChat >= 1, `chats=${mChat}`);
  rec('Market panel still renders beside the stream (tradeable market present)', yesBtn >= 1, `yes-buttons=${yesBtn}`);
  await page.screenshot({ path: `${SHOTS}/03-market-room-desktop.png`, fullPage: true });

  // ---- 4. Mobile layout ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${WEB}/room/${TWITCH_MARKET_ROOM_ID}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Chat' }).first().waitFor({ state: 'attached', timeout: 8000 }).catch(() => {});
  const hasToggle = await page.getByRole('button', { name: 'Chat' }).count();
  rec('Mobile shows the Chat/Market toggle (no permanent sidebar overlap)', hasToggle >= 1, `toggle=${hasToggle}`);
  await page.screenshot({ path: `${SHOTS}/04-market-room-mobile.png`, fullPage: true });

  await browser.close();
  console.log(`\n# TWITCH BROWSER TOTAL ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('TWITCH BROWSER E2E crashed:', e); process.exit(2); });
