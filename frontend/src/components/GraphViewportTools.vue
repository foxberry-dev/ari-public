<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import GraphDownload from './GraphDownload.vue';

type Box = { x: number; y: number; width: number; height: number };
const props = defineProps<{ bounds: Box; nodes: (Box & { id: string; active: boolean })[]; edges: string[]; scale: number; minimumScale: number; pan: { x: number; y: number }; viewport: { width: number; height: number }; fitted: boolean; exportUrl: string; filename: string; compact?: boolean; multiSelect?: boolean }>();
const emit = defineEmits<{ zoom: [delta: number]; fit: []; actual: []; pan: [point: { x: number; y: number }]; toggleMultiSelect: [] }>();
const visible = computed(() => {
  const x = Math.max(props.bounds.x, -props.pan.x / props.scale), y = Math.max(props.bounds.y, -props.pan.y / props.scale);
  const right = Math.min(props.bounds.x + props.bounds.width, (props.viewport.width - props.pan.x) / props.scale);
  const bottom = Math.min(props.bounds.y + props.bounds.height, (props.viewport.height - props.pan.y) / props.scale);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
});
const overviewOpen = ref(false);
let mapHovered = false;
let hideOverviewTimer: ReturnType<typeof setTimeout> | undefined;
function showOverview(event: PointerEvent) {
  if (event.pointerType === 'touch') return;
  clearTimeout(hideOverviewTimer); overviewOpen.value = true;
}
function hideOverview() {
  clearTimeout(hideOverviewTimer);
  hideOverviewTimer = setTimeout(() => { if (!drag && !mapHovered) overviewOpen.value = false; }, 150);
}
function enterOverview(event: PointerEvent) { mapHovered = true; showOverview(event); }
function leaveOverview() { mapHovered = false; hideOverview(); }
function finishDrag() { drag = undefined; hideOverview(); }
onUnmounted(() => clearTimeout(hideOverviewTimer));
let drag: { id: number; x: number; y: number; window: boolean } | undefined;
function point(event: PointerEvent) {
  const svg = event.currentTarget as SVGSVGElement;
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
}
function move(event: PointerEvent) {
  if (drag?.id !== event.pointerId) return;
  const current = point(event);
  function axis(value: number, start: number, length: number, viewport: number) {
    if (drag?.window) return value;
    return length <= viewport ? start - (viewport - length) / 2 : Math.max(start, Math.min(value, start + length - viewport));
  }
  emit('pan', { x: -axis(current.x - drag.x, props.bounds.x, props.bounds.width, props.viewport.width / props.scale) * props.scale,
    y: -axis(current.y - drag.y, props.bounds.y, props.bounds.height, props.viewport.height / props.scale) * props.scale });
}
function down(event: PointerEvent) {
  if (event.button !== 0) return;
  const current = point(event), window = event.target instanceof Element && event.target.classList.contains('minimap-window');
  drag = { id: event.pointerId, window, x: window ? current.x + props.pan.x / props.scale : props.viewport.width / (2 * props.scale), y: window ? current.y + props.pan.y / props.scale : props.viewport.height / (2 * props.scale) };
  (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
  event.preventDefault(); move(event);
}
</script>
<template>
  <div class="viewport-tools" :class="{ compact }" @pointerdown.stop>
    <div class="viewport-dock">
    <slot name="actions"/>
    <div class="control-stack" @pointerleave="hideOverview">
      <div v-if="!multiSelect" class="minimap-region" :class="{ visible: overviewOpen }" @pointerenter="enterOverview" @pointerleave="leaveOverview">
    <svg class="diagram-minimap" :viewBox="`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`" role="group" aria-label="Graph overview. Drag the viewport to pan." tabindex="0" @pointerdown="down" @pointermove="move" @pointerup="finishDrag" @pointercancel="finishDrag" @lostpointercapture="finishDrag">
      <path v-for="(path, index) in edges" :key="index" class="minimap-edge" :d="path"/>
      <rect v-for="node in nodes" :key="node.id" class="minimap-node" :class="{ active: node.active }" :x="node.x" :y="node.y" :width="node.width" :height="node.height" rx="3"/>
      <rect class="minimap-window" :x="visible.x" :y="visible.y" :width="visible.width" :height="visible.height"/>
    </svg>
      </div>
    <div class="viewport-buttons" role="group" aria-label="Graph zoom controls">
      <button @pointerenter="showOverview" @pointerleave="hideOverview" aria-label="Zoom out" :disabled="scale <= minimumScale" @click="emit('zoom', -.1)"><i class="pi pi-minus" aria-hidden="true"/></button>
      <output aria-label="Zoom level">{{ Math.round(scale * 100) }}%</output>
      <button @pointerenter="showOverview" @pointerleave="hideOverview" aria-label="Zoom in" :disabled="scale >= 2" @click="emit('zoom', .1)"><i class="pi pi-plus" aria-hidden="true"/></button>
      <button @pointerenter="showOverview" @pointerleave="hideOverview" aria-label="Fit graph" :aria-pressed="fitted" @click="emit('fit')"><i class="pi pi-expand" aria-hidden="true"/></button>
      <button @pointerenter="showOverview" @pointerleave="hideOverview" class="actual-size" aria-label="Zoom to 100% and focus" :aria-pressed="!fitted && scale === 1" @click="emit('actual')">1:1</button>
      <GraphDownload :url="exportUrl" :filename="filename"/>
      <button v-if="compact" class="multi-select-toggle" aria-label="Multi-select nodes" :aria-pressed="!!multiSelect" @click="emit('toggleMultiSelect')"><i class="pi pi-check-square" aria-hidden="true"/></button>
    </div>
    </div>
    </div>
  </div>
</template>
<style scoped>
.viewport-tools{position:absolute;right:16px;bottom:16px;z-index:3;display:grid;justify-items:end;max-width:calc(100% - 32px);gap:8px;pointer-events:none;--diagram-accent:#7bc8c4}
.diagram-minimap,.viewport-buttons{pointer-events:auto}
.viewport-dock{display:flex;align-items:flex-end;justify-content:flex-end;flex-wrap:wrap;gap:8px;min-width:0}
.viewport-tools.compact{left:16px}
.compact .viewport-dock{width:100%}
.compact :deep(.selection-actions){margin-right:auto}
.control-stack{position:relative;max-width:100%}
.minimap-region{position:absolute;bottom:100%;left:0;width:100%;padding-bottom:8px;visibility:hidden;pointer-events:auto}
.minimap-region.visible{visibility:visible}
.diagram-minimap{display:block;width:100%;max-width:100%;min-width:0;height:110px;box-sizing:border-box;contain:inline-size;padding:6px;border:1px solid var(--line);border-radius:6px;background:var(--surface);box-shadow:0 2px 8px #0002;touch-action:none;cursor:grab}
.control-stack:has([data-graph-export-menu]:popover-open) .minimap-region{visibility:hidden}
.diagram-minimap:active{cursor:grabbing}.minimap-edge{fill:none;stroke:var(--muted);stroke-width:1.5}.minimap-node{fill:var(--soft);stroke:var(--muted);stroke-width:1}.minimap-node.active{fill:var(--diagram-accent);stroke:var(--diagram-accent)}
.minimap-window{fill:var(--diagram-accent);fill-opacity:.12;stroke:var(--diagram-accent);stroke-width:2;vector-effect:non-scaling-stroke}
.viewport-buttons{position:relative;display:flex;align-items:center;border:1px solid var(--line);border-radius:6px;background:var(--surface);box-shadow:0 2px 8px #0002;padding:3px;gap:2px}
.viewport-buttons button,.viewport-buttons :deep(> button){display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--text)}
.viewport-buttons button:hover,.viewport-buttons :deep(> button:hover){background:var(--soft)}
.viewport-buttons button:focus-visible{outline:none;background:var(--soft)}
.viewport-buttons button[aria-pressed="true"]{color:var(--diagram-accent);background:color-mix(in srgb,var(--diagram-accent) 12%,transparent)}
.viewport-buttons .multi-select-toggle[aria-pressed="true"]{color:var(--accent);background:#e6b85c20}
.viewport-buttons button:disabled{opacity:.4;cursor:default}.viewport-buttons .actual-size{font-size:.75rem;font-weight:600}.viewport-buttons output{min-width:46px;text-align:center;font-size:.75rem;color:var(--muted);font-variant-numeric:tabular-nums}
@media(max-width:700px){.viewport-tools{right:10px;bottom:10px;max-width:calc(100% - 20px);gap:6px}.viewport-tools.compact{left:10px}.diagram-minimap{height:80px}.viewport-buttons button,.viewport-buttons :deep(> button){width:30px;height:30px}.viewport-buttons output{min-width:32px}}
@media(max-width:350px){.viewport-dock{gap:6px}.viewport-buttons{gap:0}.viewport-dock:has(.selection-actions) .viewport-buttons output{display:none}}
</style>
