import { getFactionGeneralAsset } from '../domain/profile/faction-assets.ts';
import './faction-general.css';

type FactionGeneralPortraitProps = {
  factionId?: string;
  className?: string;
  alt?: string;
  decorative?: boolean;
};

export function FactionGeneralPortrait({
  factionId,
  className = '',
  alt = '',
  decorative = true,
}: FactionGeneralPortraitProps) {
  const asset = getFactionGeneralAsset(factionId);
  const classes = ['faction-general-portrait', className].filter(Boolean).join(' ');

  return (
    <span
      className={classes}
      data-qa-faction-general
      data-faction={factionId ?? 'unknown'}
      data-asset={asset ? `${factionId}_general.png` : undefined}
      data-crop="upper"
      aria-hidden={decorative || undefined}
      aria-label={!decorative ? alt : undefined}
    >
      {asset ? <img src={asset} alt={decorative ? '' : alt} /> : <span className="faction-general-portrait__fallback">—</span>}
    </span>
  );
}
