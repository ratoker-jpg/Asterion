export type HeaderGeometry = {
  canvasWidth: number;
  canvasHeight: number;
  headerTop: number;
  headerHeight: number;
  workspaceGap: number;
  workspaceTop: number;
  baseWorkspaceTop: number;
  stageBottomGap: number;
};

export const DEFAULT_HEADER_GEOMETRY: HeaderGeometry = {
  canvasWidth: 1920,
  canvasHeight: 1080,
  headerTop: 20,
  headerHeight: 220,
  workspaceGap: 6,
  workspaceTop: 246,
  baseWorkspaceTop: 176,
  stageBottomGap: 58,
};

function readCssPixels(styles: CSSStyleDeclaration, name: string, fallback: number) {
  const value = Number.parseFloat(styles.getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

export function readHeaderGeometry(): HeaderGeometry {
  if (typeof window === 'undefined' || typeof document === 'undefined') return DEFAULT_HEADER_GEOMETRY;
  const styles = getComputedStyle(document.documentElement);
  const canvasWidth = readCssPixels(styles, '--hud-canvas-width', DEFAULT_HEADER_GEOMETRY.canvasWidth);
  const canvasHeight = readCssPixels(styles, '--hud-canvas-height', DEFAULT_HEADER_GEOMETRY.canvasHeight);
  const headerTop = readCssPixels(styles, '--hud-header-top', DEFAULT_HEADER_GEOMETRY.headerTop);
  const headerHeight = readCssPixels(styles, '--hud-header-height', DEFAULT_HEADER_GEOMETRY.headerHeight);
  const workspaceGap = readCssPixels(styles, '--hud-workspace-gap', DEFAULT_HEADER_GEOMETRY.workspaceGap);
  const baseWorkspaceTop = readCssPixels(styles, '--hud-base-workspace-top', DEFAULT_HEADER_GEOMETRY.baseWorkspaceTop);
  const stageBottomGap = readCssPixels(styles, '--hud-stage-bottom-gap', DEFAULT_HEADER_GEOMETRY.stageBottomGap);

  return {
    canvasWidth,
    canvasHeight,
    headerTop,
    headerHeight,
    workspaceGap,
    workspaceTop: headerTop + headerHeight + workspaceGap,
    baseWorkspaceTop,
    stageBottomGap,
  };
}

