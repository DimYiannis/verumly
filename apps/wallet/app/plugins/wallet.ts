import { createWallet } from '~/utils/wallet';

export default defineNuxtPlugin({
  name: 'wallet',
  dependsOn: ['capture-fragment'],
  async setup(nuxtApp) {
    const wallet = await createWallet({ buyerApi: useRuntimeConfig().public.buyerApi, vault: nuxtApp.$secretVault });
    // retry pending claims on app open (v2 §13); `online` and `visibilitychange` are wired inside createWallet
    nuxtApp.hook('app:mounted', () => {
      void wallet.refreshPending().then(wallet.retryPending);
    });
    return { provide: { wallet } };
  },
});
