import tailwindcss from '@tailwindcss/vite';

// The public website: a static page that explains why and how. No API, no database, nothing to configure to build it.
// Deploys to Vercel as a Nuxt app (see apps/site/README.md); every route is prerendered.
export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  // the wallet and dashboard links on the page: set these on Vercel once those apps are hosted
  runtimeConfig: {
    public: {
      walletUrl: process.env.NUXT_PUBLIC_WALLET_URL ?? '',
      dashboardUrl: process.env.NUXT_PUBLIC_DASHBOARD_URL ?? '',
      repoUrl: process.env.NUXT_PUBLIC_REPO_URL ?? '',
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL ?? '',
    },
  },
  nitro: { prerender: { routes: ['/', '/privacy'], crawlLinks: true } },
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'theme-color', content: '#3338B8' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  typescript: { strict: true },
});
