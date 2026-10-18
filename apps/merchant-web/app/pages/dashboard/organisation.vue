<script setup lang="ts">
import { DISCLAIMER, getCountry, listCountries, validateSetup } from '@lr/compliance';
import { getFormat } from '@lr/compliance/formats';
import { getFiscalSpec } from '@lr/fiscal/specs';
import { CheckIcon, ChevronDownIcon } from '@lucide/vue';

definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

type Values = Record<string, string | boolean>;
interface Org {
  legalName: string;
  country: string;
  kvkNumber: string;
  vatNumber: string | null;
  retentionYears: number;
  compliance: { country: string; values: Values; confirmedAt: string | null };
}

const TOPICS = ['receiptObligation', 'digitalReceipt', 'mandatoryFields', 'fiscalSystem', 'realTimeReporting', 'receiptIdentifiers', 'retention', 'vat', 'other'] as const;

const { t, intlLocale } = useLocale();
const session = sessionState();
const canWrite = computed(() => session.value.user?.role === 'owner');
const countries = listCountries();

const form = reactive({ legalName: '', country: 'NL', kvkNumber: '', vatNumber: '', retentionYears: 7 });
const values = ref<Values>({});
const valuesByCountry: Record<string, Values> = {};
const confirmLegal = ref(false);
const error = ref('');
const saved = ref(false);

const country = computed(() => getCountry(form.country) ?? getCountry('NL')!);
const format = computed(() => getFormat(form.country) ?? getFormat('NL')!);
const spec = computed(() => getFiscalSpec(form.country));
/** the settings the country's state integration reads, and whether the business has filled each in */
const needed = computed(() =>
  (spec.value?.needs ?? []).map((key) => {
    const v = values.value[key];
    return { key, label: country.value.settings.find((s) => s.key === key)?.label ?? key, filled: v === true || (typeof v === 'string' && v.trim() !== '') };
  }),
);
const money = (n: number) => new Intl.NumberFormat(intlLocale.value, { style: 'currency', currency: format.value.currency }).format(n);
const minRetention = computed(() => Math.max(1, country.value.retentionYearsIndicative));

function apply(o: Org) {
  form.legalName = o.legalName;
  form.country = o.country;
  form.kvkNumber = o.kvkNumber;
  form.vatNumber = o.vatNumber ?? '';
  form.retentionYears = o.retentionYears;
  const sameCountry = o.compliance?.country === o.country;
  values.value = sameCountry ? { ...(o.compliance.values ?? {}) } : {};
  valuesByCountry[o.country] = values.value;
  confirmLegal.value = sameCountry && !!o.compliance?.confirmedAt;
}

onMounted(async () => {
  const o = await attempt(error, () => $fetch<Org>('/api/dashboard/org'));
  if (o) apply(o);
});

// Changing country: remember what was typed, restore it if the user comes back, reset the rest.
watch(
  () => form.country,
  (next, prev) => {
    valuesByCountry[prev] = values.value;
    values.value = valuesByCountry[next] ?? {};
    const c = getCountry(next);
    if (c && form.retentionYears < Math.max(1, c.retentionYearsIndicative)) form.retentionYears = Math.max(1, c.retentionYearsIndicative);
    confirmLegal.value = false;
    saved.value = false;
  },
);

const problems = computed(() => validateSetup(form.country, { companyId: form.kvkNumber || null, vatId: form.vatNumber || null }, values.value));
const missing = computed(() => {
  const items = [...problems.value];
  if (!form.kvkNumber.trim()) items.unshift(`${country.value.companyId.label}: ${t('setup.required')}`);
  if (!form.legalName.trim()) items.unshift(`${t('setup.legalName')}: ${t('setup.required')}`);
  if (!confirmLegal.value) items.push(t('setup.statusConfirm'));
  return items;
});

const confidenceVariant = { high: 'success', medium: 'warning', low: 'danger' } as const;
const lastChecked = computed(() => {
  const d = new Date(country.value.lastChecked);
  return Number.isNaN(d.getTime()) ? country.value.lastChecked : new Intl.DateTimeFormat(intlLocale.value, { dateStyle: 'medium' }).format(d);
});

const textValue = (key: string) => (typeof values.value[key] === 'string' ? (values.value[key] as string) : '');
function setValue(key: string, v: string | boolean) {
  values.value = { ...values.value, [key]: v };
}

