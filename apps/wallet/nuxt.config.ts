import tailwindcss from '@tailwindcss/vite';
import { z } from 'zod';
import { loadEnv } from '@lr/config';

// Validated once at startup (v2 §15). Defaults make `pnpm dev` work without a .env file.
const env = loadEnv(
  z.object({
    NUXT_PUBLIC_BUYER_API: z.string().url().default('http://127.0.0.1:4002'),
    NUXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().default(''),
    RECEIPT_HOST: z.string().url().default('http://localhost:3001'),
  }),
);

// Revision of the precached app shell (`/`): changes with every build so installed workers update.
const shellRevision = new Date().toISOString();

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  // Client-rendered shell: the secret lives in the fragment and every API call is a direct browser call to buyer-api,
  // so there is nothing to server-render, and one static shell precaches cleanly for offline use.
  ssr: false,
  devtools: { enabled: false },
  modules: ['shadcn-nuxt', '@vite-pwa/nuxt'],
  shadcn: { prefix: '', componentDir: '@/components/ui' },
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  build: { transpile: ['@lr/schema', '@lr/config'] },
  runtimeConfig: {
    public: {
      buyerApi: env.NUXT_PUBLIC_BUYER_API,
      vapidPublicKey: env.NUXT_PUBLIC_VAPID_PUBLIC_KEY,
      receiptHost: env.RECEIPT_HOST,
    },
  },
  routeRules: {
    // receipt links carry a secret in the fragment: never leak the page URL, never allow framing
    '/**': { headers: { 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'permissions-policy': 'camera=(self), geolocation=(), microphone=()' } },
    '/sw.js': { headers: { 'cache-control': 'no-cache' } },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Receipts',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#3338B8' },
        // The secret is in the URL fragment, which is never sent in Referer, but keep outgoing links clean anyway.
        { name: 'referrer', content: 'no-referrer' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-title', content: 'Receipts' },
      ],
      link: [{ rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }],
    },
  },
  pwa: {
    registerType: 'autoUpdate',
    // Custom worker (push + notificationclick + app-shell precache): injectManifest, not generateSW.
    strategies: 'injectManifest',
    srcDir: '../service-worker',
    filename: 'sw.ts',
    manifest: {
      name: 'Receipts — digital receipts',
      short_name: 'Receipts',
      description: 'Your digital receipts, always at hand.',
      lang: 'en',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#F1F0EA',
      theme_color: '#3338B8',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    injectManifest: {
      globPatterns: ['**/*.{js,css,png,svg,ico,webmanifest}'],
      // `nuxt build` (node preset) has no static index.html: the Nitro server renders the SPA shell, so precache '/' itself.
      additionalManifestEntries: [{ url: '/', revision: shellRevision }],
    },
    client: { installPrompt: false },
    devOptions: { enabled: false, type: 'module' },
  },
  typescript: { strict: true },
});
