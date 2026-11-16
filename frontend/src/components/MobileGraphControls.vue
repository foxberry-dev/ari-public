<script setup lang="ts">
import { nextTick, ref } from 'vue';
import type { GraphView } from '../relationships';
import ChangeLegend from './ChangeLegend.vue';

const view = defineModel<GraphView>('view', { required: true });
const changed = defineModel<boolean>('changed', { required: true });
const showInputs = defineModel<boolean>('showInputs', { required: true });
const showConstraints = defineModel<boolean>('showConstraints', { required: true });
const track = defineModel<boolean>('track', { required: true });
const viewNames: Record<GraphView, string> = { hierarchy: 'Tree', islands: 'Grouped', rings: 'Radial' };
const panel = ref<HTMLElement>(), trigger = ref<HTMLButtonElement>();
const open = ref(false);
async function toggle() {
  const bounds = trigger.value!.getBoundingClientRect();
  panel.value!.style.top = `${bounds.bottom + 8}px`;
  panel.value!.style.right = `${innerWidth - bounds.right}px`;
  panel.value!.style.maxHeight = `${innerHeight - bounds.bottom - 20}px`;
  panel.value!.togglePopover();
  await nextTick();
  if (panel.value!.matches(':popover-open')) panel.value!.querySelector<HTMLButtonElement>('button')?.focus();
}
function close() { panel.value?.hidePopover(); trigger.value?.focus(); }
</script>

<template>
  <div class="compact-controls">
    <div class="compact-layout"><select v-model="view" aria-label="Graph layout"><option v-for="(name, value) in viewNames" :key="value" :value="value">{{ name }}</option></select><span class="compact-layout-value" aria-hidden="true">{{ viewNames[view] }}</span><svg class="layout-arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg></div>
    <div class="view-toggle" aria-label="Graph display"><button :class="{ active: !changed }" :aria-pressed="!changed" @click="changed = false">Current</button><button :class="{ active: changed }" :aria-pressed="changed" @click="changed = true">Changed</button></div>
    <button ref="trigger" class="graph-options-trigger" aria-label="Graph options and color key" aria-haspopup="dialog" aria-controls="graph-options" :aria-expanded="open" @click="toggle"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14"/><circle cx="7" cy="5" r="2"/><circle cx="13" cy="10" r="2"/><circle cx="8" cy="15" r="2"/></svg></button>
    <div id="graph-options" ref="panel" popover data-graph-options role="dialog" aria-label="Graph controls" class="graph-options" @toggle="open = ($event as ToggleEvent).newState === 'open'">
      <header><strong>Graph controls</strong><button aria-label="Close graph controls" @click="close">×</button></header>
      <div class="graph-filters"><label><input v-model="showInputs" type="checkbox" aria-label="Show inputs"><span>Inputs</span></label><label><input v-model="showConstraints" type="checkbox" aria-label="Show constraints"><span>Constraints</span></label><label><input v-model="track" type="checkbox"><span>Track new revisions</span></label></div>
      <ChangeLegend/>
    </div>
  </div>
</template>

<style scoped>
.compact-controls{display:flex;align-items:center;gap:8px;width:100%;height:44px;min-width:0}
.compact-layout{display:flex;align-items:center;position:relative;min-width:0;max-width:135px}.layout-arrow{position:absolute;right:5px;top:50%;width:14px;height:14px;transform:translateY(-50%);pointer-events:none;fill:none;stroke:#9ca591;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
select{appearance:none;width:100%;height:32px;padding:0 23px 0 9px;line-height:normal;background:#232622;border:1px solid #373c39;border-radius:6px;color:transparent;font-size:11px}
select:focus-visible{color:transparent}select option{color:#c7cebf;background:#232622}
.compact-layout-value{position:absolute;inset:1px 24px 1px 10px;display:flex;align-items:center;pointer-events:none;color:#c7cebf;font-size:11px;line-height:1;white-space:nowrap;overflow:hidden}.compact-layout:focus-within .compact-layout-value{color:var(--text)}
.view-toggle{margin-left:auto;height:32px;padding:2px;border-radius:6px;flex-shrink:0;gap:2px}.view-toggle button{padding:5px 7px;font-size:10px;border-radius:4px}
.graph-options-trigger{display:grid;place-items:center;width:32px;height:32px;flex-shrink:0;border:1px solid #373c39;border-radius:6px;color:#bdc4b4;padding:7px}.graph-options-trigger svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.6;stroke-linecap:round}.graph-options-trigger circle{fill:#202224}
.graph-options{position:fixed;inset:auto;margin:0;width:280px;max-width:calc(100vw - 20px);padding:16px;background:#242729;border:1px solid #464c45;border-radius:10px;box-shadow:0 14px 45px #0008;color:var(--text);overflow:auto}
.graph-options header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.graph-options strong{font-size:13px;font-weight:550}.graph-options header button{padding:0 5px;font-size:20px;border:0;color:#a8b09f}.graph-options header button:focus-visible{outline:none;color:var(--accent);background:transparent}
.graph-filters{display:flex;flex-direction:column;align-items:stretch;gap:10px;margin:9px 0 14px;padding-bottom:14px;border-bottom:1px solid #41473d;color:#b3bfaa;font-size:11px}.graph-filters label{display:flex;align-items:center;gap:8px;line-height:18px;cursor:pointer}.graph-filters input{accent-color:var(--accent);width:13px;height:13px;flex-shrink:0;margin:0;padding:0}
.graph-options :deep(.change-legend){display:grid;gap:10px;font-size:11px}
</style>
