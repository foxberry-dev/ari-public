<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { selectionShortcutOptions, type SelectionContext } from '../selection-shortcuts';
const props = defineProps<{ context: SelectionContext }>();
const emit = defineEmits<{ copy: [prompt: string, onCopied: () => void, label: string] }>();
const trigger = ref<HTMLButtonElement>(), menu = ref<HTMLElement>();
const open = ref(false);
const actions = computed(() => selectionShortcutOptions(props.context));
function close(restoreFocus = true) {
  menu.value?.hidePopover();
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
}
async function toggle() {
  if (!props.context.selected.length || !menu.value || !trigger.value) return false;
  if (menu.value.matches(':popover-open')) { close(); return true; }
  const bounds = trigger.value.getBoundingClientRect();
  const width = Math.min(340, innerWidth - 24);
  const left = Math.max(12, Math.min(innerWidth - width - 12, bounds.left));
  const above = bounds.top - 20, below = innerHeight - bounds.bottom - 20;
  const useAbove = above >= 180 || above >= below;
  Object.assign(menu.value.style, { width: `${width}px`, left: `${left}px`,
    top: useAbove ? 'auto' : `${bounds.bottom + 8}px`, bottom: useAbove ? `${innerHeight - bounds.top + 8}px` : 'auto',
    maxHeight: `${Math.max(96, useAbove ? above : below)}px` });
  menu.value.showPopover();
  await nextTick();
  menu.value.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  return true;
}
function handleKey(event: KeyboardEvent) {
  if (!menu.value?.matches(':popover-open') || event.isComposing) return false;
  if (event.key === '.' && event.repeat) { event.preventDefault(); event.stopImmediatePropagation(); return true; }
  if (event.key === 'Tab') { close(false); return false; }
  const exit = event.key === 'Escape' || event.ctrlKey && event.key === '[' || event.key === '.';
  if (!exit && (event.ctrlKey || event.metaKey || event.altKey)) return false;
  const buttons = [...menu.value.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (exit) close();
  else if (['ArrowDown', 'ArrowUp', 'j', 'k', 'Home', 'End'].includes(event.key)) {
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
      (index + (event.key === 'ArrowUp' || event.key === 'k' ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  } else if (/^[1-6]$/.test(event.key)) {
    if (!event.repeat) menu.value.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[Number(event.key) - 1]?.click();
  } else if (event.key === 'Enter' || event.key === ' ') (buttons[index] || buttons[0])?.click();
  else if (event.key.length === 1) buttons.find(button => button.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()))?.focus();
  else if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return false;
  event.preventDefault(); event.stopImmediatePropagation(); return true;
}
defineExpose({ toggle, handleKey });
</script>
<template>
  <button ref="trigger" class="selection-shortcuts-trigger" aria-label="Selection shortcuts" aria-haspopup="menu" aria-controls="selection-shortcuts" :aria-expanded="open" :disabled="!context.selected.length" @click="toggle"><i class="pi pi-bolt" aria-hidden="true"/><span>Shortcuts</span></button>
  <div id="selection-shortcuts" ref="menu" popover="auto" class="selection-shortcuts-menu" data-selection-shortcuts role="menu" aria-label="Selection shortcuts" @toggle="open = ($event as ToggleEvent).newState === 'open'">
    <button v-for="(action, index) in actions" :key="action.id" role="menuitem" :aria-keyshortcuts="String(index + 1)" :disabled="!action.count" @click="action.prompt && emit('copy', action.prompt, () => close(false), action.label)">
      <span class="shortcut-key" aria-hidden="true">{{ index + 1 }}</span>
      <span class="action-copy"><span class="action-label"><span>{{ action.label }}</span><small class="shortcut-count">{{ action.count }}</small></span>
      <span class="action-description">{{ action.description }}</span></span>
    </button>
  </div>
</template>
<style scoped>
.selection-shortcuts-trigger{display:flex;align-items:center;justify-content:center;gap:8px;min-height:36px;padding:8px 12px;border:0;border-radius:999px;background:#2a2d30;font-size:13px;color:var(--text);white-space:nowrap}
.selection-shortcuts-trigger:hover,.selection-shortcuts-trigger:focus-visible,.selection-shortcuts-trigger[aria-expanded="true"]{outline:none;background:#35383b;color:var(--accent)}
.selection-shortcuts-trigger:disabled{opacity:.4;cursor:default}
.selection-shortcuts-menu{position:fixed;inset:auto;margin:0;padding:6px;overflow:auto;overscroll-behavior:contain;border:1px solid var(--line);border-radius:10px;background:#202224;color:var(--text);box-shadow:0 12px 36px #0006}
.selection-shortcuts-menu button{display:flex;align-items:center;gap:10px;min-height:54px;width:100%;padding:9px 10px;text-align:left;border:0;border-radius:6px;background:transparent;color:var(--text);white-space:normal;line-height:1.4}
.selection-shortcuts-menu button+button{margin-top:4px}
.shortcut-key{display:grid;place-items:center;flex-shrink:0;width:22px;height:22px;border:1px solid #586056;border-radius:50%;font:11px ui-monospace,monospace;color:var(--accent)}
.action-copy{flex:1;min-width:0}
.selection-shortcuts-menu button:hover:not(:disabled),.selection-shortcuts-menu button:focus-visible{outline:none;background:#35383b}
.selection-shortcuts-menu button:disabled{opacity:.4;cursor:default}
.action-label{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px}.shortcut-count{color:var(--accent);font:11px ui-monospace,monospace}.action-description{display:block;margin-top:3px;font-size:11px;color:var(--muted)}
@media(max-width:1100px){.selection-shortcuts-trigger>span{display:none}}
@media(max-width:700px){.selection-shortcuts-trigger{min-height:30px;padding:6px 8px;font-size:12px;gap:5px}}
</style>
