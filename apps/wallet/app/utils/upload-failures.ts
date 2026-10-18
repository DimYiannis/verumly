import { messages, type Locale, type MessageKey } from '../i18n/index.ts';
import { formatEuro } from './format.ts';

interface FailureDraft {
  gross: number | null;
  lines: readonly { total: number }[];
}

/** A failure code as a sentence in the buyer's language, with the numbers where the draft has them. Unknown codes get a generic sentence. */
export function uploadFailureText(code: string, draft: FailureDraft | null, locale: Locale): string {
  const key = `uploadFailure.${code}`;
  const known = key in messages.en;
  const template = known ? (messages[locale][key as MessageKey] ?? messages.en[key as MessageKey]) : messages[locale]['uploadFailure.unknown'];
  const sum = draft ? draft.lines.reduce((s, l) => s + l.total, 0) : null;
  const params: Record<string, string> = {
    sum: sum === null ? '–' : formatEuro(sum, locale),
    gross: draft?.gross == null ? '–' : formatEuro(draft.gross, locale),
  };
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => params[name] ?? whole);
}
