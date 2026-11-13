/* Prebuild gate — runs BEFORE `vite build` substitutes the configured
   key into frontend assets (npm run build -> prebuild -> build). Rejects
   SECRET keys and legacy service_role JWTs before they can be embedded;
   publishable and anon keys pass. No configured key -> nothing to check. */

import { validateClientKey } from './bundle-security-scan.mjs';

const key = process.env.VITE_SUPABASE_ANON_KEY;
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
