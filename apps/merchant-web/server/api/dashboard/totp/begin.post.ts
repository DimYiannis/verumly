import { beginTotpEnrol } from '@lr/dashboard-core';

export default publicHandler(async ({ event, ctx }) => {
  rateLimit(event, 'totp', useEnv().LOGIN_RATE_LIMIT);
  return beginTotpEnrol(ctx.deps, sessionToken(event));
});
