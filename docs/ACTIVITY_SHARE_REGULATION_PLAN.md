# ACTIVITY, SHARING & MARKET-CREATION REGULATION — research-backed proposal

**STATUS: PROPOSAL ONLY. Nothing in this file is implemented.** Owner brief captured
2026-10-06 from a voice note; global research run against live sources (cited inline).
Every number below that is not from our own code or DB is labelled as an industry claim,
not a fact about LiveEdge.

Owner's asks, as heard:

1. After I place a bet I want to **see what other people are placing** — like Polymarket
   shows who is buying Yes/No and who is withdrawing.
2. I want to **share an active bet / open position** with friends and family — preferably
   **SportyBet-style (a short code)**, not necessarily a long link.
3. I want a **protocol that regulates market creation** — control creators, stop fake
   markets, and handle the fact that some creators will have insider information without
   making it obvious.
4. I want to plan **how we charge in credits for "stocks" around betting**, where winning
   raises your price and losing drops it back to market, and users can create games.
5. Mentioned once, underspecified: banners / the description on the bounty, how users
   receive payment, and "share screen". → §7 asks the questions instead of guessing.

---

## 1. What the research says, and what it means for us

| Source | Finding | Our takeaway |
|---|---|---|
| Polymarket public-analytics docs (`docs.polymarket.com/market-data/public-analytics`) | They publish **Open Interest** as a first-class metric per market ("value currently held in outstanding positions"), queryable for up to 20 condition IDs at once. | Open interest is the headline number on a market card. We can compute it honestly from our own ledger — we already know every position. |
| Polymarket Data API / Bitquery examples | Positions are exposed **per wallet** (how many Yes/No shares a wallet holds) and there is a public **Wallet PnL** series. | "See what others hold" is not a special feature — it is the same ledger, aggregated and paginated. Our data shape supports it. |
| Polymarket real-time data docs | They run a **real-time feed** so activity appears as it happens. | We already have SSE (`/api/stream/<room>`). The tape should ride the channel we ship, not a poller. |
| `polymark.et/product/share` ("Share: social trading app for Polymarket") | A whole third-party app exists purely to **share positions publicly and follow wallets** — "see their trading activity". | Social layer over a prediction market is validated demand, and it is a *thin* layer over the data — good news for effort. |
| SportyBet `Load Code` help page; LiveScore "Booking Codes Explained"; IbeBet bet-sharing guide | Booking/bet codes are an established African/European sharing ritual: **make selections → "Book bet" → get a code → friend types the code → their slip loads identically**. Referral promos are attached to it. | The code must encode the *whole bet* (markets + selections + stake) and must load into the other person's own slip — not just deep-link a page. |
| UMA Optimistic Oracle (blog.uma.xyz, crypto.news explainer, chainup.com) | Resolution is **propose → challenge window → dispute if challenged**, with capital at risk on both sides. The $60M "Strategy" dispute and whale-voting risk are documented failure modes. | We cannot run a crypto oracle, but we can copy the *shape*: a proposal period with a public challenge window before money moves. |
| Medium, "Prediction Markets Are Broken By Design" | Core criticism: **"anyone can create markets with vague rules"**, and quality control costs money and slows creation. | The fix is not moderation-by-staff; it is a **structured creation form that cannot express a vague market**. |
| WSJ (2026-06-20), Bloomberg (2026-06-04) | Polymarket was flooded with **deceptive videos by paid creators**, and markets on "social media clout" proved **gameable by bots**. | Two rules for us: no market whose outcome is a metric a creator can pump, and creator identity/holding must be visible. |
| RG.org on social casinos; Fliff; bets perts / Be The Book on social sportsbooks | The play-money industry standard is a **two-currency model**: purchased "Gold" (no value, entertainment) vs earned/"Sweeps" credits (redeemable), which is how they stay outside gambling law. | This is the closest legal template for §5. It is also the model critics attack. |
| pausebeforeyouplay.org (2024-07) | "Virtual Currency Sportsbooks are Priming Youth to Gamble": 18+ rating **with no age verification**, marketed to young users. | Our 18+ checkbox is self-attested and therefore weak. If we add monetised credits, this criticism lands on us directly. Flagged for owner, not decided here. |

---

## 2. Feature A — "See what people are placing" (activity & positions)

### 2.1 What we can honestly compute today

From the existing schema (`users`, `orders`, `claims`, ledger entries, LMSR state) we can
derive, per market: Yes/No shares by holder, total staked (open interest), realised and
unrealised P&L per user, and a chronological trade tape. **Nothing new needs to be faked
and nothing needs a third party.** Anything we cannot derive is out of scope for this
feature — no simulated whales, no invented viewer counts (project law).

### 2.2 Proposed surfaces

1. **Market card, always visible:** open interest, N holders, Yes/No split *by stake* and
   *by head count* (they differ and both matter — a 1-whale market looks different from a
   100-person market).
