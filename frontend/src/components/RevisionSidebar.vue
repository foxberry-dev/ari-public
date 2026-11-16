<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import { commitLabels, formatTime, type GraphCommit } from '../model';

const props = defineProps<{ commits: GraphCommit[]; index: number }>();
const emit = defineEmits<{ select: [index: number] }>();
const history = ref<HTMLElement>();
async function revealCurrent() {
  await nextTick();
  history.value?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
watch(() => props.index, revealCurrent);
onMounted(revealCurrent);
</script>

<template>
  <aside class="conversation-rail">
    <nav ref="history" aria-label="Conversation history">
      <button v-for="(entry, i) in commits" :key="entry.id" class="commit-entry" :class="{ selected: i === index, future: i > index }" :aria-current="i === index ? 'step' : undefined" :aria-label="`Revision ${i + 1} of ${commits.length}: ${entry.metadata.title}`" :title="`${formatTime(entry.at)} · ${entry.metadata.summary}`" @click="emit('select', i)">
        <span class="commit-dot" aria-hidden="true">{{ i === commits.length - 1 ? (i === index ? '■' : '□') : i === index ? '●' : i < index ? '✓' : '○' }}</span>
        <span class="commit-copy"><strong>{{ entry.metadata.title }}</strong><small><span class="commit-number">{{ i + 1 }}/{{ commits.length }}</span>{{ commitLabels[entry.metadata.kind] }}</small></span>
      </button>
    </nav>
  </aside>
</template>

<style scoped>
.conversation-rail{width:var(--revision-sidebar-width);flex-shrink:0;border-right:1px solid var(--line);background:var(--soft);display:flex;flex-direction:column;min-height:0}
nav{position:relative;flex:1;min-height:0;overflow:auto;padding:8px;isolation:isolate}
.commit-entry{position:relative;display:flex;align-items:flex-start;width:100%;min-height:56px;gap:10px;padding:8px;text-align:left;border:1px solid transparent;border-radius:8px;background:transparent;color:#a5a99e;transition:background .2s,color .2s}
.commit-entry:before{content:'';position:absolute;width:1px;left:15px;top:29px;bottom:-11px;background:#3a4239;z-index:-1}.commit-entry:last-child:before{display:none}
.commit-entry:hover,.commit-entry:focus-visible{outline:none;background:#272927;border-color:transparent;color:var(--text)}
.commit-entry.selected{background:#262724;border-color:transparent;box-shadow:inset 2px 0 var(--accent);border-radius:0 8px 8px 0;color:var(--text)}
.commit-dot{display:grid;place-items:center;flex-shrink:0;width:14px;height:20px;color:#7e897b;font-size:9px;position:relative}.selected .commit-dot{color:var(--accent)}
.commit-copy{min-width:0}.commit-entry strong{display:block;font-size:12px;font-weight:500;line-height:20px;overflow-wrap:anywhere}.selected strong{font-weight:600;color:#e5e4d8}
.commit-entry small{display:flex;align-items:center;gap:8px;margin-top:3px;font-size:10px;color:#8b9485}.commit-number{font:9px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;color:#7f877c;flex-shrink:0}
.commit-entry.future{color:#737c72}.future small{color:#626f61}.future .commit-dot{color:#666d65}
@media(prefers-reduced-motion:reduce){.commit-entry{transition:none}}
</style>
