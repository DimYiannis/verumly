import en from './en';
import nl from './nl';
import fragEn from './frag.en';
import fragNl from './frag.nl';

export type SiteLocale = 'en' | 'nl';
export type SiteKey = keyof typeof en | keyof typeof fragEn;

export const messages: Record<SiteLocale, Record<SiteKey, string>> = {
  en: { ...en, ...fragEn },
  nl: { ...nl, ...fragNl },
};
