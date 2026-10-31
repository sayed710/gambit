/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, type Plugin } from 'vite'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Bilgeon Script (PERSONAL USE — see FONTS-LICENSE.md) lives in
 * dev-assets/fonts/, which is gitignored and NEVER copied into dist.
 * This dev-only middleware serves it to the local dev server so the
 * owner can verify the approved typography; production builds from the
 * repository 404 the font and fall back to Fraunces (font-display swap).
 */
function bilgeonDevServer(): Plugin {
  return {
    name: 'bilgeon-dev-font',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/fonts', (req, res, next) => {
        const file = String(req.url || '').replace(/^\//, '')
        if (!/^bilgeon-script\.(ttf|otf)$/.test(file)) return next()
        const full = join(process.cwd(), 'dev-assets', 'fonts', file)
        if (!existsSync(full)) {
          res.statusCode = 404
          return res.end()
        }
        res.setHeader('Content-Type', file.endsWith('.otf') ? 'font/otf' : 'font/ttf')
        res.end(readFileSync(full))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), bilgeonDevServer(), VitePWA({
      strategies: 'injectManifest', // hand-written SW (src/sw.ts) — no runtime module loader
      srcDir: 'src',
      filename: 'sw.ts',
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
      injectManifest: { // (injectManifest strategy reads this key, not `workbox`)
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,woff2,mp3,wasm}'],
        // Stockfish is copied from public/ into dist/ and picked up by the
        // glob WITH revision — additionalManifestEntries would duplicate the
        // URLs and make workbox throw add-to-cache-list-conflicting-entries.
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
