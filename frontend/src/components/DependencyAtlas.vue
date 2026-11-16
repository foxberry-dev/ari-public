<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import GraphViewportTools from './GraphViewportTools.vue';
import { isAssumption, nodeContent, nodeStatus, type Graph, type NodeReference } from '../model';
import { comparisonLayout, constraintCenter, graphBounds, graphDecorations, graphChanges, nodeChangeClass, nodeChangeLabel, nodeWidth, nodeHeight, groupHeaderHeight, positionWires } from '../graph';
import { participants, relationshipChanges, type GraphView } from '../relationships';

const props = defineProps<{ current: Graph; previous: Graph; changed: boolean; selected: string; revision: number; view: GraphView; workspaceId: string; title: string; compact?: boolean; fullscreen?: boolean; nodeIndex?: NodeReference[]; focusedNode?: string }>();
const emit = defineEmits<{ select: [id: string]; copyReference: [reference: string] }>();
const references = computed(() => new Map(props.nodeIndex?.map(entry => [entry.id, entry]) || []));
const viewport = ref<HTMLElement>();
const track = defineModel<boolean>('track', { default: true });
const showInputs = defineModel<boolean>('showInputs', { default: true });
const showConstraints = defineModel<boolean>('showConstraints', { default: true });
const motionSpeed = 1.3;
const transitionDuration = 650 / motionSpeed;
const size = ref({ width: 800, height: 600 });
const layoutPositions: Record<GraphView, Map<string, { x: number; y: number }>> = { hierarchy: new Map(), islands: new Map(), rings: new Map() };
const groupedLabels = new Map<string, string | undefined>();
function regrouping() {
  return props.current.nodes.some(node => groupedLabels.has(node.id) && groupedLabels.get(node.id) !== node.groupLabel);
}
const historical = computed(() => props.current.edges === undefined);
const graph = computed(() => historical.value ? { nodes: [], edges: [], width: 0, height: 0 } : comparisonLayout(props.current, props.previous, props.changed, props.view, props.view === 'islands' && regrouping() ? new Map() : layoutPositions[props.view], props.selected));
const changes = computed(() => graphChanges(props.previous, props.current));
const previousNodes = computed(() => new Map(props.previous.nodes.map(n => [n.id, n])));
const edgeChanges = computed(() => relationshipChanges(props.previous, props.current));
const scale = ref(1), pan = ref({ x: 0, y: 0 });
const transform = computed(() => `translate(${pan.value.x}px, ${pan.value.y}px) scale(${scale.value})`);
const positions = ref(new Map<string, { x: number; y: number }>());
const displayNodes = computed(() => graph.value.nodes.map(n => ({ ...n, ...(positions.value.get(n.node.id) || {}) })));
const decorations = computed(() => graphDecorations(props.current, props.view, displayNodes.value));
const displayEdges = computed(() => positionWires(displayNodes.value, graph.value.edges.filter(e =>
  (e.relation.kind !== 'input' || showInputs.value) && (e.relation.kind !== 'constraint' || showConstraints.value)), props.view));
