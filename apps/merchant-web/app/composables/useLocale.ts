import { en, type MessageKey } from '~/i18n/en';
import { nl } from '~/i18n/nl';

export type Locale = 'en' | 'nl';
export const LOCALE_STORAGE_KEY = 'lr-locale';
const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { en, nl };
const INTL_TAG: Record<Locale, string> = { en: 'en-GB', nl: 'nl-NL' };

export const isLocale = (v: unknown): v is Locale => v === 'en' || v === 'nl';

/** Reads the stored choice; tolerates missing or blocked storage. */
export function readStoredLocale(): Locale | null {
  try {
    const v = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

export function useLocale() {
  const locale = useState<Locale>('lr-locale', () => 'en');

  function setLocale(next: Locale) {
    locale.value = next;
    if (import.meta.client) {
      try {
        localStorage.setItem(LOCALE_STORAGE_KEY, next);
      } catch {
        /* storage unavailable: the choice just lasts for this page view */
      }
      document.documentElement.lang = next;
    }
  }

  /** True when `key` exists in the dictionary (for dynamic keys such as statuses). */
  const te = (key: string): key is MessageKey => key in en;

  function t(key: MessageKey, params?: Record<string, string | number>): string {
    const msg = DICTIONARIES[locale.value][key] ?? en[key];
    return params ? msg.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : msg;
  }

  /** Translate a dynamic value (status, role, ...) under a prefix, falling back to the raw value. */
  const tx = (prefix: string, value: string): string => {
    const key = `${prefix}.${value}`;
    return te(key) ? t(key) : value;
  };

  return { locale, setLocale, t, te, tx, intlLocale: computed(() => INTL_TAG[locale.value]) };
}
