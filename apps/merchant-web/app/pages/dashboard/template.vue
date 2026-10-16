<script setup lang="ts">
import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, Lock, Monitor, Plus, Redo2, RotateCcw, Smartphone, Trash2, Undo2, Upload } from '@lucide/vue';
import {
  HEX_COLOR_RE,
  LOCKED_BLOCK_TYPES,
  LOGO_DATA_URL_RE,
  MAX_LOGO_CHARS,
  MAX_TEMPLATE_BLOCKS,
  MAX_TEMPLATE_TEXT,
  TEMPLATE_ALIGNS,
  TEMPLATE_BLOCK_TYPES,
  TEMPLATE_FONTS,
  TEMPLATE_PAPERS,
  TEMPLATE_SIZES,
  defaultReceiptTemplate,
  receiptTemplate,
  type ReceiptTemplate,
  type TemplateBlock,
  type TemplateBlockType,
} from '@lr/schema';
import { DISCLAIMER, getCountry } from '@lr/compliance';
import ReceiptTemplateView from '@lr/ui/src/ReceiptTemplate.vue';
import type { ReceiptLike } from '@lr/ui/src/ReceiptTemplate.vue';

definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface Org { name?: string; legalName: string | null; country: string; kvkNumber: string | null; vatNumber: string | null }

const { t, tx, intlLocale } = useLocale();
const session = sessionState();
const canWrite = computed(() => session.value.user?.role !== 'accountant');

const tpl = ref<ReceiptTemplate>(defaultReceiptTemplate());
const org = ref<Org | null>(null);
const loaded = ref(false);
const loadError = ref('');
const saveError = ref('');
const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');
const savedJson = ref(JSON.stringify(tpl.value));
const selectedId = ref<string | null>(null);
const view = ref<'phone' | 'wide'>('phone');
const legalOpen = ref(false);
const resetOpen = ref(false);
const logoError = ref('');

const dirty = computed(() => JSON.stringify(tpl.value) !== savedJson.value);
const country = computed(() => (org.value ? getCountry(org.value.country) : null));
const countryName = computed(() => country.value?.name ?? org.value?.country ?? '');
const selected = computed<TemplateBlock | null>(() => tpl.value.blocks.find((b) => b.id === selectedId.value) ?? null);
const isLocked = (type: TemplateBlockType) => LOCKED_BLOCK_TYPES.includes(type);
const atMax = computed(() => tpl.value.blocks.length >= MAX_TEMPLATE_BLOCKS);

// ---- history -------------------------------------------------------------------------------------------------
const HISTORY_LIMIT = 50;
const past = ref<string[]>([]);
const future = ref<string[]>([]);
let lastKey = '';
let lastAt = 0;

/** Applies a change to the template, recording a snapshot first. Edits with the same key within a second share one undo step. */
function mutate(fn: (draft: ReceiptTemplate) => void, key = '') {
  if (!canWrite.value) return;
  const now = Date.now();
  if (!(key && key === lastKey && now - lastAt < 1000)) {
    past.value.push(JSON.stringify(tpl.value));
    if (past.value.length > HISTORY_LIMIT) past.value.shift();
    future.value = [];
  }
  lastKey = key;
  lastAt = now;
  fn(tpl.value);
  saveStatus.value = 'idle';
}
function restore(json: string) {
  tpl.value = JSON.parse(json) as ReceiptTemplate;
  if (selectedId.value && !tpl.value.blocks.some((b) => b.id === selectedId.value)) selectedId.value = null;
  lastKey = '';
  saveStatus.value = 'idle';
}
function undo() {
  const prev = past.value.pop();
  if (prev === undefined) return;
  future.value.push(JSON.stringify(tpl.value));
  restore(prev);
}
function redo() {
  const next = future.value.pop();
  if (next === undefined) return;
  past.value.push(JSON.stringify(tpl.value));
  restore(next);
}
function onKey(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || !canWrite.value) return;
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
}

