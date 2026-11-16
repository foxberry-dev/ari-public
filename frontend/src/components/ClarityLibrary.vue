<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Workspace } from '../model';
import { counts } from '../model';
import DottedBackdrop from './DottedBackdrop.vue';
import GraphThumbnail from './GraphThumbnail.vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import { api } from '../api';

const props = defineProps<{ items: Workspace[]; loading: boolean }>();
const emit = defineEmits<{ open: [id: string]; changed: []; deleted: [receipt: { token: string; expiresAt: number }, titles: string[]] }>();
const state = defineModel<{ query: string; selectedId: string; scrollTop: number }>('state', { required: true });
const search = ref<HTMLInputElement>();
const grid = ref<HTMLElement>();
const scroller = ref<HTMLElement>();
const toolbar = ref<HTMLElement>();
const stuck = ref(false);
const deleteTargets = ref<Workspace[]>([]);
const deleteDialog = ref(false);
const deleting = ref(false);
const deleteAll = ref(false);
const deleteError = ref('');
const focusDeleteConfirmation = ref(false);
let restoreFocus = !!state.value.selectedId;
const term = computed(() => state.value.query.trim().toLowerCase());
const items = computed(() => props.items
  .filter(item => `${item.title} ${item.description}`.toLowerCase().includes(term.value))
  .toSorted((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)));
const cards = () => [...(grid.value?.querySelectorAll<HTMLButtonElement>('.clarity-card') || [])];

function rememberScroll() {
  state.value.scrollTop = scroller.value?.scrollTop || 0;
  stuck.value = !!scroller.value && !!toolbar.value && state.value.scrollTop > 0
    && toolbar.value.getBoundingClientRect().top <= scroller.value.getBoundingClientRect().top;
}

function focusCard(position: number, reveal = true, behavior: ScrollBehavior = 'instant') {
  const card = cards()[position];
  if (!card) return;
  card.focus({ preventScroll: true });
  if (reveal) card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior });
}

function focusSelected() {
  focusCard(Math.max(0, items.value.findIndex(item => item.id === state.value.selectedId)));
}

function open(id: string) {
  if (deleteDialog.value) return;
  state.value.selectedId = id;
  emit('open', id);
}

function confirmDeletion(targets: Workspace[], all = false, focusConfirmation = false) {
  if (deleteDialog.value || props.loading || !targets.length) return;
  deleteTargets.value = targets.map(item => ({ ...item }));
  deleteAll.value = all;
  deleteError.value = '';
  focusDeleteConfirmation.value = focusConfirmation;
  deleteDialog.value = true;
}

async function deleteClarifications() {
  if (deleting.value || deleteError.value) return;
  deleting.value = true;
  try {
    const receipt = await api<{ token: string; expiresAt: number }>('/workspaces/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deleteTargets.value.map(item => ({ id: item.id, expectedRevision: item.revision }))),
    });
    emit('deleted', receipt, deleteTargets.value.map(item => item.title));
    deleteDialog.value = false;
  } catch (cause) {
    deleteError.value = `${(cause as Error).message}. Close this dialog and check the library before trying again.`;
    void nextTick(() => document.querySelector<HTMLButtonElement>('#delete-clarification-dialog [autofocus]')?.focus());
  } finally {
    deleting.value = false;
    emit('changed');
  }
}

function restoreDeleteFocus() {
  if (items.value.length) focusSelected();
  else search.value?.focus({ preventScroll: true });
}

function dismissSearch() {
  state.value.query = '';
  state.value.selectedId = '';
  void nextTick(focusSelected);
}

function searchKeyboard(event: KeyboardEvent) {
  if (event.isComposing || event.metaKey || event.altKey || event.shiftKey) return;
  if (event.key === 'Escape' || event.ctrlKey && event.key === '[') {
    event.preventDefault(); event.stopPropagation(); dismissSearch();
  } else if (event.ctrlKey) {
    if (event.key.toLowerCase() === 'c') {
      event.preventDefault(); event.stopPropagation(); state.value.query = '';
    }
  } else if (['ArrowDown', 'Enter'].includes(event.key) && items.value.length) {
    event.preventDefault(); event.stopPropagation(); focusCard(0);
  }
}

