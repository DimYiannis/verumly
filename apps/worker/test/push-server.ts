import { createECDH, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';

export interface PushRequest {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export interface PushServer {
  baseUrl: string;
  requests: PushRequest[];
  /** HTTP status per path (default 201) */
  status: Record<string, number>;
  close(): Promise<void>;
}

/** A local push service: records every request and answers with a configurable status per path. */
export async function startPushServer(): Promise<PushServer> {
  const requests: PushRequest[] = [];
  const status: Record<string, number> = {};
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const path = req.url ?? '/';
      requests.push({ path, headers: req.headers, body: Buffer.concat(chunks) });
      res.statusCode = status[path] ?? 201;
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (typeof addr !== 'object' || addr === null) throw new Error('no address');
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    requests,
    status,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export interface BrowserSubscription {
  p256dh: string;
  auth: string;
  /** the browser-side private key, so the test can decrypt what the worker sent */
  privateKey: Buffer;
}

/** What a browser's PushManager.subscribe() would hand over: a P-256 key pair and a 16-byte auth secret. */
export function browserSubscription(): BrowserSubscription {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url'), privateKey: ecdh.getPrivateKey() };
}

/** RFC 8291 / RFC 8188 `aes128gcm` decryption with the subscription's private key. Throws on any tampering. */
export function decryptWebPush(sub: BrowserSubscription, body: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLen = body[20]!;
  const asPublic = body.subarray(21, 21 + idLen);
  const ciphertext = body.subarray(21 + idLen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(sub.privateKey);
  const uaPublic = Buffer.from(sub.p256dh, 'base64url');
  const secret = ecdh.computeSecret(asPublic);
  const ikm = Buffer.from(hkdfSync('sha256', secret, Buffer.from(sub.auth, 'base64url'), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  // plaintext || 0x02 (last-record delimiter) || zero padding
  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0) end--;
  if (padded[end - 1] !== 2) throw new Error('missing padding delimiter');
  return padded.subarray(0, end - 1).toString('utf8');
}