// ---- loading -------------------------------------------------------------------------------------------------
async function load() {
  const [o, r] = await Promise.all([
    attempt(loadError, () => $fetch<Org>('/api/dashboard/org')),
    attempt(loadError, () => $fetch<{ template: ReceiptTemplate | null }>('/api/dashboard/receipt-template')),
  ]);
  if (o) org.value = o;
  tpl.value = r?.template ?? defaultReceiptTemplate();
  savedJson.value = JSON.stringify(tpl.value);
  loaded.value = true;
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) { e.preventDefault(); e.returnValue = ''; }
}
onMounted(() => {
  load();
  window.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', onBeforeUnload);
  sampleTime.value = new Date().toISOString();
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('beforeunload', onBeforeUnload);
});
onBeforeRouteLeave(() => {
  if (dirty.value && !window.confirm(t('design.leaveConfirm'))) return false;
});

// ---- blocks --------------------------------------------------------------------------------------------------
function newId(type: string): string {
  const used = new Set(tpl.value.blocks.map((b) => b.id));
  for (let i = 1; ; i++) {
    const id = `${type.toLowerCase()}-${i}`.slice(0, 40);
    if (!used.has(id)) return id;
  }
}
function addBlock(type: TemplateBlockType) {
  if (atMax.value) return;
  const id = newId(type);
  const base: TemplateBlock = { id, type, align: 'left', size: 'md', bold: false, color: null, text: '', hidden: false };
  if (type === 'text') Object.assign(base, { align: 'center', text: t('design.defaultText') });
  if (type === 'logo') base.align = 'center';
  mutate((d) => d.blocks.push(base));
  selectedId.value = id;
}
function move(from: number, to: number) {
  if (to < 0 || to >= tpl.value.blocks.length || from === to) return;
  mutate((d) => {
    const [b] = d.blocks.splice(from, 1);
    if (b) d.blocks.splice(to, 0, b);
  });
}
function removeBlock(id: string) {
  const b = tpl.value.blocks.find((x) => x.id === id);
  if (!b || isLocked(b.type)) return;
  mutate((d) => { d.blocks = d.blocks.filter((x) => x.id !== id); });
  if (selectedId.value === id) selectedId.value = null;
}
function toggleHidden(b: TemplateBlock) {
  if (isLocked(b.type)) return;
  mutate(() => { b.hidden = !b.hidden; });
}
const addable = computed<TemplateBlockType[]>(() => {
  const present = new Set(tpl.value.blocks.map((b) => b.type));
  const always: TemplateBlockType[] = ['logo', 'text', 'divider', 'spacer'];
  const missing = TEMPLATE_BLOCK_TYPES.filter((ty) => !always.includes(ty) && !present.has(ty));
  return [...always, ...missing];
});

// drag and drop in the layers list
const dragFrom = ref<number | null>(null);
const dragOver = ref<number | null>(null);
function onDragStart(e: DragEvent, i: number) {
  dragFrom.value = i;
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }
}
function onDragOver(e: DragEvent, i: number) {
  if (dragFrom.value === null) return;
  e.preventDefault();
  dragOver.value = i;
}
function onDrop(e: DragEvent, i: number) {
  e.preventDefault();
  if (dragFrom.value !== null) move(dragFrom.value, i);
  dragFrom.value = null;
  dragOver.value = null;
}
function onDragEnd() { dragFrom.value = null; dragOver.value = null; }

function layerLabel(b: TemplateBlock): string {
  if (b.type === 'text') return b.text.trim() ? b.text.trim().slice(0, 28) : t('design.emptyText');
  return tx('design.type', b.type);
}

