<script setup lang="ts">
/**
 * Joins an invite from a QR code (live camera, where the browser has BarcodeDetector) or an NFC tag (Android Chrome).
 * Where neither exists nothing is shown: the phone's own camera app opens the same link anyway.
 */
import { Nfc, ScanLine, X } from '@lucide/vue';

const { t } = useLocale();

const supportsQr = ref(false);
const supportsNfc = ref(false);
const mode = ref<'off' | 'qr' | 'nfc'>('off');
const error = ref<'denied' | 'unreadable' | null>(null);
const video = ref<HTMLVideoElement | null>(null);
let stream: MediaStream | null = null;
let frame = 0;
let reader: { scan(): Promise<void>; onreading: ((e: unknown) => void) | null; onreadingerror: (() => void) | null } | null = null;
let abort: AbortController | null = null;

onMounted(() => {
  supportsQr.value = 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
  supportsNfc.value = 'NDEFReader' in window;
});

/** The invite code inside a scanned link, only for links that point at /i/<code>. */
function codeFrom(text: string): string | null {
  const m = /\/i\/([A-Za-z0-9_-]{16,64})(?:[/?#]|$)/.exec(text);
  return m ? m[1]! : null;
}

async function open(code: string) {
  stop();
  await navigateTo(`/i/${code}`);
}

async function startQr() {
  error.value = null;
  mode.value = 'qr';
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch {
    error.value = 'denied';
    mode.value = 'off';
    return;
  }
  await nextTick();
  const el = video.value;
  if (!el) return stop();
  el.srcObject = stream;
  await el.play().catch(() => undefined);
  const Detector = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => { detect(v: HTMLVideoElement): Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
  const detector = new Detector({ formats: ['qr_code'] });
  const tick = async () => {
    if (mode.value !== 'qr' || !video.value) return;
    try {
      const found = await detector.detect(video.value);
      for (const f of found) {
        const code = codeFrom(f.rawValue);
        if (code) return void (await open(code));
      }
    } catch {
      // a frame that cannot be read: try the next one
    }
    frame = requestAnimationFrame(() => void tick());
  };
  void tick();
}

async function startNfc() {
  error.value = null;
  mode.value = 'nfc';
  abort = new AbortController();
  try {
    const Ctor = (window as unknown as { NDEFReader: new () => NonNullable<typeof reader> }).NDEFReader;
    reader = new Ctor();
    reader.onreading = (e: unknown) => {
      const records = (e as { message: { records: Array<{ recordType: string; data: DataView }> } }).message.records;
      for (const r of records) {
        const text = new TextDecoder().decode(r.data);
        const code = codeFrom(text);
        if (code) return void open(code);
      }
      error.value = 'unreadable';
    };
    reader.onreadingerror = () => (error.value = 'unreadable');
    await (reader as unknown as { scan(o: { signal: AbortSignal }): Promise<void> }).scan({ signal: abort.signal });
  } catch {
    error.value = 'denied';
    mode.value = 'off';
  }
}

function stop() {
  cancelAnimationFrame(frame);
  stream?.getTracks().forEach((tr) => tr.stop());
  stream = null;
  abort?.abort();
  abort = null;
  reader = null;
  mode.value = 'off';
}
onBeforeUnmount(stop);
</script>

<template>
  <div v-if="supportsQr || supportsNfc" class="space-y-3" data-testid="invite-scan">
    <div v-if="mode === 'off'" class="flex flex-wrap gap-2">
      <Button v-if="supportsQr" type="button" variant="secondary" size="lg" data-testid="invite-scan-qr" @click="startQr">
        <ScanLine aria-hidden="true" />
        {{ t('social.scan.qr') }}
      </Button>
      <Button v-if="supportsNfc" type="button" variant="secondary" size="lg" data-testid="invite-scan-nfc" @click="startNfc">
        <Nfc aria-hidden="true" />
        {{ t('social.scan.nfc') }}
      </Button>
    </div>
    <div v-else class="space-y-2 rounded-xl border border-border bg-card p-3">
      <video v-if="mode === 'qr'" ref="video" class="aspect-square w-full rounded-lg bg-black object-cover" playsinline muted />
      <p v-else class="flex items-center gap-2 text-sm"><Nfc class="size-5 text-primary" aria-hidden="true" />{{ t('social.scan.nfcHint') }}</p>
      <Button type="button" variant="ghost" size="lg" @click="stop"><X aria-hidden="true" />{{ t('social.scan.stop') }}</Button>
    </div>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error === 'denied' ? t('social.scan.denied') : t('social.scan.unreadable') }}</p>
  </div>
</template>
