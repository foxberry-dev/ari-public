<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import GraphViewportTools from './GraphViewportTools.vue';
import SearchHighlight from './SearchHighlight.vue';
import NodeOptions from './NodeOptions.vue';
import SelectionShortcuts from './SelectionShortcuts.vue';
import { isAssumption, nodeContent, nodeStatus, unselectedAlternatives, type Graph, type NodeReference } from '../model';
import { comparisonLayout, constraintCenter, graphBounds, graphDecorations, graphChanges, nodeChangeClass, nodeChangeLabel, nodeWidth, nodeCardHeight, groupHeaderHeight, positionWires } from '../graph';
import { participants, relationshipChanges, type GraphView, type Relationship } from '../relationships';

const props = defineProps<{ current: Graph; previous: Graph; changed: boolean; selected: string; revision: number; view: GraphView; workspaceId: string; title: string; compact?: boolean; fullscreen?: boolean; nodeIndex?: NodeReference[]; focusedNode?: string; searchQuery?: string }>();
const emit = defineEmits<{ select: [id: string]; copyReference: [reference: string, onCopied?: () => void, kind?: 'prompt', label?: string] }>();
const references = computed(() => new Map(props.nodeIndex?.map(entry => [entry.id, entry]) || []));
const viewport = ref<HTMLElement>();
const allSelected = defineModel<boolean>('allSelected', { default: false });
const track = defineModel<boolean>('track', { default: true });
const showInputs = defineModel<boolean>('showInputs', { default: true });
const showConstraints = defineModel<boolean>('showConstraints', { default: true });
const motionSpeed = 1.3;
const transitionDuration = 650 / motionSpeed;
const size = ref({ width: 800, height: 600 });
const layoutPositions: Record<GraphView, Map<string, { x: number; y: number }>> = { hierarchy: new Map(), islands: new Map(), rings: new Map() };
const groupedLabels = new Map<string, string | undefined>();
const groupedHeights = new Map<string, number>();
function regrouping() {
  return props.current.nodes.some(node => groupedLabels.has(node.id) && (groupedLabels.get(node.id) !== node.groupLabel || groupedHeights.get(node.id) !== nodeCardHeight(node)));
}
const historical = computed(() => props.current.edges === undefined);
const graph = computed(() => historical.value ? { nodes: [], edges: [], width: 0, height: 0 } : comparisonLayout(props.current, props.previous, props.changed, props.view, props.view === 'islands' && regrouping() ? new Map() : layoutPositions[props.view], props.selected));
const emphasizedNodes = computed(() => selectedIds.value.size ? [...selectedIds.value] : props.searchQuery && props.focusedNode ? [props.focusedNode] : []);
const emphasizedFamily = computed(() => {
  const family = new Set<string>();
  if (!emphasizedNodes.value.length) return family;
  const parents = graph.value.edges.map(wire => wire.relation).filter(edge => edge.kind === 'parent' || edge.kind === 'legacy');
  for (const [source, target] of [['to', 'from'], ['from', 'to']] as const) {
    const visited = new Set(emphasizedNodes.value), pending = [...emphasizedNodes.value];
    while (pending.length) {
      const id = pending.pop()!;
      family.add(id);
      for (const edge of parents) if (edge[source] === id && !visited.has(edge[target])) {
        visited.add(edge[target]); pending.push(edge[target]);
      }
    }
  }
  return family;
});
const changes = computed(() => graphChanges(props.previous, props.current));
const previousNodes = computed(() => new Map(props.previous.nodes.map(n => [n.id, n])));
const edgeChanges = computed(() => relationshipChanges(props.previous, props.current));
const scale = ref(1), pan = ref({ x: 0, y: 0 });
const gridPosition = ref({ x: 5, y: 5 });
const multiSelection = ref<string[]>([]);
const multiSelectMode = ref(false);
const shiftSelecting = ref(false);
const selectionBox = ref<{ id: number; start: Point; end: Point; nodeId?: string }>();
const selectionRect = computed(() => {
  const box = selectionBox.value;
  if (!box) return;
  return { left: Math.min(box.start.x, box.end.x), top: Math.min(box.start.y, box.end.y), width: Math.abs(box.end.x - box.start.x), height: Math.abs(box.end.y - box.start.y) };
});
const boxNodes = computed(() => {
  const rect = selectionRect.value;
  if (!rect || Math.hypot(rect.width, rect.height) <= 5) return [];
  const start = graphPoint({ x: rect.left, y: rect.top });
  const end = graphPoint({ x: rect.left + rect.width, y: rect.top + rect.height });
  return displayNodes.value.filter(n => n.x <= end.x && n.x + nodeWidth >= start.x && n.y <= end.y && n.y + nodeCardHeight(n.node) >= start.y).map(n => n.node.id);
});
const selectedIds = computed(() => {
  const ids = new Set([...multiSelection.value, ...(props.selected ? [props.selected] : [])]);
  for (const id of boxNodes.value) {
    if (!ids.delete(id)) ids.add(id);
  }
  return ids;
});
const selectionShortcuts = ref<InstanceType<typeof SelectionShortcuts>>();
const shortcutContext = computed(() => ({ workspaceId: props.workspaceId, revision: props.revision,
  selected: [...selectedIds.value].map(id => displayNodes.value.find(item => item.node.id === id)?.node).filter((node): node is NonNullable<typeof node> => !!node),
  existingIds: new Set(props.current.nodes.map(node => node.id)) }));
