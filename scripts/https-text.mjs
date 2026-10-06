// GET a page as text over HTTPS, trusting Node's usual roots PLUS the intermediate certificates in certs/.
// www.tmd.go.th sends its certificate without the intermediate (GlobalSign GCC R6 AlphaSSL CA 2025), so plain fetch() fails with
// UNABLE_TO_VERIFY_LEAF_SIGNATURE. certs/tmd-intermediate.pem is that public intermediate (from secure.globalsign.com, chains to
// GlobalSign Root R6, expires 2027-05-21) — the chain is still fully verified, nothing is switched off.
import https from 'node:https';
import tls from 'node:tls';
import { readFileSync } from 'node:fs';

const extra = readFileSync(new URL('../certs/tmd-intermediate.pem', import.meta.url), 'utf8');
const ca = [...tls.rootCertificates, extra];
const UA = 'Mozilla/5.0 (compatible; BKKFLOOD/1.0; +https://bkkflood.web.app)';

export function httpsText(url, { timeoutMs = 60000, redirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { ca, headers: { 'user-agent': UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(httpsText(new URL(res.headers.location, url).href, { timeoutMs, redirects: redirects - 1 }));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} ${new URL(url).host}`));
        return;
      }
      res.setEncoding('utf8');
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve(body));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout ${new URL(url).host}`)));
    req.on('error', reject);
  });
}
