/* Prebuild gate — runs BEFORE `vite build` substitutes the configured
   key into frontend assets (npm run build -> prebuild -> build). Rejects
   SECRET keys and legacy service_role JWTs before they can be embedded;
   publishable and anon keys pass. No configured key -> nothing to check. */

import { validateClientKey } from './bundle-security-scan.mjs';
import { loadEnv } from 'vite';

// read the key from the SAME source vite would: process.env plus .env /
// .env.production / .env.local / .env.production.local, with vite's own
// precedence — a service key supplied ONLY through .env.production is
// caught here instead of being embedded into the browser bundle
const env = loadEnv('production', process.cwd(), 'VITE_');
const key = env.VITE_SUPABASE_ANON_KEY;
if (!key) {
  process.exit(0); // unconfigured build (local default) — the Online page gates on onlineConfigured()
}

try {
  validateClientKey(key);
  console.log('[prebuild] configured VITE_SUPABASE_ANON_KEY is a safe client key');
} catch (e) {
  console.error(String(e?.message ?? e));
  console.error('[prebuild] refusing to embed this key into frontend assets');
  process.exit(1);
}
