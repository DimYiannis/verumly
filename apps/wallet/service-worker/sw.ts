/// <reference lib="webworker" />
/**
 * Wallet service worker (injectManifest, because generateSW cannot express push + notificationclick):
 * - precaches the app shell, so every route opens offline (saved receipts come from IndexedDB, not from here);
 * - shows Web Push notifications and opens the receipt on click.
 * API calls are cross-origin to buyer-api and are never cached here.
 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { notificationTarget, parsePushPayload } from '../app/utils/push-payload.ts';

interface Manifest {
  __WB_MANIFEST: (string | { url: string; revision: string | null })[];
}
declare const self: ServiceWorkerGlobalScope & Manifest;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
// single-page shell: every navigation (/, /r/<id>, /receipts/<id>…) is answered by the precached shell at '/'
registerRoute(new NavigationRoute(createHandlerBoundToURL('/')));

self.addEventListener('install', () => {
  void self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event.data?.text() ?? null);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // one notification per receipt: a newer version replaces the older one
      tag: payload.receiptId ?? 'receipts',
      data: { receiptId: payload.receiptId, version: payload.version, final: payload.final },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(notificationTarget(event.notification.data), self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        await open.navigate(url);
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
