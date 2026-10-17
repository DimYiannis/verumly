import { DEFAULT_LOCALE, LOCALES, messages, type Locale, type MessageKey } from '~/i18n';

const STORAGE_KEY = 'lr-locale';

function isLocale(value: unknown): value is Locale {
  return LOCALES.some((l) => l === value);
}

/** The stored choice, or Dutch when nothing is stored (or storage is unavailable). */
function readStored(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // storage blocked or absent: fall back to the default
  }
  return DEFAULT_LOCALE;
}

export type TranslateParams = Record<string, string | number>;

/** Tiny dependency-free i18n. `locale` is shared app state; `t` reads it, so templates re-render on switch. */
export function useLocale() {
  const locale = useState<Locale>('lr-locale', readStored);

  function setLocale(next: Locale) {
    locale.value = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // not persisted; the choice still applies for this session
    }
  }

  function t(key: MessageKey, params?: TranslateParams): string {
    const text = messages[locale.value][key] ?? messages[DEFAULT_LOCALE][key];
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
  }

  /** For keys built at runtime from server values (states, categories): the raw value when there is no entry. */
  function tOr(prefix: string, value: string, params?: TranslateParams): string {
    const key = `${prefix}.${value}`;
    return key in messages[DEFAULT_LOCALE] ? t(key as MessageKey, params) : value;
  }

  return { locale, setLocale, t, tOr };
}
