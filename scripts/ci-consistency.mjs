/* CI consistency probe — three modes:
   workflows  every .github/workflows/*.yml parses as YAML and declares
              least-privilege permissions
   repo       repository invariants: license docs present, no restricted
              Bilgeon assets, required package scripts exist
   dist       production-build invariants: PWA manifest, service worker,
              Stockfish wasm, licensed fonts, brand lockup
   Exits 1 on any failure. */
import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures += 1;
};
const exists = (p) => fs.existsSync(p);

const mode = process.argv[2] ?? 'repo';
if (!['workflows', 'repo', 'dist'].includes(mode)) {
  console.error(`FAIL  unknown consistency mode "${mode}" (workflows | repo | dist)`);
  process.exit(1);
}

if (mode === 'workflows') {
  const YAML = (await import('yaml')).default;
  const dir = '.github/workflows';
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.yml') || n.endsWith('.yaml'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    // REAL parse: a malformed step or mapping fails the job here —
    // regex anchors alone cannot catch broken step structure
    let doc;
    try {
      doc = YAML.parse(text);
      check(`${f}: parses as YAML`, true);
    } catch (e) {
      check(`${f}: parses as YAML`, false, String(e).slice(0, 120));
      continue;
    }
    const jobs = doc?.jobs ?? {};
    check(`${f}: jobs defined`, Object.keys(jobs).length > 0);
    const triggers = doc[true] ?? doc.on ?? {};
    check(`${f}: pull_request or push trigger`, Boolean(triggers.pull_request || triggers.push));
    check(`${f}: least-privilege permissions`, doc.permissions?.contents === 'read');
    check(`${f}: concurrency cancellation`, doc.concurrency?.['cancel-in-progress'] === true);
    check(`${f}: every job has a timeout`, Object.values(jobs).every((j) => typeof j['timeout-minutes'] === 'number'));
    check(`${f}: no pull_request_target (untrusted checkout)`, !text.includes('pull_request_target'));
    check(`${f}: no secrets referenced`, !/\$\{\{ *secrets\./.test(text));
  }
}

if (mode === 'repo') {
  check('ASSET-LICENSES.md present', exists('ASSET-LICENSES.md'));
  check('OFL license text ships for Great Vibes', exists('public/fonts/OFL-GreatVibes.txt'));
  check('hero license record present', exists('hero-image-license.json'));
  check('Bilgeon font absent from the tree', !exists('public/fonts/bilgeon-script.ttf'));
  check('legacy queen.png absent (superseded by the lockup)', !exists('public/brand/queen.png'));
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  for (const script of ['build', 'lint', 'test', 'preview']) {
    check(`package.json script "${script}" exists`, typeof pkg.scripts?.[script] === 'string');
  }
  check('@supabase/supabase-js is a runtime dependency', Boolean(pkg.dependencies?.['@supabase/supabase-js']));
  const navSrc = fs.readFileSync('src/lib/navSection.ts', 'utf8');
  check('nav declares the Online section', navSrc.includes("'/online'"));
}

if (mode === 'dist') {
  check('dist/index.html exists', exists('dist/index.html'));
  check('PWA manifest exists', exists('dist/manifest.webmanifest'));
  check('service worker exists', exists('dist/sw.js'));
  check('Stockfish WASM bundled', fs.readdirSync('dist').some((e) => e.includes('stockfish')) ||
    (exists('dist/sf') || fs.readdirSync('dist/assets').some((e) => e.includes('stockfish'))));
  check('Great Vibes font bundled', exists('dist/fonts/GreatVibes-Regular.ttf'));
  check('OFL license bundled', exists('dist/fonts/OFL-GreatVibes.txt'));
  check('brand lockup bundled', exists('dist/brand/gambit-lockup.png'));
  check('hero photo bundled', exists('dist/assets/hero-chess.jpg'));
  check('Bilgeon font NOT in the build', !exists('dist/fonts/bilgeon-script.ttf'));
  const manifest = JSON.parse(fs.readFileSync('dist/manifest.webmanifest', 'utf8'));
  check('manifest declares the app name', (manifest.name ?? '').includes('Gambit'));
  check('manifest has 192 + 512 icons', (manifest.icons ?? []).some((i) => i.sizes === '192x192') && (manifest.icons ?? []).some((i) => i.sizes === '512x512'));
}

console.log(failures === 0 ? `CONSISTENCY (${mode}): ALL PASS` : `CONSISTENCY (${mode}): ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