// ---- properties ----------------------------------------------------------------------------------------------
const hasTextual = (b: TemplateBlock) => !['logo', 'divider', 'spacer'].includes(b.type);
const hasAlign = (b: TemplateBlock) => !['divider', 'spacer'].includes(b.type);
const hasColor = (b: TemplateBlock) => !['logo', 'spacer'].includes(b.type);
function setProp<K extends keyof TemplateBlock>(b: TemplateBlock, key: K, value: TemplateBlock[K]) {
  mutate(() => { b[key] = value; }, `block-${b.id}-${key}`);
}
const segmentClass = (on: boolean) => ['h-9 flex-1 px-2 text-sm transition-colors', on ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'];

// ---- global style --------------------------------------------------------------------------------------------
function setStyle<K extends keyof ReceiptTemplate['style']>(key: K, value: ReceiptTemplate['style'][K]) {
  mutate((d) => { d.style[key] = value; }, `style-${key}`);
}

// ---- logo ----------------------------------------------------------------------------------------------------
const LOGO_MAX_WIDTH = 320;
const LOGO_TARGET_CHARS = 150_000;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('read')); };
    img.src = url;
  });
}
/** Scales to at most 320 px wide and re-encodes (webp, else png) until the data URL is small enough. */
function encodeLogo(img: HTMLImageElement): string | null {
  let width = Math.min(LOGO_MAX_WIDTH, img.naturalWidth);
  for (let round = 0; round < 6; round++) {
    const height = Math.max(1, Math.round((img.naturalHeight * width) / img.naturalWidth));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    for (const q of [0.92, 0.8, 0.65, 0.5]) {
      const url = canvas.toDataURL('image/webp', q);
      if (url.startsWith('data:image/webp') && url.length <= LOGO_TARGET_CHARS) return url;
    }
    const png = canvas.toDataURL('image/png');
    if (png.length <= LOGO_TARGET_CHARS) return png;
    width = Math.round(width * 0.75);
  }
  return null;
}
async function onLogo(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  logoError.value = '';
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { logoError.value = t('design.logoErrType'); return; }
  let img: HTMLImageElement;
  try { img = await loadImage(file); } catch { logoError.value = t('design.logoErrRead'); return; }
  if (!img.naturalWidth || !img.naturalHeight) { logoError.value = t('design.logoErrRead'); return; }
  const url = encodeLogo(img);
  if (!url || url.length > MAX_LOGO_CHARS || !LOGO_DATA_URL_RE.test(url)) { logoError.value = t('design.logoErrSize'); return; }
  mutate((d) => { d.logo = url; });
}
function removeLogo() {
  logoError.value = '';
  mutate((d) => { d.logo = null; });
}

// ---- sample receipt ------------------------------------------------------------------------------------------
const sampleTime = ref('2026-01-01T12:00:00.000Z');
const sample = computed<ReceiptLike>(() => ({
  merchant: { name: org.value?.legalName || org.value?.name || session.value.user?.orgName || 'Your business', kvkNumber: org.value?.kvkNumber ?? '12345678', vatNumber: org.value?.vatNumber ?? null },
  createdAt: sampleTime.value,
  lines: [
    { description: t('design.sampleCoffee'), qty: '2', unitPrice: 340, total: 680, kind: 'sale' },
    { description: t('design.samplePie'), qty: '1', unitPrice: 395, total: 395, kind: 'sale' },
    { description: t('design.sampleBeer'), qty: '1', unitPrice: 389, total: 389, kind: 'sale' },
  ],
  vatSummary: [
    { rate: 9, net: 986, vat: 89, gross: 1075 },
    { rate: 21, net: 321, vat: 68, gross: 389 },
  ],
  totals: { gross: 1464, net: 1307, vat: 157, tip: 0, rounding: 0 },
  payments: [{ method: 'card', amount: 1464 }],
  fiscal: { country: org.value?.country ?? 'NL', registerSerial: 'TSE-0001', documentNumber: '0001234', extra: {} },
  currency: 'EUR',
}));
const money = (cents: number) => new Intl.NumberFormat(intlLocale.value, { style: 'currency', currency: 'EUR' }).format(cents / 100);
const dateTime = (iso: string) => amsterdam(iso);
const labels = computed(() => {
  const out: Record<string, string> = {};
  for (const k of ['company', 'vat', 'total', 'net', 'gross', 'rounding', 'tip', 'rate', 'card', 'cash', 'other', 'document', 'register', 'logo'] as const) out[k] = t(`design.label.${k}`);
  return out;
});

