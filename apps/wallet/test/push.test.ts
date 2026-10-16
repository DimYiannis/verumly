import { describe, expect, it } from 'vitest';
import { detectPushSupport, urlBase64ToUint8Array, type PushEnv } from '../app/utils/push.ts';
import { notificationTarget, parsePushPayload } from '../app/utils/push-payload.ts';

const base: PushEnv = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130',
  maxTouchPoints: 0,
  standalone: false,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  permission: 'default',
};
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1';

describe('detectPushSupport', () => {
  it('is ready on a normal browser', () => {
    expect(detectPushSupport(base)).toEqual({ kind: 'ready' });
  });
  it('tells iOS Safari tabs to Add to Home Screen instead of failing silently', () => {
    expect(detectPushSupport({ ...base, userAgent: IPHONE, maxTouchPoints: 5, hasPushManager: false })).toEqual({ kind: 'ios-needs-install' });
  });
  it('is ready on an installed iOS 16.4+ app', () => {
    expect(detectPushSupport({ ...base, userAgent: IPHONE, maxTouchPoints: 5, standalone: true })).toEqual({ kind: 'ready' });
  });
  it('flags iOS older than 16.4', () => {
    const old = IPHONE.replace('17_4', '16_3');
    expect(detectPushSupport({ ...base, userAgent: old, standalone: true })).toEqual({ kind: 'ios-too-old' });
    expect(detectPushSupport({ ...base, userAgent: IPHONE.replace('17_4', '16_4'), standalone: true })).toEqual({ kind: 'ready' });
  });
  it('treats iPadOS (desktop UA + touch) as iOS', () => {
    const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15';
    expect(detectPushSupport({ ...base, userAgent: ipad, maxTouchPoints: 5 }).kind).toBe('ios-needs-install');
    expect(detectPushSupport({ ...base, userAgent: ipad, maxTouchPoints: 0 }).kind).toBe('ready');
  });
  it('reports denied and unsupported', () => {
    expect(detectPushSupport({ ...base, permission: 'denied' })).toEqual({ kind: 'denied' });
    expect(detectPushSupport({ ...base, hasPushManager: false })).toEqual({ kind: 'unsupported' });
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes a VAPID public key', () => {
    const bytes = urlBase64ToUint8Array('BEl62iUYgUivxIkv69yViEuiBIa-ib37J8xQmr');
    expect(bytes[0]).toBe(0x04);
    expect(bytes.length).toBe(28);
  });
});

describe('push payload', () => {
  const id = '0199f3a2-7c1e-7a55-9c3e-5d8f2b6a1c40';
  it('parses the worker payload', () => {
    expect(parsePushPayload(JSON.stringify({ title: 'Bon bijgewerkt', body: 'Definitief', receiptId: id, version: 3, final: true }))).toEqual({
      title: 'Bon bijgewerkt',
      body: 'Definitief',
      receiptId: id,
      version: 3,
      final: true,
    });
  });
  it('falls back to a generic notification on junk (a push must always show something)', () => {
    for (const raw of [null, '', 'not json', '42', 'null', '{"receiptId":"x"}']) {
      const p = parsePushPayload(raw);
      expect(p.title).toBe('Bonnen');
      expect(p.receiptId).toBeNull();
    }
  });
  it('opens the receipt detail, or the wallet when the id is unusable', () => {
    expect(notificationTarget({ receiptId: id })).toBe(`/receipts/${id}`);
    expect(notificationTarget({ receiptId: '../x' })).toBe('/');
    expect(notificationTarget(null)).toBe('/');
    expect(notificationTarget({})).toBe('/');
  });
});