function keyboard(event: KeyboardEvent) {
  if (deleteDialog.value) {
    if (event.key === 'Escape' || event.ctrlKey && event.key === '[') {
      event.preventDefault();
      if (!deleting.value) deleteDialog.value = false;
    }
    return;
  }
  if (event.defaultPrevented || event.isComposing || event.metaKey || event.altKey || event.shiftKey || document.querySelector('[role="dialog"]')) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="scrollbar"]')) return;
  if (event.key === 'Escape' || event.ctrlKey && event.key === '[') {
    event.preventDefault();
    if (target?.closest('.clarity-card')) state.value.query = '';
    void nextTick(focusSelected);
    return;
  }
  if (event.ctrlKey) return;
  if (event.key === '/') {
    event.preventDefault(); search.value?.focus();
    return;
  }
  if (props.loading) return;
  const key = ({ ArrowLeft: 'h', ArrowDown: 'j', ArrowUp: 'k', ArrowRight: 'l' } as Record<string, string>)[event.key] || event.key;
  if (!['h', 'j', 'k', 'l', 'Enter', 'x'].includes(key)) return;
  const buttons = cards();
  if (!buttons.length) return;
  const position = Math.max(0, items.value.findIndex(item => item.id === state.value.selectedId));
  if (key === 'x') {
    event.preventDefault();
    if (!event.repeat) confirmDeletion([items.value[position]!], false, true);
    return;
  }
  if (key === 'Enter') {
    if (target?.closest('button') && !target.closest('.clarity-card')) return;
    event.preventDefault();
    if (!event.repeat) open(items.value[position]!.id);
    return;
  }
  const top = buttons[0]!.getBoundingClientRect().top;
  const nextRow = buttons.findIndex(card => card.getBoundingClientRect().top > top + 1);
  const columns = nextRow > 0 ? nextRow : buttons.length;
  const offset = { h: -1, l: 1, j: columns, k: -columns }[key as 'h' | 'j' | 'k' | 'l'];
  const lastRow = Math.floor((buttons.length - 1) / columns);
  let next = position + offset;
  if (key === 'j') next = Math.floor(position / columns) === lastRow ? position : Math.min(next, buttons.length - 1);
  if (next < 0 || next >= buttons.length) next = position;
  event.preventDefault();
  const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
  focusCard(next, true, behavior);
  if (next < columns) scroller.value?.scrollTo({ top: 0, behavior });
  else if (Math.floor(next / columns) === lastRow) scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior });
}

watch(() => state.value.query, () => {
  state.value.scrollTop = 0;
  scroller.value?.scrollTo({ top: 0 });
});
watch([items, () => props.loading], () => {
  if (!items.value.some(item => item.id === state.value.selectedId)) state.value.selectedId = items.value[0]?.id || '';
  void nextTick(() => {
    if (props.loading) return;
    if (scroller.value) scroller.value.scrollTop = state.value.scrollTop;
    if ((restoreFocus || document.activeElement === document.body) && !document.querySelector('[role="dialog"]')) {
      focusCard(Math.max(0, items.value.findIndex(item => item.id === state.value.selectedId)), restoreFocus && state.value.scrollTop === 0);
    }
    restoreFocus = false;
  });
}, { immediate: true, flush: 'post' });
onMounted(() => document.addEventListener('keydown', keyboard));
onUnmounted(() => document.removeEventListener('keydown', keyboard));
</script>