// ---- save and reset ------------------------------------------------------------------------------------------
async function save() {
  if (!canWrite.value || !dirty.value || saveStatus.value === 'saving') return;
  saveError.value = '';
  const parsed = receiptTemplate.safeParse(tpl.value);
  if (!parsed.success) {
    saveError.value = `${t('design.invalid')}: ${[...new Set(parsed.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)))].join('; ')}`;
    saveStatus.value = 'error';
    return;
  }
  saveStatus.value = 'saving';
  const r = await attempt(saveError, () => $fetch<{ template: ReceiptTemplate }>('/api/dashboard/receipt-template', { method: 'PUT', body: parsed.data }));
  if (!r) { saveStatus.value = 'error'; return; }
  tpl.value = r.template ?? parsed.data;
  savedJson.value = JSON.stringify(tpl.value);
  saveStatus.value = 'saved';
}
async function doReset() {
  resetOpen.value = false;
  saveError.value = '';
  const r = await attempt(saveError, () => $fetch<{ template?: ReceiptTemplate | null }>('/api/dashboard/receipt-template', { method: 'DELETE' }));
  if (r === undefined) { saveStatus.value = 'error'; return; }
  tpl.value = r?.template ?? defaultReceiptTemplate();
  savedJson.value = JSON.stringify(tpl.value);
  past.value = [];
  future.value = [];
  selectedId.value = null;
  lastKey = '';
  saveStatus.value = 'saved';
}
const statusText = computed(() => {
  if (saveStatus.value === 'saving') return t('design.status.saving');
  if (saveStatus.value === 'error') return t('design.status.error');
  if (dirty.value) return t('design.status.unsaved');
  if (saveStatus.value === 'saved') return t('design.status.saved');
  return '';
});
const frameWidth = computed(() => (view.value === 'phone' ? '390px' : '720px'));
const hexOk = (v: string) => HEX_COLOR_RE.test(v);
</script>

