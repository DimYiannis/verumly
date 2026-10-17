import type { Profile } from '~/utils/api-schemas';

/** The signed-in person's profile, fetched lazily once and shared (header avatar, home greeting). Null when unknown or offline. */
export function useProfile() {
  const wallet = useWallet();
  const profile = useState<Profile | null>('lr-profile', () => null);
  const asked = useState<boolean>('lr-profile-asked', () => false);

  async function load(force = false): Promise<void> {
    if (!wallet.session.value) return;
    if (asked.value && !force) return;
    asked.value = true;
    try {
      profile.value = await wallet.api.getProfile();
    } catch {
      asked.value = false; // offline or failed: try again next time
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

  return { profile, name, load };
}
