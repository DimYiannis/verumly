import { z } from 'zod';
import { verifyTotpLogin } from '@lr/dashboard-core';

const body = z.object({ code: z.string().max(10) }).strict();

export default publicHandler(async ({ event, ctx }) => {
  rateLimit(event, 'totp', useEnv().LOGIN_RATE_LIMIT);
  await verifyTotpLogin(ctx.deps, sessionToken(event), body.parse(await readBody(event)).code);
  return { ok: true };
});
