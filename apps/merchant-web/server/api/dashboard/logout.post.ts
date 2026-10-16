import { logout } from '@lr/dashboard-core';

export default publicHandler(async ({ event, ctx }) => {
  await logout(ctx.deps, sessionToken(event));
  deleteCookie(event, cookieName(), { path: '/' });
  return { ok: true };
});
