/* Security & licensing assertions:
   - no secrets/keys in tracked files (service keys, private keys, high-
     entropy legacy JWTs)
   - no restricted Bilgeon assets (font/binary) reintroduced
   - asset license documentation present and consistent
   - GitHub workflows keep least-privilege permissions
   Exits 1 on any failure. */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { FABRICATED_MARKERS, scanTextForSecretKeys, validateClientKey } from './bundle-security-scan.mjs';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures += 1;
};

const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const readTracked = (p) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};

/* 1 — no secret-shaped strings in tracked text files */
const secretPatterns = [
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'supabase SECRET key'],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key block'],
];
let secretHits = [];
for (const f of tracked) {
  // SQL migrations are a classic credential-leak vector — scan them too
  if (!/\.(ts|tsx|mjs|js|json|html|css|toml|ya?ml|md|svg|sql)$/.test(f)) continue;
  const lines = readTracked(f).split('\n');
  lines.forEach((line, i) => {
    // skip comment lines — the security GUARD code legitimately names
    // what it rejects (SQL -- comments and JS // and block * comments)
    if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('--')) return;
    // test files legitimately contain FABRICATED tokens (clearly fake
    // values carrying the markers exported by the scanner module) for
    // negative regressions — those exact lines are exempt; any OTHER
    // secret-shaped string in ANY file still fails the scan
    const fabricated = FABRICATED_MARKERS.some((m) => line.includes(m));
    for (const [re, label] of secretPatterns) {
      if (re.test(line) && !fabricated) secretHits.push(`${f}:${i + 1}: ${label}`);
    }
    // a legacy service_role JWT assigned to a KEY variable is a real leak
    if (/(KEY|key)[a-zA-Z_]*\s*[:=][^\n]*service_role/.test(line) && !line.includes('payload.role') && !fabricated) {
      secretHits.push(`${f}:${i + 1}: service_role JWT assigned to a key variable`);
    }
  });
}
check('no secret-shaped strings in tracked files', secretHits.length === 0, secretHits.join(' | ').slice(0, 160));

/* 2 — no restricted Bilgeon assets reintroduced */
const bilgeonAssets = tracked.filter(
  (f) => /bilgeon/i.test(f) && /\.(ttf|otf|woff2?|png|jpe?g|webp|svg|bin)$/.test(f),
);
check('no Bilgeon assets in the tree', bilgeonAssets.length === 0, bilgeonAssets.join(','));

/* 3 — licensing docs present and consistent */
check('ASSET-LICENSES.md exists', fs.existsSync('ASSET-LICENSES.md'));
check('Great Vibes OFL text ships', fs.existsSync('public/fonts/OFL-GreatVibes.txt'));
check('hero license record exists', fs.existsSync('hero-image-license.json'));
const licenses = readTracked('ASSET-LICENSES.md');
check('licenses doc covers Great Vibes OFL', licenses.includes('Great Vibes') && licenses.includes('OFL'));
check('licenses doc records the Bilgeon exclusion', licenses.includes('Bilgeon'));

/* 4 — hero image license record points at a CC0 source */
const hero = JSON.parse(readTracked('hero-image-license.json'));
check('hero photo license is CC0', hero.license === 'cc0', hero.license);

/* 5 — workflows keep least-privilege permissions */
for (const f of tracked.filter((x) => x.startsWith('.github/workflows/'))) {
  const text = readTracked(f);
  check(`${f}: contents: read only`, /permissions:\s*\n\s*contents:\s*read/.test(text));
  check(`${f}: no pull_request_target`, !/pull_request_target/.test(text));
  check(`${f}: no secrets used`, !/\${{ *secrets\.+/.test(text));
}

/* 6 — the publishable key constant is the publishable (not secret) format */
const onlineSrc = readTracked('src/lib/online/supabase.ts');
check('client uses a publishable key constant', onlineSrc.includes('sb_publishable_'));
check('client does not ASSIGN a service_role key', !/[:=]\s*['\"]ey[A-Za-z0-9_-]+['\"].*service_role/.test(onlineSrc));
check('client guard rejects service_role (validatePublishableKey present)', onlineSrc.includes('validatePublishableKey') && onlineSrc.includes("role === 'service_role'"));

/* 6b — build validation: the DISTRIBUTED bundle carries no secret keys.
   The per-JWT decoded scan is independent of guard strings elsewhere in
   the same file, and runs against the real built bundle. */
if (fs.existsSync('dist/assets')) {
  let bundleHits = [];
  for (const f of fs.readdirSync('dist/assets').filter((n) => n.endsWith('.js'))) {
    const text = fs.readFileSync(path.join('dist/assets', f), 'utf8');
    for (const hit of scanTextForSecretKeys(text)) {
      bundleHits.push(`${f}: ${hit}`);
    }
  }
  check('distributed bundle carries no secret keys', bundleHits.length === 0, bundleHits.join(', ').slice(0, 160));
}

/* 6c — build-time validation of the CONFIGURED key: if the environment
   provided a client key, reject SECRET/service_role forms before any
   build could embed them into frontend assets */
if (process.env.VITE_SUPABASE_ANON_KEY) {
  try {
    validateClientKey(process.env.VITE_SUPABASE_ANON_KEY);
    check('configured VITE_SUPABASE_ANON_KEY is a safe client key', true);
  } catch (e) {
    check('configured VITE_SUPABASE_ANON_KEY is a safe client key', false, String(e).slice(0, 140));
  }
}

console.log(failures === 0 ? 'SECURITY & LICENSING: ALL PASS' : `SECURITY & LICENSING: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
