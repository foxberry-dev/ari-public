<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { optionText, unselectedAlternatives, type GraphNode } from '../model';
const props = defineProps<{ node: GraphNode; anchor: HTMLElement; compact: boolean; maxHeight: number }>();
const emit = defineEmits<{ close: []; resize: [size: { width: number; height: number; overlap: number }] }>();
const panel = ref<HTMLDialogElement>();
const options = computed(() => unselectedAlternatives(props.node));
let frame = 0;
let observer: ResizeObserver;
let animations: Animation[] = [];
function cancelAnimations() { for (const animation of animations) animation.cancel(); animations = []; }
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  const el = panel.value;
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) { emit('close'); return; }
  const style = getComputedStyle(el);
  const height = el.getBoundingClientRect().height;
  const opacity = style.opacity, transform = style.transform;
  const list = el.querySelector('ul')!;
  const listTransform = getComputedStyle(list).transform;
  cancelAnimations();
  el.classList.add('moving');
  if (props.compact) {
    animations = [el.animate([{ opacity, transform }, { opacity: 0, transform: 'translateY(100%)' }],
      { duration: 200, easing: 'ease-in-out', fill: 'forwards' })];
  } else {
    const timing = { duration: 200, easing: 'ease-in-out', fill: 'forwards' as FillMode };
    animations = [
      el.animate([{ height: `${height}px`, opacity }, { offset: .88, opacity: 1 }, { height: '0px', opacity: 0 }], timing),
      list.animate([{ transform: listTransform }, { transform: 'translateY(-100%)' }], timing),
    ];
  }
  void Promise.all(animations.map(animation => animation.finished)).then(() => emit('close'), () => {});
}
function measure() {
  const el = panel.value;
  if (!el?.open || closing) return;
  const style = getComputedStyle(el);
  const list = el.querySelector('ul')!;
  const naturalHeight = list.offsetHeight + (el.querySelector<HTMLElement>('.sheet-handle')?.offsetHeight || 0) + Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom) + Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
  emit('resize', { width: el.offsetWidth, height: Math.min(naturalHeight, Number.parseFloat(style.maxHeight)), overlap: 0 });
}
defineExpose({ close });
function position() {
  const el = panel.value;
  if (!el) return;
  const style = getComputedStyle(props.anchor);
  el.style.setProperty('--node-background', style.backgroundColor);
  if (props.compact) return;
  const anchor = props.anchor.getBoundingClientRect();
  el.style.width = `${anchor.width}px`;
  const scale = anchor.width / props.anchor.offsetWidth;
  const border = Number.parseFloat(style.borderBottomWidth) * scale;
  el.style.setProperty('--node-scale', String(scale));
  el.style.setProperty('--node-border', `${border}px`);
  el.style.setProperty('--node-border-color', style.borderBottomColor);
  el.style.setProperty('--node-border-style', style.borderBottomStyle);
  el.style.setProperty('--node-radius', `${Number.parseFloat(style.borderTopLeftRadius) * scale}px`);
  el.style.left = `${anchor.left}px`;
  el.style.top = `${anchor.bottom - Number.parseFloat(getComputedStyle(el).borderTopWidth)}px`;
}
function track() { position(); frame = requestAnimationFrame(track); }
async function openPanel() {
  await nextTick();
  const el = panel.value;
  if (!el || closing) return;
  if (el.open) el.close();
  cancelAnimations();
  el.style.left = ''; el.style.top = ''; el.style.width = '';
  for (const property of ['--node-background', '--node-scale', '--node-border', '--node-border-color', '--node-border-style', '--node-radius']) el.style.removeProperty(property);
  props.anchor.classList.toggle('options-open', !props.compact);
  if (props.compact) el.showModal(); else el.show();
  position();
  measure();
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.classList.add('moving');
    const timing = { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)' };
    if (props.compact) {
      animations = [el.animate([{ opacity: .4, transform: 'translateY(40px)' }, { opacity: 1, transform: 'translateY(0)' }], timing)];
    } else {
      const height = el.offsetHeight;
      animations = [
        el.animate([{ height: '0px', opacity: 0 }, { offset: .12, opacity: 1 }, { height: `${height}px`, opacity: 1 }], timing),
        el.querySelector('ul')!.animate([{ transform: 'translateY(-100%)' }, { transform: 'translateY(0)' }], timing),
      ];
    }
    void Promise.all(animations.map(animation => animation.finished)).then(() => { if (!closing) el.classList.remove('moving'); }, () => {});
  }
}
let swipe: { x: number; y: number; offset: number; active: boolean } | undefined;
function restoreSheet() {
  const el = panel.value;
  if (!el || closing) return;
  const transform = getComputedStyle(el).transform;
  cancelAnimations();
  el.style.transform = '';
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    animations = [el.animate([{ transform }, { transform: 'translateY(0)' }], { duration: 160, easing: 'ease-out' })];
  }
}
function startSwipe(event: TouchEvent) {
  if (event.touches.length !== 1) { cancelSwipe(); return; }
  if (!props.compact || closing || (panel.value?.scrollTop || 0) > 0) return;
  const touch = event.touches[0];
  swipe = { x: touch.clientX, y: touch.clientY, offset: 0, active: false };
}
function moveSwipe(event: TouchEvent) {
  if (!swipe) return;
  if (event.touches.length !== 1) { cancelSwipe(); return; }
  const touch = event.touches[0], x = touch.clientX - swipe.x, y = touch.clientY - swipe.y;
  if (!swipe.active && (y < -6 || Math.abs(x) > Math.max(6, y))) { swipe = undefined; return; }
  if (!swipe.active && y <= 6) return;
  if (event.cancelable) event.preventDefault();
  if (!swipe.active) { cancelAnimations(); panel.value?.classList.remove('moving'); }
  swipe.active = true;
  swipe.offset = Math.max(0, y);
  if (panel.value) panel.value.style.transform = `translateY(${swipe.offset}px)`;
}
function endSwipe() {
  const gesture = swipe; swipe = undefined;
  if (!gesture?.active) return;
  if (gesture.offset >= 48) close(); else restoreSheet();
}
function cancelSwipe() {
  const active = swipe?.active; swipe = undefined;
  if (active) restoreSheet();
}
function backdropClick(event: MouseEvent) {
  if (!props.compact || !panel.value) return;
  const rect = panel.value.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
}
function outside(event: PointerEvent) {
  if (props.compact) return;
  const target = event.target as Element;
  if (!panel.value?.contains(target) && !target.closest('.show-node-details')) close();
}
watch(() => props.compact, openPanel);
watch(() => props.node.id, async () => { await nextTick(); position(); });
onMounted(() => {
  void openPanel();
  observer = new ResizeObserver(measure);
  observer.observe(panel.value!.querySelector('ul')!);
  frame = requestAnimationFrame(track);
  document.addEventListener('pointerdown', outside, true);
});
onUnmounted(() => { cancelAnimations(); props.anchor.classList.remove('options-open'); observer?.disconnect(); cancelAnimationFrame(frame); document.removeEventListener('pointerdown', outside, true); panel.value?.close(); });
</script>
<template>
  <Teleport to="body">
    <dialog ref="panel" class="node-options" tabindex="-1" :class="{ sheet: compact }" aria-label="Other node options" :aria-modal="compact ? true : undefined" :style="{ maxHeight: `${maxHeight}px` }" @cancel.prevent="close" @click.self="backdropClick" @pointerdown.stop @wheel.stop @touchstart.passive="startSwipe" @touchmove="moveSwipe" @touchend="endSwipe" @touchcancel="cancelSwipe">
      <button class="sheet-handle" type="button" aria-label="Close node options" @click="close"/>
      <ul aria-label="Unchosen options"><li v-for="option in options" :key="option.label">{{ optionText(node, option) }}</li></ul>
    </dialog>
  </Teleport>
