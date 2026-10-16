import { hash, verify } from '@node-rs/argon2';

// @node-rs/argon2 defaults: argon2id, m=19456 KiB, t=2, p=1 (OWASP minimum profile)
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
