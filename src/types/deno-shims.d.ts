/* Type shims for the SHARED edge-function modules (supabase/functions/
   _shared/*) — they run under Deno with npm: specifiers, but the vitest
   suites import them directly. These declarations let the app tsc
   type-check the shared modules alongside the browser code. */

declare module 'npm:chess.js@1.4.0' {
  export * from 'chess.js';
}

declare module 'npm:@supabase/supabase-js@2' {
  export * from '@supabase/supabase-js';
  export { createClient as default } from '@supabase/supabase-js';
}

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};
