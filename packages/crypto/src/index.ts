import * as ed from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import canonicalize from 'canonicalize';
import { uuidv7 } from 'uuidv7';
import { randomBytes, timingSafeEqual } from 'node:crypto';

ed.hashes.sha512 = sha512;

export { bytesToHex, hexToBytes };

/** RFC 8785 JCS canonical JSON of a value, as UTF-8 bytes. */
export function jcsBytes(value: unknown): Uint8Array {
  const s = canonicalize(value);
  if (s === undefined) throw new Error('value is not JSON-serialisable');
  return utf8ToBytes(s);
}

export function jcsString(value: unknown): string {
  const s = canonicalize(value);
  if (s === undefined) throw new Error('value is not JSON-serialisable');
  return s;
}

export function sha256Hex(data: Uint8Array | string): string {
  return bytesToHex(sha256(typeof data === 'string' ? utf8ToBytes(data) : data));
}

export function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}
export function fromB64url(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64url'));
}

/** Constant-time equality of two strings of arbitrary length (hashes both first so lengths never leak). */
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = sha256(utf8ToBytes(a));
  const hb = sha256(utf8ToBytes(b));
  return timingSafeEqual(ha, hb);
}

// ---- claim secrets -------------------------------------------------------

export const SECRET_BYTES = 32;
/** 256-bit random secret, base64url (43 chars, no padding). Generated on the terminal. */
export function generateSecret(): string {
  return b64url(new Uint8Array(randomBytes(SECRET_BYTES)));
}
export function isWellFormedSecret(s: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(s);
}
/** Hex sha256 of the secret *string* as it appears in the URL fragment. */
export function hashSecret(secret: string): string {
  return sha256Hex(secret);
}
export function verifySecret(secret: string, storedHashHex: string): boolean {
  return constantTimeEqual(hashSecret(secret), storedHashHex);
}

/** Opaque tokens (API keys, sessions): 32 random bytes, shown once, stored as sha256 hex. */
export function generateToken(): { token: string; hash: string } {
  const token = b64url(new Uint8Array(randomBytes(32)));
  return { token, hash: sha256Hex(token) };
}

// ---- ids -------------------------------------------------------------------

export function newReceiptId(): string {
  return uuidv7();
}
export { uuidv7 };

// ---- ed25519 ---------------------------------------------------------------

export interface KeyPair {
  /** base64url 32-byte seed */
  privateKey: string;
  /** base64url 32-byte public key */
  publicKey: string;
}

export function generateKeyPair(): KeyPair {
  const seed = ed.utils.randomSecretKey();
  return { privateKey: b64url(seed), publicKey: b64url(ed.getPublicKey(seed)) };
}

export function signBytes(privateKeyB64: string, message: Uint8Array): string {
  return b64url(ed.sign(message, fromB64url(privateKeyB64)));
}

export function verifyBytes(publicKeyB64: string, message: Uint8Array, signatureB64: string): boolean {
  try {
    return ed.verify(fromB64url(signatureB64), message, fromB64url(publicKeyB64));
  } catch {
    return false;
  }
}

/** Sign the JCS canonical JSON of a CRF payload. */
export function signPayload(privateKeyB64: string, payload: unknown): string {
  return signBytes(privateKeyB64, jcsBytes(payload));
}
export function verifyPayload(publicKeyB64: string, payload: unknown, signatureB64: string): boolean {
  return verifyBytes(publicKeyB64, jcsBytes(payload), signatureB64);
}

export { ed };
