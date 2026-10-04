// "Am I running the newest version of the app?" — an installed PWA (especially on iPhone) can stay open on old code for days. The build writes /version.json with a hash of
// the sources (vite.config.js); this compares it with the hash baked into the running bundle. DOM-free except for fetch.
/* global __APP_VERSION__, __APP_BUILT__ */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
export const APP_BUILT = typeof __APP_BUILT__ === 'string' ? __APP_BUILT__ : null;

// → { current, latest, outdated } ; outdated is only true when both are real ids and differ; any failure → outdated false (never nag on a bad connection)
export async function checkForUpdate(fetcher = fetch, current = APP_VERSION) {
  if (current === 'dev') return { current, latest: null, outdated: false };
  try {
    const res = await fetcher(`/version.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { current, latest: null, outdated: false };
    const j = await res.json();
    const latest = typeof j?.v === 'string' && /^[0-9a-f]{8}$/.test(j.v) ? j.v : null;
    return { current, latest, outdated: !!latest && latest !== current };
  } catch {
    return { current, latest: null, outdated: false };
  }
}
