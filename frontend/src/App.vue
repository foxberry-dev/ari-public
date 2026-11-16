<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import BerryMark from './components/BerryMark.vue';
import ClarityLibrary from './components/ClarityLibrary.vue';
import GraphWorkspace from './components/GraphWorkspace.vue';
import RelatedLinks from './components/RelatedLinks.vue';
import ShortcutReference from './components/ShortcutReference.vue';
import ReferenceNotification from './components/ReferenceNotification.vue';
import { api } from './api';
import { loadCherUrl, returnToCher } from './cher-navigation';
import { changeTheme } from './graph-presentation';
import type { Workspace } from './model';
import { installOverlayScrollbars } from './scrollbars';

const cherUrl = ref<string | null>(null);
const items = ref<Workspace[]>([]);
const workspace = ref<Workspace | null>(null);
const graphWorkspace = ref<InstanceType<typeof GraphWorkspace>>();
const fullscreen = ref(false);
const shortcuts = ref<InstanceType<typeof ShortcutReference>>();
const relatedLinks = ref<InstanceType<typeof RelatedLinks>>();
const notification = ref<InstanceType<typeof ReferenceNotification>>();
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
function keyboard(event: KeyboardEvent) {
  if (relatedLinks.value?.handleKey(event)) return;
  if (!/^\d$/.test(event.key) || event.ctrlKey || event.metaKey || event.altKey) graphWorkspace.value?.cancelNumber();
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
      else void notification.value?.copy(`ari@${workspace.value.id}`);
    } else { pendingKey = event.key; pendingUntil = Date.now() + 1000; }
    return;
  }
  pendingKey = '';
  if (event.key === 'u' && !event.shiftKey && !fullscreen.value && !document.querySelector('dialog:modal') && !(event.target instanceof Element && event.target.closest('input,textarea,[contenteditable]'))) {
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
async function navigate() { fullscreen.value = false; pendingKey = ''; error.value = ''; await refresh(); }
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
    <header class="page-header" :inert="fullscreen"><div class="header-inner" :class="workspace ? 'workspace-header' : 'library-header'">
      <a v-if="workspace" class="clarification-back" href="#/" aria-label="Back to clarity library" title="Back to clarity library"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7-7-7 7 7 7"/></svg><span>{{ workspace.title }}</span></a>
      <div v-else class="library-identity">
        <a v-if="cherUrl && !displayedId" class="cher-back" :href="cherUrl" aria-label="Back to Cher" title="Back to Cher"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></a>
        <button class="identity quiet" aria-label="Ari clarity library" @click="home"><BerryMark/><span class="wordmark">ari</span></button>
      </div>
      <span class="spacer"/>
      <ShortcutReference v-if="workspace" ref="shortcuts"/>
      <RelatedLinks v-if="workspace" ref="relatedLinks" :key="workspace.id" :links="workspace.links" :hidden="fullscreen"/>
      <span class="connection" :title="connected ? 'Live graph updates are connected.' : 'Reconnecting to the Ari server'"><i class="pi" :class="connected ? 'pi-check-circle good-text' : 'pi-exclamation-circle gold-text'"/><span>{{ connected ? 'Connected' : 'Reconnecting' }}</span></span>
    </div></header>
    <ReferenceNotification ref="notification"/>
    <div v-if="error" class="error-notice" role="alert"><span>{{ error }}</span><button @click="refresh">Retry</button></div>
    <ClarityLibrary v-if="!workspace && !displayedId" v-model:state="libraryState" :items="items" :loading="loading" @open="open"/>
    <main v-else-if="!workspace" class="container loading-page"><p>This clarification could not be opened.</p><button @click="home">Back to library</button></main>
    <GraphWorkspace v-else ref="graphWorkspace" v-model:fullscreen="fullscreen" :key="workspace.id" :workspace="workspace" @copy-reference="notification?.copy($event)"/>
  </div>
</template>
