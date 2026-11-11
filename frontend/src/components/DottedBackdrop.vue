<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

const field = ref<HTMLElement>();
function alignDots() {
  const element = field.value!;
  const width = Math.max(1, element.clientWidth - 12);
  const height = Math.max(1, element.clientHeight - 12);
  element.style.setProperty('--dot-step-x', `${width / Math.max(1, Math.round(width / 18))}px`);
  element.style.setProperty('--dot-step-y', `${height / Math.max(1, Math.round(height / 18))}px`);
}
onMounted(() => { alignDots(); window.addEventListener('resize', alignDots); });
onUnmounted(() => window.removeEventListener('resize', alignDots));
</script>

<template><div ref="field" class="dotted-backdrop" aria-hidden="true"/></template>

<style scoped>
.dotted-backdrop{position:fixed;inset:0;z-index:-1;pointer-events:none;background-color:#101113;background-image:radial-gradient(circle at 1px 1px,#ffffff1c .7px,transparent .9px);background-size:var(--dot-step-x,18px) var(--dot-step-y,18px);background-position:5px 5px}
@media(forced-colors:active){.dotted-backdrop{display:none}}
</style>
