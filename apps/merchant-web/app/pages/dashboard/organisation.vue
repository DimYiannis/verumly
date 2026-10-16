<script setup lang="ts">
import { DISCLAIMER, getCountry, listCountries, validateSetup } from '@lr/compliance';

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

  <form class="space-y-6" @submit.prevent="save">
    <p v-if="form.country !== 'NL'" class="rounded-md border border-warning-border bg-warning-soft p-3 text-sm text-warning" role="status" data-testid="org-nl-only">{{ t('setup.nlOnly') }}</p>
    <ul v-if="missing.length" class="list-disc space-y-1 pl-5 text-sm text-muted-foreground" data-testid="org-missing">
      <li v-for="m in missing" :key="m">{{ m }}</li>
    </ul>

    <Card>
      <CardContent class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div>
          <h2 class="text-base font-medium">{{ t('setup.identityTitle') }}</h2>
          <p class="mt-1 text-sm text-muted-foreground">{{ t('setup.identityHelp') }}</p>
        </div>
        <div class="max-w-lg space-y-6">
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
          <div class="space-y-2">
            <Label for="org-retention">{{ t('setup.retention') }}</Label>
            <Input id="org-retention" v-model.number="form.retentionYears" :disabled="!canWrite" type="number" :min="minRetention" max="25" required data-testid="org-retention" />
            <p class="text-xs text-muted-foreground">{{ t('setup.retentionHelp', { country: country.name, years: country.retentionYearsIndicative }) }}</p>
          </div>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardContent class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div>
          <h2 class="text-base font-medium">{{ t('setup.settingsTitle', { country: country.name }) }}</h2>
          <p class="mt-1 text-sm text-muted-foreground">{{ t('setup.settingsHelp') }}</p>
        </div>
        <div class="max-w-lg space-y-6">
          <p v-if="!country.settings.length" class="text-sm text-muted-foreground">{{ t('setup.settingsNone') }}</p>
          <div v-for="s in country.settings" :key="`${country.code}-${s.key}`" class="space-y-2">
            <template v-if="s.type === 'boolean'">
              <div class="flex items-center justify-between gap-4">
                <Label :for="`org-setting-${s.key}`">{{ s.label }}<span v-if="s.required" class="text-danger"> *</span></Label>
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
            </template>
            <p v-if="s.help" class="text-xs text-muted-foreground">{{ s.help }}</p>
            <p v-if="s.hint" class="text-xs text-muted-foreground">{{ s.hint }}</p>
          </div>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardContent class="space-y-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-base font-medium">{{ t('setup.lawTitle', { country: country.name }) }}</h2>
          <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge :variant="confidenceVariant[country.confidence]" data-testid="org-confidence">{{ t(`setup.confidence.${country.confidence}`) }}</Badge>
            <span>{{ t('setup.lastChecked', { date: lastChecked }) }}</span>
          </div>
        </div>

        <div class="rounded-md border border-warning-border bg-warning-soft p-3 text-sm" role="note">
          <p class="font-medium text-warning">{{ t('setup.disclaimerTitle') }}</p>
          <p class="mt-1">{{ DISCLAIMER }}</p>
        </div>

        <div class="divide-y divide-border rounded-md border border-border">
          <details v-for="(topic, i) in TOPICS" :key="`${country.code}-${topic}`" :open="i === 0" class="group px-4 py-3">
            <summary class="cursor-pointer text-sm font-medium">{{ t(`setup.topic.${topic}`) }}</summary>
            <p class="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{{ country.summary[topic] }}</p>
          </details>
        </div>

        <div v-if="country.adviserMustVerify">
          <h3 class="text-sm font-medium">{{ t('setup.adviserTitle') }}</h3>
          <p class="mt-1 whitespace-pre-line text-sm text-muted-foreground">{{ country.adviserMustVerify }}</p>
        </div>

        <div v-if="country.sources.length">
          <h3 class="text-sm font-medium">{{ t('setup.sources') }}</h3>
          <ul class="mt-1 space-y-1 text-sm">
            <li v-for="src in country.sources" :key="src" class="break-all">
              <a :href="src" target="_blank" rel="noopener noreferrer" class="text-primary underline-offset-4 hover:underline">{{ src }}</a>
            </li>
          </ul>
        </div>
      </CardContent>
      <CardFooter class="flex-col items-stretch gap-4 border-t border-border pt-4">
        <div class="flex items-start gap-3">
          <Switch id="org-confirm-legal" :model-value="confirmLegal" :disabled="!canWrite" data-testid="org-confirm-legal" @update:model-value="confirmLegal = !!$event" />
          <Label for="org-confirm-legal" class="leading-snug">{{ t('setup.confirmLegal', { country: country.name }) }}</Label>
        </div>
        <div class="flex items-center justify-between gap-4">
          <div class="text-sm">
            <p v-if="saved" class="text-success" data-testid="org-saved">{{ t('setup.saved') }}</p>
            <p v-else-if="error" class="text-danger" role="alert" data-testid="error">{{ error }}</p>
            <p v-else-if="!canWrite" class="text-muted-foreground">{{ t('setup.ownersOnly') }}</p>
          </div>
          <Button v-if="canWrite" :disabled="!confirmLegal" data-testid="org-save">{{ t('setup.save') }}</Button>
        </div>
      </CardFooter>
    </Card>
  </form>
</template>
