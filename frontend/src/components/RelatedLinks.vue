<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import LinkFavicon from './LinkFavicon.vue';
import type { RelatedLink } from '../model';
const props = defineProps<{ links?: RelatedLink[]; hidden?: boolean }>();
const trigger = ref<HTMLButtonElement>(), panel = ref<HTMLElement>(), open = ref(false);
const references = computed(() => (props.links ?? []).flatMap(link => {
  if (!/^https?:\/\/[^/]/i.test(link.url) || /[\s\u0000-\u001f\u007f-\u009f\\]/u.test(link.url)) return [];
  try { const url = new URL(link.url); return url.hostname && !url.username && !url.password ? [{ ...link, url: url.href, hostname: url.hostname }] : []; } catch { return []; }
}));
watch([() => JSON.stringify(props.links ?? []), () => props.hidden], () => panel.value?.hidePopover());
async function toggle() {
  if (!references.value.length || props.hidden) return;
  const bounds = trigger.value!.getBoundingClientRect();
  panel.value!.style.top = `${bounds.bottom + 8}px`;
  panel.value!.style.right = `${Math.max(8, innerWidth - bounds.right)}px`;
  panel.value!.style.setProperty('--tip-right', `${bounds.width / 2}px`);
  panel.value!.togglePopover();
  await nextTick();
  if (panel.value!.matches(':popover-open')) panel.value!.querySelector('a')?.focus({ preventScroll: true });
}
function handleKey(event: KeyboardEvent): boolean {
  if (!panel.value?.matches(':popover-open')) return false;
  event.stopImmediatePropagation();
  const links = [...panel.value.querySelectorAll<HTMLAnchorElement>('a')];
  const index = links.indexOf(document.activeElement as HTMLAnchorElement);
  if (event.key === 'Escape' || event.ctrlKey && event.key === '[') {
    event.preventDefault(); panel.value.hidePopover(); trigger.value?.focus();
  } else if (!event.ctrlKey && !event.metaKey && !event.altKey && ['j', 'k', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault();
    const delta = ['j', 'ArrowDown'].includes(event.key) ? 1 : -1;
    links[(index + delta + links.length) % links.length]?.focus();
  } else if (event.key === 'Enter' && !event.altKey) {
    event.preventDefault();
    const link = links[index] ?? links[0];
    if (link && !event.repeat) {
      panel.value.hidePopover(); trigger.value?.focus();
      if (event.ctrlKey || event.metaKey) window.open(link.href, '_blank', 'noopener,noreferrer');
      else window.location.assign(link.href);
    }
  }
  return true;
}
defineExpose({ toggle, handleKey });
</script>
<template>
  <template v-if="references.length">
    <button ref="trigger" class="related-links-trigger" aria-label="Related links" title="Related links" aria-haspopup="dialog" aria-controls="related-links" :aria-expanded="open" @click="toggle"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/></svg><span>Links · {{ references.length }}</span></button>
    <div id="related-links" ref="panel" popover data-related-links class="related-links-popover" role="dialog" aria-label="Related links" @toggle="open = ($event as ToggleEvent).newState === 'open'">
      <ul><li v-for="(link, index) in references" :key="index"><a :href="link.url" rel="noopener noreferrer" :title="link.url" @click="panel?.hidePopover()"><LinkFavicon :url="link.url"/><span class="reference-text"><span>{{ link.label }}</span><small>{{ link.hostname }}</small></span><svg class="external-link" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7m0-7L10 14M10 3H4v17h17v-6"/></svg></a></li></ul>
    </div>
  </template>
</template>
<style scoped>
.related-links-trigger{display:flex;align-items:center;gap:7px;flex-shrink:0;white-space:nowrap;height:32px;border:1px solid var(--line);border-radius:6px;padding:6px 9px;color:var(--muted);font-size:11.7px;line-height:18px}.related-links-trigger svg,.external-link{width:14px;height:14px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}.related-links-trigger:hover,.related-links-trigger[aria-expanded="true"]{background:var(--soft);color:var(--text)}
.related-links-popover{position:fixed;inset:auto;margin:0;width:min(340px,calc(100vw - 16px));padding:4px;background:var(--surface);color:var(--text);border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 28px #0002;overflow:visible}.related-links-popover:before{content:'';position:absolute;top:-5px;right:calc(var(--tip-right) - 5px);width:8px;height:8px;background:var(--surface);border-left:1px solid var(--line);border-top:1px solid var(--line);transform:rotate(45deg)}ul{list-style:none;margin:0;padding:0;max-height:min(420px,65dvh);overflow:auto}a{display:flex;align-items:center;gap:10px;padding:8px;border-radius:5px;color:var(--text);text-decoration:none}a:hover{background:var(--soft)}.reference-text{display:flex;flex:1;flex-direction:column;gap:2px;min-width:0;overflow-wrap:anywhere;font-size:13.2px;line-height:1.4}.reference-text small,.external-link{color:var(--muted);font-size:11.25px}
@media(max-width:1100px){.related-links-trigger{width:32px;padding:8px;justify-content:center}.related-links-trigger>span{display:none}}
.related-links-popover a:hover,.related-links-popover a:focus{background:var(--raised);color:var(--text);outline:none;box-shadow:none;text-decoration:none}
.related-links-trigger:focus-visible{outline:none;box-shadow:none;background:var(--raised);color:var(--text)}
</style>
