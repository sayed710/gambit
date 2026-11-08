/* Security & licensing assertions:
   - no secrets/keys in tracked files (service keys, private keys, high-
     entropy legacy JWTs)
   - no restricted Bilgeon assets (font/binary) reintroduced
   - asset license documentation present and consistent
   - GitHub workflows keep least-privilege permissions
   Exits 1 on any failure. */
import fs from 'node:fs';
import { execSync } from 'node:child_process';

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
  if (!/\.(ts|tsx|mjs|js|json|html|css|toml|ya?ml|md|svg)$/.test(f)) continue;
  const lines = readTracked(f).split('\n');
  lines.forEach((line, i) => {
    // skip comments — the security GUARD code legitimately names what it rejects
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
    for (const [re, label] of secretPatterns) {
      if (re.test(line)) secretHits.push(`${f}:${i + 1}: ${label}`);
    }
    // a legacy service_role JWT assigned to a KEY variable is a real leak
    if (/(KEY|key)[a-zA-Z_]*\s*[:=][^\n]*service_role/.test(line) && !line.includes('payload.role')) {
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

console.log(failures === 0 ? 'SECURITY & LICENSING: ALL PASS' : `SECURITY & LICENSING: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
