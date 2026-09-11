import type { ImgHTMLAttributes } from 'react';
import {
  RESOURCE_ICON_ASSETS,
  RESOURCE_ICON_OPTICAL_SCALES,
  resolveResourceIconKind,
  type ResourceIconKind,
} from './resource-assets.ts';
import './resource-icons.css';

type ResourceIconProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> & {
  kind: ResourceIconKind;
  label?: string;
};

/** Single typed renderer for all resource and debris icons outside the header shell. */
export function ResourceIcon({ kind, label, className, ...props }: ResourceIconProps) {
  const canonicalKind = resolveResourceIconKind(kind);
  const source = RESOURCE_ICON_ASSETS[canonicalKind];
  const decorative = !label;

  return (
    <img
      {...props}
      className={[
        'asterion-resource-icon',
        `asterion-resource-icon--${canonicalKind}`,
        className,
      ].filter(Boolean).join(' ')}
      src={source}
      alt={label ?? ''}
      aria-hidden={decorative ? 'true' : undefined}
      aria-label={label}
      data-qa-resource-kind={canonicalKind}
      data-qa-resource-asset={source}
      data-qa-resource-optical-scale={RESOURCE_ICON_OPTICAL_SCALES[canonicalKind]}
      draggable={false}
    />
  );
}
