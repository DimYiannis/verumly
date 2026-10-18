import { getFormat } from '@lr/compliance/formats';
import { fiscalLabels } from '@lr/fiscal/specs';

/** What a receipt of a country needs to be shown correctly: its time zone, the short names of the company and VAT numbers, the labels of the fiscal data. */
export function receiptContext(country: string) {
  const f = getFormat(country);
  return {
    timeZone: f?.timezone ?? 'Europe/Amsterdam',
    companyLabel: f?.idLabels.company ?? 'KvK',
    vatLabel: f?.idLabels.vat ?? 'BTW',
    fiscalLabels: fiscalLabels(country),
  };
}
