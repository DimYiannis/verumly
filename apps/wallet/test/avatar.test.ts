import { describe, expect, it } from 'vitest';
import { initialsOf, LOGO_COLORS, logoColor, personTone, PERSON_TONES } from '../app/utils/avatar.ts';

describe('initialsOf', () => {
  it('takes two words', () => {
    expect(initialsOf('Café Het Plein')).toBe('CH');
    expect(initialsOf('bakkerij zonnig')).toBe('BZ');
  });
  it('takes two letters of a single word', () => {
    expect(initialsOf('Anna')).toBe('AN');
    expect(initialsOf('@sam_jones')).toBe('SJ');
  });
  it('handles one letter and empty names', () => {
    expect(initialsOf('X')).toBe('X');
    expect(initialsOf('  ')).toBe('?');
    expect(initialsOf('')).toBe('?');
  });
});

describe('colours', () => {
  it('are stable and case-insensitive', () => {
    expect(logoColor('Café Het Plein')).toBe(logoColor(' café het plein '));
    expect(personTone('Anna')).toBe(personTone('anna'));
  });
  it('come from the palettes', () => {
    expect(LOGO_COLORS).toContain(logoColor('Bioscoop Rex'));
    expect(PERSON_TONES).toContain(personTone('Lisa'));
  });
});
