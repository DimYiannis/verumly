import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';

export interface ReceivedPush {
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** A browser push subscription as the Push API would hand it out: a real P-256 key pair and a 16-byte auth secret. */
export interface TestSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** every request the worker has POSTed to the endpoint, in arrival order */
  received: ReceivedPush[];
  /** RFC 8291 decryption with this subscription's private key */
  decrypt(push: ReceivedPush): object;
  close(): Promise<void>;
}

/** Local HTTP "push service" on a loopback port (buyer-api allows loopback endpoints because PUSH_ALLOW_LOOPBACK is on in dev). */
export async function startPushEndpoint(): Promise<TestSubscription> {
  const received: ReceivedPush[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(201).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('push endpoint did not bind a TCP port');
  const { port } = address;

  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const uaPublic = ua.getPublicKey();
  const authSecret = randomBytes(16);

  return {
    endpoint: `http://127.0.0.1:${port}/push/${randomBytes(8).toString('hex')}`,
    keys: { p256dh: uaPublic.toString('base64url'), auth: authSecret.toString('base64url') },
    received,
    decrypt(push) {
      // aes128gcm body: salt(16) | record size(4) | key id length(1) | key id (the sender's public key) | ciphertext
      const salt = push.body.subarray(0, 16);
      const idLen = push.body[20] ?? 0;
      const asPublic = push.body.subarray(21, 21 + idLen);
      const ciphertext = push.body.subarray(21 + idLen);
      const ecdhSecret = ua.computeSecret(asPublic);
      const ikm = Buffer.from(hkdfSync('sha256', ecdhSecret, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
      const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
      const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
      const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
      decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
      const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
      let end = padded.length;
      while (end > 0 && padded[end - 1] === 0) end--; // zero padding, then the 0x02 last-record delimiter
      const payload: unknown = JSON.parse(padded.subarray(0, end - 1).toString('utf8'));
      if (typeof payload !== 'object' || payload === null) throw new Error('push payload is not a JSON object');
      return payload;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

