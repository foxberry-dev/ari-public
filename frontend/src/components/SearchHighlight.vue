<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ text: string; query?: string }>();
const parts = computed(() => {
  const term = props.query?.trim().toLocaleLowerCase();
  if (!term) return [{ text: props.text, match: false }];
  const value = props.text.toLocaleLowerCase();
  const result: { text: string; match: boolean }[] = [];
  let start = 0, found = value.indexOf(term);
  while (found !== -1) {
    if (found > start) result.push({ text: props.text.slice(start, found), match: false });
    result.push({ text: props.text.slice(found, found + term.length), match: true });
    start = found + term.length;
    found = value.indexOf(term, start);
  }
  if (start < props.text.length) result.push({ text: props.text.slice(start), match: false });
  return result;
});
</script>

<template>
  <template v-for="(part, index) in parts" :key="index"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template>
</template>

<style scoped>
mark{background:#e6b85c;color:#17191b;border-radius:2px}
</style>
