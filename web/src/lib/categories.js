// Category taxonomy for the landing chips + the football rail.
//
// This implements docs/live-aggregation-spec.md §2: the DISPLAY superset is fixed
// (Football, Sports, Gaming, IRL, Music, Talk, Tech/Conference, Lifestyle), but a
// chip/rail only surfaces for a bucket that OBSERVED data maps into — we never
// invent per-row buckets or show an empty "Football" section (§2 + §4 honesty).
//
// Inputs are SOURCE-NATIVE labels only: Twitch `game_name`, Kick `category.name`,
// a room's `heroMarket.category`, or a floor config tag. We merely classify an
// existing label into a display bucket; unknown labels stay uncategorized.

export const DISPLAY_CATEGORIES = ['Football', 'Sports', 'Gaming', 'IRL', 'Music', 'Talk', 'Tech/Conference', 'Lifestyle'];

const RULES = [
  ['Football', ['football', 'soccer', 'premier league', 'epl', 'la liga', 'bundesliga', 'serie a', 'ligue 1', 'champions league', 'uefa', 'fifa', 'world cup', 'mls', 'copa', 'europa league']],
  ['Sports', ['nba', 'nfl', 'nhl', 'mlb', 'tennis', 'cricket', 'mma', 'ufc', 'boxing', 'golf', 'rugby', 'darts', 'f1', 'formula', 'racing', 'athletics', 'basketball', 'baseball', 'american football', 'sports']],
  ['Music', ['music', 'dj', 'singing', 'producer', 'lofi', 'hip hop radio', 'concert', 'live music']],
  ['IRL', ['irl', 'just chatting', 'traveling', 'outdoor', 'adventure', 'streaming'], ],
  ['Talk', ['talk shows', 'politics', 'interview', 'podcast', 'chat & people', 'non-stopers'], ],
  ['Tech/Conference', ['software', 'engineering', 'computer science', 'tech', 'conference', 'developer', 'science & technology', 'i rl'] ],
  ['Gaming', ['gaming', 'valorant', 'league of legends', 'fortnite', 'minecraft', 'cs2', 'counter-strike', 'dota', 'apex', 'genshin', 'gta', 'esports', 'roleplay']],
  ['Lifestyle', ['beauty', 'fashion', 'fitness', 'health', 'cooking', 'asmr', 'home', 'lifestyle', 'food']],
];

// Map a source-native label to a display bucket (or '' when it matches none).
export function mapToDisplay(rawCategory) {
  const s = String(rawCategory || '').toLowerCase().trim();
  if (!s) return '';
  for (const [bucket, terms] of RULES) {
    if (terms.some((t) => s.includes(t))) return bucket;
  }
  return '';
}

// True when a live/room label should count as Football for the football rail.
export function isFootball(rawCategory) {
  return mapToDisplay(rawCategory) === 'Football';
}

// Given [labels...], return the ordered display buckets that actually have data.
export function bucketsWithData(labels) {
  const present = new Set(labels.map(mapToDisplay).filter(Boolean));
  return DISPLAY_CATEGORIES.filter((c) => present.has(c));
}
