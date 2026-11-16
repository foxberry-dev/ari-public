<script setup lang="ts">
import { ref } from 'vue';

const dialog = ref<HTMLDialogElement>();
const open = ref(false);
function toggle() {
  if (dialog.value?.open) dialog.value.close();
  else { dialog.value?.showModal(); open.value = true; }
}
defineExpose({ toggle });
</script>

<template>
  <button class="shortcut-help" aria-label="Keyboard shortcuts" aria-haspopup="dialog" aria-controls="shortcut-reference" :aria-expanded="open" title="Keyboard shortcuts (?)" @click="toggle"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 15h10"/></svg></button>
  <dialog id="shortcut-reference" ref="dialog" class="quick-reference" aria-labelledby="shortcut-title" @close="open = false" @click.self="dialog?.close()">
    <header class="dialog-head"><div><div class="kicker">Quick reference</div><h2 id="shortcut-title">Keyboard shortcuts</h2></div><button class="dialog-close" aria-label="Close shortcuts" @click="dialog?.close()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></header>
    <dl>
      <dt class="desktop-revision"><kbd>j</kbd> <kbd>k</kbd> / <kbd>↓</kbd> <kbd>↑</kbd></dt><dd class="desktop-revision">Next / previous revision from anywhere</dd>
      <dt class="mobile-revision"><kbd>h</kbd> <kbd>l</kbd> / <kbd>←</kbd> <kbd>→</kbd></dt><dd class="mobile-revision">Previous / next revision from anywhere</dd>
      <dt><kbd>gg</kbd> / <kbd>Home</kbd></dt><dd>First revision</dd>
      <dt><kbd>G</kbd> / <kbd>End</kbd></dt><dd>Last revision</dd>
      <dt><kbd>1</kbd> <kbd>10</kbd> …</dt><dd>Focus a node and its parent / children; ambiguous numbers wait 1 second</dd>
      <dt><kbd>yy</kbd></dt><dd>Copy the clarification reference</dd>
      <dt><kbd>u</kbd></dt><dd>Open links; j/k or ↓/↑ to move, Enter to open, Ctrl+Enter for a new tab</dd>
      <dt><kbd>[</kbd> <kbd>]</kbd></dt><dd>Previous / next graph layout</dd>
      <dt><kbd>f</kbd></dt><dd>Toggle fullscreen canvas; Escape restores controls</dd>
      <dt><kbd>i</kbd></dt><dd>Hide / show input relationships</dd>
      <dt><kbd>c</kbd></dt><dd>Switch Current / Changed</dd>
      <dt><kbd>s</kbd></dt><dd>Hide / show constraints</dd>
      <dt><kbd>Esc</kbd> / <kbd>Ctrl [</kbd></dt><dd>Back to overview; close dialogs</dd>
      <dt><kbd>?</kbd></dt><dd>Open / close this reference</dd>
      <dt class="desktop-revision"><kbd>←</kbd> <kbd>→</kbd></dt><dd class="desktop-revision">Pan when the graph is focused</dd>
      <dt><kbd>Shift h/j/k/l</kbd></dt><dd>Pan left/down/up/right from anywhere</dd>
      <dt><kbd>−</kbd> <kbd>=</kbd></dt><dd>Zoom out / in from anywhere</dd>
      <dt><kbd>0</kbd></dt><dd>Fit when the graph is focused</dd>
      <dt><kbd>Tab</kbd></dt><dd>Move between controls</dd>
    </dl>
    <form method="dialog" class="dialog-foot"><button autofocus>Done</button></form>
  </dialog>
</template>

<style scoped>
.shortcut-help{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:32px;min-height:32px;padding:7px;border-color:transparent;color:var(--muted)}
svg{width:16px;height:16px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.55;stroke-linecap:round;stroke-linejoin:round}
.shortcut-help:hover,.dialog-close:hover{background:var(--raised)}
.shortcut-help:focus-visible,.dialog-close:focus-visible{outline:none;background:#575757;color:var(--text)}
.quick-reference{--dialog-padding:20px;color:var(--text);background:var(--raised);border:1px solid var(--line);border-radius:13px;width:min(480px,calc(100vw - 32px));max-width:none;max-height:calc(100dvh - 32px);padding:0;box-shadow:0 28px 90px #0009}
.quick-reference::backdrop{background:#0008}
.dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:var(--dialog-padding);border-bottom:1px solid var(--line)}
.kicker{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
h2{font-size:19px;font-weight:550;letter-spacing:-.55px;line-height:1.2;margin:0}
.dialog-close{display:flex;align-items:center;justify-content:center;min-height:26px;width:26px;padding:5px;margin:0;color:var(--muted);border-color:transparent}
.dialog-close svg{width:14px;height:14px}
dl{display:grid;grid-template-columns:max-content 1fr;align-items:center;gap:8px 12px;margin:0;padding:var(--dialog-padding)}
dt{font-size:10px}dd{margin:0;color:var(--muted);font-size:12px}
kbd{font:10px/1 ui-monospace,SFMono-Regular,Consolas,monospace;display:inline-flex;align-items:center;justify-content:center;gap:4px;min-width:24px;height:23px;padding:0 6px;border:1px solid var(--line);border-bottom-width:2px;border-radius:4px;color:var(--text);background:var(--soft)}
.dialog-foot{margin:0;padding:var(--dialog-padding);border-top:1px solid var(--line);display:flex;justify-content:flex-end}
.dialog-foot button{background:var(--text);color:#000;font-size:13px;min-height:34px;padding:6px 10px}
.dialog-foot button:is(:hover,:focus-visible){outline:none;background:#fff;color:#000}
.mobile-revision{display:none}
@media(max-width:1100px){.desktop-revision{display:none}.mobile-revision{display:block}}
@media(max-width:1100px){.workspace-header .shortcut-help{display:none}}
</style>
