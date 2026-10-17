import tailwindcss from '@tailwindcss/vite';

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },
  modules: ['shadcn-nuxt'],
  shadcn: { prefix: '', componentDir: '@/components/ui' },
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  // The dashboard and the simulator are client-side apps behind an API: no SSR (no cookie forwarding, no
  // hydration mismatch with localStorage/IndexedDB). Nitro still serves /api and /sim-api on the node preset.
  routeRules: { '/dashboard/**': { ssr: false }, '/simulator': { ssr: false } },
  nitro: {
    // workspace packages ship TypeScript sources: bundle them (Node refuses to strip types under node_modules)
    externals: { inline: [/^@lr\//] },
    // pdfmake 0.3 ships no types; @lr/receipt-pdf declares them ambiently
    typescript: { tsConfig: { include: ['../../../packages/receipt-pdf/src/pdfmake.d.ts'] } },
  },
  // the typed $fetch route map imports the server handlers, which import dashboard-core (and so pdfmake)
  typescript: { tsConfig: { include: ['../../../packages/receipt-pdf/src/pdfmake.d.ts'] } },
  app: { head: { title: 'Less Receipts · Merchant', htmlAttrs: { lang: 'en' } } },
});