2. **Market → "Activity" tab:** a live tape — `<display name> bought Yes · 200 · 21:04`,
   with buy/sell/settle distinguished. Paginated, SSE-appended. Top holders list, showing
   display name + position size + entry price. **Never a wallet address** (privacy) and
   never an email.
3. **Global "Live bets" feed on Discover:** what is moving right now across markets,
   filterable by category. This is the Polymarket/"Share"-app hook that makes the app feel
   populated without inventing population.
4. **Leaderboard:** P&L, ROI %, hit rate, streak, markets created, and *how* each is
   computed shown on hover. ROI must be included alongside raw P&L or the board just
   rewards the biggest $100 start.
5. **Your own position history** (Portfolio already exists — extend, don't duplicate):
   entry price, current price, unrealised P&L, and "resolve in" time.

### 2.3 Server delta (small)

- `GET /api/markets/:id/activity?cursor=` (tape), `GET /api/markets/:id/holders`,
  `GET /api/leaderboard?window=7d|30d|all`.
- One index on `(market_id, created_at desc)` for orders and one on `(user_id, status)`.
- Aggregation cached per market with a short TTL; SSE pushes the individual event that
  invalidated it.
- **Invariant test required:** the sum of all holders' stakes must equal open interest, and
  open interest must reconcile with the ledger. If it can't, the feature doesn't ship.

---

## 3. Feature B — Sharing a bet / open position

### 3.1 Recommendation: ship the **code** and the **link**, same object

The owner's instinct (SportyBet code) and the Polymarket pattern (link) are not competing —
they solve different moments. A code is for **telling a friend in a WhatsApp chat**; a link
is for **posting somewhere**. One share sheet, two outputs, one underlying record.

### 3.2 The code

- **6 characters, not 5.** Owner asked for 5; the math argues against it: a 5-char code from
  a 32-symbol unambiguous alphabet is ~33M combinations, and a shareable code is
  *guessable-by-design* (people type random codes to see what they get). 6 chars ≈ 1B and
  we can additionally expire them. Flagged as a deviation from the brief on purpose.
- Alphabet excludes `0/O`, `1/I/L` so it survives being read out loud or typed from a
  screenshot.
- Encodes: market(s) + side + stake + odds snapshot + creator + expiry.
- `POST /api/share-codes` → returns the code; `GET /api/share-codes/:code` → returns the
  payload for the **"Load this bet"** screen, which shows exactly what will be staked at
  what price, then places it as *the visitor's own bet*. It must never silently place a bet.
- **Honesty constraints:** if the odds moved since the snapshot, the load screen says so and
  shows the new price before confirming; if the market already resolved, the code says
  "this bet is closed", never a dead end.
- Rate-limited and expiring (default 7 days), so codes don't leak value forever.

### 3.3 The link

- `GET /b/:code` — a **server-rendered** page (not the SPA) whose only job is the OG
  image + a button into the app. Without this, a shared link renders as a grey box in
  WhatsApp/X/Discord and the feature is dead on arrival.
- The card shows: question, your side, stake, current price, your P&L if open, and the
  mandatory **"play money — no cash value"** line (§5 of TERMS_DRAFT).
- Needs a decision: a dynamic-image dependency (satori/resvg-style, ~1 dep + a render
  endpoint) vs a static branded card. **Recommendation: dynamic**, because a position card
  with real numbers is the thing that gets shared. Flagged — it is the only new runtime
  dependency in this plan.
- Privacy default: sharing a position shows **display name + position**, never email/wallet;
  a user can share anonymously ("Someone's position").

### 3.4 Screen sharing — recommend NOT building it now

Owner mentioned "share screen". Real screen sharing is WebRTC + signalling + TURN
infrastructure, a large surface, and it is not what makes Polymarket shareable — the
*position card* is. Recommend replacing it in this phase with the card + a "copy as text"
fallback, and revisiting screen share only if users actually ask. Stated as a
recommendation to decline, so it isn't silently dropped.

---

## 4. Feature C — the creation "protocol" (regulation, creators, fake markets)

This is the part the owner called most crucial, and it is where the research is most useful:
the failure mode is documented (vague rules, paid/insider creators, bot-pumpable outcomes)
and the mitigation is structural, not punitive.

### 4.1 Six controls, ordered cheapest-first

1. **A market that cannot be vague.** Structured fields, not a free-text description:
   *Question* · *Objective outcome criteria* · *Named resolution source* · *Resolves at* ·
   *Deadline*. Reject creation whose criteria contain no checkable source. This single
   change kills most fake/ambiguous markets without any human review.
2. **No metric a creator can pump.** Ban (or hard-verify) markets resolving on follower
   counts, likes, "clout", or anything the creator controls — exactly the bot vulnerability
   Bloomberg documented.
3. **A bond, in play-money credits.** Creating costs a stake (e.g. 200 credits, held, not
   burned). Good-faith resolution → returned. Vague/abandoned/self-serving resolution →
   slashed to the affected bettors. This is the honest version of "charge creators": it
   prices abuse without selling participation.
4. **Propose → challenge window → live.** A new market sits in `proposed` for N minutes with
   a visible "flag this market" action. Unflagged → activates. Flagged → human/queue. This
   is UMA's optimistic-oracle shape, with none of the crypto.
5. **Auto-resolution wherever a real source exists.** Football markets already have
   API-Football as an authoritative score source — those should never need a human creator
   to declare a result. Manual resolution stays only where no source exists, and those
   markets carry a visible "resolved by creator" label.
6. **Creator reputation, publicly on the market.** Track hit-rate of their resolved
   markets, cancellation rate, disputes, and **their own position in it**. Gating: low
   reputation → fewer concurrent markets, higher bond, no featured placement.

### 4.2 Insider information — say what is actually true

We cannot detect insider knowledge, and pretending otherwise would be a lie we ship. What
we *can* do: make the creator's own stake visible, cap how much a single account may hold
against its own market, publish the resolution source so an informed outsider is not
structurally required, and treat a pattern (creator always on the winning side of their own
markets) as a bannable moderation signal, not a technical control.

### 4.3 Who may create

Owner said creation should stay open to everyone, and the controls above are why that is
defensible. Recommendation: **open, but tiered** — any completed account can create;
a bond and the challenge window apply to all; featured placement requires reputation. This
preserves the "anyone can create a game" goal without the "anyone can create garbage"
consequence.

---

## 5. Feature D — credits, "stocks", and the price-goes-up-when-you-win idea

### 5.1 What I think is being asked, and the fork in it

The description — *charging for stocks in credits, price rises when you win, drops to market
when you lose, users can create a game* — can mean two different products:

- **(a) A user reputation/level economy.** Your credit balance, fee rate, limits and badge
  move with your demonstrated accuracy. No security, no investor, no promise of profit.
  Cheap, safe, and it is what "price goes up when you win" looks like without real money.
- **(b) Tradable claims on a creator** — you buy "stock" in a creator and it appreciates
  when they win. That is an **investment contract** in the ordinary legal sense: money in,
  common enterprise, profit from the efforts of others. It is a securities question, not a
  UI question, and it is not something I will build on assumption.

**Recommendation: build (a) now; do not build (b) without counsel.** Flagged as the single
most important decision in this document.

### 5.2 The two-currency pattern the industry already uses

Social sportsbooks (Fliff and the sweepstakes model) separate **purchased credits** from
**earned credits**. That distinction is the whole reason they operate outside gambling
licensure. If LiveEdge ever monetises, this is the shape to copy — and it inherits the
criticism in §1 (18+ rating with no age verification, marketed at young users), which the
owner should see before choosing it, not after.

### 5.3 The invariant that must survive all of it

Money conservation. Credits minted = credits burned + credits held. Any bond, fee, slash or
payout introduced above must have a test proving the total is conserved, in integer
micro-units, or it does not merge.

---

## 6. Sequencing (what I would do, in order)

| # | Ship | Why here | Rough size |
|---|---|---|---|
| 0 | Finish the auth path: real Privy login → `/welcome` → terms → congrats, end to end | Everything below needs a real user identity, not a minted session | verification, not code |
| 1 | **Activity tab + open interest + holders** (§2) | Pure read over data we already have; makes the app feel alive before we spend anything on growth | S–M |
| 2 | **Leaderboard** (§2.3) | Reuses the same aggregation; highest retention value per line of code | S |
| 3 | **Share codes + load-this-bet** (§3.2) | The social loop the owner wants; no new dependency | M |
| 4 | **Server-rendered share card** (§3.3) | Unlocks actual sharing outside the app; needs the dependency decision | M |
| 5 | **Creation protocol 1–4** (§4.1) | Structured form, no-pump rule, bond, challenge window | M |
| 6 | **Reputation + auto-resolution** (§4.1 items 5–6) | Compounds on 1–4 | M–L |
| 7 | **Credit economy (a)** (§5.1) | Only after the invariant tests from 5 exist | L |

Out of scope for this plan: screen sharing, real-money rails, currency conversion,
KYC/age-verification vendors, and any tradable creator security.

---

## 7. Questions for the owner (short answers are enough)

1. **§5.1 fork — (a) reputation economy or (b) tradable creator stock?** If (b), legal
   review has to come first, and I will not scaffold it silently.
2. **Share code length:** accept 6 chars (recommended), or keep 5 and accept guessing risk?
3. **Dynamic share image:** approve one new server-side rendering dependency, or start with
   a static card?
4. **Creation bond:** how many credits, and should it be refunded on a *disputed-but-honest*
   market?
5. **Challenge window:** how long (I'd start at 10 minutes) and who reviews flags — you, or
   a queue you check daily?
6. **§6 "banners / the description for the bounty / how users receive payment"** — I did not
   understand this from the voice note and I would rather ask than invent it. Which surface
   is the banner (market card? landing hero? creator page?), and what is paid to whom —
   a creator bounty in play credits, or an actual payout?
7. **Screen share:** accept the recommendation to defer it, or is it a hard requirement?
