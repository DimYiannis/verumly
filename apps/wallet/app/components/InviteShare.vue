<script setup lang="ts">
/**
 * One invite link, every way to hand it over: a QR code to scan with any phone camera, the system share sheet
 * (WhatsApp, AirDrop, Messages, ...), copy, and an NFC tag (Android Chrome only; hidden elsewhere).
 */
import { Check, Copy, Nfc, Share2 } from '@lucide/vue';
import QRCode from 'qrcode';
import { copyText } from '~/utils/social';

const props = defineProps<{ link: string; shareTitle?: string; shareText?: string }>();
const { t } = useLocale();

const qr = ref('');
const copied = ref(false);
const nfc = ref<'idle' | 'waiting' | 'done' | 'error'>('idle');
const canShare = ref(false);
const canNfc = ref(false);

onMounted(() => {
  canShare.value = typeof navigator.share === 'function';
  canNfc.value = 'NDEFReader' in window;
});

watch(
  () => props.link,
  async (link) => {
    qr.value = link ? await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : '';
  },
  { immediate: true },
);

async function copy() {
  copied.value = await copyText(props.link);
  setTimeout(() => (copied.value = false), 2500);
}

async function share() {
  try {
    await navigator.share({ title: props.shareTitle ?? t('social.invite.shareTitle'), text: props.shareText ?? t('social.invite.shareText'), url: props.link });
  } catch {
    // the person closed the share sheet
  }
}

interface NdefWriter {
  write(message: { records: Array<{ recordType: string; data: string }> }): Promise<void>;
}

/** Writes the link to a tag held against the back of the phone. */
async function writeTag() {
  nfc.value = 'waiting';
  try {
    const Ctor = (window as unknown as { NDEFReader: new () => NdefWriter }).NDEFReader;
    await new Ctor().write({ records: [{ recordType: 'url', data: props.link }] });
    nfc.value = 'done';
  } catch {
    nfc.value = 'error';
  }
}
</script>

<template>
  <div class="space-y-3" data-testid="invite-share">
    <div class="flex flex-col items-center gap-3 rounded-[14px] border border-border bg-card px-4 py-5">
      <div v-if="qr" class="w-52 rounded-[14px] border border-border bg-white p-3.5" role="img" :aria-label="t('social.invite.qrLabel')" data-testid="invite-qr" v-html="qr" />
      <p class="text-center text-[13px] text-text-secondary">{{ t('social.invite.qrHint') }}</p>
    </div>
    <Input :model-value="link" readonly class="h-11 bg-card font-mono text-xs" data-testid="friends-invite-link" :aria-label="t('social.invite.link')" @focus="($event.target as HTMLInputElement).select()" />
    <div class="flex gap-2">
      <Button v-if="canShare" type="button" size="lg" class="min-w-0 flex-1" data-testid="invite-share-native" @click="share">
        <Share2 aria-hidden="true" />
        {{ t('social.invite.share') }}
      </Button>
      <Button type="button" :variant="canShare ? 'secondary' : 'default'" size="lg" class="min-w-0 flex-1" data-testid="friends-invite-copy" @click="copy">
        <component :is="copied ? Check : Copy" aria-hidden="true" />
        {{ copied ? t('social.copied') : t('social.copy') }}
      </Button>
      <Button v-if="canNfc" type="button" variant="secondary" size="lg" class="min-w-0 flex-1" :disabled="nfc === 'waiting'" data-testid="invite-nfc-write" @click="writeTag">
        <Nfc aria-hidden="true" />
        {{ nfc === 'waiting' ? t('social.invite.nfcWaiting') : nfc === 'done' ? t('social.invite.nfcDone') : t('social.invite.nfcWrite') }}
      </Button>
    </div>
    <p v-if="nfc === 'error'" role="alert" class="text-sm text-danger">{{ t('social.invite.nfcError') }}</p>
    <p class="text-center text-xs text-text-secondary">{{ t('social.invite.expires') }}</p>
  </div>
</template>
