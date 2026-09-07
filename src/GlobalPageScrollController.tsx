import { useEffect } from 'react';

const BASE_STAGE_WIDTH = 1920;
const BASE_WORKSPACE_HEIGHT = 1080 - 176 - 58;
const BASE_UTILITY_WORKSPACE_HEIGHT = 1080 - 246 - 58;
const BASE_FLEET_VERTICAL_PADDING = 22 + 30;
const BASE_FLEET_CONTENT_HEIGHT = BASE_UTILITY_WORKSPACE_HEIGHT - BASE_FLEET_VERTICAL_PADDING;
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

function getPageContainer(workspace: HTMLElement) {
  return workspace.querySelector<HTMLElement>('.fleet-main-v1') ?? workspace;
}

function getPageRoots(container: HTMLElement) {
  return Array.from(container.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && isVisible(child),
  );
}

function isUtilityRoot(roots: readonly HTMLElement[]) {
  return roots.some((element) => element.classList.contains('utility-screen-host'));
}

function usesCompactWorkspaceHeight(workspace: HTMLElement) {
  return workspace.classList.contains('workspace--command');
}

function measureContentHeight(container: HTMLElement, stageScale: number, roots: readonly HTMLElement[]) {
  const containerRect = container.getBoundingClientRect();

  return Math.ceil(roots.reduce((maxBottom, element) => {
    const rect = element.getBoundingClientRect();
    const top = (rect.top - containerRect.top) / stageScale;
    const renderedHeight = rect.height / stageScale;
    const naturalHeight = Math.max(renderedHeight, element.scrollHeight);
    return Math.max(maxBottom, Math.max(0, top) + naturalHeight);
  }, 0));
}

function pageIdentity(roots: readonly HTMLElement[]) {
  const primary = roots[0];
  if (!primary) return 'empty';
  const title = primary.querySelector('h2')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  return `${primary.className}|${title}`;
}

function sameRoots(left: readonly HTMLElement[], right: readonly HTMLElement[]) {
  return left.length === right.length && left.every((element, index) => element === right[index]);
}

export function GlobalPageScrollController() {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    let delayed = 0;
    let resizeObserver: ResizeObserver | null = null;
    let observedRoots: HTMLElement[] = [];
    let lastPageIdentity = '';

    const clearGeometry = () => {
      root.style.removeProperty('--asterion-scroll-workspace-height');
      root.style.removeProperty('--asterion-scroll-stage-height');
      root.style.removeProperty('--asterion-scroll-page-height');
    };

    const schedule = () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(delayed);
      frame = window.requestAnimationFrame(sync);
      delayed = window.setTimeout(sync, 32);
    };

    const observeCurrentPage = (roots: readonly HTMLElement[]) => {
      if (sameRoots(observedRoots, roots)) return;

      resizeObserver?.disconnect();
      observedRoots = [...roots];
      if (typeof ResizeObserver === 'undefined' || roots.length === 0) return;

      resizeObserver = new ResizeObserver(() => schedule());
      roots.forEach((element) => resizeObserver?.observe(element));
    };

    const sync = () => {
      const workspace = document.querySelector<HTMLElement>('.workspace');
      const stage = document.querySelector<HTMLElement>('.stage');
      if (!workspace || !stage) {
        resizeObserver?.disconnect();
        observedRoots = [];
        root.classList.remove('asterion-long-page');
        clearGeometry();
        lastPageIdentity = '';
        return;
      }

      const stageScale = getStageScale(stage);
      const pageContainer = getPageContainer(workspace);
      const pageRoots = getPageRoots(pageContainer);
      const identity = pageIdentity(pageRoots);
      const pageChanged = identity !== lastPageIdentity;
      lastPageIdentity = identity;

      // A long page may have already enlarged .workspace when navigation swaps its
      // contents. Measure the incoming page from the normal shell first; otherwise
      // a root with min-height: 100% can inherit the previous page's height and keep
      // the global scroll mode alive indefinitely.
      if (pageChanged && root.classList.contains('asterion-long-page')) {
        root.classList.remove('asterion-long-page');
        clearGeometry();
        schedule();
        return;
      }

      const isFleetPage = pageContainer.classList.contains('fleet-main-v1');
      const utilityPage = !isFleetPage && isUtilityRoot(pageRoots);
      const availableHeight = utilityPage || usesCompactWorkspaceHeight(workspace)
        ? BASE_UTILITY_WORKSPACE_HEIGHT
        : isFleetPage
          ? BASE_FLEET_CONTENT_HEIGHT
          : BASE_WORKSPACE_HEIGHT;
      const contentHeight = measureContentHeight(pageContainer, stageScale, pageRoots);
      const needsScroll = contentHeight > availableHeight + OVERFLOW_EPSILON;

      if (needsScroll) {
        const workspaceHeight = Math.ceil(contentHeight + PAGE_BOTTOM_PADDING);
        const stageHeight = LONG_WORKSPACE_TOP + workspaceHeight + STAGE_BOTTOM_GAP;
        const pageHeight = Math.ceil(stageHeight * stageScale);

        root.style.setProperty('--asterion-scroll-workspace-height', `${workspaceHeight}px`);
        root.style.setProperty('--asterion-scroll-stage-height', `${stageHeight}px`);
        root.style.setProperty('--asterion-scroll-page-height', `${pageHeight}px`);

        if (!root.classList.contains('asterion-long-page')) {
          root.classList.add('asterion-long-page');
        }
      } else {
        if (root.classList.contains('asterion-long-page')) {
          root.classList.remove('asterion-long-page');
        }
        clearGeometry();
      }

      observeCurrentPage(pageRoots);

      if (pageChanged) {
        window.scrollTo(0, 0);
      }
    };

    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
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
      root.classList.remove('asterion-long-page');
      clearGeometry();
    };
  }, []);

  return null;
}
