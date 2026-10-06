// ---------------------------------------------------------------------------
// Terms copy — the FROZEN product text from docs/TERMS_DRAFT.md. Kept as data
// (pure module, no React) so both the cover-flow Step 3 and the /legal page
// render the SAME words, and tests can pin the exact mandatory copy.
// If the lead revises TERMS_DRAFT.md, this file is the only place to sync.
// ---------------------------------------------------------------------------

// Version string the client sends to POST /api/me/setup (plan §4 contract).
export const TERMS_VERSION = '2026-10-draft-1';

// TERMS_DRAFT.md Part 3 — the ONE paragraph users actually see. The old
// "before your $100 lands" opener was retired with the $100 ceremony (owner
// decision, Oct 2026): the paragraph stays honest about the play-money
// economy without promising a specific number — Portfolio shows the real one.
export const TERMS_SUMMARY_PARAGRAPH =
  'LiveEdge is a play-money prediction app: your balance and everything you ' +
  '"win" are fake money with no cash value — never redeemable, never ' +
  'purchasable, and nothing real is ever at risk. You must be 18+; markets ' +
  '(some written by AI) resolve by the rules shown on them, live video and ' +
  'scores come from third parties who may glitch or disappear, and you\u2019re ' +
  'responsible for keeping your login safe and your conduct decent. That\u2019s ' +
  'genuinely it — the full legal version is linked below.';

// The consent checkbox label (plan §7 decision 1 + 4: 18+, agree-to-terms).
export const TERMS_CHECKBOX_LABEL = "I'm 18 or older and I agree to the Terms & Conditions.";

// The mandatory play-money line (spec "Honesty" law). FUNDED_LINE was removed
// with the $100 congrats ceremony (Oct 2026) — do not re-add a number promise.
export const PLAY_MONEY_LINE = 'Play money for predictions. Not real money.';

// /legal page — TERMS_DRAFT.md Part 2, full text (DRAFT; attorney review
// pending per Part 4). Sections: { n, title, body }.
export const TERMS_SECTIONS = [
  {
    n: '1. What LiveEdge is — and what it firmly is not',
    body: 'LiveEdge is a place to watch live streams and sports with friends and bet fake money on what happens next. You get $100 in play money ("Sim USD") when you join, and a faucet hands out more whenever you run out. That is the whole economy. Sim USD is a number in our database: it has no cash value, it cannot be bought, sold, withdrawn, transferred, or exchanged for anything real, and nothing you win is ever redeemable. LiveEdge is not a gambling site, not a sportsbook, not an exchange, and not an investment product. If any screen ever makes it feel like real money, that\u2019s a bug in our copy — tell us.',
  },
  {
    n: '2. Who can use it',
    body: 'You must be at least 18 years old. We ask you to confirm this honestly; we do not verify your age with documents. By using LiveEdge you also confirm that using an app like this is legal where you live. If the laws where you are put live prediction games (even free ones) in a grey area, please don\u2019t use LiveEdge — the internet is big and we genuinely mean it when we say nothing here is worth anything.',
  },
  {
    n: '3. Accounts, logins, and the little wallet we all pretend you don\u2019t have to think about',
    body: 'Accounts are created when you sign in through Privy with your email (one-time code) or Google. Privy automatically creates an embedded Solana wallet for you; LiveEdge uses its public address as your account identity and as the key that "signs" your bets so the record is tamper-proof. You never need to write down a seed phrase for LiveEdge to work, and the wallet in this app holds nothing of value. Your Privy login and wallet recovery are governed by Privy\u2019s terms — keep your email and Google account secure; you\u2019re responsible for activity on your login.',
  },
  {
    n: '4. Predictions, markets, and how things resolve',
    body: 'Other users, and an AI engine that is labeled as AI, write the market questions you bet on. Live data (scores, streams, news feeds) comes from third parties and can be late, wrong, or missing. When a market is ambiguous, broken, cancelled, or built on a feed that glitched, we resolve or void it using the rules shown on that market — final resolution calls are ours, made in good faith, and we show the resolution basis on the market. Simulated winnings and losses mean exactly that: numbers moving in your play-money balance. There is no house, no rake you pay in real value, and no payouts in real value. Ever.',
  },
  {
    n: '5. Your content and how you must behave',
    body: 'Chat messages, room names, display names, and any streams you broadcast stay yours — you grant us a licence to display them inside LiveEdge. Don\u2019t use the app to harass, hate, spam, share illegal content, scrape our data, bot the faucet, try to fake results, or do anything that breaks the platform rules of the video services we embed. We moderate and we remove, and we can act on accounts without a right of appeal in hard cases — protecting real users beats a fake-money leaderboard position, always.',
  },
  {
    n: '6. Third parties, briefly named',
    body: 'The video you watch comes from YouTube, Twitch, Kick, or Livepeer; match data from API-Football; log-in and embedded wallets from Privy; market generation from Google Gemini. Each has its own terms, and they apply to their slices of your experience. Streams can disappear at any moment — embeds are up to the platform, not us. Interruptions are not a refund of anything, because there\u2019s nothing to refund.',
  },
  {
    n: '7. Privacy snapshot',
    body: 'We store: your wallet public address, display name, email (via Privy), your interest selections, pins, bets, chat messages, and notification history. Your session token lives only in your browser tab. We don\u2019t sell your data. A dedicated Privacy notice is in progress; until it ships, email us to delete your account and data and we\u2019ll do it by hand.',
  },
  {
    n: '8. Intellectual property',
    body: 'The LiveEdge name, design, and code are ours. Third-party footage/logos belong to their owners — we embed, we don\u2019t own. Your content is yours (see §5). AI-generated market text is labeled as AI-generated.',
  },
  {
    n: '9. Disclaimers',
    body: 'LiveEdge is provided "as is", currently as a hackathon-stage product. No guarantee of availability, accuracy of live data, fairness of any market, or that the AI never writes a weird question. Nothing here is financial, legal, or betting advice.',
  },
  {
    n: '10. Limitation of liability',
    body: 'To the maximum extent the law allows: because nothing in LiveEdge has monetary value, our total responsibility for any claim is limited to, practically, saying sorry and fixing the bug. You can\u2019t "lose" anything of real value here — if you somehow do, that\u2019s on whatever third party actually took your money, not LiveEdge (which takes none).',
  },
  {
    n: '11. Termination',
    body: 'We can suspend or terminate accounts that abuse §5 (harassment, cheating, scraping, faucet farming, illegal use). Termination of a sim account deletes sim balances — which, again, are worth nothing.',
  },
  {
    n: '12. Disputes and governing law',
    body: 'Not yet set: this draft intentionally leaves the jurisdiction clause out pending legal review.',
  },
  {
    n: '13. Changes to these terms',
    body: 'When terms change, we\u2019ll version them (you accepted "2026-10-draft-1") and notify you in-app via the notification bell. Continued use after notification means acceptance; if you don\u2019t agree, ask for account deletion instead.',
  },
  {
    n: '14. Contact',
    body: 'Support contact and legal entity: to be published before general availability.',
  },
];
