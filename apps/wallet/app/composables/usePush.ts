import { z } from 'zod';
import type { MessageKey } from '~/i18n';
import { ApiError } from '~/utils/api';
import { detectPushSupport, urlBase64ToUint8Array, type PushEnv, type PushSupport } from '~/utils/push';

function currentEnv(): PushEnv {
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && navigator.standalone === true),
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: 'PushManager' in window,
    hasNotification: 'Notification' in window,
    permission: 'Notification' in window ? Notification.permission : 'unsupported',
  };
}

const SUBSCRIPTION_KEY = 'pushSubscriptionId';

/** Web Push opt-in. Never fails silently: every dead end sets `support` or `error` for the UI. */
export function usePush() {
  const wallet = useWallet();
  const config = useRuntimeConfig();
  const support = ref<PushSupport>({ kind: 'unsupported' });
  const subscribed = ref(false);
  const busy = ref(false);
  /** a dictionary key, translated by the UI so it follows a language switch */
  const error = ref<MessageKey | null>(null);

  async function refresh() {
    support.value = detectPushSupport(currentEnv());
    subscribed.value = (await wallet.kv.get(SUBSCRIPTION_KEY, z.string())) !== undefined;
  }

  async function enable() {
    busy.value = true;
    error.value = null;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        error.value = 'push.err.denied';
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        error.value = 'push.err.noRegistration';
        return;
      }
      const key = config.public.vapidPublicKey || (await wallet.api.vapidPublicKey()).publicKey;
      if (!key) {
        error.value = 'push.err.noKey';
        return;
      }
      const sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
      const json = sub.toJSON();
      const p256dh = json.keys?.p256dh;
      const auth = json.keys?.auth;
      if (!json.endpoint || !p256dh || !auth) {
        error.value = 'push.err.badSubscription';
        return;
      }
      const { id } = await wallet.api.addPushSubscription({ endpoint: json.endpoint, keys: { p256dh, auth } });
      await wallet.kv.set(SUBSCRIPTION_KEY, id);
      await wallet.api.putConsents({ push: true });
    } catch (e) {
      error.value = e instanceof ApiError && e.isNetwork ? 'push.err.offline' : 'push.err.enableFailed';
    } finally {
      busy.value = false;
      await refresh();
    }
  }

  async function disable() {
    busy.value = true;
    error.value = null;
    try {
      const id = await wallet.kv.get(SUBSCRIPTION_KEY, z.string());
      const registration = await navigator.serviceWorker.getRegistration();
      await (await registration?.pushManager.getSubscription())?.unsubscribe();
      if (id) await wallet.api.removePushSubscription(id);
      await wallet.kv.delete(SUBSCRIPTION_KEY);
      await wallet.api.putConsents({ push: false });
    } catch {
      error.value = 'push.err.disableFailed';
    } finally {
      busy.value = false;
      await refresh();
    }
  }

  onMounted(refresh);
  return { support, subscribed, busy, error, enable, disable };
}
