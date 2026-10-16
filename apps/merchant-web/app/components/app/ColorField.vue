<script setup lang="ts">
import { HEX_COLOR_RE } from '@lr/schema';

// A native colour picker plus a hex field. Emits only valid #rrggbb values.
const props = defineProps<{ modelValue: string; label: string; hexLabel: string; disabled?: boolean; testid?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const draft = ref(props.modelValue);
watch(() => props.modelValue, (v) => (draft.value = v));

function onHex(e: Event) {
  const v = (e.target as HTMLInputElement).value.trim();
  draft.value = v;
  const full = v.startsWith('#') ? v : `#${v}`;
  if (HEX_COLOR_RE.test(full)) emit('update:modelValue', full.toUpperCase());
}
function onPick(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value.toUpperCase());
}
</script>

<template>
  <div class="flex items-center gap-2">
    <input type="color" :value="modelValue" :aria-label="label" :disabled="disabled" :data-testid="testid" class="size-9 shrink-0 cursor-pointer rounded-md border border-input bg-card p-1 disabled:cursor-not-allowed disabled:opacity-50" @input="onPick" />
    <Input :model-value="draft" :aria-label="hexLabel" :disabled="disabled" maxlength="7" class="font-mono uppercase" @input="onHex" />
  </div>
</template>
