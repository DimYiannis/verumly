<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'dashboard-auth' });

interface Org { legalName: string; kvkNumber: string; vatNumber: string | null; retentionYears: number }
const { t } = useLocale();
const session = sessionState();
const canWrite = computed(() => session.value.user?.role === 'owner');
const form = reactive<Org>({ legalName: '', kvkNumber: '', vatNumber: null, retentionYears: 7 });
const error = ref('');
const saved = ref(false);

onMounted(async () => {
  const o = await attempt(error, () => $fetch<Org>('/api/dashboard/org'));
  if (o) Object.assign(form, o);
});

async function save() {
  saved.value = false;
  const o = await attempt(error, () =>
    $fetch<Org>('/api/dashboard/org', { method: 'PUT', body: { legalName: form.legalName, kvkNumber: form.kvkNumber, vatNumber: form.vatNumber || null, retentionYears: Number(form.retentionYears) } }),
  );
  if (o) {
    Object.assign(form, o);
    saved.value = true;
  }
}
</script>

<template>
  <AppPageHeading :title="t('nav.organisation')" :description="t('org.description')" />

  <Card>
    <form @submit.prevent="save">
      <CardContent class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div>
          <h2 class="text-base font-medium">{{ t('org.legalTitle') }}</h2>
          <p class="mt-1 text-sm text-muted-foreground">{{ t('org.legalHelp') }}</p>
        </div>
        <div class="max-w-lg space-y-6">
          <div class="space-y-2">
            <Label for="org-legal-name">{{ t('org.legalName') }}</Label>
            <Input id="org-legal-name" v-model="form.legalName" :disabled="!canWrite" required data-testid="org-legal-name" />
          </div>
          <div class="space-y-2">
            <Label for="org-kvk">{{ t('org.kvk') }}</Label>
            <Input id="org-kvk" v-model="form.kvkNumber" :disabled="!canWrite" required pattern="\d{8}" data-testid="org-kvk" />
            <p class="text-xs text-muted-foreground">{{ t('org.kvkHelp') }}</p>
          </div>
          <div class="space-y-2">
            <Label for="org-vat">{{ t('org.vat') }}</Label>
            <Input id="org-vat" :model-value="form.vatNumber ?? ''" @update:model-value="form.vatNumber = String($event)" :disabled="!canWrite" pattern="NL\d{9}B\d{2}" :placeholder="t('org.vatPlaceholder')" data-testid="org-vat" />
            <p class="text-xs text-muted-foreground">{{ t('org.vatHelp') }}</p>
          </div>
          <div class="space-y-2">
            <Label for="org-retention">{{ t('org.retention') }}</Label>
            <Input id="org-retention" v-model.number="form.retentionYears" :disabled="!canWrite" type="number" min="7" max="25" required data-testid="org-retention" />
            <p class="text-xs text-muted-foreground">{{ t('org.retentionHelp') }}</p>
          </div>
        </div>
      </CardContent>
      <CardFooter class="mt-6 justify-between gap-4">
        <div class="text-sm">
          <p v-if="saved" class="text-success" data-testid="org-saved">{{ t('org.saved') }}</p>
          <p v-else-if="error" class="text-danger" role="alert" data-testid="error">{{ error }}</p>
          <p v-else-if="!canWrite" class="text-muted-foreground">{{ t('org.ownersOnly') }}</p>
        </div>
        <Button v-if="canWrite" data-testid="org-save">{{ t('org.save') }}</Button>
      </CardFooter>
    </form>
  </Card>
</template>