function toggleSelectionShortcuts() {
  if (!selectedIds.value.size) return false;
  closeOptions(); void selectionShortcuts.value?.toggle(); return true;
}
function handleSelectionShortcutKey(event: KeyboardEvent) { return selectionShortcuts.value?.handleKey(event) || false; }
function copyShortcutRequest(prompt: string, onCopied: () => void, label: string) {
  emit('copyReference', prompt, () => { onCopied(); clearSelection(); viewport.value?.focus({ preventScroll: true }); }, 'prompt', label);
}
const checkedIds = selectedIds;
const selectedReference = computed(() => `ari@${props.workspaceId}@${[...selectedIds.value].join(',')}`);
function clearSelection() {
  closeOptions();
  if (!selectedIds.value.size && !selectionBox.value && !multiSelectMode.value) return false;
  resetGesture();
  multiSelectMode.value = false;
  multiSelection.value = [];
  emit('select', '');
  return true;
}
function copySelection() {
  if (!selectedIds.value.size) return false;
  emit('copyReference', selectedReference.value, clearSelection);
  return true;
}
function selectNode(event: MouseEvent, id: string) {
  closeOptions();
  if (multiSelectMode.value || event.shiftKey) toggleNode(id);
  else if (selectedIds.value.size === 1 && selectedIds.value.has(id)) clearSelection();
  else {
    multiSelection.value = [];
    emit('select', id);
  }
}
function toggleNode(id: string) {
  const ids = new Set(selectedIds.value);
  if (ids.has(id)) ids.delete(id); else ids.add(id);
  multiSelection.value = [...ids];
  emit('select', '');
}
const optionsId = ref('');
const optionsAnchor = ref<HTMLElement>();
const optionsSize = ref({ width: 340, height: 0, overlap: 0 });
const optionsPanel = ref<InstanceType<typeof NodeOptions>>();
const optionsNode = computed(() => displayNodes.value.find(item => item.node.id === optionsId.value));
const optionsMaxHeight = computed(() => Math.max(100, Math.min(360, size.value.height * .45)));
function closeOptions() {
  if (!optionsId.value) return false;
  if (optionsPanel.value) optionsPanel.value.close(); else finishCloseOptions();
  return true;
}
function finishCloseOptions() { optionsId.value = ''; }
async function inspectNode(id: string, toggle = false) {
  const item = displayNodes.value.find(item => item.node.id === id);
  if (!item || !unselectedAlternatives(item.node).length) return;
  if (toggle && optionsId.value === id) { closeOptions(); return; }
  resetGesture();
  optionsAnchor.value = viewport.value?.querySelector<HTMLElement>(`.graph-node[data-node-id="${id}"]`) || undefined;
  optionsId.value = id;
  await nextTick();
  if (!props.compact) revealOptions(optionsSize.value);
}
function revealOptions(measured: { width: number; height: number; overlap: number }) {
  optionsSize.value = measured;
  const item = optionsNode.value;
  if (!item || props.compact || !measured.height) return;
  cancelPan(); fitted.value = false;
  const nodeHeight = nodeCardHeight(item.node), padding = 48, bottomPadding = 88;
  const nextScale = Math.max(minimumScale.value, Math.min(scale.value,
    (size.value.width - padding * 2) / nodeWidth,
    (size.value.height - padding - bottomPadding + measured.overlap - measured.height) / nodeHeight));
  const width = Math.max(nodeWidth * nextScale, measured.width);
  const height = nodeHeight * nextScale - measured.overlap + measured.height;
  const center = Math.max(padding + width / 2, Math.min(size.value.width - padding - width / 2, pan.value.x + (item.x + nodeWidth / 2) * nextScale));
  const top = Math.max(padding, Math.min(size.value.height - bottomPadding - height, pan.value.y + item.y * nextScale));
  moveCamera(nextScale, { x: center - (item.x + nodeWidth / 2) * nextScale, y: top - item.y * nextScale });
}
watch(() => props.revision, finishCloseOptions);
function toggleMultiSelect() {
  if (multiSelectMode.value) { clearSelection(); return; }
  resetGesture();
  multiSelection.value = [...selectedIds.value];
  multiSelectMode.value = true;
  emit('select', '');
}
watch(() => props.revision, () => { resetGesture(); multiSelection.value = []; multiSelectMode.value = false; });
watch(() => props.compact, compact => { if (!compact) multiSelectMode.value = false; });
watch(() => graph.value.nodes, nodes => {
  const visible = new Set(nodes.map(n => n.node.id));
  multiSelection.value = multiSelection.value.filter(id => visible.has(id));
});
const transform = computed(() => `translate(${pan.value.x}px, ${pan.value.y}px) scale(${scale.value})`);
const positions = ref(new Map<string, { x: number; y: number }>());
const displayNodes = computed(() => graph.value.nodes.map(n => ({ ...n, ...(positions.value.get(n.node.id) || {}) })));
watch([selectedIds, displayNodes], () => {
  allSelected.value = displayNodes.value.length > 0 && displayNodes.value.every(item => selectedIds.value.has(item.node.id));
}, { immediate: true });
function selectAll() {
  if (!displayNodes.value.length) return;
  closeOptions(); resetGesture();
  multiSelection.value = displayNodes.value.map(item => item.node.id);
  emit('select', '');
}
function toggleSelectAll() {
  if (allSelected.value) clearSelection();
  else selectAll();
}
function focusTopic() {
  const topic = props.current.nodes.find(node => node.kind === 'topic');
  const target = displayNodes.value.find(item => item.node.id === topic?.id);
  if (!viewport.value || !target) return;
  closeOptions(); resetGesture(); fitted.value = false;
  const nextScale = Math.max(minimumScale.value, Math.min(scale.value, (size.value.width - 96) / nodeWidth, (size.value.height - 96) / nodeCardHeight(target.node)));
  moveCamera(nextScale, {
    x: size.value.width / 2 - (target.x + nodeWidth / 2) * nextScale,
    y: size.value.height / 2 - (target.y + nodeCardHeight(target.node) / 2) * nextScale,
  });
}

