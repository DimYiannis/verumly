import tailwindcss from '@tailwindcss/vite';

// The public website: a static page that explains why and how, in English (`/`, `/privacy`) and Dutch (`/nl`, `/nl/privacy`).
// No API, no database, nothing to configure to build it.
// Deploys to Vercel as a Nuxt app (see apps/site/README.md); every route is prerendered.
// Absolute site address for share previews (og:image must be absolute): NUXT_PUBLIC_SITE_URL wins, then Vercel's production
// domain from the build environment; empty (relative image) when neither is set.
const siteUrl = (process.env.NUXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/+$/, '');

// The hosted demo runs on boxd (machine `less-receipts-demo`) at fixed public addresses.
const DEMO_WALLET_URL = 'https://wallet-r7k2.less-receipts-demo.boxd.sh';
const DEMO_DASHBOARD_URL = 'https://dash-r7k2.less-receipts-demo.boxd.sh/dashboard';
const isVercelProduction = process.env.VERCEL_ENV === 'production';

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  // the wallet and dashboard links on the page: NUXT_PUBLIC_WALLET_URL / NUXT_PUBLIC_DASHBOARD_URL win; without them a Vercel
  // production build uses the hosted demo addresses above; other builds leave them empty (dev falls back to localhost, see HomePage.vue)
  runtimeConfig: {
    public: {
      walletUrl: process.env.NUXT_PUBLIC_WALLET_URL || (isVercelProduction ? DEMO_WALLET_URL : ''),
      dashboardUrl: process.env.NUXT_PUBLIC_DASHBOARD_URL || (isVercelProduction ? DEMO_DASHBOARD_URL : ''),
      repoUrl: process.env.NUXT_PUBLIC_REPO_URL ?? '',
      siteUrl,
    },
  },
  nitro: { prerender: { routes: ['/', '/privacy', '/nl', '/nl/privacy'], crawlLinks: true } },
  app: {
    head: {
      // <html lang> is set per page (en / nl) by useLocaleHead and error.vue
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'theme-color', content: '#3338B8' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  typescript: { strict: true },
});
