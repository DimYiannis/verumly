import { z } from 'zod';
import { confirmTotpEnrol } from '@lr/dashboard-core';

const body = z.object({ enrolToken: z.string().max(2000), code: z.string().max(10) }).strict();

export default publicHandler(async ({ event, ctx }) => {
  rateLimit(event, 'totp', useEnv().LOGIN_RATE_LIMIT);
  const b = body.parse(await readBody(event));
  await confirmTotpEnrol(ctx.deps, sessionToken(event), b.enrolToken, b.code);
  return { ok: true };
});
