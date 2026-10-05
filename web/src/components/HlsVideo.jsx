import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

// Honest HLS (.m3u8) live player for self-hosted / Livepeer feeds — the §6
// "verify Livepeer HLS" surface. Uses hls.js where MSE is available and falls back
// to native HLS (Safari/iOS). Per the real-vs-simulated honesty rule we NEVER fake
// playback: while the manifest loads we show a clear "connecting" state, and on a
// fatal error (e.g. the stream is idle / no ingest) we surface "isn't live right
// now" instead of a dead or fabricated player. `controls` + muted autoplay satisfy
// browser autoplay policy while keeping the stream user-controllable.
export default function HlsVideo({ src, poster, className = '' }) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | loading | playing | error
  const [message, setMessage] = useState('');

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) {
      setStatus('idle');
      return;
    }
    setStatus('loading');
    setMessage('');

    let hls;
    const canNative = video.canPlayType('application/vnd.apple.mpegurl');
    const fail = (msg) => {
      setStatus('error');
      setMessage(msg || 'This stream isn’t live right now.');
    };
    const onPlaying = () => setStatus('playing');
    video.addEventListener('playing', onPlaying);

    if (Hls.isSupported() && !canNative) {
      hls = new Hls({ lowLatencyMode: true, backBufferLength: 30 });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data && data.fatal) {
          fail();
          hls.destroy();
          hls = undefined;
        }
      });
    } else if (canNative) {
      video.src = src;
      video.addEventListener('error', () => fail());
      video.play().catch(() => {});
    } else {
      fail('HLS playback isn’t supported in this browser.');
    }

    return () => {
      video.removeEventListener('playing', onPlaying);
      if (hls) hls.destroy();
    };
  }, [src]);

  return (
    <div
      className={`relative w-full aspect-video bg-black rounded-card overflow-hidden border border-white/10 ${className}`}
      data-testid="hls-video"
      data-status={status}
    >
      <video
        ref={videoRef}
        muted
        playsInline
        controls
        poster={poster || undefined}
        className="w-full h-full object-cover"
      />
      {status !== 'playing' && (
        <div className="absolute inset-0 grid place-items-center px-6 text-center bg-black/60 pointer-events-none">
          <p className="text-white/75 text-sm font-medium">
            {status === 'error' ? message : 'Connecting to the live stream…'}
          </p>
        </div>
      )}
    </div>
  );
}
