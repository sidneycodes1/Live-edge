import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { validate } from '../middleware/validate.js';
import { sanitizeText } from '../services/sanitize.js';

export function roomsRouter({ db, hub, kick }) {
  const r = Router();

  r.get('/', async (_req, res, next) => {
    try {
      // auto-close markets past end_time
      await db.query(`update markets set status='closed' where status='open' and end_time <= now()`);
      const { rows: rooms } = await db.query(
        `select r.*, u.display_name as owner_name, u.wallet as owner_wallet
         from rooms r join users u on u.id=r.owner_id
         order by (case when r.is_seed then 1 else 0 end), r.created_at desc`,
      );
      const result = [];
      for (const room of rooms) {
        // Prefer a tradeable (open) market as the room hero; fall back to most recent.
        const { rows: markets } = await db.query(
          `select * from markets where room_id=$1
           order by case status when 'open' then 0 when 'closed' then 1 else 2 end, created_at desc
           limit 1`,
          [room.id],
        );
        const hero = markets[0] || null;
        // THE LIST IS AN OPEN-BET LIST (owner fix, Oct 2026). A room earns a card only
        // while it carries an OPEN market — for EVERY owner, not just the engine. A
        // market-less room (a half-finished "create game": a title with nothing to bet
        // on) or one whose only market has closed is NOT a market, so it must never
        // render as a lone "Play" tile in "All markets". Read-path filter, NOT a
        // delete — any trades/ledger rows stay queryable forever (FKs have no cascade).
        if (!hero || hero.status !== 'open') continue;
        const viewers = hub ? hub.count(room.id) : 0;
        result.push({
          id: room.id,
          title: room.title,
          video_url: room.video_url,
          kick_channel: room.kick_channel || null,
          status: room.status,
          isSeed: room.is_seed,
          // Queryable room fact (migration 007). (watch_party was retired with the
          // football vertical, Oct 2026 — the DB column stays, it is no longer read.)
          category: room.category || null,
          owner: { displayName: room.owner_name, wallet: room.owner_wallet },
          viewers,
          heroMarket: hero
            ? {
                id: hero.id,
                question: hero.question,
                yesPrice: Number(hero.yes_price),
                noPrice: Number(hero.no_price),
                status: hero.status,
                isSeed: hero.is_seed,
                // Additive fields the Discover card needs to read as a live tile:
                // thumbnail, category (rails/filters), volume (social proof), and
                // end_time (countdown). No behavior change to existing consumers.
                category: hero.category,
                image_url: hero.image_url,
                volume: Number(hero.volume),
                end_time: hero.end_time,
                // Price provenance + Panta mirrors (Door 1 honesty labels). The
                // Discover card renders a source chip from these.
                source: hero.source,
                price_source: hero.price_source,
                price_observed_at: hero.price_observed_at,
                panta:
                  hero.source === 'panta'
                    ? {
                        phase: hero.panta_phase,
                        status: hero.panta_status,
                        resolved: hero.panta_resolved,
                        total_volume_usdc: hero.panta_total_volume_usdc != null ? Number(hero.panta_total_volume_usdc) : null,
                      }
                    : null,
              }
            : null,
        });
      }
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  r.get('/:id', async (req, res, next) => {
    try {
      await db.query(`update markets set status='closed' where status='open' and end_time <= now()`);
      const { rows } = await db.query(`select r.*, u.display_name as owner_name from rooms r join users u on u.id=r.owner_id where r.id=$1`, [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Room not found' } });
      const room = rows[0];
      const { rows: markets } = await db.query(
        `select * from markets where room_id=$1
         order by case status when 'open' then 0 when 'closed' then 1 else 2 end, created_at desc`,
        [room.id],
      );
      // coalesce: AI spectator rows (kind='ai') carry their persona label in
      // chat_messages.display_name; real users resolve via the users join.
      const { rows: chats } = await db.query(`select c.id, c.room_id, c.user_id, c.kind, c.body, c.is_seed, c.created_at, u.wallet, coalesce(u.display_name, c.display_name) as display_name from chat_messages c left join users u on u.id=c.user_id where c.room_id=$1 order by c.id desc limit 50`, [room.id]);
      const viewers = hub ? hub.count(room.id) : 0;
      res.json({
        id: room.id,
        title: room.title,
        video_url: room.video_url,
        kick_channel: room.kick_channel || null,
        status: room.status,
        isSeed: room.is_seed,
        // Queryable room fact (migration 007) — see list route.
        category: room.category || null,
        owner: { displayName: room.owner_name },
        viewers,
        markets: markets.map((m) => ({
          id: m.id,
          question: m.question,
          resolution_rule: m.resolution_rule,
          sources_of_truth: m.sources_of_truth,
          category: m.category,
          image_url: m.image_url,
          yes_price: Number(m.yes_price),
          no_price: Number(m.no_price),
          q_yes: Number(m.q_yes),
          q_no: Number(m.q_no),
          volume: Number(m.volume),
          status: m.status,
          outcome: m.outcome,
          graduated: m.graduated,
          creator_fees_accrued: Number(m.creator_fees_accrued),
          isSeed: m.is_seed,
          source: m.source,
          price_source: m.price_source,
          price_observed_at: m.price_observed_at,
          panta:
            m.source === 'panta'
              ? {
                  market_id: m.panta_market_id,
                  phase: m.panta_phase,
                  status: m.panta_status,
                  resolved: m.panta_resolved,
                  yes_wins: m.panta_yes_wins,
                  oracle: m.panta_oracle,
                  graduated: m.panta_graduated,
                  total_volume_usdc: m.panta_total_volume_usdc != null ? Number(m.panta_total_volume_usdc) : null,
                }
              : null,
          end_time: m.end_time,
          resolution_time: m.resolution_time,
        })),
        chat: chats.reverse().map((c) => ({
          id: c.id,
          kind: c.kind,
          body: c.body,
          isSeed: c.is_seed,
          created_at: c.created_at,
          user: { display_name: c.display_name, wallet: c.wallet },
        })),
      });
    } catch (e) {
      next(e);
    }
  });

  const createSchema = z.object({
    title: z.string().min(3).max(80),
    videoUrl: z.string().url().optional().or(z.literal('')).optional(),
    // Optional real Kick channel slug to bind to this room. Stored
    // lowercased; validated server-side at creation time.
    kickChannel: z.string().min(1).max(100).optional().or(z.literal('')).optional(),
  });

  r.post('/', validate(createSchema), async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
      const title = sanitizeText(req.body.title);
      const videoUrl = req.body.videoUrl || null;
      const kickChannel = (req.body.kickChannel || '').trim().toLowerCase() || null;
      // Don't silently accept garbage: when Kick is verifiable, the channel must
      // exist (offline is fine — embeds still work). If creds are absent we can't
      // verify, so we accept but flag it (never block a demo attachment).
      let kickVerified = null;
      if (kickChannel && kick) {
        const v = await kick.validateChannel(kickChannel);
        if (v.verifiable && !v.exists) {
          return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `Kick channel '${kickChannel}' does not exist` } });
        }
        kickVerified = v.verifiable;
      }
      const id = randomUUID();
      await db.query(`insert into rooms(id, owner_id, title, video_url, kick_channel) values($1,$2,$3,$4,$5)`, [id, req.user.id, title, videoUrl, kickChannel]);
      const { rows } = await db.query('select * from rooms where id=$1', [id]);
      res.status(201).json({ ...rows[0], kickVerified });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
