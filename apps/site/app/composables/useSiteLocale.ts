import { messages, type SiteKey, type SiteLocale } from '~/i18n';

// The site has two languages: English at `/…` and Dutch at `/nl/…`. The language is read from the route, so the same page
// components render both. Texts live in app/i18n.
export function useSiteLocale() {
  const route = useRoute();
  const locale = computed<SiteLocale>(() => (route.path === '/nl' || route.path.startsWith('/nl/') ? 'nl' : 'en'));

  function t(key: SiteKey, vars?: Record<string, string | number>): string {
    const text = messages[locale.value][key] ?? messages.en[key];
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => (name in vars ? String(vars[name]) : placeholder));
  }

  // Internal path in the current language; hash-only links (`#try`) stay as they are.
  function localePath(path: string): string {
    if (!path.startsWith('/') || locale.value === 'en') return path;
    return path === '/' ? '/nl' : `/nl${path}`;
  }

  return { locale, t, localePath };
}
