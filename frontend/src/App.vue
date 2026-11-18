<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import BerryMark from './components/BerryMark.vue';
import ClarityLibrary from './components/ClarityLibrary.vue';
import GraphWorkspace from './components/GraphWorkspace.vue';
import GraphSearch from './components/GraphSearch.vue';
import type { SearchContext, SearchMatch } from './graph-search';
import RelatedLinks from './components/RelatedLinks.vue';
import ShortcutReference from './components/ShortcutReference.vue';
import ReferenceNotification from './components/ReferenceNotification.vue';
import DeletionNotification from './components/DeletionNotification.vue';
import { api } from './api';
import { loadCherUrl, returnToCher } from './cher-navigation';
import { changeTheme } from './graph-presentation';
import type { Workspace } from './model';
import { installOverlayScrollbars } from './scrollbars';

const cherUrl = ref<string | null>(null);
const items = ref<Workspace[]>([]);
const workspace = ref<Workspace | null>(null);
const graphWorkspace = ref<InstanceType<typeof GraphWorkspace>>();
const search = ref<InstanceType<typeof GraphSearch>>();
const graphSearchContext = ref<SearchContext>();
const searchQuery = ref('');
const searchContext = computed<SearchContext | undefined>(() => {
  const current = workspace.value;
  if (!current) return;
  if (graphSearchContext.value?.workspaceId === current.id) return graphSearchContext.value;
  return { workspaceId: current.id, revision: current.revision, nodes: current.commits.at(-1)?.graph.nodes || [] };
});
let pendingSearch: SearchMatch | undefined;
const fullscreen = ref(false);
const allSelected = ref(false);
const shortcuts = ref<InstanceType<typeof ShortcutReference>>();
const relatedLinks = ref<InstanceType<typeof RelatedLinks>>();
const notification = ref<InstanceType<typeof ReferenceNotification>>();
const deletionNotification = ref<InstanceType<typeof DeletionNotification>>();
let pendingKey = '', pendingUntil = 0;
const loading = ref(true);
const displayedId = ref('');
const connected = ref(false);
const error = ref('');
const libraryState = ref({ query: '', selectedId: '', scrollTop: 0 });
let events: EventSource;
let interval: ReturnType<typeof setInterval>;
let sequence = 0;
let disposeScrollbars: (() => void) | undefined;
function routeId() { return decodeURIComponent(location.hash.match(/^#\/clarifications\/([^/]+)$/)?.[1] || ''); }
function open(id: string) { location.hash = `/clarifications/${encodeURIComponent(id)}`; }
function home() { location.hash = '/'; }
function copyLink() {
  if (workspace.value) void notification.value?.copy(new URL(`#/clarifications/${encodeURIComponent(workspace.value.id)}`, location.href).href, 'link');
}
async function copyReference(reference: string, onCopied?: () => void, kind: 'reference' | 'prompt' = 'reference', label?: string) {
  if (await notification.value?.copy(reference, kind, label)) onCopied?.();
}
async function revealSearch(match: SearchMatch) {
  if (workspace.value?.id !== match.workspaceId) { pendingSearch = match; open(match.workspaceId); return; }
  await graphWorkspace.value?.revealNode(match.nodeId, match.revision);
}
watch(workspace, async value => {
  if (!pendingSearch || pendingSearch.workspaceId !== value?.id) return;
  const match = pendingSearch; pendingSearch = undefined;
  await nextTick();
  await graphWorkspace.value?.revealNode(match.nodeId, match.revision);
});
function keyboard(event: KeyboardEvent) {
  if (!event.isComposing && event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'f') {
    event.preventDefault(); event.stopImmediatePropagation(); pendingKey = '';
    graphWorkspace.value?.cancelNumber();
    void nextTick().then(() => search.value?.show());
    return;
  }
  if (search.value?.handleKey(event)) return;
  if (event.target instanceof Element && event.target.closest('.graph-search')) return;
  if (relatedLinks.value?.handleKey(event)) return;
  if (graphWorkspace.value?.handleSelectionShortcutKey(event)) return;
  if (['.', ';', 'a', 't'].includes(event.key) && (document.querySelector('dialog:modal') || event.target instanceof Element && event.target.closest('input,textarea,[contenteditable],[role="textbox"]'))) return;
  if ((!/^\d$/.test(event.key) && event.key !== 'Enter') || event.ctrlKey || event.metaKey || event.altKey) graphWorkspace.value?.cancelNumber();
  if (event.isComposing || event.altKey || event.metaKey) return;
  const exit = event.key === 'Escape' || event.ctrlKey && event.key === '[';
  if (exit) {
    if (event.defaultPrevented || event.repeat || event.shiftKey) return;
    const exportMenu = document.querySelector<HTMLElement>('[data-graph-export-menu]:popover-open');
    if (exportMenu) { event.preventDefault(); event.stopImmediatePropagation(); exportMenu.hidePopover(); return; }
    const relatedLinks = document.querySelector<HTMLElement>('[data-related-links]:popover-open');
    if (relatedLinks) {
      event.preventDefault(); event.stopImmediatePropagation(); relatedLinks.hidePopover();
      document.querySelector<HTMLButtonElement>('[aria-controls="related-links"]')?.focus(); return;
    }
    const graphOptions = document.querySelector<HTMLElement>('[data-graph-options]:popover-open');
    if (graphOptions) {
      event.preventDefault(); event.stopImmediatePropagation(); graphOptions.hidePopover();
      document.querySelector<HTMLButtonElement>('[aria-controls="graph-options"]')?.focus(); return;
    }
    const dialog = document.querySelector<HTMLDialogElement>('dialog:modal');
    if (dialog) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
      return;
    }
    if (document.querySelector('[role="dialog"]:not([popover])')) return;
    if (graphWorkspace.value?.closeOptions()) {
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    if (graphWorkspace.value?.clearSelection()) {
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    if (fullscreen.value) {
      event.preventDefault(); event.stopImmediatePropagation(); fullscreen.value = false; return;
    }
    if (routeId()) {
      event.preventDefault(); event.stopImmediatePropagation(); home();
      return;
    }
    if (returnToCher(cherUrl.value)) {
      event.preventDefault(); event.stopImmediatePropagation();
      return;
    }
  }
  if (event.target instanceof Element && event.target.closest('[data-graph-export-menu]') && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  if (event.target instanceof HTMLSelectElement && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  if (event.ctrlKey || !workspace.value) { pendingKey = ''; return; }
  if (event.key === 'g' || event.key === 'y') {
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.repeat) return;
    if (pendingKey === event.key && Date.now() < pendingUntil) {
      pendingKey = '';
      if (event.key === 'g') graphWorkspace.value?.shortcut('gg');
      else graphWorkspace.value?.copyReference();
    } else { pendingKey = event.key; pendingUntil = Date.now() + 1000; }
    return;
  }
  pendingKey = '';
  if (event.key === 'u' && !event.shiftKey && !document.querySelector('dialog:modal') && !(event.target instanceof Element && event.target.closest('input,textarea,[contenteditable]'))) {
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat) void relatedLinks.value?.toggle();
  } else if (event.key === '?') {
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat) shortcuts.value?.toggle();
  } else if (graphWorkspace.value?.shortcut(event.key, event.shiftKey, event.repeat)) {
    event.preventDefault(); event.stopImmediatePropagation();
  }
}
async function refresh() {
  const request = ++sequence, id = routeId();
  try {
    const [all, detail] = await Promise.all([api<Workspace[]>('/workspaces'), id ? api<Workspace>(`/workspaces/${encodeURIComponent(id)}`) : Promise.resolve(null)]);
    if (request !== sequence || id !== routeId()) return;
    items.value = all; workspace.value = detail; displayedId.value = id; error.value = '';
  } catch (cause) {
    if (request === sequence) {
      if (displayedId.value !== id) { workspace.value = null; displayedId.value = id; }
      error.value = cause instanceof Error ? cause.message : 'Cannot reach Ari';
    }
  } finally { if (request === sequence) loading.value = false; }
}
async function navigate() {
  if (pendingSearch?.workspaceId !== routeId()) { pendingSearch = undefined; search.value?.close(); }
  fullscreen.value = false; pendingKey = ''; error.value = ''; await refresh();
}
onMounted(() => {
  void loadCherUrl().then(url => { cherUrl.value = url; });
  disposeScrollbars = installOverlayScrollbars();
  window.addEventListener('hashchange', navigate);
  document.addEventListener('keydown', keyboard, true);
  events = new EventSource('/api/events');
  events.onopen = () => { connected.value = true; void refresh(); };
  events.onmessage = () => void refresh();
  events.onerror = () => { connected.value = false; };
  interval = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 5000);
  void refresh();
});
onUnmounted(() => { disposeScrollbars?.(); events?.close(); clearInterval(interval); window.removeEventListener('hashchange', navigate); document.removeEventListener('keydown', keyboard, true); });
</script>
<template>
  <div v-if="!loading" class="app" :style="changeTheme" :class="{ 'in-workspace': !!workspace, fullscreen: !!workspace && fullscreen }">
    <header class="page-header"><div class="header-inner" :class="workspace ? 'workspace-header' : 'library-header'">
      <a v-if="workspace" class="clarification-back" href="#/" aria-label="Back to clarity library" title="Back to clarity library"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7-7-7 7 7 7"/></svg><span>{{ workspace.title }}</span></a>
      <button v-if="workspace" class="copy-link" aria-label="Copy clarification link" @click="copyLink"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/><path d="M10 2h7l5 5v8a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM17 2v5h5"/></svg></button>
      <div v-else class="library-identity">
        <a v-if="cherUrl && !displayedId" class="cher-back" :href="cherUrl" aria-label="Back to Cher" title="Back to Cher"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></a>
        <button class="identity quiet" aria-label="Ari clarity library" @click="home"><BerryMark/><span class="wordmark">ari</span></button>
      </div>
      <span class="spacer"/>
      <GraphSearch ref="search" :workspaces="items" :context="searchContext" @reveal="revealSearch" @query-change="searchQuery = $event"/>
      <button v-if="workspace" class="header-fullscreen" aria-label="Toggle fullscreen canvas" :aria-pressed="fullscreen" @click="fullscreen = !fullscreen"><svg viewBox="0 0 24 24" aria-hidden="true"><path v-if="fullscreen" d="M3 8h5V3m13 5h-5V3M3 16h5v5m13-5h-5v5"/><path v-else d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg></button>
      <button v-if="workspace" class="header-select-all" aria-label="Toggle select all nodes" :aria-pressed="allSelected" @click="graphWorkspace?.toggleSelectAll()"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="14" height="14" rx="2"/><path d="M16 3H5a2 2 0 0 0-2 2v11m8-2 2 2 4-5"/></svg></button>
      <ShortcutReference v-if="workspace" ref="shortcuts"/>
      <RelatedLinks v-if="workspace" ref="relatedLinks" :key="workspace.id" :links="workspace.links"/>
      <span class="connection" :title="connected ? 'Live graph updates are connected.' : 'Reconnecting to the Ari server'"><i class="pi" :class="connected ? 'pi-check-circle good-text' : 'pi-exclamation-circle gold-text'"/><span>{{ connected ? 'Connected' : 'Reconnecting' }}</span></span>
    </div></header>
    <ReferenceNotification ref="notification"/>
    <DeletionNotification ref="deletionNotification" @changed="refresh"/>
    <div v-if="error" class="error-notice" role="alert"><span>{{ error }}</span><button @click="refresh">Retry</button></div>
    <ClarityLibrary v-if="!workspace && !displayedId" v-model:state="libraryState" :items="items" :loading="loading" @open="open" @changed="refresh" @deleted="(receipt, titles) => deletionNotification?.deleted(receipt, titles)"/>
    <main v-else-if="!workspace" class="container loading-page"><p>This clarification could not be opened.</p><button @click="home">Back to library</button></main>
    <GraphWorkspace v-else ref="graphWorkspace" v-model:fullscreen="fullscreen" v-model:all-selected="allSelected" :key="workspace.id" :workspace="workspace" :search-query="searchQuery" @copy-reference="copyReference" @search-context="graphSearchContext = $event"/>
  </div>
</template>

<style scoped>
.copy-link,.header-fullscreen,.header-select-all{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:32px;min-height:32px;padding:7px;border-color:transparent;color:var(--muted)}
.copy-link svg,.header-fullscreen svg,.header-select-all svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.55;stroke-linecap:round;stroke-linejoin:round}
.copy-link:hover,.header-fullscreen:hover,.header-select-all:hover{background:var(--raised)}
.copy-link:focus-visible,.header-fullscreen:focus-visible,.header-select-all:focus-visible{outline:none;background:#575757;color:var(--text)}
.header-fullscreen[aria-pressed="true"],.header-select-all[aria-pressed="true"]{color:var(--accent)}
</style>
