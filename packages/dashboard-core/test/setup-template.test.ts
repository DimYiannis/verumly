import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultReceiptTemplate } from '@lr/schema';
import { ForbiddenError, getOrganization, getReceiptTemplate, resetReceiptTemplate, updateOrganization, updateReceiptTemplate, type Actor } from '../src/index.ts';
import { fixture, userWithRole, type Fixture } from './helpers.ts';

let f: Fixture;
let owner: Actor;
let accountant: Actor;

beforeAll(async () => {
  f = await fixture('dc_setup');
  owner = (await userWithRole(f, 0, 'owner')).actor;
  accountant = (await userWithRole(f, 0, 'accountant')).actor;
});
afterAll(() => f.close());

// VAT ids are unique per organisation: this must differ from the ids the helper orgs are seeded with (helpers.ts).
const base = { legalName: 'Café Test GmbH', retentionYears: 8, vatNumber: 'DE987654321' };

describe('business setup per country', () => {
  it('stores the declared country, registry number and its legal settings', async () => {
    const org = await updateOrganization(f.dash.db, owner, {
      ...base,
      country: 'DE',
      kvkNumber: '12/345/67890',
      compliance: { tseSerial: 'AB12CD', tillId: 'K-1', tillRegisteredAt: true, digitalConsentMode: 'explicit_opt_in' },
      confirmLegal: true,
    });
    expect(org.country).toBe('DE');
    expect(org.compliance).toMatchObject({ country: 'DE', values: { tseSerial: 'AB12CD' } });
    expect((org.compliance as { confirmedAt: string | null }).confirmedAt).toEqual(expect.any(String));
    expect((await getOrganization(f.dash.db, owner)).country).toBe('DE');
  });

  it('rejects a country whose required legal settings are missing', async () => {
    await expect(updateOrganization(f.dash.db, owner, { ...base, country: 'DE', kvkNumber: '12/345/67890', compliance: {} })).rejects.toMatchObject({ code: 'validation' });
  });

  it('rejects an unknown country and a VAT id of another country', async () => {
    await expect(updateOrganization(f.dash.db, owner, { ...base, country: 'XX', kvkNumber: '1' })).rejects.toMatchObject({ code: 'validation' });
    await expect(updateOrganization(f.dash.db, owner, { ...base, country: 'NL', kvkNumber: '12345678', vatNumber: 'DE987654321' })).rejects.toMatchObject({ code: 'validation' });
  });

  it('drops values that are not settings of the country', async () => {
    const org = await updateOrganization(f.dash.db, owner, {
      ...base,
      country: 'DE',
      kvkNumber: '12/345/67890',
      compliance: { tseSerial: 'AB12CD', tillId: 'K-1', tillRegisteredAt: true, digitalConsentMode: 'explicit_opt_in', nonsense: 'x' },
    });
    expect('nonsense' in (org.compliance as { values: object }).values).toBe(false);
  });
});

describe('receipt template', () => {
  it('is null until saved, then round-trips', async () => {
    expect(await getReceiptTemplate(f.dash.db, owner)).toBeNull();
    const tpl = defaultReceiptTemplate();
    tpl.style.accent = '#AA3300';
    await updateReceiptTemplate(f.dash.db, owner, tpl);
    expect((await getReceiptTemplate(f.dash.db, owner)) as { style: { accent: string } }).toMatchObject({ style: { accent: '#AA3300' } });
    await resetReceiptTemplate(f.dash.db, owner);
    expect(await getReceiptTemplate(f.dash.db, owner)).toBeNull();
  });

  it('refuses to drop or hide a block the law requires', async () => {
    const noTotals = defaultReceiptTemplate();
    noTotals.blocks = noTotals.blocks.filter((b) => b.type !== 'totals');
    await expect(updateReceiptTemplate(f.dash.db, owner, noTotals)).rejects.toMatchObject({ code: 'validation' });
    const hiddenVat = defaultReceiptTemplate();
    hiddenVat.blocks.find((b) => b.type === 'vatTable')!.hidden = true;
    await expect(updateReceiptTemplate(f.dash.db, owner, hiddenVat)).rejects.toMatchObject({ code: 'validation' });
  });

  it('refuses markup-like logos and unknown keys', async () => {
    const svg = defaultReceiptTemplate();
    svg.logo = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    await expect(updateReceiptTemplate(f.dash.db, owner, svg)).rejects.toMatchObject({ code: 'validation' });
    await expect(updateReceiptTemplate(f.dash.db, owner, { ...defaultReceiptTemplate(), html: '<script>' })).rejects.toMatchObject({ code: 'validation' });
  });

  it('accountants can read but not write', async () => {
    await getReceiptTemplate(f.dash.db, accountant);
    await expect(updateReceiptTemplate(f.dash.db, accountant, defaultReceiptTemplate())).rejects.toBeInstanceOf(ForbiddenError);
  });
});
