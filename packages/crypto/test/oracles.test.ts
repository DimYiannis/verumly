import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ed from '@noble/ed25519';
import {
  bytesToHex,
  constantTimeEqual,
  generateKeyPair,
  generateSecret,
  hashSecret,
  hexToBytes,
  isWellFormedSecret,
  jcsBytes,
  newReceiptId,
  signPayload,
  verifyPayload,
  verifySecret,
} from '../src/index.ts';

const here = new URL('.', import.meta.url).pathname;

describe('RFC 8032 §7.1 Ed25519 vectors (outside oracle)', () => {
  const vectors = JSON.parse(readFileSync(join(here, 'vectors/rfc8032.json'), 'utf8')) as {
    name: string;
    secretKey: string;
    publicKey: string;
    message: string;
    signature: string;
  }[];
  it('has the five published vectors', () => expect(vectors).toHaveLength(5));
  for (const v of vectors) {
    it(`TEST ${v.name}: public key, signature, verification`, () => {
      const sk = hexToBytes(v.secretKey);
      const msg = hexToBytes(v.message);
      expect(bytesToHex(ed.getPublicKey(sk))).toBe(v.publicKey);
      expect(bytesToHex(ed.sign(msg, sk))).toBe(v.signature);
      expect(ed.verify(hexToBytes(v.signature), msg, hexToBytes(v.publicKey))).toBe(true);
      if (msg.length > 0) {
        const bad = Uint8Array.from(msg);
        bad[0] = bad[0]! ^ 1;
        expect(ed.verify(hexToBytes(v.signature), bad, hexToBytes(v.publicKey))).toBe(false);
      }
    });
  }
});

describe('RFC 8785 JCS test data (cyberphone/json-canonicalization) through canonicalize', () => {
  const dir = join(here, 'vectors/jcs');
  const files = readdirSync(join(dir, 'input')).sort();
  it('has all six upstream data files', () => expect(files).toHaveLength(6));
  for (const f of files) {
    it(`${f}`, () => {
      const input = JSON.parse(readFileSync(join(dir, 'input', f), 'utf8'));
      const expected = readFileSync(join(dir, 'output', f));
      expect(Buffer.from(jcsBytes(input)).equals(expected)).toBe(true);
    });
  }
});

describe('UUIDv7 per RFC 9562', () => {
  it('has version 7, variant 10, and a 48-bit ms timestamp prefix', () => {
    const before = Date.now();
    const id = newReceiptId();
    const after = Date.now();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const ts = parseInt(id.replace(/-/g, '').slice(0, 12), 16);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
  it('is monotonically increasing when generated in sequence', () => {
    const ids = Array.from({ length: 200 }, () => newReceiptId());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(200);
  });
});

describe('secrets and signatures', () => {
  it('secret is 256-bit base64url, hashed as sha256 hex, verified constant-time', () => {
    const s = generateSecret();
    expect(isWellFormedSecret(s)).toBe(true);
    expect(Buffer.from(s, 'base64url')).toHaveLength(32);
    expect(hashSecret(s)).toMatch(/^[0-9a-f]{64}$/);
    expect(verifySecret(s, hashSecret(s))).toBe(true);
    expect(verifySecret(generateSecret(), hashSecret(s))).toBe(false);
    expect(constantTimeEqual('a', 'ab')).toBe(false);
  });
  it('sign/verify over JCS is key-order independent and tamper evident', () => {
    const kp = generateKeyPair();
    const sig = signPayload(kp.privateKey, { b: 1, a: [1, 2], c: { y: 1, x: 2 } });
    expect(verifyPayload(kp.publicKey, { c: { x: 2, y: 1 }, a: [1, 2], b: 1 }, sig)).toBe(true);
    expect(verifyPayload(kp.publicKey, { c: { x: 2, y: 1 }, a: [1, 2], b: 2 }, sig)).toBe(false);
    expect(verifyPayload(generateKeyPair().publicKey, { b: 1, a: [1, 2], c: { y: 1, x: 2 } }, sig)).toBe(false);
    expect(verifyPayload('garbage', {}, sig)).toBe(false);
  });
});
