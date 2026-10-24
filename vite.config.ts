/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false, // src/lib/pwa.ts registers manually for status control // never interrupt an active game — the user reloads
      includeAssets: ['favicon.svg', 'icons.svg', 'pwa/icon-192.png', 'pwa/icon-512.png', 'pwa/icon-maskable-512.png'],
      manifest: {
        name: 'Gambit — Play Chess',
        short_name: 'Gambit',
        description: 'A calm, focused place to play chess: engine games, puzzles, repertoire, review and training — all on your device.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#F5F1E8',
        theme_color: '#1C1A17',
        icons: [
          { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,mp3,wasm}'],
        // Stockfish lives in public/ and is NOT hashed — precache both files
        // deliberately so the engine runs with zero network access.
        additionalManifestEntries: [
          { url: '/stockfish/stockfish-18-lite-single.js', revision: null },
          { url: '/stockfish/stockfish-18-lite-single.wasm', revision: null },
        ],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/stockfish\//],
        cleanupOutdatedCaches: true, // old precaches go; localStorage user data is never touched
        // 7 MB of WASM on first install is the honest price of an offline engine
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      devOptions: { enabled: false }, // keep HMR/dev-server behavior untouched
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
