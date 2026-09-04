import { useEffect } from 'react';

const BASE_STAGE_WIDTH = 1920;
const BASE_WORKSPACE_HEIGHT = 1080 - 176 - 58;
const LONG_WORKSPACE_TOP = 246;
const STAGE_BOTTOM_GAP = 58;
const PAGE_BOTTOM_PADDING = 52;
const OVERFLOW_EPSILON = 2;

function isVisible(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function getStageScale(stage: HTMLElement) {
  const rect = stage.getBoundingClientRect();
  const scale = rect.width / BASE_STAGE_WIDTH;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function getPageRoots(workspace: HTMLElement) {
  const fleetMain = workspace.querySelector<HTMLElement>('.fleet-main-v1');
  const parent = fleetMain ?? workspace;
  return Array.from(parent.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && isVisible(child),
  );
}

function measureContentHeight(workspace: HTMLElement, stageScale: number) {
  const workspaceRect = workspace.getBoundingClientRect();
  const roots = getPageRoots(workspace);

  return Math.ceil(roots.reduce((maxBottom, element) => {
    const rect = element.getBoundingClientRect();
    const top = (rect.top - workspaceRect.top) / stageScale;
    const renderedHeight = rect.height / stageScale;
    const naturalHeight = Math.max(renderedHeight, element.scrollHeight);
    return Math.max(maxBottom, Math.max(0, top) + naturalHeight);
  }, 0));
}

export function GlobalPageScrollController() {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    let delayed = 0;
    let resizeObserver: ResizeObserver | null = null;

    const clearGeometry = () => {
      root.style.removeProperty('--asterion-scroll-workspace-height');
      root.style.removeProperty('--asterion-scroll-stage-height');
      root.style.removeProperty('--asterion-scroll-page-height');
    };

    const observeCurrentPage = (workspace: HTMLElement) => {
      resizeObserver?.disconnect();
      if (typeof ResizeObserver === 'undefined') return;
      resizeObserver = new ResizeObserver(() => schedule());
      getPageRoots(workspace).forEach((element) => resizeObserver?.observe(element));
    };

    const sync = () => {
      const workspace = document.querySelector<HTMLElement>('.workspace');
      const stage = document.querySelector<HTMLElement>('.stage');
      if (!workspace || !stage) {
        root.classList.remove('asterion-long-page', 'asterion-combat-priority-page');
        clearGeometry();
        return;
      }

      const wasLong = root.classList.contains('asterion-long-page');

      // Always measure against the normal one-screen shell. This prevents an already
      // expanded page from measuring its own expanded wrapper and growing forever.
      root.classList.remove('asterion-long-page', 'asterion-combat-priority-page');
      clearGeometry();

      const stageScale = getStageScale(stage);
      const contentHeight = measureContentHeight(workspace, stageScale);
      const needsScroll = contentHeight > BASE_WORKSPACE_HEIGHT + OVERFLOW_EPSILON;

      if (needsScroll) {
        const workspaceHeight = Math.ceil(contentHeight + PAGE_BOTTOM_PADDING);
        const stageHeight = LONG_WORKSPACE_TOP + workspaceHeight + STAGE_BOTTOM_GAP;
        const pageHeight = Math.ceil(stageHeight * stageScale);

        root.style.setProperty('--asterion-scroll-workspace-height', `${workspaceHeight}px`);
        root.style.setProperty('--asterion-scroll-stage-height', `${stageHeight}px`);
        root.style.setProperty('--asterion-scroll-page-height', `${pageHeight}px`);
        root.classList.add('asterion-long-page');
      }

      observeCurrentPage(workspace);

      if (wasLong !== needsScroll) {
        window.scrollTo(0, 0);
      }
    };

    const schedule = () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(delayed);
      frame = window.requestAnimationFrame(sync);
      // Page-specific legacy cleanup effects can run just after a route commit. A second
      // pass makes the global controller the final source of truth for scrolling.
      delayed = window.setTimeout(sync, 32);
    };

    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    schedule();

    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.cancelAnimationFrame(frame);
      window.clearTimeout(delayed);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      root.classList.remove('asterion-long-page', 'asterion-combat-priority-page');
      clearGeometry();
    };
  }, []);

  return null;
}
