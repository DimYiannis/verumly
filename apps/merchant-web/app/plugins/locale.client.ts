// Restore the stored language before the first render. No stored value means English.
export default defineNuxtPlugin(() => {
  const locale = useState<Locale>('lr-locale', () => 'en');
  const stored = readStoredLocale();
  if (stored) locale.value = stored;
  document.documentElement.lang = locale.value;
});
