import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Encrypts small secrets at rest (TOTP seeds). Swap for a KMS-backed implementation without touching callers. */
export interface KeyProvider {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

const PREFIX = 'v1';

/** AES-256-GCM with a 32-byte key from env (base64). Format: `v1.<iv>.<tag>.<ciphertext>` (base64url). */
export class LocalKeyProvider implements KeyProvider {
  private key: Buffer;

  constructor(keyBase64: string) {
    const key = Buffer.from(keyBase64, 'base64');
    if (key.length !== 32) throw new Error('DASHBOARD_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
    this.key = key;
  }

  async encrypt(plaintext: string): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [PREFIX, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
  }

  async decrypt(ciphertext: string): Promise<string> {
    const [prefix, iv, tag, ct] = ciphertext.split('.');
    if (prefix !== PREFIX || !iv || !tag || !ct) throw new Error('unsupported ciphertext format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  }
}
