import { describe, expect, it } from 'vitest';
import { corsOrigins } from '../src/app.ts';

describe('corsOrigins', () => {
  it('adds the loopback twin of a local wallet origin, so localhost and 127.0.0.1 both work', () => {
    expect(corsOrigins('http://localhost:3001')).toEqual(['http://localhost:3001', 'http://127.0.0.1:3001']);
    expect(corsOrigins('http://127.0.0.1:3001')).toEqual(['http://127.0.0.1:3001', 'http://localhost:3001']);
  });
  it('allows a real origin exactly as configured, nothing more', () => {
    expect(corsOrigins('https://wallet.example.com')).toEqual(['https://wallet.example.com']);
    expect(corsOrigins('not a url')).toEqual(['not a url']);
  });
});
