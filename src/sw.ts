/* Gambit service worker — hand-written (injectManifest strategy).

   Compiled and bundled by Vite as ONE classic script (no runtime module
   loader), with the precache manifest injected at build time. All app
   assets including the 7 MB Stockfish WASM are precached; navigation
   falls back to the app shell so hash routes work offline. User data
   lives in localStorage and is never touched by this worker. */

// minimal ServiceWorkerGlobalScope typing (compiled under the DOM lib)
declare const self: {
  __WB_MANIFEST: { url: string; revision: string | null }[];
  addEventListener(type: string, cb: (event: { data?: { type?: string } }) => void): void;
  skipWaiting(): Promise<void>;
};

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches(); // drop outdated precaches only — user data is not cache storage
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/\/stockfish\//] }));

// update flow: the app asks the waiting worker to take over (user-triggered)
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

export {}; // this file is a worker entry, not an importable module
