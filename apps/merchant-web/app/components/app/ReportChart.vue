<script setup lang="ts">
// Dependency-free SVG chart: vertical bars or a line for time groupings, horizontal sorted bars for categories.
interface Point { label: string; value: number }
const props = defineProps<{ points: Point[]; mode: 'bars' | 'line'; horizontal: boolean; format: (v: number) => string; summary: string }>();

const W = 720;
const MAX_H = 20;

const pts = computed(() => (props.horizontal ? [...props.points].sort((a, b) => b.value - a.value).slice(0, MAX_H) : props.points));

const domain = computed(() => {
  const vals = pts.value.map((p) => p.value);
  let lo = Math.min(0, ...vals);
  let hi = Math.max(0, ...vals);
  if (hi === lo) hi = lo + 1;
  return { lo, hi };
});

function niceTicks(lo: number, hi: number, n = 4): number[] {
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw);
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}
const ticks = computed(() => niceTicks(domain.value.lo, domain.value.hi));
const dmax = computed(() => Math.max(domain.value.hi, ticks.value[ticks.value.length - 1] ?? 0));
const dmin = computed(() => Math.min(domain.value.lo, ticks.value[0] ?? 0));

// vertical layout
const V = { l: 72, r: 12, t: 12, b: 40, h: 280 };
const vx = (i: number) => V.l + ((i + 0.5) / Math.max(pts.value.length, 1)) * (W - V.l - V.r);
const vy = (v: number) => V.t + (1 - (v - dmin.value) / (dmax.value - dmin.value)) * (V.h - V.t - V.b);
const bw = computed(() => Math.max(2, Math.min(40, ((W - V.l - V.r) / Math.max(pts.value.length, 1)) * 0.7)));
const every = computed(() => Math.ceil(pts.value.length / 12));
const linePath = computed(() => pts.value.map((p, i) => `${i ? 'L' : 'M'}${vx(i).toFixed(1)},${vy(p.value).toFixed(1)}`).join(' '));

// horizontal layout
const ROW = 28;
const Hz = { l: 150, r: 90, t: 8 };
const hh = computed(() => Hz.t + pts.value.length * ROW + 8);
const hx = (v: number) => Hz.l + ((v - dmin.value) / (dmax.value - dmin.value)) * (W - Hz.l - Hz.r);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}...` : s);
</script>

<template>
  <svg v-if="!horizontal" :viewBox="`0 0 ${W} ${V.h}`" class="h-auto w-full" role="img" :aria-label="summary" data-testid="report-chart-svg">
    <title>{{ summary }}</title>
    <g class="tabular-nums" font-size="11" fill="var(--muted-foreground)">
      <g v-for="tk in ticks" :key="tk">
        <line :x1="V.l" :x2="W - V.r" :y1="vy(tk)" :y2="vy(tk)" :stroke="tk === 0 ? 'var(--muted-foreground)' : 'var(--border)'" stroke-width="1" />
        <text :x="V.l - 8" :y="vy(tk) + 4" text-anchor="end">{{ format(tk) }}</text>
      </g>
      <template v-if="mode === 'bars'">
        <rect v-for="(p, i) in pts" :key="p.label + i" :x="vx(i) - bw / 2" :y="Math.min(vy(p.value), vy(0))" :width="bw" :height="Math.max(1, Math.abs(vy(p.value) - vy(0)))" rx="2" fill="var(--chart-1)">
          <title>{{ p.label }}: {{ format(p.value) }}</title>
        </rect>
      </template>
      <template v-else>
        <path :d="linePath" fill="none" stroke="var(--chart-1)" stroke-width="2" stroke-linejoin="round" />
        <circle v-for="(p, i) in pts" :key="p.label + i" :cx="vx(i)" :cy="vy(p.value)" r="3.5" fill="var(--chart-1)">
          <title>{{ p.label }}: {{ format(p.value) }}</title>
        </circle>
      </template>
      <template v-for="(p, i) in pts" :key="`x${i}`">
        <text v-if="i % every === 0" :x="vx(i)" :y="V.h - V.b + 16" text-anchor="middle">{{ clip(p.label, 10) }}</text>
      </template>
    </g>
  </svg>

  <svg v-else :viewBox="`0 0 ${W} ${hh}`" class="h-auto w-full" role="img" :aria-label="summary" data-testid="report-chart-svg">
    <title>{{ summary }}</title>
    <g class="tabular-nums" font-size="12" fill="var(--foreground)">
      <line :x1="hx(0)" :x2="hx(0)" :y1="Hz.t" :y2="hh - 8" stroke="var(--border)" stroke-width="1" />
      <g v-for="(p, i) in pts" :key="p.label + i">
        <text :x="Hz.l - 8" :y="Hz.t + i * ROW + ROW / 2 + 4" text-anchor="end">{{ clip(p.label, 22) }}</text>
        <rect :x="Math.min(hx(0), hx(p.value))" :y="Hz.t + i * ROW + 4" :width="Math.max(1, Math.abs(hx(p.value) - hx(0)))" :height="ROW - 8" rx="2" fill="var(--chart-1)">
          <title>{{ p.label }}: {{ format(p.value) }}</title>
        </rect>
        <text :x="Math.max(hx(0), hx(p.value)) + 6" :y="Hz.t + i * ROW + ROW / 2 + 4" fill="var(--muted-foreground)">{{ format(p.value) }}</text>
      </g>
    </g>
  </svg>
</template>
