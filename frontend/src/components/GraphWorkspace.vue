<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import DependencyAtlas from './DependencyAtlas.vue';
import NodeInspector from './NodeInspector.vue';
import MobileRevisionBar from './MobileRevisionBar.vue';
import MobileGraphControls from './MobileGraphControls.vue';
import ChangeLegend from './ChangeLegend.vue';
import RevisionSidebar from './RevisionSidebar.vue';
import type { Workspace } from '../model';
import { graphChanges } from '../graph';
import type { GraphView } from '../relationships';

const props = defineProps<{ workspace: Workspace }>();
const emit = defineEmits<{ copyReference: [reference: string] }>();
const fullscreen = defineModel<boolean>('fullscreen', { default: false });
const track = ref(sessionStorage.getItem('ari.track') !== 'false');
watch(track, enabled => sessionStorage.setItem('ari.track', String(enabled)));
const selectedCommitId = ref(props.workspace.commits.at(-1)?.id || '');
const selectedNode = ref('');
const focusedNode = ref('');
let numberPrefix = '', numberTimer: ReturnType<typeof setTimeout> | undefined;
function clearNumber() { clearTimeout(numberTimer); numberPrefix = ''; }
onUnmounted(clearNumber);
const atlas = ref<InstanceType<typeof DependencyAtlas>>();
const details = ref<HTMLDialogElement>();
const mobileQuery = matchMedia('(max-width: 1100px)');
const mobile = ref(mobileQuery.matches);
function resizeDetails(event: MediaQueryListEvent) { mobile.value = event.matches; }
onMounted(() => mobileQuery.addEventListener('change', resizeDetails));
onUnmounted(() => mobileQuery.removeEventListener('change', resizeDetails));
const changed = ref(false);
const view = ref<GraphView>('hierarchy');
const showInputs = ref(true), showConstraints = ref(true);
const index = computed(() => Math.max(0, props.workspace.commits.findIndex(c => c.id === selectedCommitId.value)));
const commit = computed(() => props.workspace.commits[index.value]);
const previous = computed(() => props.workspace.commits[index.value - 1]?.graph || { nodes: [] });
const current = computed(() => commit.value?.graph || { nodes: [] });
const changes = computed(() => graphChanges(previous.value, current.value));
const nodes = computed(() => [...current.value.nodes, ...(changed.value ? previous.value.nodes.filter(n => changes.value.get(n.id) === 'removed') : [])]);
const node = computed(() => nodes.value.find(n => n.id === selectedNode.value));
async function go(i: number, focus = false) {
  const next = props.workspace.commits[i];
  if (!next || selectedCommitId.value === next.id) return;
  clearNumber(); focusedNode.value = ''; selectedCommitId.value = next.id; selectedNode.value = '';
  if (focus) {
    await nextTick();
    if (selectedCommitId.value === next.id) atlas.value?.focusChanges();
  }
}
async function focusNumber(number: number) {
  clearNumber();
  const entry = props.workspace.nodeIndex?.find(entry => entry.number === number && nodes.value.some(node => node.id === entry.id));
  if (!entry) return;
  selectedNode.value = ''; focusedNode.value = entry.id;
  await nextTick();
  if (focusedNode.value === entry.id) atlas.value?.focusNode(entry.id);
}
function shortcut(key: string, shift = false, repeat = false) {
  if (!shift && /^\d$/.test(key) && (key !== '0' || numberPrefix)) {
    if (repeat) return true;
    clearTimeout(numberTimer); numberPrefix += key;
    const prefix = numberPrefix;
    const matches = props.workspace.nodeIndex?.filter(entry => String(entry.number).startsWith(prefix) && nodes.value.some(node => node.id === entry.id)) || [];
    if (!matches.length) { clearNumber(); return true; }
    if (matches.some(entry => String(entry.number) !== prefix)) numberTimer = setTimeout(() => { void focusNumber(Number(prefix)); }, 1000);
    else void focusNumber(Number(prefix));
    return true;
  }
  clearNumber();
  const pan: Record<string, [number, number]> = { H: [187.5, 0], J: [0, -187.5], K: [0, 187.5], L: [-187.5, 0] };
  const direction = shift ? pan[key.toUpperCase()] : undefined;
  if (direction) { atlas.value?.panBy(...direction, key.toUpperCase()); return true; }
  if (key === '-' || key === '=' || key === '+') { atlas.value?.zoom(key === '-' ? -.1 : .1); return true; }
  if (mobile.value ? key === 'l' || key === 'ArrowRight' : key === 'j' || key === 'ArrowDown') void go(index.value + 1, true);
  else if (mobile.value ? key === 'h' || key === 'ArrowLeft' : key === 'k' || key === 'ArrowUp') void go(index.value - 1, true);
  else if (key === 'Home' || key === 'gg') void go(0, true);
  else if (key === 'End' || key === 'G') void go(props.workspace.commits.length - 1, true);
  else if (key === '[' || key === ']') {
    const views: GraphView[] = ['hierarchy', 'islands', 'rings'];
    view.value = views[(views.indexOf(view.value) + (key === ']' ? 1 : 2)) % views.length]!;
  } else if (key === 'f') { if (!repeat) fullscreen.value = !fullscreen.value; }
  else if (key === 'i') showInputs.value = !showInputs.value;
  else if (key === 'c') changed.value = !changed.value;
  else if (key === 's') showConstraints.value = !showConstraints.value;
  else return false;
  return true;
}
defineExpose({ shortcut, cancelNumber: clearNumber });
watch(() => props.workspace.commits, async (next, old) => {
  const latest = next.at(-1);
  if (!latest || latest.id === old?.at(-1)?.id) return;
  if (old?.length && selectedCommitId.value !== old.at(-1)?.id) return;
  selectedCommitId.value = latest.id;
  if (track.value) {
    await nextTick();
    if (selectedCommitId.value === latest.id) atlas.value?.focusChanges();
  }
});
watch(nodes, all => { if (!all.some(n => n.id === selectedNode.value)) selectedNode.value = ''; });
let modal = false;
watch([node, mobile], async ([selected, isMobile]) => {
  await nextTick();
  const panel = details.value;
  if (!panel) return;
  if (!selected) { panel.close(); return; }
  if (panel.open && modal === isMobile) return;
  if (panel.open) panel.close();
  modal = isMobile;
  if (isMobile) panel.showModal(); else panel.show();
}, { flush: 'post' });
</script>
<template>
  <main class="graph-workspace" :class="{ fullscreen }" @pointerdown.capture="clearNumber">
    <MobileRevisionBar :inert="fullscreen" v-if="mobile" :commits="workspace.commits" :index="index" @select="go"/>
    <RevisionSidebar :inert="fullscreen" v-else :commits="workspace.commits" :index="index" @select="go"/>
    <div class="graph-center">
      <DependencyAtlas ref="atlas" :fullscreen="fullscreen" v-model:track="track" :compact="mobile" :node-index="workspace.nodeIndex" :focused-node="focusedNode" v-model:show-inputs="showInputs" v-model:show-constraints="showConstraints" :workspace-id="workspace.id" :title="workspace.title" :current="current" :previous="previous" :changed="changed" :selected="selectedNode" :revision="commit?.revision || 0" :view="view" @select="focusedNode = ''; selectedNode = $event" @copy-reference="emit('copyReference', $event)">
        <template #toolbar><MobileGraphControls v-if="mobile" v-model:track="track" v-model:view="view" v-model:changed="changed" v-model:show-inputs="showInputs" v-model:show-constraints="showConstraints"/><template v-else><div class="view-toggle" aria-label="Graph layout"><button :class="{ active: view === 'hierarchy' }" :aria-pressed="view === 'hierarchy'" @click="view = 'hierarchy'">Tree</button><button :class="{ active: view === 'islands' }" :aria-pressed="view === 'islands'" @click="view = 'islands'">Grouped</button><button :class="{ active: view === 'rings' }" :aria-pressed="view === 'rings'" @click="view = 'rings'">Radial</button></div><div class="view-toggle" aria-label="Graph display"><button :class="{ active: !changed }" :aria-pressed="!changed" @click="changed = false">Current</button><button :class="{ active: changed }" :aria-pressed="changed" @click="changed = true">Changed</button></div><ChangeLegend v-if="changed"/></template></template>
      </DependencyAtlas>
    </div>
    <dialog ref="details" class="node-details" aria-label="Node details" :aria-modal="mobile ? true : undefined" @cancel.prevent="selectedNode = ''" @click.self="selectedNode = ''">
      <NodeInspector v-if="node && commit" :node="node" :workspace="workspace" :commit="commit" :previous="previous" :change="changed ? changes.get(node.id) : undefined" @select="selectedNode = $event" @close="selectedNode = ''"/>
    </dialog>
  </main>
</template>
