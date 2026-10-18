# bonnen: the public website

A static page that explains why the product exists and how it works (`/`) and how privacy is built (`/privacy`).
Nuxt 4 + Tailwind 4, styled with the shared tokens in `packages/ui`. No API, no database.

```sh
pnpm --filter @lr/site dev        # http://localhost:3002
pnpm --filter @lr/site generate   # static output in apps/site/.output/public
```

## Deploy to Vercel

1. Import the GitHub repository in Vercel.
2. **Root Directory**: `apps/site`. Keep "Include source files outside of the Root Directory" on (the site uses `packages/ui`).
3. Framework preset: Nuxt. `vercel.json` already sets the install and build commands (pnpm at the repo root).
4. Optional environment variables, used for the demo buttons on the page (all are public):
   - `NUXT_PUBLIC_WALLET_URL`: where the wallet demo is hosted
   - `NUXT_PUBLIC_DASHBOARD_URL`: where the dashboard demo is hosted
   - `NUXT_PUBLIC_REPO_URL`: link to the source (also linked from the demo section's README note)
   - `NUXT_PUBLIC_SITE_URL`: the site's own address (for share previews: the `og:image` must be an absolute URL). When unset, the build uses Vercel's `VERCEL_PROJECT_PRODUCTION_URL` (prefixed with `https://`); with neither, the share image stays a relative path and previews will not show it

The buttons are always shown. Without the first two: in `pnpm dev` they point at the local apps (`http://localhost:3001`, `http://localhost:3000/dashboard`); in a production build (`generate`) they scroll to the demo section, which says the demo goes online soon. After setting the variables in Vercel, redeploy: the values are read at build time.

Content lives in `app/pages/index.vue` (copy) and `app/components/Frag*.vue` (the mini screens, drawn in markup: update them when the app's screens change).
