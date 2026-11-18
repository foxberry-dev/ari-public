<script setup lang="ts">
import { computed, ref, watch } from 'vue';
const props = defineProps<{ url: string }>();
const index = ref(0);
const sources = computed(() => ['/favicon.ico', '/favicon.svg', '/assets/favicon.svg'].map(path => new URL(path, props.url).href));
watch(() => props.url, () => { index.value = 0; });
</script>
<template>
  <span class="reference-favicon" aria-hidden="true"><img v-if="index < sources.length" :src="sources[index]" alt="" width="16" height="16" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="index++"><svg v-else viewBox="0 0 24 24"><path d="M9 17H7A5 5 0 0 1 7 7h2m6 0h2a5 5 0 0 1 0 10h-2M8 12h8"/></svg></span>
</template>
<style scoped>
.reference-favicon{display:grid;place-items:center;width:16px;height:16px;flex-shrink:0}.reference-favicon img{display:block;width:16px;height:16px;object-fit:contain}.reference-favicon svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
</style>
