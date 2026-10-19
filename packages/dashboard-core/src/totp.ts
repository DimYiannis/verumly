import * as OTPAuth from 'otpauth';

export const TOTP_ISSUER = 'Syngrapha';

function totpFor(secretBase32: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

/** A fresh 160-bit TOTP seed: base32 secret plus the otpauth:// URI for authenticator apps. */
export function newTotpSecret(label: string): { secret: string; uri: string } {
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  return { secret, uri: totpFor(secret, label).toString() };
}

/** Accepts the current code and one step either side (±30 s clock drift). */
export function verifyTotp(secretBase32: string, code: string, at = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return totpFor(secretBase32, 'x').validate({ token: code, timestamp: at, window: 1 }) !== null;
}

export function currentTotp(secretBase32: string, at = Date.now()): string {
  return totpFor(secretBase32, 'x').generate({ timestamp: at });
}
