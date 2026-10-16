<script setup lang="ts">
import type { MessageKey } from '~/i18n';
import { formatDateTime, formatEuro } from '~/utils/format';

defineProps<{ merchant: string; total: number; time: string; busy: boolean; error: MessageKey | null }>();
const { t, locale } = useLocale();
const emit = defineEmits<{ save: []; reject: [] }>();
</script>

<template>
  <!-- Modal by design: the buyer must answer "Bon opslaan?", so Escape and outside taps do not dismiss it. -->
  <Sheet :open="true">
    <SheetContent
      side="bottom"
      :show-close-button="false"
      data-testid="confirm-sheet"
      aria-describedby="sheet-desc"
      class="mx-auto w-full max-w-xl rounded-t-xl border-border p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      @escape-key-down.prevent
      @pointer-down-outside.prevent
      @interact-outside.prevent
    >
      <SheetHeader class="p-0">
        <SheetTitle id="sheet-title" class="text-h2 font-semibold">{{ t('sheet.title') }}</SheetTitle>
        <SheetDescription id="sheet-desc" class="text-sm text-text-secondary">{{ t('sheet.desc') }}</SheetDescription>
      </SheetHeader>
      <dl class="space-y-2 rounded-lg border border-border bg-background p-4 text-sm">
        <div class="flex justify-between gap-3">
          <dt class="text-text-secondary">{{ t('common.merchant') }}</dt>
          <dd class="font-medium" data-testid="sheet-merchant">{{ merchant }}</dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt class="text-text-secondary">{{ t('common.total') }}</dt>
          <dd class="font-mono font-medium tabular-nums" data-testid="sheet-total">{{ formatEuro(total, locale) }}</dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt class="text-text-secondary">{{ t('sheet.time') }}</dt>
          <dd class="font-medium" data-testid="sheet-time">{{ formatDateTime(time, locale) }}</dd>
        </div>
      </dl>
      <p v-if="error" role="alert" data-testid="sheet-error" class="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">{{ t(error) }}</p>
      <div class="flex flex-col gap-2">
        <Button type="button" size="lg" data-testid="save-button" :disabled="busy" @click="emit('save')">
          {{ busy ? t('sheet.busy') : t('sheet.save') }}
        </Button>
        <Button type="button" size="lg" variant="secondary" data-testid="not-mine-button" :disabled="busy" @click="emit('reject')">{{ t('sheet.notMine') }}</Button>
      </div>
    </SheetContent>
  </Sheet>
</template>
