import { CREST_HALO_RADIUS, crestPatternLayout } from '../../../domain/command/crest.ts';
import { ORBITAL_CREST_CATALOG } from '../../../domain/command/orbital-crest-catalog.generated.ts';
import type { AllianceCrest } from '../../../domain/command/types.ts';

/**
 * Canvas renderer of the «Орбитальные дома» crest. Layer order from the package
 * contract: field texture → pattern (one field layer, clipped by the frame's exact
 * interior mask) → glyph (placed on the safe circle, then clipped by the same
 * mask) → metal frame on top. Modules load on demand and stay cached; finished
 * composites are cached per configuration and pixel size.
 */

const URLS = import.meta.glob('../../../assets/command/orbital-heraldry/*.{webp,png}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const urlById = new Map(Object.entries(URLS).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1).replace(/\.(webp|png)$/, ''), url]));

const images = new Map<string, Promise<HTMLImageElement | null>>();
const composites = new Map<string, HTMLCanvasElement>();
const COMPOSITE_LIMIT = 240;

function loadImage(id: string): Promise<HTMLImageElement | null> {
  const cached = images.get(id);
  if (cached) return cached;
  const url = urlById.get(id);
  const promise = url
    ? new Promise<HTMLImageElement | null>((resolve) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => { images.delete(id); resolve(null); };
      image.src = url;
    })
    : Promise.resolve(null);
  images.set(id, promise);
  return promise;
}

function surface(size: number) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return { canvas, context };
}

type Placement = { pivot: readonly number[]; radius: number };

/** Draws a module so its registered circle (pivot + radius) lands on (x, y) with the given radius. */
function drawPlaced(context: CanvasRenderingContext2D, image: HTMLImageElement, placement: Placement, x: number, y: number, radius: number, rotation = 0, mirror = false) {
  // Every module is square, so the normalized radius refers to the drawn side.
  const side = radius / placement.radius;
  context.save();
  context.translate(x, y);
  if (rotation) context.rotate(rotation * Math.PI / 180);
  if (mirror) context.scale(-1, 1);
  context.drawImage(image, -placement.pivot[0] * side, -placement.pivot[1] * side, side, side);
  context.restore();
}

export function crestKey(crest: AllianceCrest): string {
  return [crest.frame, crest.field, crest.pattern, crest.patternOpacity.toFixed(3), crest.glyph, crest.color, crest.glyphScale.toFixed(3), crest.rotation.toFixed(1), crest.mirrorX ? 1 : 0, crest.offsetX.toFixed(4), crest.offsetY.toFixed(4)].join('|');
}

/** Module ids the crest needs; used to warm the cache for constructor tiles. */
export function crestModuleIds(crest: AllianceCrest): string[] {
  const ids = [`frame-${crest.frame}`, `mask-${crest.frame}`, `field-${crest.field}`, `glyph-${crest.glyph}-${crest.color}`];
  if (crest.pattern !== 'none') ids.push(`pattern-${crest.pattern}`);
  return ids;
}

/** Composes the crest into a square canvas of `size` device pixels (cached). */
export async function composeCrest(crest: AllianceCrest, size: number): Promise<HTMLCanvasElement | null> {
  const key = `${crestKey(crest)}@${size}`;
  const ready = composites.get(key);
  if (ready) return ready;

  const frame = ORBITAL_CREST_CATALOG.frames.find((item) => item.id === crest.frame);
  const glyph = ORBITAL_CREST_CATALOG.glyphs.find((item) => item.id === crest.glyph);
  const pattern = ORBITAL_CREST_CATALOG.patterns.find((item) => item.id === crest.pattern);
  if (!frame || !glyph) return null;
  const [frameImage, maskImage, fieldImage, glyphImage, patternImage] = await Promise.all([
    loadImage(`frame-${crest.frame}`),
    loadImage(`mask-${crest.frame}`),
    loadImage(`field-${crest.field}`),
    loadImage(`glyph-${crest.glyph}-${crest.color}`),
    pattern ? loadImage(`pattern-${pattern.id}`) : Promise.resolve(null),
  ]);
  if (!frameImage || !maskImage || !fieldImage || !glyphImage || (pattern && !patternImage)) return null;

  const output = surface(size);
  const layer = surface(size);
  if (!output || !layer) return null;
  const centerX = size * frame.interior.pivot[0];
  const centerY = size * frame.interior.pivot[1];
  const safeRadius = size * frame.interior.radius;

  // Field texture + pattern, clipped by the interior mask.
  layer.context.drawImage(fieldImage, 0, 0, size, size);
  if (pattern && patternImage) {
    layer.context.globalAlpha = Math.max(0, Math.min(1, crest.patternOpacity));
    if (crestPatternLayout(pattern.id) === 'halo') drawPlaced(layer.context, patternImage, pattern, centerX, centerY, safeRadius * CREST_HALO_RADIUS);
    else layer.context.drawImage(patternImage, 0, 0, size, size);
    layer.context.globalAlpha = 1;
  }
  layer.context.globalCompositeOperation = 'destination-in';
  layer.context.drawImage(maskImage, 0, 0, size, size);
  output.context.drawImage(layer.canvas, 0, 0);

  // Glyph: scaled and placed on the safe circle before the same mask clips it.
  layer.context.globalCompositeOperation = 'source-over';
  layer.context.clearRect(0, 0, size, size);
  drawPlaced(layer.context, glyphImage, glyph.placement[crest.color], centerX + crest.offsetX * safeRadius, centerY + crest.offsetY * safeRadius, safeRadius * crest.glyphScale, crest.rotation, crest.mirrorX);
  layer.context.globalCompositeOperation = 'destination-in';
  layer.context.drawImage(maskImage, 0, 0, size, size);
  output.context.drawImage(layer.canvas, 0, 0);

  output.context.drawImage(frameImage, 0, 0, size, size);

  if (composites.size >= COMPOSITE_LIMIT) composites.delete(composites.keys().next().value as string);
  composites.set(key, output.canvas);
  return output.canvas;
}

/** Preloads the modules of several crests (constructor tiles), without composing. */
export function warmCrestModules(crests: readonly AllianceCrest[]): void {
  for (const crest of crests) for (const id of crestModuleIds(crest)) void loadImage(id);
}

/** Safe circle of a frame in normalized canvas units (editor overlay). */
export function crestSafeCircle(frameId: AllianceCrest['frame']) {
  const frame = ORBITAL_CREST_CATALOG.frames.find((item) => item.id === frameId) ?? ORBITAL_CREST_CATALOG.frames[0];
  return { x: frame.interior.pivot[0], y: frame.interior.pivot[1], radius: frame.interior.radius };
}

export function crestModuleUrl(id: string): string | undefined {
  return urlById.get(id);
}
