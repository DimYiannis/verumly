import { en } from './en.ts';
import { nl, type MessageKey } from './nl.ts';

export type Locale = 'nl' | 'en';
export type { MessageKey };

export const LOCALES: readonly Locale[] = ['nl', 'en'];
export const DEFAULT_LOCALE: Locale = 'en';
export const messages: Record<Locale, Record<MessageKey, string>> = { nl, en };
