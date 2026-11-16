<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { api } from '../api';

const emit = defineEmits<{ changed: [] }>();
type Receipt = { token: string; expiresAt: number };
type Notice = { id: number; receipt: Receipt; title: string; detail: string; busy: boolean; error: boolean; undo: boolean; timer: ReturnType<typeof setTimeout> };
const notices = ref<Notice[]>([]);
let nextId = 0;

function close(id: number) {
  const notice = notices.value.find(item => item.id === id);
  if (notice?.busy) return;
  clearTimeout(notice?.timer);
  notices.value = notices.value.filter(item => item.id !== id);
}

function deleted(receipt: Receipt, titles: string[]) {
  const id = nextId++;
  notices.value.push({ id, receipt, title: titles.length === 1 ? 'Clarification deleted' : 'Clarifications deleted',
    detail: titles.length === 1 ? titles[0]! : `${titles.length} clarifications`, busy: false, error: false, undo: true,
    timer: setTimeout(() => close(id), Math.max(0, receipt.expiresAt - Date.now())) });
}

async function undo(notice: Notice) {
  if (notice.busy || !notice.undo) return;
  notice.busy = true;
  notice.undo = false;
  clearTimeout(notice.timer);
  try {
    await api(`/deletions/${encodeURIComponent(notice.receipt.token)}/restore`, { method: 'POST' });
    notice.title = notice.title.replace('deleted', 'restored');
  } catch (cause) {
    notice.error = true;
    notice.title = 'Undo failed';
    notice.detail = `${(cause as Error).message}. Check the library before trying again.`;
  } finally {
    notice.busy = false;
    emit('changed');
    notice.timer = setTimeout(() => close(notice.id), notice.error ? 6000 : 3000);
  }
}

onBeforeUnmount(() => notices.value.forEach(item => clearTimeout(item.timer)));
defineExpose({ deleted });
</script>

<template>
  <div class="deletion-notifications" aria-live="polite">
    <div v-for="notice in notices" :key="notice.id" class="deletion-notification" :class="{ failed: notice.error }" role="status">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="notice.error ? 'm6 6 12 12M6 18 18 6' : 'm5 12 4 4L19 6'"/></svg>
      <div class="notification-text"><strong>{{ notice.title }}</strong><p>{{ notice.detail }}</p></div>
      <button v-if="notice.undo" class="undo" :disabled="notice.busy" @click="undo(notice)"><i class="pi pi-undo" aria-hidden="true"/>Undo</button>
      <button class="close" aria-label="Close notification" :disabled="notice.busy" @click="close(notice.id)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button>
    </div>
  </div>
</template>

<style scoped>
.deletion-notifications{position:fixed;top:24px;right:24px;z-index:1200;width:min(380px,calc(100vw - 32px));display:grid;gap:12px;pointer-events:none}
.deletion-notification{display:flex;align-items:center;gap:14px;padding:14px 16px;border:1px solid var(--success);border-radius:9px;background:#173b32;color:var(--success);box-shadow:0 8px 32px #0005;font-size:13px;pointer-events:auto}
.notification-text{min-width:0;flex:1;overflow-wrap:anywhere}.notification-text strong{font-weight:600}.notification-text p{margin-top:4px}
svg{width:16px;height:16px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
button{color:inherit;border:0;flex-shrink:0}button:focus-visible{outline:none;background:var(--raised);color:var(--text)}.undo{display:flex;align-items:center;gap:6px;padding:6px}.close{display:grid;place-items:center;width:20px;height:20px;padding:0}.failed{border-color:var(--danger);background:#40232e;color:var(--danger)}
@media(max-width:700px){.deletion-notifications{top:16px;right:16px}}
</style>
