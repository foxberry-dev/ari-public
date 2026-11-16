<script setup lang="ts">
import { nextTick, ref } from 'vue';

const props = defineProps<{ url: string; filename: string }>();
const menu = ref<HTMLElement>(), trigger = ref<HTMLButtonElement>();
const open = ref(false), busy = ref(false), error = ref('');
async function toggle() {
  const element = menu.value!, bounds = trigger.value!.parentElement!.getBoundingClientRect();
  element.style.setProperty('--menu-right', `${innerWidth - bounds.right}px`);
  element.style.setProperty('--menu-bottom', `${innerHeight - bounds.top + 6}px`);
  element.style.width = `${bounds.width}px`;
  element.togglePopover();
  error.value = '';
  await nextTick();
  if (element.matches(':popover-open')) element.querySelector<HTMLButtonElement>('button')?.focus();
}
function state(event: Event) {
  open.value = (event as ToggleEvent).newState === 'open';
}
function keyboard(event: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const buttons = [...menu.value!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
}
async function download(format: string) {
  if (busy.value) return;
  const urlAtStart = props.url, filenameAtStart = props.filename;
  busy.value = true; error.value = '';
  try {
    const response = await fetch(`${urlAtStart}&format=${format}`);
    if (!response.ok) { const problem = await response.json().catch(() => null); throw new Error(problem?.error || `Graph export failed (${response.status})`); }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = `${filenameAtStart}.${format}`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    menu.value?.hidePopover();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'The graph could not be exported.'; }
  finally { busy.value = false; }
}
</script>
<template>
  <button ref="trigger" aria-label="Export graph" title="Export graph" aria-haspopup="menu" :aria-expanded="open" @click="toggle"><i class="pi pi-download" aria-hidden="true"/></button>
  <div ref="menu" popover="auto" class="export-menu" data-graph-export-menu role="menu" aria-label="Export graph" :aria-busy="busy" @toggle="state" @keydown="keyboard">
    <button v-for="format in ['svg', 'png', 'pdf']" :key="format" role="menuitem" :disabled="busy" @click="download(format)"><span>{{ format.toUpperCase() }}</span><small>{{ format === 'svg' ? 'Vector image' : format === 'png' ? 'Image' : 'Document' }}</small></button>
    <p v-if="error" class="export-error" role="alert">{{ error }}</p>
  </div>
</template>
<style scoped>
.export-menu{position:fixed;inset:auto var(--menu-right) var(--menu-bottom) auto;margin:0;max-width:calc(100vw - 32px);max-height:calc(100dvh - 100px);overflow:auto;padding:6px;border:1px solid var(--line);border-radius:8px;background:var(--surface);box-shadow:0 6px 24px #0003;color:var(--text)}
.export-menu button{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:36px;padding:8px 10px;border:0;border-radius:4px;background:transparent;color:var(--text);text-align:left;font-size:.82rem}
.export-menu button:hover,.export-menu button:focus-visible{background:var(--soft);outline:none}
.export-menu small{color:var(--muted);font-size:.72rem}.export-menu button:disabled{opacity:.5;cursor:default}
.export-error{margin:6px 10px;font-size:.78rem;line-height:1.4;overflow-wrap:anywhere;color:var(--danger)}
</style>
