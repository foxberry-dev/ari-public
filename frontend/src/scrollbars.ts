export function installOverlayScrollbars() {
  const regions = new Map<HTMLElement, { update: () => void; dispose: () => void }>();
  let nextId = 0;
  let frame = 0;
  let disposed = false;
  const owned = (element: Node) => element instanceof Element && !!element.closest('.overlay-scrollbar');
  const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(refresh); };

  function install(viewport: HTMLElement) {
    const page = viewport === document.documentElement;
    const host = page ? document.body : viewport.parentElement;
    if (!host) return;
    if (!viewport.id) {
      do { nextId++; } while (document.getElementById(`scroll-region-${nextId}`));
      viewport.id = `scroll-region-${nextId}`;
    }
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const axes = [
      { name: 'y', size: 'height', client: 'clientHeight', extent: 'scrollHeight', position: 'scrollTop', coordinate: 'clientY', edge: 'top', previous: 'ArrowUp', next: 'ArrowDown' },
      { name: 'x', size: 'width', client: 'clientWidth', extent: 'scrollWidth', position: 'scrollLeft', coordinate: 'clientX', edge: 'left', previous: 'ArrowLeft', next: 'ArrowRight' },
    ] as const;
    const tracks = axes.map(axis => {
      const track = document.createElement('div');
      track.className = 'overlay-scrollbar'; track.hidden = true; track.tabIndex = 0;
      track.setAttribute('role', 'scrollbar'); track.setAttribute('aria-controls', viewport.id);
      track.setAttribute('aria-orientation', axis.name === 'y' ? 'vertical' : 'horizontal');
      track.setAttribute('aria-label', `${page ? 'Page' : viewport.getAttribute('aria-label') || 'Content'} ${axis.name === 'y' ? 'vertical' : 'horizontal'} scroll`);
      track.setAttribute('aria-valuemin', '0');
      const thumb = document.createElement('div'); thumb.className = 'overlay-scrollbar-thumb'; track.append(thumb);
      // PrimeVue's focus trap needs its final sentinel to remain the last child.
      const sentinel = host.lastElementChild?.matches('[data-p-hidden-focusable="true"]') ? host.lastElementChild : null;
      host.insertBefore(track, sentinel);
      const maximum = () => Math.max(0, viewport[axis.extent] - viewport[axis.client]);
      let offset = 0;
      function seek(event: PointerEvent) {
        const bounds = track.getBoundingClientRect();
        const travel = bounds[axis.size] - thumb.getBoundingClientRect()[axis.size];
        if (travel > 0) viewport[axis.position] = Math.max(0, Math.min(1, (event[axis.coordinate] - bounds[axis.edge] - offset) / travel)) * maximum();
        schedule();
      }
      track.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault(); track.focus({ preventScroll: true });
        const bounds = thumb.getBoundingClientRect();
        offset = event.target === thumb ? event[axis.coordinate] - bounds[axis.edge] : bounds[axis.size] / 2;
        track.setPointerCapture(event.pointerId); track.classList.add('dragging'); seek(event);
      }, options);
      track.addEventListener('pointermove', event => { if (track.hasPointerCapture(event.pointerId)) seek(event); }, options);
      track.addEventListener('pointerup', event => { if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId); }, options);
      track.addEventListener('lostpointercapture', () => track.classList.remove('dragging'), options);
      track.addEventListener('keydown', event => {
        const maximumValue = maximum();
        const positions: Record<string, number> = {
          [axis.previous]: viewport[axis.position] - 40, [axis.next]: viewport[axis.position] + 40,
          PageUp: viewport[axis.position] - viewport[axis.client] * .9, PageDown: viewport[axis.position] + viewport[axis.client] * .9,
          Home: 0, End: maximumValue,
        };
        if (!(event.key in positions)) return;
        event.preventDefault(); viewport[axis.position] = positions[event.key]; schedule();
      }, options);
      return { axis, track, thumb, maximum };
    });
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport); for (const element of viewport.children) if (!owned(element)) observer.observe(element);
    regions.set(viewport, {
      update() {
        const style = getComputedStyle(viewport);
        const bounds = page ? { left: 0, top: 0 } : viewport.getBoundingClientRect();
        for (const { axis, track, maximum } of tracks) {
          track.hidden = viewport.clientWidth <= 0 || viewport.clientHeight <= 0 || !!viewport.closest('[hidden], [inert]') || maximum() <= 0 || (!page && !/auto|scroll/.test(axis.name === 'y' ? style.overflowY : style.overflowX));
        }
        for (const { axis, track, thumb, maximum } of tracks) {
          if (track.hidden) continue;
          const other = tracks.some(t => t.axis !== axis && !t.track.hidden);
          const length = Math.max(0, viewport[axis.client] - 4 - (other ? 8 : 0));
          const size = Math.min(length, Math.max(24, length * viewport[axis.client] / viewport[axis.extent]));
          const position = Math.max(0, Math.min(maximum(), viewport[axis.position]));
          track.style.position = page ? 'fixed' : 'absolute';
          const parent = track.offsetParent as HTMLElement | null;
          const initial = !parent || parent === document.body && getComputedStyle(parent).position === 'static';
          const origin = initial ? { left: -scrollX, top: -scrollY } : parent.getBoundingClientRect();
          const left = bounds.left + (page ? 0 : viewport.clientLeft) + 2 + (axis.name === 'y' ? viewport.clientWidth - 12 : 0);
          const top = bounds.top + (page ? 0 : viewport.clientTop) + 2 + (axis.name === 'x' ? viewport.clientHeight - 12 : 0);
          track.style.left = `${page ? left : left - origin.left + (initial ? 0 : parent!.scrollLeft - parent!.clientLeft)}px`;
          track.style.top = `${page ? top : top - origin.top + (initial ? 0 : parent!.scrollTop - parent!.clientTop)}px`;
          track.style.width = `${axis.name === 'y' ? 8 : length}px`; track.style.height = `${axis.name === 'y' ? length : 8}px`;
          thumb.style[axis.size] = `${size}px`;
          thumb.style.transform = `translate${axis.name.toUpperCase()}(${position / maximum() * (length - size)}px)`;
          track.setAttribute('aria-valuemax', String(maximum())); track.setAttribute('aria-valuenow', String(Math.round(position)));
        }
      },
      dispose() { controller.abort(); observer.disconnect(); tracks.forEach(t => t.track.remove()); },
    });
  }
  function refresh() {
    frame = 0;
    for (const [viewport, region] of regions) if (!viewport.isConnected) { region.dispose(); regions.delete(viewport); }
    for (const element of [document.documentElement, ...document.querySelectorAll('*')]) {
      if (!(element instanceof HTMLElement) || element === document.body || owned(element) || regions.has(element)) continue;
      const style = getComputedStyle(element);
      if (element === document.documentElement || /auto|scroll/.test(style.overflowX + style.overflowY)) install(element);
    }
    for (const region of regions.values()) region.update();
  }
  const mutations = new MutationObserver(records => {
    if (records.some(r => !owned(r.target) && (r.type !== 'childList' || [...r.addedNodes, ...r.removedNodes].some(n => !owned(n))))) schedule();
  });
  mutations.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'inert'] });
  document.addEventListener('scroll', schedule, { capture: true, passive: true }); window.addEventListener('resize', schedule);
  refresh();
  return () => {
    disposed = true; cancelAnimationFrame(frame); mutations.disconnect();
    document.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule);
    for (const region of regions.values()) region.dispose(); regions.clear();
  };
}
