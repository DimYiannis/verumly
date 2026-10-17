export const ROLES = ['owner', 'manager', 'accountant'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'org.read',
  'org.write',
  'locations.read',
  'locations.write',
  'terminals.read',
  'terminals.write',
  'users.read',
  'users.write',
  'archive.read',
  'reports.read',
  'exports.read',
  'exports.create',
  'billing.read',
  'billing.write',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * owner: everything. manager: operations (locations, terminals) but no organisation settings, no user management and
 * no billing. accountant: read-only; reads plus exports, and the subscription and its invoices (no plan changes).
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: PERMISSIONS.filter((p) => !p.startsWith('users.') && !p.startsWith('billing.') && p !== 'org.write'),
  accountant: ['org.read', 'locations.read', 'archive.read', 'reports.read', 'exports.read', 'exports.create', 'billing.read'],
};

/** The authenticated, MFA-completed dashboard user. Built only by `resolveSession`. */
export interface Actor {
  userId: string;
  orgId: string;
  role: Role;
}

export class ForbiddenError extends Error {
  readonly permission: Permission;
  constructor(permission: Permission) {
    super(`forbidden: ${permission}`);
    this.name = 'ForbiddenError';
    this.permission = permission;
  }
}

/** Server-side authorisation gate. Every dashboard-core function that reads or writes org data calls this. */
export function requireRole(actor: Pick<Actor, 'role'>, permission: Permission): void {
  if (!ROLE_PERMISSIONS[actor.role].includes(permission)) throw new ForbiddenError(permission);
}