</template>
<style scoped>
.node-options{position:fixed;inset:auto;margin:0;outline:none;z-index:80;width:min(340px,calc(100vw - 32px));padding:0;border:var(--node-border,1px) var(--node-border-style,solid) var(--node-border-color,#414441);border-top-width:0;border-radius:0 0 var(--node-radius,11px) var(--node-radius,11px);background:var(--node-background,#1d1f21);color:var(--text);box-shadow:0 18px 32px #0006,inset 0 10px 14px -6px #0009;overflow:auto;overscroll-behavior:contain}
.node-options.moving{overflow:hidden}
.node-options ul{list-style:none;margin:0;padding:0}
.node-options li{font-size:calc(11px * var(--node-scale,1));line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;color:#c7cbc2;padding:calc(10px * var(--node-scale,1));border-bottom:1px solid #35383a}
.node-options li:last-child{border:0}
.sheet-handle{display:none}.node-options::backdrop{background:#0009}
.node-options.sheet{inset:auto 0 0!important;width:100%;max-width:none;max-height:80dvh!important;border-top-width:1px;border-bottom-width:0;border-radius:20px 20px 0 0;padding:0 0 env(safe-area-inset-bottom);box-shadow:0 -12px 48px #0006}
.sheet .sheet-handle{display:block;position:relative;width:72px;height:16px;margin:0 auto;padding:0;border:0;background:transparent;touch-action:none}
.sheet .sheet-handle::before{content:"";position:absolute;top:6px;left:18px;width:36px;height:4px;border-radius:4px;background:#60645d}
.sheet .sheet-handle::after{content:"";position:absolute;inset:-5px -8px}
.sheet .sheet-handle:focus-visible{outline:none}.sheet .sheet-handle:hover::before,.sheet .sheet-handle:focus-visible::before{background:var(--accent)}
.sheet li{font-size:14px;padding:12px}
</style>
