import { currentUser, sessionStatus } from '@lr/dashboard-core';

/** Where this browser stands: anonymous, MFA pending (enrol / verify) or ready (with the signed-in user). */
export default publicHandler(async ({ event, ctx }) => {
  const s = await sessionStatus(ctx.deps, sessionToken(event));
  if (s.state !== 'ready') return { state: s.state };
  const { userId, orgId, role } = s.session;
  const u = await currentUser(ctx.deps.db, { userId, orgId, role });
  return { state: s.state, user: { email: u.email, role: u.role, orgName: u.orgName, country: u.country } };
});
