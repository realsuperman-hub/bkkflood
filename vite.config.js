import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// The app version = a hash of the files the app is built from (source, page, service worker, manifest) — NOT of the git commit, because the Thai-network PC and the
// workflow commit fresh data every 15 minutes and that must not tell every user "new version". The same id is baked into the bundle and written to /version.json,
// so an installed app (an iPhone home-screen app keeps running its old code for days) can ask the server whether it is out of date.
function sourceHash() {
  const h = createHash('sha1');
  const walk = (dir) => {
    for (const f of readdirSync(dir).sort()) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(p.replace(/\\/g, '/')).update(readFileSync(p));
    }
  };
  walk('src');
  for (const f of ['index.html', 'public/sw.js', 'public/manifest.webmanifest']) if (existsSync(f)) h.update(f).update(readFileSync(f));
  return h.digest('hex').slice(0, 8);
}

const VERSION = sourceHash();
const BUILT = new Date().toISOString();

export default {
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  define: { __APP_VERSION__: JSON.stringify(VERSION), __APP_BUILT__: JSON.stringify(BUILT) },
  plugins: [
    {
      name: 'version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ v: VERSION, built: BUILT }) });
      },
    },
  ],
};
