export type ErrorCode = 'validation' | 'not_found' | 'conflict' | 'unauthenticated';

/** Domain error that the web layer maps to an HTTP status. */
export class DashboardError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'DashboardError';
    this.code = code;
  }
}

export function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'cause' in e && typeof e.cause === 'object' && e.cause !== null && 'code' in e.cause && e.cause.code === '23505';
}
export function isForeignKeyViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'cause' in e && typeof e.cause === 'object' && e.cause !== null && 'code' in e.cause && e.cause.code === '23503';
}