watch(optionsNode, item => { if (!item || !unselectedAlternatives(item.node).length) finishCloseOptions(); });
const decorations = computed(() => graphDecorations(props.current, props.view, displayNodes.value));
const displayEdges = computed(() => positionWires(displayNodes.value, graph.value.edges.filter(e =>
  (e.relation.kind !== 'input' || showInputs.value) && (e.relation.kind !== 'constraint' || showConstraints.value)), props.view));
const bounds = computed(() => graphBounds(props.current, props.view, graph.value.nodes));
const fitScale = computed(() => Math.max(.001, Math.min((size.value.width - 60) / bounds.value.width, (size.value.height - 60) / bounds.value.height, 1)));
const minimumScale = computed(() => Math.min(.05, fitScale.value));
const overviewNodes = computed(() => displayNodes.value.map(n => ({ id: n.node.id, x: n.x, y: n.y, width: nodeWidth, height: nodeCardHeight(n.node), active: selectedIds.value.has(n.node.id) })));
const exportUrl = computed(() => `/api/workspaces/${encodeURIComponent(props.workspaceId)}/export?${new URLSearchParams({ revision: String(props.revision), layout: props.view, display: props.changed ? 'changed' : 'current', inputs: String(showInputs.value), constraints: String(showConstraints.value), ...(props.selected ? { selected: props.selected } : {}) })}`);
const constraints = computed(() => [...new Map(displayEdges.value.filter(e => e.relation.kind === 'constraint').map(e => [e.relation.id, e.relation])).values()].map(edge => ({ edge, ...constraintCenter(edge, displayNodes.value) })));
let observer: ResizeObserver;
let viewportOrigin: { x: number; y: number } | undefined;
let preservingViewportOrigin = false;
function syncViewportOrigin() {
  if (!viewport.value) return;
  const rect = viewport.value.getBoundingClientRect();
  if (preservingViewportOrigin && viewportOrigin && initialized) {
    const x = viewportOrigin.x - rect.left, y = viewportOrigin.y - rect.top;
    pan.value = { x: pan.value.x + x, y: pan.value.y + y };
    gridPosition.value = { x: gridPosition.value.x + x, y: gridPosition.value.y + y };
    if (drag) { drag.px += x; drag.py += y; }
  }
  viewportOrigin = { x: rect.left, y: rect.top };
}
watch(() => props.fullscreen, () => {
  resetGesture(); preservingViewportOrigin = true;
  void nextTick(syncViewportOrigin);
}, { flush: 'sync' });
let frame = 0, initialized = false;
const fitted = ref(false);
type Point = { x: number; y: number };
const touches = new Map<number, Point>();
let drag: { id: number; x: number; y: number; px: number; py: number; started: number; nodeId?: string } | undefined;
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
function selectionModifier(event: KeyboardEvent) { shiftSelecting.value = event.shiftKey; }
function loseFocus() { shiftSelecting.value = false; resetGesture(); }
function visibilityChanged() { if (document.hidden) loseFocus(); }
function resetGesture() {
  cancelPan();
  const ids = [...touches.keys(), ...(drag ? [drag.id] : []), ...(selectionBox.value ? [selectionBox.value.id] : [])];
  selectionBox.value = undefined;
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
function focusSearchNode(id: string) {
  const target = graph.value.nodes.find(item => item.node.id === id);
  if (!viewport.value || !target) return;
  resetGesture(); fitted.value = false;
  const viewportBounds = viewport.value.getBoundingClientRect();
  const searchBounds = document.querySelector('.graph-search')?.getBoundingClientRect();
  const top = Math.min(size.value.height - 48, Math.max(24, (searchBounds?.bottom ?? viewportBounds.top) - viewportBounds.top + 24));
  moveCamera(1, {
    x: size.value.width / 2 - target.x - nodeWidth / 2,
    y: top + (size.value.height - top - 64) / 2 - target.y - nodeCardHeight(target.node) / 2,
  });
}
function focusNodes(ids: Set<string>) {
  if (!viewport.value) return;
  const targets = graph.value.nodes.filter(item => ids.has(item.node.id));
  if (!targets.length) return;
  resetGesture(); fitted.value = false;
  const x = Math.min(...targets.map(n => n.x)), y = Math.min(...targets.map(n => n.y));
  const width = Math.max(...targets.map(n => n.x + nodeWidth)) - x;
  const height = Math.max(...targets.map(n => n.y + nodeCardHeight(n.node))) - y;
  const targetScale = Math.max(minimumScale.value, Math.min(1, (size.value.width - 96) / width, (size.value.height - 96) / height));
  const targetPan = { x: (size.value.width - width * targetScale) / 2 - x * targetScale, y: (size.value.height - height * targetScale) / 2 - y * targetScale };
  moveCamera(targetScale, targetPan);
}
function moveCamera(targetScale: number, targetPan: Point, animated = true) {
  const from = { ...pan.value, scale: scale.value };
  const to = constrainedPan(targetPan, targetScale);
  const began = performance.now();
  function tick(now: number) {
    const progress = !animated || matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : Math.max(0, Math.min(1, (now - began) / transitionDuration));
    const eased = progress * progress * (3 - 2 * progress);
    scale.value = from.scale + (targetScale - from.scale) * eased;
    pan.value = { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
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
function constrainedPan(point: Point, nextScale = scale.value): Point {
  function axis(value: number, start: number, length: number, extent: number) {
    const contentLength = length * nextScale;
    const center = extent / 2 - (start + length / 2) * nextScale;
    const travel = Math.max(extent, contentLength) / 2;
    return Math.max(center - travel, Math.min(center + travel, value));
  }
  const item = !props.compact && optionsSize.value.height ? optionsNode.value : undefined;
  const extraLeft = item ? item.x + nodeWidth / 2 - optionsSize.value.width / (2 * nextScale) : bounds.value.x;
  const extraRight = item ? extraLeft + optionsSize.value.width / nextScale : bounds.value.x + bounds.value.width;
  const extraBottom = item ? item.y + nodeCardHeight(item.node) + (optionsSize.value.height - optionsSize.value.overlap) / nextScale : bounds.value.y + bounds.value.height;
  const left = Math.min(bounds.value.x, extraLeft), right = Math.max(bounds.value.x + bounds.value.width, extraRight);
  const bottom = Math.max(bounds.value.y + bounds.value.height, extraBottom);
  return {
    x: axis(point.x, left, right - left, size.value.width),
    y: axis(point.y, bounds.value.y, bottom - bounds.value.y, size.value.height),
  };
}
function zoomAt(value: number, point: Point, anchor = graphPoint(point)) {
  cancelPan();
  const next = Math.min(2, Math.max(minimumScale.value, value));
  const anchored = { x: point.x - anchor.x * next, y: point.y - anchor.y * next };
  const position = next === scale.value ? constrainedPan(anchored) : anchored;
  if (next === scale.value && position.x === pan.value.x && position.y === pan.value.y) return;
  fitted.value = false; scale.value = next; pan.value = position;
}
function changeZoom(delta: number) {
  const next = Math.min(2, Math.max(minimumScale.value, scale.value + delta));
  if (next === scale.value) return;
  zoomAt(next, { x: size.value.width / 2, y: size.value.height / 2 });
}
function wheel(event: WheelEvent) {
  if ((event.target as Element).closest('.viewport-tools')) return;
  event.preventDefault();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.value.height : 1;
  if (event.ctrlKey) {
    zoomAt(scale.value * Math.exp(-event.deltaY * unit * .01), localPoint({ x: event.clientX, y: event.clientY }));
  } else {
    cancelPan(); fitted.value = false;
    const horizontalUnit = event.deltaMode === 2 ? size.value.width : unit;
    pan.value = constrainedPan({ x: pan.value.x - event.deltaX * horizontalUnit, y: pan.value.y - event.deltaY * unit });
  }
}
function doubleClick(event: MouseEvent) {
  if (event.shiftKey || event.ctrlKey || event.metaKey) return;
  const node = (event.target as Element).closest<HTMLElement>('.graph-node');
  if (node) { event.preventDefault(); return; }
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
    for (const node of props.current.nodes) {
      groupedLabels.set(node.id, node.groupLabel);
      groupedHeights.set(node.id, nodeCardHeight(node));
    }
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
  if (event.pointerType !== 'touch') { lastTap = undefined; shiftSelecting.value = event.shiftKey; }
  if (event.shiftKey && event.pointerType !== 'touch' && !(event.target as Element).closest('button:not(.graph-node), a, .viewport-tools, .selection-actions')) {
    const point = localPoint({ x: event.clientX, y: event.clientY });
    selectionBox.value = { id: event.pointerId, start: point, end: point, nodeId: (event.target as Element).closest<HTMLElement>('.graph-node')?.dataset.nodeId };
    viewport.value!.focus({ preventScroll: true });
    viewport.value!.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  if (event.pointerType === 'touch') {
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size >= 2) { beginPinch(); event.preventDefault(); return; }
  }
  const target = event.target as Element;
  const node = target.closest<HTMLElement>('.graph-node');
  if (target.closest('button, a, [role="button"]') && !(multiSelectMode.value && node)) return;
  if (!node) viewport.value!.focus({ preventScroll: true });
  fitted.value = false;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, px: pan.value.x, py: pan.value.y, started: performance.now(), nodeId: node?.dataset.nodeId };
  viewport.value!.setPointerCapture(event.pointerId);
  event.preventDefault();
}
function move(event: PointerEvent) {
  if (event.pointerType !== 'touch') shiftSelecting.value = event.shiftKey;
  if (selectionBox.value?.id === event.pointerId) {
    selectionBox.value.end = localPoint({ x: event.clientX, y: event.clientY });
    event.preventDefault();
    return;
  }
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
  pan.value = constrainedPan({ x: drag.px + event.clientX - drag.x, y: drag.py + event.clientY - drag.y });
}
function end(event: PointerEvent, cancelled = false) {
  if (selectionBox.value?.id === event.pointerId) {
    const { start, end: point, nodeId } = selectionBox.value;
    if (!cancelled && Math.hypot(point.x - start.x, point.y - start.y) > 5) {
      multiSelection.value = [...selectedIds.value];
      emit('select', '');
    } else if (!cancelled && nodeId) toggleNode(nodeId);
    suppressClick = true;
    selectionBox.value = undefined;
    return;
  }
  if (!touches.has(event.pointerId) && drag?.id !== event.pointerId) return;
  const touch = touches.delete(event.pointerId);
  if (cancelled) { suppressClick = true; lastTap = undefined; }
  if (multiSelectMode.value && drag?.id === event.pointerId) {
    if (!cancelled && !suppressClick) {
      if (drag.nodeId) toggleNode(drag.nodeId); else clearSelection();
    }
    suppressClick = true; lastTap = undefined; drag = undefined; pinch = undefined;
    return;
  }
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
  const target = event.target as Element;
  if (target.closest('.viewport-tools, .selection-actions')) return;
  if (suppressClick && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); return; }
  if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !target.closest('button, a, [role="button"]')) {
    clearSelection();
  }
}
function keyboard(event: KeyboardEvent) {
  if (event.defaultPrevented || event.target !== viewport.value) return;
  const delta = { ArrowLeft: [40, 0], ArrowRight: [-40, 0] }[event.key];
  if (delta) { event.preventDefault(); cancelPan(); fitted.value = false; pan.value = constrainedPan({ x: pan.value.x + delta[0], y: pan.value.y + delta[1] }); }
  if (event.key === '0') fit();
  if (event.key === '+') changeZoom(.1);
  if (event.key === '-') changeZoom(-.1);
}
function toggleFit() { closeOptions(); if (fitted.value) actualSize(); else fit(true); }
function actualSize() {
  resetGesture();
  fitted.value = false; scale.value = 1;
  const selected = graph.value.nodes.find(n => n.node.id === props.selected);
  const x = selected ? selected.x + nodeWidth / 2 : bounds.value.x + bounds.value.width / 2;
  const y = selected ? selected.y + nodeCardHeight(selected.node) / 2 : bounds.value.y + bounds.value.height / 2;
  pan.value = constrainedPan({ x: size.value.width / 2 - x, y: size.value.height / 2 - y });
}
function panBy(x: number, y: number, key: string) {
  if (heldPan?.key === key && heldPan.releasedAt === undefined) return;
  resetGesture(); fitted.value = false;
  const from = { ...pan.value }, held = { key, elapsed: 0 } as NonNullable<typeof heldPan>;
  heldPan = held;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) pan.value = constrainedPan({ x: from.x + x, y: from.y + y });
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
    if (!reduced || !done) pan.value = constrainedPan({ x: from.x + x * distance, y: from.y + y * distance });
    panFrame = done ? 0 : requestAnimationFrame(tick);
    if (done) heldPan = undefined;
  }
  panFrame = requestAnimationFrame(tick);
}
defineExpose({ selectAll, toggleSelectAll, focusTopic, panBy, zoom: changeZoom, focusChanges, focusNode, focusSearchNode, clearSelection, copySelection, inspectNode, closeOptions, toggleFit, toggleSelectionShortcuts, handleSelectionShortcutKey });
function moveMap(point: { x: number; y: number }) { cancelPan(); fitted.value = false; pan.value = constrainedPan(point); }
function edgeChange(id: string) { return props.changed ? edgeChanges.value.get(id) : ''; }
function focused(edge: Relationship) {
  const ids = participants(edge);
  if (edge.kind === 'parent' || edge.kind === 'legacy') return ids.every(id => emphasizedFamily.value.has(id));
  return emphasizedNodes.value.some(id => ids.includes(id));
}
watch(() => [bounds.value.x, bounds.value.y, bounds.value.width, bounds.value.height, size.value.width, size.value.height], (next, old) => {
  if (next.some((value, index) => value !== old?.[index])) fitted.value = false;
}, { flush: 'sync' });
watch(() => props.view, () => fit(true));
onMounted(() => {
  document.addEventListener('keydown', selectionModifier, true);
  document.addEventListener('keyup', selectionModifier, true);
  document.addEventListener('keyup', releasePan, true);
  document.addEventListener('visibilitychange', visibilityChanged);
  window.addEventListener('blur', loseFocus);
  observer = new ResizeObserver(([entry]) => {
    if (!entry) return;
    syncViewportOrigin();
    size.value = { width: entry.contentRect.width, height: entry.contentRect.height };
    if (preservingViewportOrigin) {
      const chrome = viewport.value!.closest('.graph-workspace')?.querySelectorAll('.conversation-rail, .mobile-revisions, .graph-chrome-shell');
      preservingViewportOrigin = !!chrome && [...chrome].some(element => element.getAnimations().some(animation => animation.playState === 'running'));
    }
    if (!initialized) fit();
  });
  observer.observe(viewport.value!);
});
onUnmounted(() => {
  document.removeEventListener('keydown', selectionModifier, true);
  document.removeEventListener('keyup', selectionModifier, true);
  document.removeEventListener('keyup', releasePan, true);
  document.removeEventListener('visibilitychange', visibilityChanged);
  window.removeEventListener('blur', loseFocus);
  observer?.disconnect(); cancelAnimationFrame(frame); resetGesture();
});
</script>
<template>
  <section class="atlas">
    <div class="graph-chrome-shell"><div class="graph-chrome">
    <div class="graph-toolbar" :inert="fullscreen"><slot name="toolbar"/></div>
    <div v-if="!compact" class="relationship-legend" :inert="fullscreen" aria-label="Relationship legend"><span><i class="parent"/>Parent</span><label><input v-model="showInputs" type="checkbox" aria-label="Show inputs"><i class="input"/>Input →</label><label><input v-model="showConstraints" type="checkbox" aria-label="Show constraints"><i class="constraint"/>Constraint</label><label class="track-toggle" title="Follow changed nodes when a new revision arrives at Latest"><input v-model="track" type="checkbox" aria-label="Track new revisions">Track</label></div>
    </div></div>
    <NodeOptions ref="optionsPanel" v-if="optionsNode && optionsAnchor" :key="optionsId" :node="optionsNode.node" :anchor="optionsAnchor" :compact="!!compact" :max-height="optionsMaxHeight" @close="finishCloseOptions" @resize="revealOptions"/>
    <div ref="viewport" class="graph-viewport" :style="{ backgroundPosition: `${gridPosition.x}px ${gridPosition.y}px` }" :class="{ selecting: shiftSelecting || selectionBox }" tabindex="0" role="region" aria-label="Decision graph. Shift+drag to toggle nodes in selection, Shift+click to toggle a node. Drag to pan, pinch or double-tap the background to zoom, plus and minus to zoom, zero to fit." @pointerdown="down" @pointermove="move" @pointerup="end($event)" @pointercancel="end($event, true)" @lostpointercapture="lostCapture" @click.capture="click" @dblclick="doubleClick" @wheel="wheel" @keydown="keyboard">
      <div class="graph-scene" :style="{ width: `${graph.width}px`, height: `${graph.height}px`, transform }">
        <svg class="wires" :width="graph.width" :height="graph.height" aria-hidden="true"><g v-for="region in decorations.islands" :key="region.id" :data-island-id="region.id"><title>{{ region.title }}</title><rect class="island-region" :x="region.x" :y="region.y" :width="region.width" :height="region.height" rx="8"/><rect class="island-header" :x="region.x + 1" :y="region.y + 1" :width="region.width - 2" :height="groupHeaderHeight" rx="7"/><svg :x="region.x + 16" :y="region.y" :width="region.width - 32" :height="groupHeaderHeight"><text class="island-title" x="50%" y="26" text-anchor="middle">{{ region.title }}</text></svg></g><ellipse v-for="ring in decorations.rings" :key="ring.level" class="ring-guide" :data-ring="ring.level" :cx="ring.x" :cy="ring.y" :rx="ring.rx" :ry="ring.ry"/><defs><marker id="atlas-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 10 5 0 10" fill="context-stroke"/></marker></defs><path v-for="edge in displayEdges" :key="edge.id" :data-from="edge.from" :data-to="edge.to" :data-relationship-id="edge.relation.id" :d="edge.path" :class="[edge.relation.kind, edgeChange(edge.relation.id), { focused: focused(edge.relation), dimmed: emphasizedNodes.length > 0 && !focused(edge.relation) }]" :marker-end="edge.relation.kind === 'input' || edge.relation.kind === 'legacy' ? 'url(#atlas-arrow)' : undefined"/>
          <g v-for="item in constraints" :key="item.edge.id" :transform="`translate(${item.x} ${item.y})`" class="constraint-junction" :class="[edgeChange(item.edge.id), { focused: focused(item.edge) }]" :data-constraint-id="item.edge.id"><circle r="4"/><text v-if="focused(item.edge) && item.edge.kind === 'constraint'" y="-12" text-anchor="middle">{{ item.edge.label }}</text></g>
        </svg>
        <div v-for="item in displayNodes" :key="item.node.id" class="node-frame" :class="{ 'inspection-dimmed': emphasizedNodes.length > 0 && !emphasizedFamily.has(item.node.id) }" :style="{ transform: `translate(${item.x}px, ${item.y}px)`, width: `${nodeWidth}px`, height: `${nodeCardHeight(item.node)}px` }">
        <button class="graph-node" :data-node-id="item.node.id" :class="[changed && changes.has(item.node.id) ? nodeChangeClass(previousNodes.get(item.node.id), item.node, changes.get(item.node.id)!) : '', isAssumption(item.node) ? 'assumption' : item.node.kind, { selected: selectedIds.has(item.node.id), checked: checkedIds.has(item.node.id), targeted: focusedNode === item.node.id, 'search-active': !!searchQuery && focusedNode === item.node.id }]" :aria-pressed="selectedIds.has(item.node.id)" @click="selectNode($event, item.node.id)">
          <span v-if="checkedIds.has(item.node.id)" class="node-selection-badge" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m3.5 8 3 3 6-6"/></svg></span>
          <strong :title="item.node.title"><SearchHighlight :text="item.node.title" :query="searchQuery"/></strong><span class="node-value"><SearchHighlight :text="nodeContent(item.node)" :query="searchQuery"/></span>
          <span class="node-status">{{ changed && changes.has(item.node.id) ? (isAssumption(item.node) ? 'Assumption · ' : '') + nodeChangeLabel(previousNodes.get(item.node.id), item.node, changes.get(item.node.id)!) : nodeStatus(item.node) }}</span>
        </button>
        <button class="show-node-details" aria-label="Show other node options" :disabled="!unselectedAlternatives(item.node).length" :aria-expanded="optionsId === item.node.id" @click.stop="inspectNode(item.node.id, true)"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 10h12"/></svg></button>
        <span v-if="references.has(item.node.id)" class="node-reference"><span class="node-number">#{{ references.get(item.node.id)!.number }}</span><button class="copy-node-reference" :aria-label="`Copy reference to node ${references.get(item.node.id)!.number}`" @click.stop="emit('copyReference', references.get(item.node.id)!.reference)"><svg viewBox="0 0 16 16" aria-hidden="true"><g transform="translate(0 16) scale(1 -1)"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M10 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></g></svg></button></span>
        </div>
      </div>
      <div v-if="selectionRect" class="selection-box" :style="{ left: `${selectionRect.left}px`, top: `${selectionRect.top}px`, width: `${selectionRect.width}px`, height: `${selectionRect.height}px` }" aria-hidden="true"/>
      <GraphViewportTools v-if="graph.nodes.length" :compact="compact" :multi-select="multiSelectMode" @toggle-multi-select="toggleMultiSelect" :bounds="bounds" :nodes="overviewNodes" :edges="displayEdges.map(e => e.path)" :scale="scale" :minimum-scale="minimumScale" :pan="pan" :viewport="size" :fitted="fitted" :export-url="exportUrl" :filename="`${workspaceId}-r${revision}-${view}`" @zoom="changeZoom" @fit="fit" @actual="actualSize" @pan="moveMap">
        <template #actions>
          <Transition name="selection-actions">
            <div v-if="selectedIds.size || multiSelectMode" class="selection-actions" role="toolbar" aria-label="Selected node actions" @pointerdown.stop @dblclick.stop>
              <span role="status" :aria-label="`${selectedIds.size} selected`">{{ selectedIds.size }}<span class="selection-caption"> selected</span></span>
              <button aria-label="Copy selected node references" :disabled="!selectedIds.size" @click="copySelection"><i class="pi pi-copy" aria-hidden="true"/><span class="selection-caption">Copy</span></button>
              <SelectionShortcuts ref="selectionShortcuts" :context="shortcutContext" @copy="copyShortcutRequest"/>
            </div>
          </Transition>
        </template>
      </GraphViewportTools>
    </div>
    <div v-if="!graph.nodes.length" class="canvas-empty"><i class="pi pi-sitemap"/><template v-if="historical"><h2>Earlier graph format</h2><p>Press G or select the last revision to view the current graph.</p></template><template v-else><h2>A graph starts here.</h2><p>Continue the conversation with your agent.<br>Published graph commits appear automatically.</p></template></div>
  </section>
