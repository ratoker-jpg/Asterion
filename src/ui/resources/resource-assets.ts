import metalIcon from '../../assets/ui/header-icons/metal.webp';
import mineralIcon from '../../assets/ui/header-icons/mineral.webp';
import gasIcon from '../../assets/ui/header-icons/gas.webp';
import energyIcon from '../../assets/ui/header-icons/energy.webp';
import populationIcon from '../../assets/ui/header-icons/population.webp';
import debrisIcon from '../../assets/ui/header-icons/debris.webp';

/** Canonical domain resource keys. Keep `minerals` aligned with the wallet model. */
export const RESOURCE_ICON_KINDS = ['metal', 'minerals', 'gas', 'energy', 'population', 'debris'] as const;
export type ResourceIconKind = (typeof RESOURCE_ICON_KINDS)[number];

export const RESOURCE_ICON_ASSETS = {
  metal: metalIcon,
  minerals: mineralIcon,
  gas: gasIcon,
  energy: energyIcon,
  population: populationIcon,
  debris: debrisIcon,
} satisfies Record<ResourceIconKind, string>;

/** Optical compensation for transparent padding in the source asset canvases. */
export const RESOURCE_ICON_OPTICAL_SCALES = {
  metal: 1,
  minerals: 1,
  gas: 1,
  energy: 1,
  population: 1,
  debris: 1,
} satisfies Record<ResourceIconKind, number>;

/** Compatibility adapter for the legacy header spelling `mineral`. */
export function resolveResourceIconKind(kind: ResourceIconKind | 'mineral'): ResourceIconKind {
  return kind === 'mineral' ? 'minerals' : kind;
}
