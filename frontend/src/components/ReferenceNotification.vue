<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';

const message = ref('');
const layer = ref<HTMLElement>();
watch(message, value => { if (value) layer.value?.showPopover(); else layer.value?.hidePopover(); }, { flush: 'post' });
const failed = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

function dismiss() {
  clearTimeout(timer);
  message.value = '';
}

async function copy(reference: string) {
  let error = false;
  try { await navigator.clipboard.writeText(reference); }
  catch { error = true; }
  failed.value = error;
  message.value = error ? 'Could not copy reference. Clipboard access is unavailable or was denied.' : `Copied ${reference}`;
  clearTimeout(timer);
  timer = setTimeout(dismiss, error ? 5000 : 3000);
}

onBeforeUnmount(() => clearTimeout(timer));
defineExpose({ copy });
</script>

<template>
  <div ref="layer" popover="manual" class="reference-notifications" role="status" aria-live="polite" aria-atomic="true">
    <div class="reference-notification" :class="{ 'notification-error': failed }" :hidden="!message">
      <svg class="notification-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="failed ? 'm6 6 12 12M6 18 18 6' : 'm5 12 4 4L19 6'" /></svg>
      <p>{{ message }}</p>
      <button class="notification-close" type="button" aria-label="Close" @click="dismiss"><svg class="notification-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
    </div>
  </div>
</template>

<style scoped>
.reference-notifications { margin:0; padding:0; border:0; background:transparent; left:auto; bottom:auto; pointer-events:none; position: fixed; top: 24px; right: 24px; z-index: 10; width: min(380px, calc(100vw - 32px)); }
.reference-notification { pointer-events:auto; display: flex; align-items: center; gap: 14px; margin: 0; padding: 14px 16px; border: 1px solid var(--success); border-radius: 9px; background: #173b32; color: var(--success); box-shadow: 0 8px 32px #0005; font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }
.reference-notification p { flex: 1; min-width: 0; margin: 0; }
.notification-icon { width: 16px; height: 16px; flex-shrink: 0; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.notification-close { display: grid; place-items: center; flex-shrink: 0; width: 20px; height: 20px; padding: 0; border: 0; background: transparent; color: inherit; }
.notification-close:focus-visible { background: var(--focus-surface); color: var(--text); }
.notification-error { border-color: var(--danger); background: #40232e; color: var(--danger); }
.reference-notification[hidden] { display: none; opacity: 0; }
@media (max-width: 700px) { .reference-notifications { top: 16px; right: 16px; } }
@media (prefers-reduced-motion: no-preference) {
  .reference-notification { transition: opacity .15s ease, display .15s allow-discrete; }
  @starting-style { .reference-notification:not([hidden]) { opacity: 0; } }
}
</style>