</template>

<style scoped>
.graph-node .node-status{padding-left:24px}
.show-node-details{position:absolute;left:calc(10px + var(--node-border));bottom:calc(10px + var(--node-border));display:grid;place-items:center;width:16px;height:16px;padding:2px;border:0;border-radius:4px;color:#9caa96}
.show-node-details svg{width:12px;height:12px;transform:translateY(-1px);fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round}
.show-node-details:hover:not(:disabled),.show-node-details:focus-visible{outline:none;color:var(--accent);background:#ffffff0c}
.show-node-details::after,.copy-node-reference::after{content:'';position:absolute;inset:-8px}
.copy-node-reference{position:relative}
.graph-viewport.selecting,.graph-viewport.selecting:active,.graph-viewport.selecting .graph-node{cursor:crosshair}
.selection-box{position:absolute;pointer-events:none;z-index:3;border:1px solid var(--accent);background:#e6b85c20}
.graph-node.search-active{box-shadow:0 8px 24px #0002}
.graph-node.search-active :deep(mark){background:#ff914d;color:#17191b}
.graph-node.checked{background:#353024;opacity:1}
.node-frame{transition:opacity .2s}
.node-frame.inspection-dimmed{opacity:.67}
.node-selection-badge{position:absolute;top:-9px;right:-9px;display:grid;place-items:center;width:22px;height:22px;border:2px solid #101113;border-radius:50%;background:var(--accent);color:#1b1c1e;pointer-events:none}
.node-selection-badge svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
.selection-actions{position:relative;z-index:4;display:flex;align-items:center;gap:12px;padding:4px 8px 4px 16px;border:1px solid #45484b;border-radius:999px;background:#202224;box-shadow:0 8px 32px #0006;cursor:default;white-space:nowrap;pointer-events:auto}
.selection-actions>span{font-size:13px;color:var(--accent);padding-right:6px}
.selection-actions button{display:flex;align-items:center;justify-content:center;gap:8px;min-height:36px;padding:8px 12px;border:0;border-radius:999px;background:#2a2d30;font-size:13px}
.selection-actions button:disabled{opacity:.4;cursor:default}
.selection-actions button:hover:not(:disabled){color:var(--accent);background:#35383b}
.selection-actions button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.selection-actions-enter-active,.selection-actions-leave-active{transition:transform .22s ease,opacity .22s ease}
.selection-actions-enter-from,.selection-actions-leave-to{transform:translateY(24px);opacity:0}
@media(max-width:700px){.selection-actions :deep(.selection-shortcuts-trigger){width:30px;padding:6px}.selection-actions{gap:4px;padding:3px 4px 3px 8px}.selection-actions>span{padding-right:4px}.selection-caption{display:none}.selection-actions button{width:30px;min-height:30px;padding:6px}}
@media(max-width:350px){.selection-actions{gap:2px}}
@media(prefers-reduced-motion:reduce){.selection-actions-enter-active,.selection-actions-leave-active{transition:none}}
.graph-node.options-open{border-bottom-left-radius:0;border-bottom-right-radius:0;box-shadow:0 12px 30px #0007}
.node-frame:has(.options-open){z-index:5}
@media(prefers-reduced-motion:no-preference){.graph-node{transition:opacity .5s,border-color .3s,border-radius .24s,box-shadow .24s}}
.show-node-details:disabled{opacity:.3;cursor:default}
.show-node-details[aria-expanded="true"]{color:var(--accent);background:#ffffff0a}
</style>
