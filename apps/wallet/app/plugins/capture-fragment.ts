import { consumeReceiptFragment } from '~/utils/receipt-link';

/**
 * Runs before the router and before any request: the secret in `/r/<id>#<secret>` is moved into memory and the
 * fragment is removed from the address bar with history.replaceState (v2 §2.5).
 */
export default defineNuxtPlugin({
  name: 'capture-fragment',
  enforce: 'pre',
  setup(nuxtApp) {
    const vault: Record<string, string> = {};
    const env = { location: window.location, history: window.history };
    consumeReceiptFragment(env, vault);
    // a link opened inside an already running app (same-document navigation)
    nuxtApp.hook('page:finish', () => {
      consumeReceiptFragment(env, vault);
    });
    return { provide: { secretVault: vault } };
  },
});
