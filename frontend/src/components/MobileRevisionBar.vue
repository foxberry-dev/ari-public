<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { commitLabels, formatTime, type GraphCommit } from '../model';

const props = defineProps<{ commits: GraphCommit[]; index: number }>();
const emit = defineEmits<{ select: [index: number] }>();
const container = ref<HTMLElement>();
const slots = ref(1), backward = ref(false);
watch(() => props.index, (index, previous) => { backward.value = index < previous; });
const currentSlot = computed(() => slots.value === 3 ? 1 : slots.value === 1 || props.index === 0 ? 0 : backward.value || props.index === props.commits.length - 1 ? 1 : 0);
const steps = computed(() => {
  const start = Math.max(0, props.index - 2);
  return props.commits.slice(start, props.index + 3).map((commit, offset) => {
    const index = start + offset, slot = index - props.index + currentSlot.value;
    return { commit, index, slot, visible: slot >= 0 && slot < slots.value };
  });
});
let observer: ResizeObserver;
let origin: { id: number; x: number; y: number; commitId?: string } | undefined;
let suppressClick = false;
function start(event: PointerEvent) {
  suppressClick = false;
  origin = event.pointerType === 'touch' && event.isPrimary
    ? { id: event.pointerId, x: event.clientX, y: event.clientY, commitId: props.commits[props.index]?.id }
    : undefined;
}
function end(event: PointerEvent) {
  const from = origin; origin = undefined;
  if (!from || from.id !== event.pointerId || from.commitId !== props.commits[props.index]?.id) return;
  const x = event.clientX - from.x, y = event.clientY - from.y;
  if (Math.abs(x) < 40 || Math.abs(x) < Math.abs(y) * 1.25) return;
  suppressClick = true;
  const next = props.index + (x < 0 ? 1 : -1);
  if (props.commits[next]) emit('select', next);
}
function click(event: MouseEvent) {
  if (!suppressClick) return;
  suppressClick = false; event.preventDefault(); event.stopPropagation();
}
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    if (entry) slots.value = entry.contentRect.width < 480 ? 1 : entry.contentRect.width < 900 ? 2 : 3;
  });
  observer.observe(container.value!);
});
onUnmounted(() => observer?.disconnect());
</script>

<template>
  <nav ref="container" class="mobile-revisions" aria-label="Revision history">
    <p class="revision-announcement" role="status" aria-atomic="true">Revision {{ index + 1 }}/{{ commits.length }} · {{ commits[index]?.metadata.title }} · {{ commits[index] ? commitLabels[commits[index]!.metadata.kind] : '' }}</p>
    <button class="revision-chevron" aria-label="Previous revision" :disabled="index === 0" @click="emit('select', index - 1)">‹</button>
    <div class="revision-rail" :style="{ '--slots': slots, '--current-slot': currentSlot }" @pointerdown="start" @pointerup="end" @pointercancel="origin = undefined" @click.capture="click">
      <div class="revision-runway" aria-hidden="true"/><div class="revision-lens" aria-hidden="true"/>
      <button v-for="step in steps" :key="step.commit.id" type="button" class="revision-tile" :class="{ current: step.index === index, visible: step.visible, future: step.index > index }" :style="{ transform: `translateX(${step.slot * 100}%)` }" :data-revision="step.commit.revision" :aria-label="`${step.index < index ? 'Previous' : step.index > index ? 'Next' : 'Current'} revision ${step.index + 1} of ${commits.length}: ${step.commit.metadata.title}`" :aria-current="step.index === index ? 'step' : undefined" :aria-disabled="step.index === index ? true : undefined" :aria-hidden="!step.visible" :tabindex="step.visible && step.index !== index ? 0 : -1" :title="`${step.commit.metadata.title} · ${commitLabels[step.commit.metadata.kind]} · ${formatTime(step.commit.at)} · ${step.commit.metadata.summary}`" @click="step.index !== index && emit('select', step.index)">
        <span class="revision-heading"><span class="revision-marker" aria-hidden="true">{{ step.index === commits.length - 1 ? (step.index === index ? '■' : '□') : step.index === index ? '●' : step.index < index ? '✓' : '○' }}</span><span class="revision-title"><span class="revision-number">{{ step.index + 1 }}/{{ commits.length }}</span><span class="revision-label">{{ step.commit.metadata.title }}</span></span></span>
      </button>
    </div>
    <button class="revision-chevron" aria-label="Next revision" :disabled="index === commits.length - 1" @click="emit('select', index + 1)">›</button>
  </nav>
</template>

<style scoped>
.mobile-revisions{display:flex;align-items:center;gap:6px;flex-shrink:0;min-width:0;height:44px;padding:0 8px;background:var(--surface);border-bottom:1px solid #303436}
.revision-announcement{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.revision-chevron{width:30px;height:36px;flex-shrink:0;color:#a7ac9f;font-size:20px;border:0;padding:0}.revision-chevron:focus-visible{outline:none;color:var(--accent)}
.revision-rail{position:relative;flex:1;min-width:0;height:43px;overflow:hidden;isolation:isolate;border-radius:6px;touch-action:pinch-zoom;user-select:none}
.revision-runway{position:absolute;inset:4px 0;background:var(--surface);border-radius:6px}
.revision-lens{position:absolute;inset:3px auto 3px calc(100% * var(--current-slot) / var(--slots));width:calc(100% / var(--slots));border-radius:6px;background:#252821;transition:left .3s cubic-bezier(.22,.68,0,1),width .3s}
.revision-tile{position:absolute;top:0;left:0;width:calc(100% / var(--slots));height:100%;display:flex;align-items:center;justify-content:center;min-width:0;padding:0 6px;border:0;border-radius:6px;background:transparent;color:#808a77;opacity:0;pointer-events:none;transition:transform .3s cubic-bezier(.22,.68,0,1),opacity .3s,color .3s}
.revision-tile.visible{opacity:1;pointer-events:auto}.revision-tile.current{color:var(--text);cursor:default}.revision-tile.future{color:#777b78}.revision-tile:not(.current):hover,.revision-tile:focus-visible{outline:none;background:#333;color:var(--text)}
.revision-heading{display:flex;align-items:center;justify-content:center;gap:5px;min-width:0;max-width:100%}.revision-marker{flex-shrink:0;font-size:8px;color:#79816f}.current .revision-marker{color:var(--accent)}
.revision-title{display:flex;align-items:center;gap:7px;min-width:0;max-width:100%;font-size:10px;font-weight:550;line-height:1.4}.current .revision-title{font-size:12px}.revision-number{flex-shrink:0;color:#969d90;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:9px;font-weight:400}.current .revision-number{font-size:11px}.revision-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
@media(prefers-reduced-motion:reduce){.revision-tile,.revision-lens{transition:none}}
</style>
