import { profile as profileSchema, type Profile } from '~/utils/api-schemas';

/** The signed-in person's profile, fetched lazily once and shared (header avatar, home greeting). The last answer is kept on this device, so offline the name and avatar still show. */
export function useProfile() {
  const wallet = useWallet();
  const profile = useState<Profile | null>('lr-profile', () => null);
  const asked = useState<boolean>('lr-profile-asked', () => false);

  async function load(force = false): Promise<void> {
    if (!wallet.session.value) return;
    if (asked.value && !force) return;
    asked.value = true;
    const key = profileCacheKey(wallet.session.value);
    let fresh: Profile;
    try {
      fresh = await wallet.api.getProfile();
    } catch {
      asked.value = false; // offline or failed: try again next time
      profile.value ??= (await wallet.kv.get(key, profileSchema)) ?? null;
      return;
    }
    profile.value = fresh;
    // cache the plain parsed object: `profile.value` is a reactive Proxy, which IndexedDB cannot structured-clone
    try {
      await wallet.kv.set(key, fresh);
    } catch {
      // the cache is best effort; the profile itself is already showing
    }
  }

  /** What to call this person: display name, handle, or the part of the email before the @. */
  const name = computed(() => {
    const p = profile.value;
    if (p?.displayName) return p.displayName;
    if (p?.handle) return p.handle;
    const email = wallet.session.value?.email ?? '';
    return email.split('@')[0] ?? '';
  });

  /** Forget the in-memory profile (after logout/delete) so the header drops the old name at once. */
  function reset() {
    profile.value = null;
    asked.value = false;
  }

  return { profile, name, load, reset };
}
