/** Web Push capability detection (v2 §13: say why on iOS instead of failing silently). Pure; the environment is injected. */

export interface PushEnv {
  userAgent: string;
  maxTouchPoints: number;
  /** display-mode: standalone, or iOS `navigator.standalone` */
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: 'default' | 'granted' | 'denied' | 'unsupported';
}

export type PushSupport =
  | { kind: 'ready' }
  | { kind: 'ios-needs-install' }
  | { kind: 'ios-too-old' }
  | { kind: 'denied' }
  | { kind: 'unsupported' };

export function isIos(env: Pick<PushEnv, 'userAgent' | 'maxTouchPoints'>): boolean {
  // iPadOS 13+ reports a desktop Mac user agent but has touch points
  return /iPad|iPhone|iPod/.test(env.userAgent) || (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1);
}

export function iosVersion(userAgent: string): number[] | null {
  const m = /OS (\d+)[_.](\d+)/.exec(userAgent);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export function detectPushSupport(env: PushEnv): PushSupport {
  if (isIos(env)) {
    const v = iosVersion(env.userAgent);
    if (v && (v[0]! < 16 || (v[0] === 16 && v[1]! < 4))) return { kind: 'ios-too-old' };
    // Safari tabs have no PushManager; it appears only for an installed Home Screen app
    if (!env.standalone) return { kind: 'ios-needs-install' };
  }
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return { kind: 'unsupported' };
  if (env.permission === 'denied') return { kind: 'denied' };
  return { kind: 'ready' };
}

export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64Url.length / 4) * 4, '=');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
