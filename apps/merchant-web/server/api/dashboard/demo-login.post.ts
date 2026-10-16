import { z } from 'zod';
import { demoLogin } from '@lr/dashboard-core';

const body = z.object({ email: z.string().max(200), password: z.string().max(200) }).strict();

export default publicHandler(async ({ event, ctx }) => {
  if (!useEnv().DEMO_MODE) throw createError({ statusCode: 404, statusMessage: 'not found' });
  rateLimit(event, 'login', useEnv().LOGIN_RATE_LIMIT);
  const { email, password } = body.parse(await readBody(event));
  // development only: password check as usual, MFA answered server-side
  const r = await demoLogin(ctx.deps, email, password);
  if (!r) throw createError({ statusCode: 401, statusMessage: 'invalid email or password' });
  setSessionCookie(event, r.token);
  return { ok: true };
});