<template>
  <main class="library" :aria-busy="loading" :style="{ '--overview-scroll': `${state.scrollTop}px` }">
    <DottedBackdrop/>
    <div ref="scroller" class="library-scroll" role="region" aria-label="Clarity library" @scroll="rememberScroll">
    <div class="library-intro library-content">
      <div class="page-intro"><p class="eyebrow">Your clarity library</p><h1>Good decisions start here.<br><span>Make the next step clear.</span></h1><p class="lede">Connected questions, published by your agent. Explore the choices and keep the reasoning.</p></div>
    </div>
    <div ref="toolbar" class="library-toolbar library-content" :class="{ 'is-stuck': stuck }">
      <label class="search"><i class="pi pi-search" aria-hidden="true"/><input ref="search" v-model="state.query" type="search" placeholder="Search titles and descriptions" aria-label="Search clarifications" autocomplete="off" @keydown="searchKeyboard"><kbd aria-hidden="true">/</kbd></label>
      <div class="library-results"><p class="result-count" role="status">{{ loading ? 'Loading your clarifications…' : `${items.length} clarification${items.length === 1 ? '' : 's'}${term ? ' found' : ''}` }}</p><Button v-if="props.items.length" class="delete-all" label="Delete all" icon="pi pi-trash" severity="danger" text size="small" :disabled="loading || deleteDialog" aria-controls="delete-clarification-dialog" :aria-expanded="deleteDialog && deleteAll" @click="confirmDeletion(props.items, true)"/></div>
    </div>
      <div class="library-content library-card-content">
        <div v-if="items.length" ref="grid" class="card-grid" aria-label="Clarifications" aria-description="Use h j k l or arrow keys to move between cards. Press Enter to open a clarification, or x to delete it.">
          <div v-for="item in items" :key="item.id" class="clarity-card-wrap">
          <button class="clarity-card" :data-clarification-id="item.id" :tabindex="item.id === state.selectedId ? 0 : -1" @focus="state.selectedId = item.id" @click="open(item.id)">
            <GraphThumbnail :workspace="item"/>
            <div class="card-body"><h2>{{ item.title }}</h2><p>{{ item.description || 'An open space to develop your next decision.' }}</p></div>
            <div class="card-footer"><span>{{ item.commits.at(-1)?.graph.nodes.length || 0 }} nodes · {{ counts(item).decided }} decided<span v-if="counts(item).assumptions"> · {{ counts(item).assumptions }} assumptions</span></span><i class="pi pi-arrow-right" aria-hidden="true"/></div>
          </button>
          <button type="button" class="delete-clarification" :aria-label="`Delete ${item.title}`" :title="`Delete ${item.title}`" aria-controls="delete-clarification-dialog" :aria-expanded="deleteDialog && !deleteAll && deleteTargets[0]?.id === item.id" @focus="state.selectedId = item.id" @click="confirmDeletion([item])"><i class="pi pi-trash" aria-hidden="true"/></button>
          </div>
        </div>
        <section v-else-if="!loading" class="empty-library">
          <i class="pi pi-sitemap" aria-hidden="true"/><h2>{{ term ? 'No matching clarifications' : 'A place for the next decision' }}</h2><p>{{ term ? 'Try another title or description.' : 'Ask your agent to publish a clarification through Ari’s MCP tools.' }}</p>
        </section>
      </div>
    </div>
    <Dialog id="delete-clarification-dialog" v-model:visible="deleteDialog" modal :dismissable-mask="!deleting" :header="deleteAll ? 'Delete all clarifications?' : 'Delete clarification?'" :closable="false" :close-on-escape="!deleting" :draggable="false" :style="{ width: 'min(480px, 94vw)' }" aria-describedby="delete-clarification-description" @after-hide="restoreDeleteFocus">
      <p v-if="deleteAll" id="delete-clarification-description">Delete all {{ deleteTargets.length }} clarifications in your library and all their revision history, including clarifications hidden by search? You can undo for 8 seconds from the notification.</p>
      <p v-else id="delete-clarification-description">Delete “{{ deleteTargets[0]?.title }}” and all its revision history? You can undo for 8 seconds from the notification.</p>
      <p v-if="deleteError" class="delete-error" role="alert">{{ deleteError }}</p>
      <template #footer>
        <Button :label="deleteError ? 'Close' : 'Cancel'" severity="secondary" outlined :autofocus="!focusDeleteConfirmation || !!deleteError" :disabled="deleting" @click="deleteDialog = false"/>
        <Button v-if="!deleteError" :label="deleteAll ? 'Delete all clarifications' : 'Delete clarification'" icon="pi pi-trash" severity="danger" :autofocus="focusDeleteConfirmation" :loading="deleting" :disabled="deleting" @click="deleteClarifications"/>
      </template>
    </Dialog>
  </main>
</template>