<template>
  <AppPageHeading :title="t('design.title')" :description="t('design.description')">
    <span v-if="statusText" class="text-sm text-muted-foreground" role="status" data-testid="design-status">{{ statusText }}</span>
    <Button variant="outline" size="icon" :aria-label="t('design.undo')" :title="t('design.undo')" :disabled="!canWrite || !past.length" data-testid="design-undo" @click="undo"><Undo2 /></Button>
    <Button variant="outline" size="icon" :aria-label="t('design.redo')" :title="t('design.redo')" :disabled="!canWrite || !future.length" data-testid="design-redo" @click="redo"><Redo2 /></Button>
    <Button variant="outline" :disabled="!canWrite || !loaded" data-testid="design-reset" @click="resetOpen = true"><RotateCcw />{{ t('design.reset') }}</Button>
    <Button :disabled="!canWrite || !dirty || saveStatus === 'saving'" data-testid="design-save" @click="save">{{ t('design.save') }}</Button>
  </AppPageHeading>

  <AppErrorNote v-if="loadError" data-testid="error">{{ loadError }}</AppErrorNote>
  <AppErrorNote v-if="saveError" data-testid="design-error">{{ saveError }}</AppErrorNote>
  <p v-if="!canWrite" class="px-2 text-sm text-muted-foreground">{{ t('design.readOnly') }}</p>

  <div v-if="!loaded" class="px-2 text-sm text-muted-foreground">{{ t('design.loading') }}</div>

  <div v-else class="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)_300px]">
    <!-- LEFT: add, layers, style -->
    <div class="space-y-4">
      <Card>
        <CardHeader><CardTitle class="text-base">{{ t('design.add') }}</CardTitle></CardHeader>
        <CardContent class="mt-3">
          <div class="grid grid-cols-2 gap-2">
            <Button v-for="ty in addable" :key="ty" variant="outline" :disabled="!canWrite || atMax" :data-testid="`design-add-${ty}`" :aria-label="t('design.addBlock', { type: tx('design.type', ty) })" @click="addBlock(ty)">
              <Plus />{{ tx('design.type', ty) }}
            </Button>
          </div>
          <p v-if="atMax" class="mt-2 text-xs text-muted-foreground">{{ t('design.maxBlocks', { max: MAX_TEMPLATE_BLOCKS }) }}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle class="text-base">{{ t('design.layers') }}</CardTitle></CardHeader>
        <CardContent class="mt-3">
          <ul class="space-y-1" data-testid="design-layers">
            <li
              v-for="(b, i) in tpl.blocks"
              :key="b.id"
              :draggable="canWrite"
              class="flex items-center gap-1 rounded-md border bg-card py-1 pl-1 pr-1 text-sm"
              :class="[selectedId === b.id ? 'border-primary' : 'border-border', dragOver === i && dragFrom !== i ? 'border-primary bg-muted' : '', dragFrom === i ? 'opacity-50' : '']"
              :data-testid="`design-layer-${b.id}`"
              @dragstart="onDragStart($event, i)"
              @dragover="onDragOver($event, i)"
              @drop="onDrop($event, i)"
              @dragend="onDragEnd"
            >
              <GripVertical class="size-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden="true" />
              <button type="button" class="min-w-0 flex-1 truncate rounded px-1 py-1.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring" :class="b.hidden ? 'text-muted-foreground line-through' : ''" @click="selectedId = b.id">{{ layerLabel(b) }}</button>
              <span v-if="isLocked(b.type)" class="flex size-7 shrink-0 items-center justify-center text-muted-foreground" :title="t('design.lockedTitle', { country: countryName })" :aria-label="t('design.lockedTitle', { country: countryName })" role="img"><Lock class="size-3.5" /></span>
              <button type="button" class="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring disabled:opacity-40" :disabled="!canWrite || i === 0" :aria-label="t('design.moveUp')" :title="t('design.moveUp')" @click="move(i, i - 1)"><ChevronUp class="size-4" /></button>
              <button type="button" class="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring disabled:opacity-40" :disabled="!canWrite || i === tpl.blocks.length - 1" :aria-label="t('design.moveDown')" :title="t('design.moveDown')" @click="move(i, i + 1)"><ChevronDown class="size-4" /></button>
              <button type="button" class="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring disabled:opacity-40" :disabled="!canWrite || isLocked(b.type)" :aria-label="b.hidden ? t('design.show') : t('design.hide')" :title="isLocked(b.type) ? t('design.lockedTitle', { country: countryName }) : b.hidden ? t('design.show') : t('design.hide')" :data-testid="`design-toggle-${b.id}`" @click="toggleHidden(b)">
                <EyeOff v-if="b.hidden" class="size-4" /><Eye v-else class="size-4" />
              </button>
              <button v-if="!isLocked(b.type)" type="button" class="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-danger focus-visible:ring-[3px] focus-visible:ring-ring disabled:opacity-40" :disabled="!canWrite" :aria-label="t('design.delete')" :title="t('design.delete')" :data-testid="`design-delete-${b.id}`" @click="removeBlock(b.id)"><Trash2 class="size-4" /></button>
            </li>
          </ul>
          <p class="mt-3 text-xs text-muted-foreground">{{ t('design.layersHint') }}</p>
          <p class="mt-1 flex items-start gap-1 text-xs text-muted-foreground"><Lock class="mt-0.5 size-3 shrink-0" aria-hidden="true" /><span>{{ t('design.lockedHint', { country: countryName }) }}</span></p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle class="text-base">{{ t('design.style') }}</CardTitle></CardHeader>
        <CardContent class="mt-3 space-y-4">
          <div class="space-y-2"><Label>{{ t('design.accent') }}</Label><AppColorField :model-value="tpl.style.accent" :label="t('design.accent')" :hex-label="t('design.hex')" :disabled="!canWrite" testid="design-style-accent" @update:model-value="setStyle('accent', $event)" /></div>
          <div class="space-y-2"><Label>{{ t('design.textColor') }}</Label><AppColorField :model-value="tpl.style.text" :label="t('design.textColor')" :hex-label="t('design.hex')" :disabled="!canWrite" testid="design-style-text" @update:model-value="setStyle('text', $event)" /></div>
          <div class="space-y-2"><Label>{{ t('design.background') }}</Label><AppColorField :model-value="tpl.style.background" :label="t('design.background')" :hex-label="t('design.hex')" :disabled="!canWrite" testid="design-style-background" @update:model-value="setStyle('background', $event)" /></div>
          <div class="space-y-2">
            <Label for="design-font">{{ t('design.font') }}</Label>
            <AppNativeSelect id="design-font" :model-value="tpl.style.font" :disabled="!canWrite" data-testid="design-style-font" @update:model-value="setStyle('font', $event as ReceiptTemplate['style']['font'])">
              <option v-for="f in TEMPLATE_FONTS" :key="f" :value="f">{{ tx('design.font', f) }}</option>
            </AppNativeSelect>
          </div>
          <div class="space-y-2">
            <Label for="design-paper">{{ t('design.paper') }}</Label>
            <AppNativeSelect id="design-paper" :model-value="tpl.style.paper" :disabled="!canWrite" data-testid="design-style-paper" @update:model-value="setStyle('paper', $event as ReceiptTemplate['style']['paper'])">
              <option v-for="p in TEMPLATE_PAPERS" :key="p" :value="p">{{ tx('design.paper', p) }}</option>
            </AppNativeSelect>
          </div>
          <div class="space-y-2">
            <Label>{{ t('design.logo') }}</Label>
            <div v-if="tpl.logo" class="flex items-center gap-3 rounded-md border bg-muted p-2"><img :src="tpl.logo" alt="" class="max-h-12 max-w-[60%] object-contain" /></div>
            <div class="flex flex-wrap gap-2">
              <label class="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-[14px] text-sm font-medium transition-colors focus-within:ring-[3px] focus-within:ring-ring hover:bg-muted" :class="canWrite ? '' : 'pointer-events-none opacity-50'">
                <Upload class="size-4" />{{ tpl.logo ? t('design.logoReplace') : t('design.logoUpload') }}
                <input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" :disabled="!canWrite" data-testid="design-logo-input" @change="onLogo" />
              </label>
              <Button v-if="tpl.logo" variant="ghost" :disabled="!canWrite" data-testid="design-logo-remove" @click="removeLogo"><Trash2 />{{ t('design.logoRemove') }}</Button>
            </div>
            <p class="text-xs text-muted-foreground">{{ t('design.logoHelp') }}</p>
            <AppErrorNote v-if="logoError" data-testid="design-logo-error">{{ logoError }}</AppErrorNote>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- CENTER: preview -->
    <div class="min-w-0 space-y-4">
      <Card>
        <CardHeader>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div><CardTitle class="text-base">{{ t('design.preview') }}</CardTitle><p class="mt-1 text-xs text-muted-foreground">{{ t('design.previewHint') }}</p></div>
            <div class="flex overflow-hidden rounded-md border border-border" role="group" :aria-label="t('design.preview')">
              <button type="button" :class="segmentClass(view === 'phone')" class="flex items-center gap-1.5" :aria-pressed="view === 'phone'" data-testid="design-view-phone" @click="view = 'phone'"><Smartphone class="size-4" />{{ t('design.viewPhone') }}</button>
              <button type="button" :class="segmentClass(view === 'wide')" class="flex items-center gap-1.5 border-l border-border" :aria-pressed="view === 'wide'" data-testid="design-view-wide" @click="view = 'wide'"><Monitor class="size-4" />{{ t('design.viewWide') }}</button>
            </div>
          </div>
        </CardHeader>
        <CardContent class="mt-3">
          <div class="overflow-x-auto rounded-md border border-border bg-muted p-4 sm:p-8" style="background-image: radial-gradient(rgba(0, 0, 0, 0.07) 1px, transparent 1px); background-size: 16px 16px">
            <div class="mx-auto w-full" :style="{ maxWidth: frameWidth }" data-testid="design-canvas">
              <ReceiptTemplateView :template="tpl" :receipt="sample" :money="money" :date-time="dateTime" :labels="labels" designer :selected-id="selectedId" @select="selectedId = $event" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Collapsible v-model:open="legalOpen">
        <Card>
          <CollapsibleTrigger as-child>
            <button type="button" class="flex w-full items-center justify-between gap-2 px-6 text-left text-base font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring" data-testid="design-legal-toggle">
              <span>{{ t('design.legal') }}</span><ChevronDown class="size-4 transition-transform" :class="legalOpen ? 'rotate-180' : ''" aria-hidden="true" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent class="mt-3 space-y-3 text-sm" data-testid="design-legal">
              <template v-if="country">
                <p class="font-medium">{{ t('design.legalFor', { country: country.name }) }}</p>
                <div><p class="text-xs font-medium text-text-secondary">{{ t('design.legalMandatory') }}</p><p class="mt-1 whitespace-pre-line text-muted-foreground">{{ country.summary.mandatoryFields }}</p></div>
                <div><p class="text-xs font-medium text-text-secondary">{{ t('design.legalFiscal') }}</p><p class="mt-1 whitespace-pre-line text-muted-foreground">{{ country.summary.fiscalSystem }}</p></div>
              </template>
              <p v-else class="text-muted-foreground">{{ t('design.legalUnknown') }}</p>
              <p>{{ t('design.legalKeep') }}</p>
              <p class="text-xs text-muted-foreground">{{ DISCLAIMER }}</p>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>

    <!-- RIGHT: properties -->
    <Card>
      <CardHeader><CardTitle class="text-base">{{ t('design.properties') }}</CardTitle></CardHeader>
      <CardContent class="mt-3">
        <div v-if="!selected" class="rounded-md border border-dashed p-4 text-sm" data-testid="design-prop-empty">
          <p class="font-medium">{{ t('design.selectBlock') }}</p>
          <p class="mt-1 text-muted-foreground">{{ t('design.selectBlockHint') }}</p>
        </div>
        <div v-else class="space-y-4" :data-testid="`design-props-${selected.id}`">
          <p class="flex items-center gap-1.5 text-sm font-medium"><Lock v-if="isLocked(selected.type)" class="size-3.5 text-muted-foreground" aria-hidden="true" />{{ tx('design.type', selected.type) }}</p>

          <div v-if="selected.type === 'text'" class="space-y-2">
            <Label for="design-prop-text">{{ t('design.text') }}</Label>
            <Textarea id="design-prop-text" :model-value="selected.text" :maxlength="MAX_TEMPLATE_TEXT" rows="4" :disabled="!canWrite" data-testid="design-prop-text" @update:model-value="setProp(selected, 'text', String($event).slice(0, MAX_TEMPLATE_TEXT))" />
            <p class="text-right text-xs text-muted-foreground" data-testid="design-prop-text-count">{{ t('design.textCount', { count: selected.text.length, max: MAX_TEMPLATE_TEXT }) }}</p>
          </div>

          <div v-if="hasAlign(selected)" class="space-y-2">
            <Label>{{ t('design.align') }}</Label>
            <div class="flex overflow-hidden rounded-md border border-border" role="group" :aria-label="t('design.align')" data-testid="design-prop-align">
              <button v-for="(a, idx) in TEMPLATE_ALIGNS" :key="a" type="button" :disabled="!canWrite" :class="[segmentClass(selected.align === a), idx ? 'border-l border-border' : '']" :aria-pressed="selected.align === a" :data-testid="`design-prop-align-${a}`" @click="setProp(selected, 'align', a)">{{ tx('design.align', a) }}</button>
            </div>
          </div>

          <div v-if="hasTextual(selected)" class="space-y-2">
            <Label>{{ t('design.size') }}</Label>
            <div class="flex overflow-hidden rounded-md border border-border" role="group" :aria-label="t('design.size')" data-testid="design-prop-size">
              <button v-for="(s, idx) in TEMPLATE_SIZES" :key="s" type="button" :disabled="!canWrite" :class="[segmentClass(selected.size === s), idx ? 'border-l border-border' : '']" :aria-pressed="selected.size === s" :title="tx('design.size', s)" :data-testid="`design-prop-size-${s}`" @click="setProp(selected, 'size', s)">{{ s.toUpperCase() }}</button>
            </div>
          </div>

          <div v-if="hasTextual(selected)" class="flex items-center justify-between gap-3">
            <Label for="design-prop-bold">{{ t('design.bold') }}</Label>
            <Switch id="design-prop-bold" :model-value="selected.bold" :disabled="!canWrite" data-testid="design-prop-bold" @update:model-value="setProp(selected, 'bold', Boolean($event))" />
          </div>

          <div v-if="hasColor(selected)" class="space-y-2">
            <Label>{{ t('design.color') }}</Label>
            <AppColorField :model-value="selected.color ?? tpl.style.text" :label="t('design.color')" :hex-label="t('design.hex')" :disabled="!canWrite" testid="design-prop-color" @update:model-value="setProp(selected, 'color', hexOk($event) ? $event : null)" />
            <Button v-if="selected.color" variant="ghost" size="sm" :disabled="!canWrite" data-testid="design-prop-color-reset" @click="setProp(selected, 'color', null)">{{ t('design.useTemplateColor') }}</Button>
          </div>

          <div class="space-y-1">
            <div class="flex items-center justify-between gap-3">
              <Label for="design-prop-hidden">{{ t('design.hidden') }}</Label>
              <Switch id="design-prop-hidden" :model-value="selected.hidden" :disabled="!canWrite || isLocked(selected.type)" data-testid="design-prop-hidden" @update:model-value="setProp(selected, 'hidden', Boolean($event))" />
            </div>
            <p v-if="isLocked(selected.type)" class="text-xs text-muted-foreground">{{ t('design.hiddenLocked') }}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>

  <AlertDialog v-model:open="resetOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t('design.resetTitle') }}</AlertDialogTitle>
        <AlertDialogDescription>{{ t('design.resetBody') }}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
        <AlertDialogAction data-testid="design-reset-confirm" @click="doReset">{{ t('design.resetConfirm') }}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
