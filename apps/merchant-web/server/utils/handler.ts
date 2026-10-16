import type { H3Event } from 'h3';
import { z } from 'zod';
import { DashboardError, ForbiddenError, requireRole, resolveSession, SESSION_TTL_MS, type Actor, type Permission } from '@lr/dashboard-core';
import { getCtx, type Ctx } from './ctx.ts';
import { useEnv } from './env.ts';

const STATUS = { validation: 400, not_found: 404, conflict: 409, unauthenticated: 401 } as const;

/** Domain errors become their HTTP status; anything else is a bare 500 (error text can contain SQL parameters). */
function toHttpError(e: unknown) {
  if (e instanceof DashboardError) return createError({ statusCode: STATUS[e.code], statusMessage: e.message });
  if (e instanceof ForbiddenError) return createError({ statusCode: 403, statusMessage: 'forbidden' });
  if (e instanceof z.ZodError) return createError({ statusCode: 400, statusMessage: 'invalid request' });
  if (typeof e === 'object' && e !== null && 'statusCode' in e) return e;
  console.error('dashboard: unhandled error', e instanceof Error ? e.name : typeof e);
  return createError({ statusCode: 500, statusMessage: 'internal error' });
}

export function cookieName(): string {
  return useEnv().cookieSecure ? '__Host-lr_dashboard' : 'lr_dashboard';
}

export function setSessionCookie(event: H3Event, token: string): void {
  setCookie(event, cookieName(), token, { httpOnly: true, sameSite: 'lax', secure: useEnv().cookieSecure, path: '/', maxAge: SESSION_TTL_MS / 1000 });
}

export function sessionToken(event: H3Event): string {
  return getCookie(event, cookieName()) ?? '';
}

/** Public (pre-auth) endpoint: no-store, errors mapped. */
export function publicHandler<T>(fn: (a: { event: H3Event; ctx: Ctx }) => Promise<T>) {
  return defineEventHandler(async (event) => {
    setResponseHeader(event, 'cache-control', 'no-store');
    try {
      return await fn({ event, ctx: getCtx() });
    } catch (e) {
      throw toHttpError(e);
    }
  });
}

/**
 * Authenticated dashboard endpoint. The session cookie must belong to an MFA-completed session; `permission`
 * is checked here (dashboard-core checks it again for every call that takes an actor).
 */
export function dashboardHandler<T>(permission: Permission | null, fn: (a: { event: H3Event; actor: Actor; ctx: Ctx }) => Promise<T>) {
  return publicHandler(async ({ event, ctx }) => {
    const session = await resolveSession(ctx.deps, sessionToken(event));
    if (!session) throw new DashboardError('unauthenticated', 'not signed in');
    const actor: Actor = { userId: session.userId, orgId: session.orgId, role: session.role };
    if (permission) requireRole(actor, permission);
    return fn({ event, actor, ctx });
  });
}

/** Small fixed-window limiter per client IP and bucket (per process; a shared store is a deployment decision). */
const windows: Record<string, { n: number; reset: number }> = {};
export function rateLimit(event: H3Event, bucket: string, max: number, windowMs = 5 * 60_000): void {
  const key = `${bucket}:${getRequestIP(event) ?? 'unknown'}`;
  const now = Date.now();
  const w = windows[key];
  if (!w || w.reset < now) {
    windows[key] = { n: 1, reset: now + windowMs };
    return;
  }
  if (++w.n > max) throw createError({ statusCode: 429, statusMessage: 'too many attempts' });
}