<style scoped>
.library{position:relative;display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;overflow:hidden;background-image:radial-gradient(ellipse at 85% 5%,#e6b85c1f,transparent 60%);background-size:100% 450px;background-repeat:no-repeat;background-position:0 calc(-1 * var(--overview-scroll,0px))}
.library-content{width:100%;padding-inline:24px}
.library-intro{padding-top:28px}
.library-toolbar{padding-bottom:6px}
.library-scroll{position:relative;flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scroll-padding-block:24px}
.library-card-content{padding-top:6px;padding-bottom:32px}
.page-intro{margin-bottom:20px}
.page-intro .eyebrow{font-size:11.1px;line-height:1.6;margin-bottom:8px}
.page-intro h1{font-size:36px;font-weight:700;line-height:1.15;letter-spacing:-.035em}
.page-intro h1 span{color:var(--muted)}
.lede{margin-top:12px;color:var(--muted);font-size:15px;line-height:1.65}
.search{display:flex;align-items:center;gap:12px;padding:12px 16px;margin-bottom:12px;border:1px solid var(--accent-line);border-radius:8px;color:var(--muted);background:#1b1d1ff5}
.search:focus-within{border-color:var(--accent);background:var(--soft)}
.search .pi{font-size:15px}
.search input{min-width:0;width:100%;padding:1px 2px;border:0;outline:0;background:transparent;color:var(--text);font-size:13px;line-height:normal}
.search input::placeholder{color:var(--muted);opacity:1}
.search kbd{display:block;min-width:auto;padding:2px 6px;font-size:11.25px;line-height:normal;white-space:nowrap}
.library-results{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:32px;margin-bottom:8px}
.clarity-card-wrap{position:relative;display:flex;min-width:0}
.delete-clarification{position:absolute;top:10px;right:10px;display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:6px;background:var(--raised);color:var(--muted)}
.delete-clarification:hover{background:var(--soft);color:var(--danger)}
.delete-clarification .pi{font-size:15px}
.delete-clarification:focus-visible{outline:none;background:var(--raised);color:var(--text)}
.delete-error{color:var(--danger);margin-top:16px;overflow-wrap:anywhere}
.result-count{font-size:12.75px;color:var(--muted);line-height:1.65}
.card-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}
.clarity-card{position:relative;display:flex;flex-direction:column;align-items:stretch;min-width:0;width:100%;padding:0;overflow:hidden;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--text);text-align:left;box-shadow:0 1px 0 #ffffff05}
.clarity-card:hover{border-color:var(--accent)}
.clarity-card:focus-visible{background:#333638;outline:none}
.clarity-card:focus-visible::after{content:'';position:absolute;inset:-1px;border:2px solid var(--accent);border-radius:inherit;pointer-events:none;z-index:2}
.card-body{padding:22px;flex:1}
.card-body h2{font-size:17px;font-weight:500;line-height:1.3;letter-spacing:-.3px;margin-bottom:9px;overflow-wrap:anywhere}
.card-body p{font-size:12px;line-height:1.6;color:var(--muted);margin:0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;min-height:38px;white-space:pre-wrap;overflow-wrap:anywhere}
.card-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 22px;border-top:1px solid var(--line);background:#1b1d1f;color:var(--muted);font-size:11px;line-height:1.4}
.card-footer .pi{color:var(--text);font-size:12px;flex-shrink:0}
.clarity-card:focus-visible .card-footer .pi{color:var(--accent)}
.empty-library{display:flex;flex-direction:column;align-items:center;text-align:center;padding:60px 24px;border:1px dashed var(--line);border-radius:10px;background:color-mix(in srgb,var(--soft) 20%,transparent);color:var(--muted)}
.empty-library>.pi{font-size:30px;color:var(--accent)}
.empty-library h2{margin:20px 0 10px;font-size:20.25px;color:var(--text)}
.empty-library p{max-width:600px;margin:12px auto;font-size:15px}
@media(max-width:1050px){.card-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:700px){.library-content{padding-inline:16px}.library-intro{padding-top:20px}.library-toolbar{position:sticky;top:0;z-index:5;padding-top:12px;background:#101113}.library-toolbar.is-stuck{box-shadow:0 6px 10px -6px #0009}.library-scroll{scroll-padding-top:124px}.page-intro{margin-bottom:4px}.page-intro h1{font-size:30px}}
@media(max-width:650px){.card-grid{grid-template-columns:minmax(0,1fr)}}
@media(forced-colors:active){.library{background-image:none}.clarity-card:focus-visible::after{border-color:Highlight}}
</style>
