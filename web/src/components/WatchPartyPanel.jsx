import { useState } from 'react';
import RoomFeed from './RoomFeed.jsx';

// "Bring your own feed / where to watch" — the heart of the football watch-party
// vertical (docs/live-aggregation-spec.md §2). Premium match footage is licensed,
// so we NEVER host or embed the match ourselves. The fan pastes their OWN legal
// stream (Twitch / YouTube / Kick / .mp4) and we embed it locally for the room;
// nothing is sent to the server and no video is fabricated. Until a feed is added we
// show an honest "where to watch" prompt, not a dead player.
export default function WatchPartyPanel({ parent }) {
  const [url, setUrl] = useState('');
  const [loaded, setLoaded] = useState('');

  const submit = (e) => {
    e.preventDefault();
    setLoaded(url.trim());
  };

  return (
    <div className="space-y-3">
      <div className="relative w-full aspect-video min-h-[300px] rounded-card overflow-hidden border border-white/10 bg-black/30">
        {loaded ? (
          <RoomFeed videoUrl={loaded} parent={parent} />
        ) : (
          <div className="absolute inset-0 grid place-items-center px-6 text-center bg-gradient-to-br from-[#141420] via-surface to-black">
            <div className="max-w-sm">
              <h3 className="font-heading font-bold text-white/90">Bring your own feed</h3>
              <p className="text-xs text-white/50 mt-2">
                We don’t host match video — it’s licensed elsewhere. Paste your legal stream
                (Twitch, YouTube, Kick or an .mp4 link) and it plays right here while you follow
                the market and chat.
              </p>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor="byo-feed" className="sr-only">Feed URL</label>
        <input
          id="byo-feed"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste your stream URL (https://…)"
          className="flex-1 min-w-0 bg-surface border border-white/10 rounded-card px-3 py-2 text-sm text-white placeholder-white/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        />
        <button type="submit" className="shrink-0 px-4 py-2 rounded-card bg-white text-black text-sm font-semibold cursor-pointer hover:bg-white/90 transition">
          {loaded ? 'Update' : 'Load my feed'}
        </button>
      </form>
    </div>
  );
}
