// The same page in both languages: `/privacy` and `/nl/privacy`, `/` and `/nl`.
export function useAlternatePaths() {
  const route = useRoute();
  return computed(() => {
    const base = route.path.replace(/^\/nl(?=\/|$)/, '').replace(/\/+$/, '') || '/';
    return { en: base, nl: base === '/' ? '/nl' : `/nl${base}` };
  });
}

// <html lang>, og:locale and hreflang alternates for a page that exists in both languages. The alternates need absolute
// URLs, so they are only emitted when the site address is known (runtime config `siteUrl`).
export function useLocaleHead() {
  const { locale } = useSiteLocale();
  const alternates = useAlternatePaths();
  const siteUrl = useRuntimeConfig().public.siteUrl;

  useSeoMeta({ ogLocale: () => (locale.value === 'nl' ? 'nl_NL' : 'en_GB') });
  useHead({
    htmlAttrs: { lang: () => locale.value },
    link: () =>
      siteUrl
        ? [
            { rel: 'alternate', hreflang: 'en', href: `${siteUrl}${alternates.value.en}` },
            { rel: 'alternate', hreflang: 'nl', href: `${siteUrl}${alternates.value.nl}` },
            { rel: 'alternate', hreflang: 'x-default', href: `${siteUrl}${alternates.value.en}` },
          ]
        : [],
  });
}
