import { demoLogin } from '@lr/dashboard-core';
import { DEMO_OWNER } from '../../utils/demo.ts';

export default publicHandler(async ({ event, ctx }) => {
  if (!useEnv().DEMO_MODE) throw createError({ statusCode: 404, statusMessage: 'not found' });
  rateLimit(event, 'login', useEnv().LOGIN_RATE_LIMIT);
  const r = await demoLogin(ctx.deps, DEMO_OWNER.email, DEMO_OWNER.password);
  if (!r) throw createError({ statusCode: 404, statusMessage: 'demo user not seeded: run pnpm db:seed' });
  setSessionCookie(event, r.token);
  return { ok: true };
});
