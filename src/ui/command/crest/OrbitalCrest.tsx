import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { AllianceCrest } from '../../../domain/command/types.ts';
import { composeCrest, crestKey } from './renderer';

/**
 * The crest as a square canvas that fills its box. `size` pins an exact CSS
 * size (the 32/48/64 px previews); without it the canvas follows the container.
 */
export function OrbitalCrest({ crest, size, className = '', label }: { crest: AllianceCrest; size?: number; className?: string; label?: string }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [measured, setMeasured] = useState(size ?? 0);
  const cssSize = size ?? measured;

  useLayoutEffect(() => {
    if (size) return undefined;
    const box = boxRef.current;
    if (!box) return undefined;
    const measure = () => setMeasured(Math.floor(Math.min(box.clientWidth, box.clientHeight)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [size]);

  const key = crestKey(crest);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cssSize <= 0) return undefined;
    let live = true;
    // Rendering resolution follows the real device pixels (the stage is scaled).
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width > 0 ? rect.width / cssSize : 1;
    const pixels = Math.max(16, Math.min(1024, Math.round(cssSize * scale * (window.devicePixelRatio || 1))));
    void composeCrest(crest, pixels).then((image) => {
      if (!live || !image) return;
      canvas.width = pixels;
      canvas.height = pixels;
      const context = canvas.getContext('2d');
      context?.clearRect(0, 0, pixels, pixels);
      context?.drawImage(image, 0, 0);
    });
    return () => { live = false; };
    // The key covers every crest field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cssSize]);

  return (
    <span ref={boxRef} className={`orbital-crest ${className}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <canvas ref={canvasRef} style={{ width: cssSize, height: cssSize }} />
    </span>
  );
}