const bounds = computed(() => graphBounds(props.current, props.view, graph.value.nodes));
const fitScale = computed(() => Math.max(.001, Math.min((size.value.width - 60) / bounds.value.width, (size.value.height - 60) / bounds.value.height, 1)));
const minimumScale = computed(() => Math.min(.05, fitScale.value));
const overviewNodes = computed(() => displayNodes.value.map(n => ({ id: n.node.id, x: n.x, y: n.y, width: nodeWidth, height: nodeHeight, active: n.node.id === props.selected })));
const exportUrl = computed(() => `/api/workspaces/${encodeURIComponent(props.workspaceId)}/export?${new URLSearchParams({ revision: String(props.revision), layout: props.view, display: props.changed ? 'changed' : 'current', inputs: String(showInputs.value), constraints: String(showConstraints.value), ...(props.selected ? { selected: props.selected } : {}) })}`);
const constraints = computed(() => [...new Map(displayEdges.value.filter(e => e.relation.kind === 'constraint').map(e => [e.relation.id, e.relation])).values()].map(edge => ({ edge, ...constraintCenter(edge, displayNodes.value) })));
let observer: ResizeObserver;
let frame = 0, initialized = false;
const fitted = ref(false);
type Point = { x: number; y: number };
const touches = new Map<number, Point>();
let drag: { id: number; x: number; y: number; px: number; py: number; started: number } | undefined;
let pinch: { distance: number; scale: number; anchor: Point } | undefined;
let lastTap: { point: Point; at: number } | undefined;
let suppressClick = false, ignoreDoubleClickUntil = 0;
let panFrame = 0, cameraFrame = 0;
let heldPan: { key: string; elapsed: number; releasedAt?: number } | undefined;
function cancelPan() {
  cancelAnimationFrame(panFrame); panFrame = 0; heldPan = undefined;
  cancelAnimationFrame(cameraFrame); cameraFrame = 0;
}
function releasePan(event: KeyboardEvent) {
  if (heldPan && (event.key === 'Shift' || event.key.toUpperCase() === heldPan.key) && heldPan.releasedAt === undefined) heldPan.releasedAt = heldPan.elapsed;
}
function visibilityChanged() { if (document.hidden) cancelPan(); }
function resetGesture() {
  cancelPan();
  const ids = [...touches.keys(), ...(drag ? [drag.id] : [])];
  suppressClick = ids.length > 0; touches.clear(); drag = undefined; pinch = undefined; lastTap = undefined;
  for (const id of ids) if (viewport.value?.hasPointerCapture(id)) viewport.value.releasePointerCapture(id);
}
function fit(animated = false) {
  if (!viewport.value || !graph.value.nodes.length) return;
  resetGesture();
  const { x, y, width, height } = bounds.value;
  const targetScale = fitScale.value;
  moveCamera(targetScale, { x: (size.value.width - width * targetScale) / 2 - x * targetScale, y: (size.value.height - height * targetScale) / 2 - y * targetScale }, animated);
  fitted.value = true; initialized = true;
}
function focusChanges() {
  focusNodes(new Set(changes.value.keys()));
}
function focusNode(id: string) {
  const ids = new Set([id]);
  for (const wire of graph.value.edges) {
    if (wire.relation.kind !== 'parent') continue;
    if (wire.relation.from === id) ids.add(wire.relation.to);
    if (wire.relation.to === id) ids.add(wire.relation.from);
  }
  focusNodes(ids);
}
function focusNodes(ids: Set<string>) {
  if (!viewport.value) return;
  const targets = graph.value.nodes.filter(item => ids.has(item.node.id));
  if (!targets.length) return;
  resetGesture(); fitted.value = false;
  const x = Math.min(...targets.map(n => n.x)), y = Math.min(...targets.map(n => n.y));
  const width = Math.max(...targets.map(n => n.x + nodeWidth)) - x;
  const height = Math.max(...targets.map(n => n.y + nodeHeight)) - y;
  const targetScale = Math.max(minimumScale.value, Math.min(1, (size.value.width - 96) / width, (size.value.height - 96) / height));
  const targetPan = { x: (size.value.width - width * targetScale) / 2 - x * targetScale, y: (size.value.height - height * targetScale) / 2 - y * targetScale };
  moveCamera(targetScale, targetPan);
}
function moveCamera(targetScale: number, targetPan: Point, animated = true) {
  const from = { ...pan.value, scale: scale.value };
  const began = performance.now();
  function tick(now: number) {
    const progress = !animated || matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : Math.max(0, Math.min(1, (now - began) / transitionDuration));
    const eased = progress * progress * (3 - 2 * progress);
    scale.value = from.scale + (targetScale - from.scale) * eased;
    pan.value = { x: from.x + (targetPan.x - from.x) * eased, y: from.y + (targetPan.y - from.y) * eased };
    cameraFrame = progress < 1 ? requestAnimationFrame(tick) : 0;
  }
  tick(began);
}
function localPoint(point: Point): Point {
  const bounds = viewport.value!.getBoundingClientRect();
  return { x: point.x - bounds.left, y: point.y - bounds.top };
}
function graphPoint(point: Point): Point {
  return { x: (point.x - pan.value.x) / scale.value, y: (point.y - pan.value.y) / scale.value };
}
function zoomAt(value: number, point: Point, anchor = graphPoint(point)) {
  cancelPan();
  const next = Math.min(2, Math.max(minimumScale.value, value));
  const position = { x: point.x - anchor.x * next, y: point.y - anchor.y * next };
  if (next === scale.value && position.x === pan.value.x && position.y === pan.value.y) return;
  fitted.value = false; scale.value = next; pan.value = position;
}
function changeZoom(delta: number) {
  const next = Math.min(2, Math.max(minimumScale.value, scale.value + delta));
  if (next === scale.value) return;
  zoomAt(next, { x: size.value.width / 2, y: size.value.height / 2 });
}
function wheel(event: WheelEvent) {
  if (!event.ctrlKey || (event.target as Element).closest('.viewport-tools')) return;
  event.preventDefault();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.value.height : 1;
  zoomAt(scale.value * Math.exp(-event.deltaY * unit * .01), localPoint({ x: event.clientX, y: event.clientY }));
}
function doubleClick(event: MouseEvent) {
  if (event.defaultPrevented || (event.target as Element).closest('button, a, [role="button"], .viewport-tools')) return;
  event.preventDefault();
  if (performance.now() >= ignoreDoubleClickUntil) zoomAt(scale.value * 2, localPoint({ x: event.clientX, y: event.clientY }));
}
function touchGeometry() {
  const [first, second] = [...touches.values()] as [Point, Point];
  return { point: localPoint({ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }), distance: Math.hypot(second.x - first.x, second.y - first.y) };
}
function beginPinch() {
  const geometry = touchGeometry();
  pinch = { distance: Math.max(1, geometry.distance), scale: scale.value, anchor: graphPoint(geometry.point) };
  drag = undefined; lastTap = undefined; suppressClick = true;
  for (const id of touches.keys()) viewport.value!.setPointerCapture(id);
}
watch(graph, target => {
  cancelPan();
  cancelAnimationFrame(frame);
  if (props.view === 'islands') {
    if (regrouping()) layoutPositions.islands.clear();
    for (const node of props.current.nodes) groupedLabels.set(node.id, node.groupLabel);
  }
  if (props.view !== 'hierarchy') for (const n of target.nodes) layoutPositions[props.view].set(n.node.id, { x: n.x, y: n.y });
  if (!initialized) fit();
  const start = new Map(positions.value);
  if (!target.nodes.some(n => start.has(n.node.id)) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    positions.value = new Map(target.nodes.map(n => [n.node.id, { x: n.x, y: n.y }]));
    return;
  }
  const began = performance.now();
  function tick(now: number) {
    const progress = Math.max(0, Math.min(1, (now - began) / transitionDuration)), eased = progress * progress * (3 - 2 * progress);
    positions.value = new Map(target.nodes.map(n => {
      const from = start.get(n.node.id) || n;
      return [n.node.id, { x: from.x + (n.x - from.x) * eased, y: from.y + (n.y - from.y) * eased }];
    }));
    if (progress < 1) frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
}, { immediate: true });
function down(event: PointerEvent) {
  if (event.button !== 0) return;
  cancelPan();
  if (!touches.size) suppressClick = false;
  if (event.pointerType !== 'touch') lastTap = undefined;
  if (event.pointerType === 'touch') {
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size >= 2) { beginPinch(); event.preventDefault(); return; }
  }
  if ((event.target as Element).closest('button, a, [role="button"]')) return;
  fitted.value = false;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, px: pan.value.x, py: pan.value.y, started: performance.now() };
  viewport.value!.setPointerCapture(event.pointerId);
  event.preventDefault();
}
function move(event: PointerEvent) {
  if (touches.has(event.pointerId)) {
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && touches.size >= 2) {
      const geometry = touchGeometry();
      event.preventDefault(); zoomAt(pinch.scale * geometry.distance / pinch.distance, geometry.point, pinch.anchor);
      return;
    }
  }
  if (drag?.id !== event.pointerId) return;
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) { suppressClick = true; lastTap = undefined; }
  pan.value = { x: drag.px + event.clientX - drag.x, y: drag.py + event.clientY - drag.y };
}
function end(event: PointerEvent, cancelled = false) {
  if (!touches.has(event.pointerId) && drag?.id !== event.pointerId) return;
  const touch = touches.delete(event.pointerId);
  if (cancelled) { suppressClick = true; lastTap = undefined; }
  if (touch && !cancelled && drag?.id === event.pointerId && !suppressClick && performance.now() - drag.started < 350) {
    const point = { x: event.clientX, y: event.clientY }, now = performance.now();
    if (lastTap && now - lastTap.at < 350 && Math.hypot(point.x - lastTap.point.x, point.y - lastTap.point.y) < 30) {
      zoomAt(scale.value * 2, localPoint(point)); lastTap = undefined;
      suppressClick = true; ignoreDoubleClickUntil = now + 500;
    } else lastTap = { point, at: now };
  }
  if (drag?.id === event.pointerId) drag = undefined;
  if (!cancelled && touches.size >= 2) beginPinch(); else pinch = undefined;
}
function lostCapture(event: PointerEvent) {
  if (event.target === viewport.value) end(event, true);
}
function click(event: MouseEvent) {
  if (suppressClick && event.detail !== 0 && !(event.target as Element).closest('.viewport-tools')) { event.preventDefault(); event.stopPropagation(); }
}
function keyboard(event: KeyboardEvent) {
  if (event.defaultPrevented || event.target !== viewport.value) return;
  const delta = { ArrowLeft: [40, 0], ArrowRight: [-40, 0] }[event.key];
  if (delta) { event.preventDefault(); cancelPan(); fitted.value = false; pan.value = { x: pan.value.x + delta[0], y: pan.value.y + delta[1] }; }
  if (event.key === '0') fit();
  if (event.key === '+') changeZoom(.1);
  if (event.key === '-') changeZoom(-.1);
}
function actualSize() {
  resetGesture();
  fitted.value = false; scale.value = 1;
  const selected = graph.value.nodes.find(n => n.node.id === props.selected);
  const x = selected ? selected.x + nodeWidth / 2 : bounds.value.x + bounds.value.width / 2;
  const y = selected ? selected.y + nodeHeight / 2 : bounds.value.y + bounds.value.height / 2;
  pan.value = { x: size.value.width / 2 - x, y: size.value.height / 2 - y };
}
function panBy(x: number, y: number, key: string) {
  if (heldPan?.key === key && heldPan.releasedAt === undefined) return;
  resetGesture(); fitted.value = false;
  const from = { ...pan.value }, held = { key, elapsed: 0 } as NonNullable<typeof heldPan>;
  heldPan = held;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) pan.value = { x: from.x + x, y: from.y + y };
  let start: number | undefined;
  function tick(now: number) {
    start ??= now;
    held.elapsed = (now - start) * motionSpeed;
    let distance: number, done = false;
    if (reduced) {
      distance = 1 + held.elapsed / 100;
      done = held.releasedAt !== undefined;
    } else {
      const ramp = 100;
      const released = held.releasedAt === undefined ? undefined : Math.max(ramp, held.releasedAt);
      const moving = Math.min(held.elapsed, released ?? held.elapsed);
      distance = moving < ramp ? (moving - ramp / Math.PI * Math.sin(Math.PI * moving / ramp)) / 200 : (moving - ramp / 2) / 100;
      if (released !== undefined && held.elapsed >= released) {
        const progress = Math.min(1, (held.elapsed - released) / 150);
        distance += .5 * (1 - (1 - progress) ** 3);
        done = progress === 1;
      }
    }
    if (!reduced || !done) pan.value = { x: from.x + x * distance, y: from.y + y * distance };
    panFrame = done ? 0 : requestAnimationFrame(tick);
    if (done) heldPan = undefined;
  }
  panFrame = requestAnimationFrame(tick);
}
defineExpose({ panBy, zoom: changeZoom, focusChanges, focusNode });
function moveMap(point: { x: number; y: number }) { cancelPan(); fitted.value = false; pan.value = point; }
function edgeChange(id: string) { return props.changed ? edgeChanges.value.get(id) : ''; }
function focused(ids: string[]) { return !!props.selected && ids.includes(props.selected); }
watch(() => [bounds.value.x, bounds.value.y, bounds.value.width, bounds.value.height, size.value.width, size.value.height], (next, old) => {
  if (next.some((value, index) => value !== old?.[index])) fitted.value = false;
}, { flush: 'sync' });
watch(() => props.view, () => fit(true));
onMounted(() => {
  document.addEventListener('keyup', releasePan, true);
  document.addEventListener('visibilitychange', visibilityChanged);
  window.addEventListener('blur', cancelPan);
  observer = new ResizeObserver(([entry]) => {
    if (!entry) return;
    size.value = { width: entry.contentRect.width, height: entry.contentRect.height };
    if (!initialized) fit();
  });
  observer.observe(viewport.value!);
});
onUnmounted(() => {
  document.removeEventListener('keyup', releasePan, true);
  document.removeEventListener('visibilitychange', visibilityChanged);
  window.removeEventListener('blur', cancelPan);
  observer?.disconnect(); cancelAnimationFrame(frame); resetGesture();
});
</script>
<template>
  <section class="atlas">
    <div class="graph-chrome-shell"><div class="graph-chrome">
    <div class="graph-toolbar" :inert="fullscreen"><slot name="toolbar"/></div>
    <div v-if="!compact" class="relationship-legend" :inert="fullscreen" aria-label="Relationship legend"><span><i class="parent"/>Parent</span><label><input v-model="showInputs" type="checkbox" aria-label="Show inputs"><i class="input"/>Input →</label><label><input v-model="showConstraints" type="checkbox" aria-label="Show constraints"><i class="constraint"/>Constraint</label><label class="track-toggle" title="Follow changed nodes when a new revision arrives at Latest"><input v-model="track" type="checkbox" aria-label="Track new revisions">Track</label></div>
    </div></div>
    <div ref="viewport" class="graph-viewport" tabindex="0" role="region" aria-label="Decision graph. Drag to pan, pinch or double-tap the background to zoom, plus and minus to zoom, zero to fit." @pointerdown="down" @pointermove="move" @pointerup="end($event)" @pointercancel="end($event, true)" @lostpointercapture="lostCapture" @click.capture="click" @dblclick="doubleClick" @wheel="wheel" @keydown="keyboard">
      <div class="graph-scene" :style="{ width: `${graph.width}px`, height: `${graph.height}px`, transform }">
        <svg class="wires" :width="graph.width" :height="graph.height" aria-hidden="true"><g v-for="region in decorations.islands" :key="region.id" :data-island-id="region.id"><title>{{ region.title }}</title><rect class="island-region" :x="region.x" :y="region.y" :width="region.width" :height="region.height" rx="8"/><rect class="island-header" :x="region.x + 1" :y="region.y + 1" :width="region.width - 2" :height="groupHeaderHeight" rx="7"/><svg :x="region.x + 16" :y="region.y" :width="region.width - 32" :height="groupHeaderHeight"><text class="island-title" x="50%" y="26" text-anchor="middle">{{ region.title }}</text></svg></g><ellipse v-for="ring in decorations.rings" :key="ring.level" class="ring-guide" :data-ring="ring.level" :cx="ring.x" :cy="ring.y" :rx="ring.rx" :ry="ring.ry"/><defs><marker id="atlas-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 10 5 0 10" fill="context-stroke"/></marker></defs><path v-for="edge in displayEdges" :key="edge.id" :data-from="edge.from" :data-to="edge.to" :data-relationship-id="edge.relation.id" :d="edge.path" :class="[edge.relation.kind, edgeChange(edge.relation.id), { focused: focused(participants(edge.relation)), dimmed: selected && !focused(participants(edge.relation)) }]" :marker-end="edge.relation.kind === 'input' || edge.relation.kind === 'legacy' ? 'url(#atlas-arrow)' : undefined"/>
          <g v-for="item in constraints" :key="item.edge.id" :transform="`translate(${item.x} ${item.y})`" class="constraint-junction" :class="[edgeChange(item.edge.id), { focused: focused(participants(item.edge)) }]" :data-constraint-id="item.edge.id"><circle r="4"/><text v-if="focused(participants(item.edge)) && item.edge.kind === 'constraint'" y="-12" text-anchor="middle">{{ item.edge.label }}</text></g>
        </svg>
        <div v-for="item in displayNodes" :key="item.node.id" class="node-frame" :style="{ transform: `translate(${item.x}px, ${item.y}px)`, width: `${nodeWidth}px`, height: `${nodeHeight}px` }">
        <button class="graph-node" :data-node-id="item.node.id" :class="[changed && changes.has(item.node.id) ? nodeChangeClass(previousNodes.get(item.node.id), item.node, changes.get(item.node.id)!) : '', isAssumption(item.node) ? 'assumption' : item.node.kind, { selected: selected === item.node.id, targeted: focusedNode === item.node.id }]" :aria-pressed="selected === item.node.id" @click="emit('select', item.node.id)">
          <strong :title="item.node.title">{{ item.node.title }}</strong><span class="node-value">{{ nodeContent(item.node) }}</span>
          <span class="node-status">{{ changed && changes.has(item.node.id) ? (isAssumption(item.node) ? 'Assumption · ' : '') + nodeChangeLabel(previousNodes.get(item.node.id), item.node, changes.get(item.node.id)!) : nodeStatus(item.node) }}</span>
        </button>
        <span v-if="references.has(item.node.id)" class="node-reference"><span class="node-number">#{{ references.get(item.node.id)!.number }}</span><button class="copy-node-reference" :aria-label="`Copy reference to node ${references.get(item.node.id)!.number}`" :title="references.get(item.node.id)!.reference" @click.stop="emit('copyReference', references.get(item.node.id)!.reference)"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M10 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg></button></span>
        </div>
      </div>
      <GraphViewportTools v-if="graph.nodes.length" :bounds="bounds" :nodes="overviewNodes" :edges="displayEdges.map(e => e.path)" :scale="scale" :minimum-scale="minimumScale" :pan="pan" :viewport="size" :fitted="fitted" :export-url="exportUrl" :filename="`${workspaceId}-r${revision}-${view}`" @zoom="changeZoom" @fit="fit" @actual="actualSize" @pan="moveMap"/>
    </div>
    <div v-if="!graph.nodes.length" class="canvas-empty"><i class="pi pi-sitemap"/><template v-if="historical"><h2>Earlier graph format</h2><p>Press G or select the last revision to view the current graph.</p></template><template v-else><h2>A graph starts here.</h2><p>Continue the conversation with your agent.<br>Published graph commits appear automatically.</p></template></div>
  </section>
</template>