// ---- stepper: reflects progress, each step anchors to its section ------------------------------------------------
const identityDone = computed(() => !!form.legalName.trim() && !!form.kvkNumber.trim());
const legalDone = computed(() => problems.value.length === 0);
const steps = computed(() => {
  const done = [true, identityDone.value, identityDone.value && legalDone.value, confirmLegal.value && identityDone.value && legalDone.value];
  const current = done.findIndex((d) => !d);
  return [
    { id: 'org-step-country', anchor: 'org-section-identity', label: t('adm.setup.stepCountry') },
    { id: 'org-step-identity', anchor: 'org-section-identity', label: t('adm.setup.stepIdentity') },
    { id: 'org-step-legal', anchor: 'org-section-legal', label: t('adm.setup.stepLegal') },
    { id: 'org-step-confirm', anchor: 'org-section-confirm', label: t('adm.setup.stepConfirm') },
  ].map((s, i) => ({ ...s, n: i + 1, done: done[i]!, current: i === current }));
});
function goTo(anchor: string) {
  document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function save() {
  saved.value = false;
  const o = await attempt(error, () =>
    $fetch<Org>('/api/dashboard/org', {
      method: 'PUT',
      body: {
        legalName: form.legalName,
        country: form.country,
        kvkNumber: form.kvkNumber,
        vatNumber: form.vatNumber.trim() || null,
        retentionYears: Number(form.retentionYears),
        compliance: values.value,
        confirmLegal: confirmLegal.value,
      },
    }),
  );
  if (o) {
    apply(o);
    saved.value = true;
  }
}
</script>

<template>
  <AppPageHeading :title="t('nav.organisation')" :description="t('setup.description')">
    <Badge :variant="missing.length ? 'warning' : 'success'" data-testid="org-status">
      {{ missing.length ? t('setup.statusLeft', { n: missing.length }) : t('setup.statusComplete') }}
    </Badge>
  </AppPageHeading>

  <nav class="flex flex-wrap items-center gap-2 px-2" :aria-label="t('adm.setup.stepsLabel')" data-testid="org-steps">
    <template v-for="(s, i) in steps" :key="s.id">
      <button type="button" class="flex items-center gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring" :aria-current="s.current ? 'step' : undefined" :data-testid="s.id" :data-state="s.done ? 'done' : s.current ? 'current' : 'todo'" @click="goTo(s.anchor)">
        <span class="flex size-7 items-center justify-center rounded-full text-xs font-medium" :class="s.done ? 'bg-success text-white' : s.current ? 'bg-primary text-primary-foreground' : 'bg-border text-muted-foreground'">
          <CheckIcon v-if="s.done" class="size-4" /><template v-else>{{ s.n }}</template>
        </span>
        <span class="text-sm" :class="s.done || s.current ? 'font-medium' : 'text-muted-foreground'">{{ s.label }}</span>
      </button>
      <span v-if="i < steps.length - 1" class="hidden h-0.5 min-w-6 flex-1 rounded sm:block" :class="s.done ? 'bg-success' : 'bg-border'" aria-hidden="true" />
    </template>
  </nav>

  <form class="space-y-4" @submit.prevent="save">
    <ul v-if="missing.length" class="list-disc space-y-1 pl-5 text-sm text-muted-foreground" data-testid="org-missing">
      <li v-for="m in missing" :key="m">{{ m }}</li>
    </ul>

    <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div class="flex min-w-0 flex-col gap-4">
        <Card id="org-section-identity" class="scroll-mt-4">
          <CardHeader>
            <CardTitle class="text-base">{{ t('setup.identityTitle') }}</CardTitle>
            <CardDescription>{{ t('setup.identityHelp') }}</CardDescription>
          </CardHeader>
          <CardContent class="mt-2 grid gap-6 sm:grid-cols-2">
            <div class="space-y-2">
              <Label for="org-country">{{ t('setup.country') }}</Label>
              <AppNativeSelect id="org-country" v-model="form.country" :disabled="!canWrite" data-testid="org-country">
                <option v-for="c in countries" :key="c.code" :value="c.code">{{ c.name }} ({{ c.currency }})</option>
              </AppNativeSelect>
            </div>
            <div class="space-y-2">
              <Label for="org-legal-name">{{ t('setup.legalName') }}</Label>
              <Input id="org-legal-name" v-model="form.legalName" :disabled="!canWrite" required data-testid="org-legal-name" />
            </div>
            <div class="space-y-2">
              <Label for="org-kvk">{{ country.companyId.label }}</Label>
              <Input id="org-kvk" v-model="form.kvkNumber" :disabled="!canWrite" required :pattern="country.companyId.pattern" data-testid="org-kvk" />
              <p v-if="country.companyId.example" class="text-xs text-muted-foreground">{{ t('setup.companyIdHint', { example: country.companyId.example }) }}</p>
            </div>
            <div class="space-y-2">
              <Label for="org-vat">{{ country.vatId.label }} <span class="font-normal text-muted-foreground">({{ t('setup.vatOptional') }})</span></Label>
              <Input id="org-vat" v-model="form.vatNumber" :disabled="!canWrite" :placeholder="country.vatId.example" data-testid="org-vat" />
              <p v-if="country.vatId.example" class="text-xs text-muted-foreground">{{ t('setup.vatHint', { example: country.vatId.example }) }}</p>
            </div>
            <div class="space-y-2 sm:col-span-2">
              <Label for="org-retention">{{ t('setup.retention') }}</Label>
              <Input id="org-retention" v-model.number="form.retentionYears" :disabled="!canWrite" type="number" :min="minRetention" max="25" required class="sm:max-w-48" data-testid="org-retention" />
              <p class="text-xs text-muted-foreground">{{ t('setup.retentionHelp', { country: country.name, years: country.retentionYearsIndicative }) }}</p>
            </div>
          </CardContent>
        </Card>

        <Card id="org-section-legal" class="scroll-mt-4">
          <CardHeader>
            <CardTitle class="text-base">{{ t('setup.settingsTitle', { country: country.name }) }}</CardTitle>
            <CardDescription>{{ t('setup.settingsHelp') }} {{ t('adm.setup.settingsRequired') }}</CardDescription>
          </CardHeader>
          <CardContent class="mt-2 grid gap-6 sm:grid-cols-2">
            <p v-if="!country.settings.length" class="text-sm text-muted-foreground sm:col-span-2">{{ t('setup.settingsNone') }}</p>
            <div v-for="s in country.settings" :key="`${country.code}-${s.key}`" class="space-y-2" :class="s.type === 'boolean' ? 'sm:col-span-2' : ''">
              <template v-if="s.type === 'boolean'">
                <div class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3">
                  <div class="min-w-0 space-y-1">
                    <Label :for="`org-setting-${s.key}`">{{ s.label }}<span v-if="s.required" class="text-danger"> *</span></Label>
                    <p v-if="s.help" class="text-xs text-muted-foreground">{{ s.help }}</p>
                    <p v-if="s.hint" class="text-xs text-muted-foreground">{{ s.hint }}</p>
                  </div>
                  <Switch :id="`org-setting-${s.key}`" :model-value="values[s.key] === true" :disabled="!canWrite" :data-testid="`org-setting-${s.key}`" @update:model-value="setValue(s.key, !!$event)" />
                </div>
              </template>
              <template v-else>
                <Label :for="`org-setting-${s.key}`">{{ s.label }}<span v-if="s.required" class="text-danger"> *</span></Label>
                <AppNativeSelect
                  v-if="s.type === 'select'"
                  :id="`org-setting-${s.key}`"
                  :model-value="textValue(s.key)"
                  :disabled="!canWrite"
                  :required="s.required"
                  :data-testid="`org-setting-${s.key}`"
                  @update:model-value="setValue(s.key, $event ?? '')"
                >
                  <option value="">{{ t('setup.selectPlaceholder') }}</option>
                  <option v-for="o in s.options ?? []" :key="o" :value="o">{{ o }}</option>
                </AppNativeSelect>
                <Input
                  v-else
                  :id="`org-setting-${s.key}`"
                  :model-value="textValue(s.key)"
                  :disabled="!canWrite"
                  :required="s.required"
                  :pattern="s.pattern"
                  :data-testid="`org-setting-${s.key}`"
                  @update:model-value="setValue(s.key, String($event))"
                />
                <p v-if="s.help" class="text-xs text-muted-foreground">{{ s.help }}</p>
                <p v-if="s.hint" class="text-xs text-muted-foreground">{{ s.hint }}</p>
              </template>
            </div>
          </CardContent>
        </Card>

        <Card id="org-section-state" class="scroll-mt-4" data-testid="org-state">
          <CardHeader>
            <CardTitle class="text-base">{{ t('fmt.title', { country: country.name }) }}</CardTitle>
            <CardDescription>{{ t('fmt.help') }}</CardDescription>
          </CardHeader>
          <CardContent class="mt-2 space-y-6 text-sm">
            <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2" data-testid="org-format">
              <div><dt class="text-muted-foreground">{{ t('fmt.currency') }}</dt><dd class="font-medium">{{ format.currency }} · {{ money(1234.5) }}</dd></div>
              <div><dt class="text-muted-foreground">{{ t('fmt.vatRates') }}</dt><dd class="font-medium">{{ format.vatRates.map((r) => `${r}%`).join(' · ') }}</dd></div>
              <div><dt class="text-muted-foreground">{{ t('fmt.rounding') }}</dt><dd class="font-medium">{{ format.cashRoundingStep ? t('fmt.roundingStep', { step: format.cashRoundingStep / 100 }) : t('fmt.roundingNone') }}</dd></div>
              <div><dt class="text-muted-foreground">{{ t('fmt.timezone') }}</dt><dd class="font-medium">{{ format.timezone }}</dd></div>
              <div class="sm:col-span-2"><dt class="text-muted-foreground">{{ t('fmt.ids') }}</dt><dd class="font-medium">{{ format.idLabels.company }} · {{ format.idLabels.vat }}</dd></div>
            </dl>

            <div v-if="spec" class="space-y-4 rounded-md border border-border p-4" data-testid="org-fiscal">
              <div class="space-y-1">
                <p class="font-medium">{{ spec.system }}</p>
                <p class="text-muted-foreground">{{ spec.authority }} · {{ t(format.fiscal === 'required' ? 'fmt.required' : 'fmt.optional') }}</p>
                <p>{{ spec.how }}</p>
              </div>
              <div class="space-y-1">
                <p class="text-muted-foreground">{{ t('fmt.fields') }}</p>
                <ul class="flex flex-wrap gap-2"><li v-for="f in spec.fields" :key="f.key" class="rounded-md bg-muted px-2 py-1 text-xs">{{ f.label }}</li></ul>
              </div>
              <div v-if="needed.length" class="space-y-1">
                <p class="text-muted-foreground">{{ t('fmt.needs') }}</p>
                <ul class="space-y-1"><li v-for="n in needed" :key="n.key" class="flex items-center gap-2"><Badge :variant="n.filled ? 'success' : 'warning'">{{ n.filled ? t('fmt.filled') : t('fmt.missing') }}</Badge>{{ n.label }}</li></ul>
              </div>
              <p class="text-muted-foreground">{{ t('fmt.connect') }}</p>
            </div>
            <p v-else class="text-muted-foreground" data-testid="org-no-fiscal">{{ t('fmt.none', { country: country.name }) }}</p>
          </CardContent>
        </Card>

        <Card id="org-section-confirm" class="scroll-mt-4">
          <CardContent class="flex flex-wrap items-center justify-between gap-4">
            <div class="flex min-w-0 flex-1 basis-72 items-start gap-3">
              <Switch id="org-confirm-legal" :model-value="confirmLegal" :disabled="!canWrite" data-testid="org-confirm-legal" @update:model-value="confirmLegal = !!$event" />
              <Label for="org-confirm-legal" class="leading-snug">{{ t('setup.confirmLegal', { country: country.name }) }}</Label>
            </div>
            <div class="flex items-center gap-4">
              <div class="text-sm">
                <p v-if="saved" class="text-success" data-testid="org-saved">{{ t('setup.saved') }}</p>
                <p v-else-if="error" class="text-danger" role="alert" data-testid="error">{{ error }}</p>
                <p v-else-if="!canWrite" class="text-muted-foreground">{{ t('setup.ownersOnly') }}</p>
              </div>
              <Button v-if="canWrite" :disabled="!confirmLegal" data-testid="org-save">{{ t('setup.save') }}</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card class="lg:sticky lg:top-4" data-testid="org-law">
        <CardHeader>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <CardTitle class="text-base">{{ t('adm.setup.lawCard') }}</CardTitle>
            <Badge :variant="confidenceVariant[country.confidence]" data-testid="org-confidence">{{ t(`setup.confidence.${country.confidence}`) }}</Badge>
          </div>
          <CardDescription>{{ t('setup.lawTitle', { country: country.name }) }} · {{ t('setup.lastChecked', { date: lastChecked }) }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="rounded-md border border-warning-border bg-warning-soft p-3 text-sm" role="note">
            <p class="font-medium text-warning">{{ t('setup.disclaimerTitle') }}</p>
            <p class="mt-1 text-text-secondary">{{ DISCLAIMER }}</p>
          </div>

          <div class="max-h-[60vh] divide-y divide-border overflow-y-auto rounded-md border border-border">
            <details v-for="(topic, i) in TOPICS" :key="`${country.code}-${topic}`" :open="i === 0" class="group px-4 py-3">
              <summary class="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                {{ t(`setup.topic.${topic}`) }}
                <ChevronDownIcon class="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p class="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{{ country.summary[topic] }}</p>
            </details>
          </div>

          <details v-if="country.adviserMustVerify || country.sources.length" class="group rounded-md border border-border px-4 py-3">
            <summary class="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium text-primary [&::-webkit-details-marker]:hidden">
              {{ t('adm.setup.sourcesTitle') }}
              <ChevronDownIcon class="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div v-if="country.adviserMustVerify" class="mt-3">
              <h3 class="text-sm font-medium">{{ t('setup.adviserTitle') }}</h3>
              <p class="mt-1 whitespace-pre-line text-sm text-muted-foreground">{{ country.adviserMustVerify }}</p>
            </div>
            <div v-if="country.sources.length" class="mt-3">
              <h3 class="text-sm font-medium">{{ t('setup.sources') }}</h3>
              <ul class="mt-1 space-y-1 text-sm">
                <li v-for="src in country.sources" :key="src" class="break-all">
                  <a :href="src" target="_blank" rel="noopener noreferrer" class="text-primary underline-offset-4 hover:underline">{{ src }}</a>
                </li>
              </ul>
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  </form>
</template>
