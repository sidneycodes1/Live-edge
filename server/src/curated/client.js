import { ProviderError } from '../aggregator/errors.js';
import { CURATED_CHANNELS } from './channels.js';

// ---------------------------------------------------------------------------
// Curated always-live channel client — keyless + quota-free (docs/…§6 provider
// pattern; Phase 2 "curated live channels"). Each channel's LATEST video id,
// title, and author come from its public Atom feed:
//
//   GET https://www.youtube.com/feeds/videos.xml?channel_id=<UC…>   (no API key)
//
// This endpoint is NOT the Data API — it consumes no search quota, so it keeps
// working when the YouTube SEARCH budget is exhausted (429). The live stream
// itself is embedded by CHANNEL id (liveEmbedUrl), independent of the RSS videoId.
//
// Boundary: getChannels() runs every feed IN PARALLEL (Promise.allSettled); a
// single channel failing is SKIPPED (partial results are fine). If EVERY fetch
// fails AND there is no cache, it throws ProviderError('NETWORK') so the caller
// (aggregator) reports the source degraded — a curated outage must never be able
// to break the general grid. Cache 10 min + single-flight; stale cache is served
// if a full refresh fails.
//
// §4 honesty: we never emit a viewer count (there is none) — the `viewCount` key
// is ABSENT, not 0. The item is a REAL, confirmed-loadable channel card.
// ---------------------------------------------------------------------------

const RSS_BASE = 'https://www.youtube.com/feeds/videos.xml?channel_id=';

// Decode the handful of XML/HTML entities a YouTube feed title can contain. &amp;
// is resolved LAST so a literal "&amp;lt;" is not double-unescaped.
export function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function first(re, text) {
  const m = re.exec(text);
  return m ? m[1].trim() : '';
}

// Parse the FIRST <entry> (the latest upload) out of an Atom feed. Returns
// { videoId, title, authorName } or null when the feed has no usable entry.
export function parseFirstEntry(xml) {
  const text = String(xml || '');
  const block = /<entry>([\s\S]*?)<\/entry>/.exec(text);
  if (!block) return null;
  const e = block[1];
  // yt:videoId is authoritative; fall back to the <id>yt:video:XXX</id> form.
  let videoId = first(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/, e);
  if (!videoId) {
    const gid = first(/<id>([\s\S]*?)<\/id>/, e);
    const m = /yt:video:([\w-]+)/.exec(gid);
    if (m) videoId = m[1];
  }
  if (!videoId) return null;
  return {
    videoId,
    title: decodeEntities(first(/<title>([\s\S]*?)<\/title>/, e)),
    authorName: decodeEntities(first(/<name>([\s\S]*?)<\/name>/, e)),
  };
}

// Build the exact curated item shape. NOTE: no `viewCount` key at all (§4).
export function normalizeCuratedItem(channel, entry) {
  return {
    id: `yt-${entry.videoId}`,
    source: 'curated-youtube',
    category: channel.category,
    title: entry.title,
    channelName: entry.authorName || channel.name,
    owner: channel.name,
    videoUrl: `https://www.youtube.com/watch?v=${entry.videoId}`,
    liveEmbedUrl: `https://www.youtube.com/embed/live_stream?channel=${channel.channelId}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${entry.videoId}/hqdefault.jpg`,
    status: 'live-24-7',
  };
}

