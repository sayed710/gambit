/*
  module-probe — the compatibility gate's self-test target (loaded by
  src/lib/compat.ts probeModuleWorker()). SAME-ORIGIN on purpose: site
  policies that allow the app's own engine workers allow this probe too
  (a blob: worker would be blocked by stricter worker-src policies).

  The source below MUST stay valid ONLY as a JavaScript module: the
  top-level `export {}` is a syntax error in a classic script, so a
  browser that silently downgrades the worker type fails to parse this
  file and the probe correctly reports module workers as unsupported.
*/
export {};
self.postMessage('module-ok');
