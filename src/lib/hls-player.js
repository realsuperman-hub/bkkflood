// Plays one HLS stream in a <video>. Safari/iOS play HLS natively; elsewhere hls.js is loaded on first use from cdnjs, pinned to one version with a
// Subresource-Integrity hash (so a changed file is refused). Returns { destroy } — call it when the viewer closes to stop all network use.
const SRC = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.17/hls.min.js';
const SRI = 'sha384-9v3HcdYrO3D+OPDTjZ40RXocgE4GtXVCd3/mCS62JsM93JXgI1afJVuwjFvsu6ni';

let loading = null;
function loadHlsJs() {
  if (window.Hls) return Promise.resolve(window.Hls);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.integrity = SRI;
    s.crossOrigin = 'anonymous';
    s.referrerPolicy = 'no-referrer';
    s.onload = () => (window.Hls ? resolve(window.Hls) : reject(new Error('hls.js missing')));
    s.onerror = () => { loading = null; reject(new Error('hls.js failed to load')); };
    document.head.append(s);
  });
  return loading;
}

// onState('loading' | 'playing' | 'error')
export async function playHls(video, url, onState = () => {}) {
  let hls = null;
  let dead = false;
  const stop = () => {
    dead = true;
    try { hls?.destroy(); } catch { /* already gone */ }
    video.pause();
    video.removeAttribute('src');
    video.load();
  };
  onState('loading');
  video.muted = true;
  video.playsInline = true;
  video.addEventListener('playing', () => !dead && onState('playing'), { once: true });
  try {
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.addEventListener('error', () => !dead && onState('error'), { once: true });
    } else {
      const Hls = await loadHlsJs();
      if (dead) return { destroy: stop };
      if (!Hls.isSupported()) throw new Error('HLS not supported');
      hls = new Hls({ maxBufferLength: 10, liveSyncDurationCount: 3, enableWorker: true });
      let recoveries = 0;
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (!d.fatal || dead) return;
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR && recoveries++ < 2) hls.startLoad();
        else if (d.type === Hls.ErrorTypes.MEDIA_ERROR && recoveries++ < 2) hls.recoverMediaError();
        else onState('error');
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    }
    await video.play().catch(() => {}); // autoplay can be refused; the controls stay available
    setTimeout(() => { if (!dead && video.readyState < 2) onState('error'); }, 15000);
  } catch {
    if (!dead) onState('error');
  }
  return { destroy: stop };
}
