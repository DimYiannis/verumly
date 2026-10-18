/** In demo mode only the listed demo accounts sign in without a code; any other address uses the e-mail code flow. */
export function isDemoAddress(demoUsers: ReadonlyArray<{ email: string }>, typed: string): boolean {
  const e = typed.trim().toLowerCase();
  return demoUsers.some((u) => u.email.toLowerCase() === e);
}
