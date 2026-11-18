<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { Workspace } from '../model';
import { searchNodes, type SearchContext, type SearchMatch } from '../graph-search';

const props = defineProps<{ workspaces: Workspace[]; context?: SearchContext }>();
const emit = defineEmits<{ reveal: [match: SearchMatch]; queryChange: [query: string] }>();
const opened = ref(false), query = ref(''), scope = ref('current'), index = ref(0);
const input = ref<HTMLInputElement>(), trigger = ref<HTMLButtonElement>();
const results = computed(() => searchNodes(props.workspaces, query.value, props.context, scope.value === 'all'));
const active = computed(() => results.value[index.value]);
watch([opened, query, results], () => emit('queryChange', opened.value && results.value.length ? query.value.trim() : ''));
function reveal() { if (opened.value && active.value) emit('reveal', active.value); }
watch(() => results.value.map(match => `${match.workspaceId}@${match.revision}@${match.nodeId}`).join('|'), () => { index.value = 0; reveal(); });
watch(() => props.context, context => { if (!context) scope.value = 'all'; });
async function show() {
  if (!opened.value) scope.value = props.context ? 'current' : 'all';
  opened.value = true;
  await nextTick();
  input.value?.focus(); input.value?.select();
  reveal();
}
function close() {
  if (!opened.value) return;
  opened.value = false; query.value = ''; index.value = 0;
  const destination = document.querySelector<HTMLElement>('.graph-viewport') ?? trigger.value;
  destination?.focus({ preventScroll: true });
}
function step(delta: number) {
  if (!results.value.length) return;
  index.value = (index.value + delta + results.value.length) % results.value.length;
  reveal();
}
function handleKey(event: KeyboardEvent) {
  if (!opened.value) return false;
  if (event.key === 'Escape' || event.ctrlKey && event.key === '[') {
    event.preventDefault(); event.stopImmediatePropagation(); close(); return true;
  }
  if (!(event.target instanceof Element) || !event.target.closest('.graph-search')) return false;
  if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? -1 : 1); }
  return true;
}
defineExpose({ show, close, handleKey });
</script>

<template>
  <button ref="trigger" class="search-trigger" aria-label="Search graph nodes" title="Search nodes (Ctrl+F)" :aria-expanded="opened" aria-controls="graph-search" @click="opened ? close() : show()"><i class="pi pi-search" aria-hidden="true"/></button>
  <section v-if="opened" id="graph-search" class="graph-search" role="search" aria-label="Graph node search">
    <div class="search-fields">
      <input ref="input" v-model="query" class="search-input" type="text" role="searchbox" aria-label="Find graph nodes" placeholder="Find nodes…" autocomplete="off">
      <button aria-label="Close graph search" title="Close search (Escape)" @click="close"><i class="pi pi-times" aria-hidden="true"/></button>
    </div>
    <div class="search-results">
      <button aria-label="Previous search result" title="Previous result (Shift+Enter)" :disabled="!results.length" @click="step(-1)"><i class="pi pi-chevron-left" aria-hidden="true"/></button>
      <div class="search-result-summary"><output aria-live="polite" aria-label="Search result count">{{ results.length ? `${index + 1} / ${results.length}` : query.trim() ? 'No results' : '0 / 0' }}</output><span class="search-result-title" :title="active ? `${active.workspaceTitle} · ${active.title}` : ''">{{ active ? `${scope === 'all' ? active.workspaceTitle + ' · ' : ''}${active.title}` : 'Search titles, answers and alternatives' }}</span></div>
      <button aria-label="Next search result" title="Next result (Enter)" :disabled="!results.length" @click="step(1)"><i class="pi pi-chevron-right" aria-hidden="true"/></button>
    </div>
  </section>
</template>

<style scoped>
.search-trigger{display:grid;place-items:center;width:32px;min-height:32px;padding:7px;border-color:transparent;color:var(--muted);flex-shrink:0}
.search-trigger:hover,.search-trigger:focus-visible{background:var(--soft);color:var(--text);outline:none}
.graph-search{position:fixed;z-index:10;top:74px;right:8px;width:min(359px,calc(100vw - 16px));padding:8px;border:1px solid var(--line);border-radius:10px;background:#202224;box-shadow:0 8px 28px #0006}
.search-fields,.search-results{display:flex;align-items:center;gap:6px;min-width:0}
.search-fields .search-input{flex:1;min-width:0;width:100px;padding:8px;font-size:13px;border:0;outline:none;box-shadow:none;border-radius:5px;background:#101113;color:var(--text)}
.search-fields .search-input:focus{outline:none;box-shadow:none;background:#18191b}
.graph-search button{display:grid;place-items:center;width:30px;min-height:30px;flex-shrink:0;padding:4px;border:0;color:var(--text)}
.graph-search button:hover,.graph-search button:focus-visible{background:#35383b;outline:none;box-shadow:none}
.graph-search button:disabled{opacity:.4;cursor:default}
.search-results{margin-top:6px;font-size:11px;color:var(--muted)}
.search-result-summary{display:flex;align-items:center;justify-content:center;gap:8px;flex:1;min-width:0;text-align:center}
.search-results output{white-space:nowrap;color:var(--accent)}
.search-result-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style>
