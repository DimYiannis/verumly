import { describe, expect, it } from 'vitest';
import { isDemoAddress } from '../app/utils/login-mode.ts';

const users = [{ email: 'buyer@example.test' }, { email: 'friend@example.test' }];

describe('isDemoAddress', () => {
  it('matches listed demo accounts, ignoring case and spaces', () => {
    expect(isDemoAddress(users, ' Buyer@Example.test ')).toBe(true);
  });
  it('sends any other address to the e-mail code flow', () => {
    expect(isDemoAddress(users, 'someone@example.test')).toBe(false);
    expect(isDemoAddress([], 'buyer@example.test')).toBe(false);
  });
});
