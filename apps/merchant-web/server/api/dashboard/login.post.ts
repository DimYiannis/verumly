import { z } from 'zod';
import { login } from '@lr/dashboard-core';

const body = z.object({ email: z.string().max(200), password: z.string().max(200) }).strict();

export default publicHandler(async ({ event, ctx }) => {
  rateLimit(event, 'login', useEnv().LOGIN_RATE_LIMIT);
  const { email, password } = body.parse(await readBody(event));
  const r = await login(ctx.deps, email, password);
  if (!r) throw createError({ statusCode: 401, statusMessage: 'invalid email or password' });
  setSessionCookie(event, r.token);
  return { next: r.next };
});
