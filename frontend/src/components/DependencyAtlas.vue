<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { affectedBy, questionStatus, type Workspace } from '../model';
import { layout, nodeWidth, nodeHeight } from '../graph';

const props = defineProps<{ workspace: Workspace; selected: string }>();
const emit = defineEmits<{ select: [id: string] }>();
const viewport = ref<HTMLElement>();
const size = ref({ width: 800, height: 600 });
const graph = computed(() => layout(props.workspace.questions));
const zoom = ref(1);
const pan = ref({ x: 0, y: 0 });
const manual = ref(false);
const trace = ref(false);
const scale = computed(() => manual.value ? zoom.value : Math.min((size.value.width - 40) / graph.value.width, (size.value.height - 40) / graph.value.height, 1));
const transform = computed(() => `translate(${(size.value.width - graph.value.width * scale.value) / 2 + pan.value.x}px, ${(size.value.height - graph.value.height * scale.value) / 2 + pan.value.y}px) scale(${scale.value})`);
const neighbors = computed(() => new Set([props.selected, ...affectedBy(props.workspace, props.selected).map(q => q.id), ...(props.workspace.questions.find(q => q.id === props.selected)?.dependsOn || [])]));
let observer: ResizeObserver;
let drag: { x: number; y: number; px: number; py: number } | undefined;

function fit() { manual.value = false; pan.value = { x: 0, y: 0 }; }
function changeZoom(delta: number) { zoom.value = Math.min(2, Math.max(.15, scale.value + delta)); manual.value = true; }
function down(event: PointerEvent) {
  if ((event.target as HTMLElement).closest('button')) return;
  drag = { x: event.clientX, y: event.clientY, px: pan.value.x, py: pan.value.y };
  viewport.value?.setPointerCapture(event.pointerId);
}
function move(event: PointerEvent) {
  if (drag) pan.value = { x: drag.px + event.clientX - drag.x, y: drag.py + event.clientY - drag.y };
}
function keyboard(event: KeyboardEvent) {
  if (event.target !== viewport.value) return;
  const delta = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[event.key];
  if (delta) { event.preventDefault(); pan.value = { x: pan.value.x + delta[0], y: pan.value.y + delta[1] }; }
  if (event.key === '0') fit();
  if (event.key === '+') changeZoom(.1);
  if (event.key === '-') changeZoom(-.1);
}
watch(() => props.workspace.id, fit);
onMounted(() => { observer = new ResizeObserver(([entry]) => { size.value = { width: entry.contentRect.width, height: entry.contentRect.height }; }); observer.observe(viewport.value!); });
onUnmounted(() => observer?.disconnect());
</script>

<template>
  <section class="atlas">
    <div class="canvas-title"><div><p class="eyebrow">Dependency atlas</p><p class="small muted">A clear view of what hangs on what</p></div><button class="quiet" :class="{ active: trace }" :aria-pressed="trace" @click="trace = !trace"><i class="pi pi-share-alt"/> Trace impact</button></div>
    <div ref="viewport" class="graph-viewport" tabindex="0" role="region" aria-label="Decision dependency map. Use arrow keys to pan, plus and minus to zoom, zero to fit." @pointerdown="down" @pointermove="move" @pointerup="drag = undefined" @pointercancel="drag = undefined" @keydown="keyboard">
      <div class="graph-scene" :style="{ width: `${graph.width}px`, height: `${graph.height}px`, transform }">
        <svg class="wires" :width="graph.width" :height="graph.height" aria-hidden="true"><defs><marker id="atlas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 10 5 0 10" fill="#92866a"/></marker></defs><path v-for="edge in graph.edges" :key="edge.id" :d="edge.path" :class="{ related: edge.from === selected || edge.to === selected, faded: trace && (!neighbors.has(edge.from) || !neighbors.has(edge.to)) }" marker-end="url(#atlas-arrow)"/></svg>
        <button v-for="node in graph.nodes" :key="node.question.id" class="graph-node" :class="{ selected: selected === node.question.id, affected: workspace.needsReview.includes(node.question.id), faded: trace && !neighbors.has(node.question.id) }" :style="{ left: `${node.x}px`, top: `${node.y}px`, width: `${nodeWidth}px`, height: `${nodeHeight}px` }" :aria-pressed="selected === node.question.id" @click="emit('select', node.question.id)">
          <span class="row between"><span class="eyebrow">{{ node.question.id }}</span><span class="badge" :class="{ gold: questionStatus(workspace, node.question) === 'Needs review', good: questionStatus(workspace, node.question) === 'Decided' }">{{ questionStatus(workspace, node.question) }}</span></span>
          <strong :title="node.question.title">{{ node.question.title }}</strong><span class="node-value" :title="workspace.answers[node.question.id]?.value">{{ workspace.answers[node.question.id]?.value || 'No answer yet' }}</span>
        </button>
      </div>
    </div>
    <div v-if="!graph.nodes.length" class="canvas-empty"><i class="pi pi-sitemap"/><h2>Start with the right questions.</h2><p>Ask your agent to develop this idea.<br>Proposed questions appear here after your approval.</p></div>
    <div class="canvas-bottom"><span class="tiny muted">→ informs <span class="legend-help"> · Drag to move · Tab to inspect</span></span><div class="graph-controls"><button aria-label="Zoom out" @click="changeZoom(-.1)">−</button><span>{{ Math.round(scale * 100) }}%</span><button aria-label="Zoom in" @click="changeZoom(.1)">+</button><button @click="fit">Fit map</button></div></div>
    <div class="map-dock"><slot /></div>
  </section>
</template>