export function createCuratedClient({
  channels = CURATED_CHANNELS,
  fetchImpl = fetch,
  timeoutMs = 8000,
  ttlMs = 10 * 60 * 1000,
  // Partial refresh (some feeds throttled/failed → fewer items than channels) is
  // cached only briefly: a transient YouTube soft-block at boot must NOT lock the
  // grid to 3 cards for the full 10 minutes. Complete refreshes keep the long TTL.
  partialTtlMs = 60 * 1000,
  // Bounded concurrency + small stagger: firing 14 simultaneous RSS requests is
  // exactly the burst pattern YouTube soft-throttles (observed: fake 404s per-IP).
  // Defaults are timing-neutral (full parallelism, no waits) so unit tests stay
  // fast and deterministic; PRODUCTION passes the tuned values in app.js.
  concurrency = Infinity,
  staggerMs = 0,
  retryDelayMs = 0,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  warn = (msg) => console.warn(msg),
} = {}) {
  let cache = null; // { at, data, complete }
  let inflight = null;

  // One keyless RSS fetch, bounded by an AbortController timeout.
  async function fetchFeed(channel) {
    const url = `${RSS_BASE}${encodeURIComponent(channel.channelId)}`;
    let ctrl;
    let timer;
    try {
      ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
      timer = setTimeout(() => ctrl?.abort?.(), timeoutMs);
      const res = await fetchImpl(url, { method: 'GET', signal: ctrl?.signal });
      if (res.status === 404) throw new ProviderError('HTTP_ERROR', `curated feed 404 (${channel.name})`, { status: 404 });
      if (!res.ok) throw new ProviderError('HTTP_ERROR', `curated feed failed (${res.status})`, { status: res.status });
      const xml = await res.text();
      const entry = parseFirstEntry(xml);
      if (!entry) {
        warn(`curated: ${channel.name} feed had no usable entry`);
        return null;
      }
      return normalizeCuratedItem(channel, entry);
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      if (e?.name === 'AbortError') throw new ProviderError('TIMEOUT', `curated feed timed out (${channel.name})`);
      throw new ProviderError('NETWORK', `curated feed transport error (${channel.name})`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // One feed with a single retry (throttle blips are transient; a fake-404 usually
  // clears seconds later). Retry only on retryable codes, never on a good empty parse.
  async function fetchFeedWithRetry(channel) {
    try {
      return await fetchFeed(channel);
    } catch (e) {
      const retryable = e instanceof ProviderError
        && ['HTTP_ERROR', 'RATE_LIMIT', 'TIMEOUT', 'NETWORK'].includes(e.code);
      if (!retryable) throw e;
      await sleep(retryDelayMs);
      return fetchFeed(channel); // second failure propagates to the skip path
    }
  }

  // Promise.allSettled-style fan-out with a concurrency cap and staggered launches
  // (bounded lanes) — avoids the 14-at-once burst that draws fake-404 throttling.
  async function settleBounded(list, worker) {
    const results = new Array(list.length).fill(null);
    let next = 0;
    const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, async (_r, k) => {
      while (next < list.length) {
        const i = next++;
        if (k > 0 && staggerMs > 0) await sleep(staggerMs);
        results[i] = await worker(list[i], i);
      }
    });
    await Promise.all(lanes);
    return results;
  }

  // Public: CuratedItem[]. Bounded-concurrency RSS fan-out, cache-aside + single-flight.
  // Skips per-channel failures; throws ProviderError('NETWORK') only when NOTHING
  // loaded and there is no cache to fall back on.
  async function getChannels() {
    const at = now();
    if (cache) {
      const age = at - cache.at;
      if (age < (cache.complete ? ttlMs : partialTtlMs)) return cache.data;
    }
    if (inflight) return inflight;

    inflight = (async () => {
      try {
        let okCount = 0;
        const settled = await settleBounded(channels, async (c) => {
          try {
            const v = await fetchFeedWithRetry(c);
            okCount += 1;
            return { status: 'fulfilled', value: v };
          } catch (reason) {
            return { status: 'rejected', reason };
          }
        });
        const seen = new Set();
        const items = [];
        settled.forEach((r, idx) => {
          if (r.status === 'fulfilled') {
            const it = r.value;
            if (it && !seen.has(it.id)) {
              seen.add(it.id);
              items.push(it);
            }
          } else {
            const reason = r.reason?.code || r.reason?.name || 'ERROR';
            warn(`curated: ${channels[idx]?.name} dropped (feed failed: ${reason})`);
          }
        });

        if (items.length === 0) {
          if (cache) {
            warn('curated: every feed failed → serving last-good stale cache');
            return cache.data;
          }
          throw new ProviderError('NETWORK', 'all curated channel feeds failed');
        }
        const complete = okCount === channels.length;
        cache = { at: now(), data: items, complete };
        if (!complete) warn(`curated: partial refresh ${items.length}/${channels.length} → short ${partialTtlMs}ms cache`);
        return items;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  return { getChannels };
}
