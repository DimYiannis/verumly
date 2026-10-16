import { describe, expect, it } from 'vitest';
import { consumeReceiptFragment, parseReceiptLink } from '../app/utils/receipt-link.ts';

const ID = '0199f3a2-7c1e-7a55-9c3e-5d8f2b6a1c40';
const SECRET = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MEFCQ0RFRkdISUo';

describe('parseReceiptLink', () => {
  it('accepts a full URL with a UUIDv7 and a 43-char base64url secret', () => {
    expect(SECRET).toHaveLength(43);
    expect(parseReceiptLink(`https://wallet.example/r/${ID}#${SECRET}`)).toEqual({ receiptId: ID, secret: SECRET });
  });

  it('accepts a bare path and a trailing slash', () => {
    expect(parseReceiptLink(`/r/${ID}/#${SECRET}`)).toEqual({ receiptId: ID, secret: SECRET });
  });

  it('accepts base64url characters - and _', () => {
    const s = `${'-_'.repeat(21)}A`;
    expect(parseReceiptLink(`/r/${ID}#${s}`)?.secret).toBe(s);
  });

  it.each([
    ['no fragment', `/r/${ID}`],
    ['empty fragment', `/r/${ID}#`],
    ['secret too short', `/r/${ID}#${SECRET.slice(1)}`],
    ['secret too long', `/r/${ID}#${SECRET}A`],
    ['secret with padding', `/r/${ID}#${SECRET.slice(0, 42)}=`],
    ['secret with + or /', `/r/${ID}#${SECRET.slice(0, 41)}+/`],
    ['uuid v4 (not v7)', `/r/0199f3a2-7c1e-4a55-9c3e-5d8f2b6a1c40#${SECRET}`],
    ['uuid with bad variant', `/r/0199f3a2-7c1e-7a55-1c3e-5d8f2b6a1c40#${SECRET}`],
    ['uppercase uuid', `/r/${ID.toUpperCase()}#${SECRET}`],
    ['not a uuid', `/r/not-a-receipt#${SECRET}`],
    ['wrong path', `/x/${ID}#${SECRET}`],
    ['extra path segment', `/r/${ID}/extra#${SECRET}`],
    ['secret in query instead of fragment', `/r/${ID}?s=${SECRET}`],
    ['garbage', 'http://'],
  ])('rejects %s', (_name, url) => {
    expect(parseReceiptLink(url)).toBeNull();
  });
});

function fakeEnv(pathname: string, hash: string, search = '') {
  const calls: { state: unknown; url: string | null | undefined }[] = [];
  return {
    calls,
    env: {
      location: { pathname, search, hash },
      history: {
        state: { position: 3 },
        replaceState(state: unknown, _unused: string, url?: string | null) {
          calls.push({ state, url });
        },
      },
    },
  };
}

describe('consumeReceiptFragment', () => {
  it('moves the secret into the vault and strips the fragment with replaceState, keeping path, query and history state', () => {
    const { env, calls } = fakeEnv(`/r/${ID}`, `#${SECRET}`, '?x=1');
    const vault: Record<string, string> = {};
    expect(consumeReceiptFragment(env, vault)).toEqual({ receiptId: ID, secret: SECRET });
    expect(vault).toEqual({ [ID]: SECRET });
    expect(calls).toEqual([{ state: { position: 3 }, url: `/r/${ID}?x=1` }]);
    expect(calls[0]?.url).not.toContain('#');
  });

  it('strips a malformed fragment on /r/ without storing anything', () => {
    const { env, calls } = fakeEnv(`/r/${ID}`, '#short');
    const vault: Record<string, string> = {};
    expect(consumeReceiptFragment(env, vault)).toBeNull();
    expect(vault).toEqual({});
    expect(calls).toHaveLength(1);
  });

  it('leaves other pages and fragment-less URLs alone', () => {
    const other = fakeEnv('/settings', `#${SECRET}`);
    expect(consumeReceiptFragment(other.env, {})).toBeNull();
    expect(other.calls).toHaveLength(0);
    const bare = fakeEnv(`/r/${ID}`, '');
    expect(consumeReceiptFragment(bare.env, {})).toBeNull();
    expect(bare.calls).toHaveLength(0);
  });
});
