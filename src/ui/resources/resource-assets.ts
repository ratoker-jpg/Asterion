import metalIcon from '../../assets/ui/header-icons/metal.png';
import mineralIcon from '../../assets/ui/header-icons/mineral.png';
import gasIcon from '../../assets/ui/header-icons/gas.png';
import energyIcon from '../../assets/ui/header-icons/energy.png';
import populationIcon from '../../assets/ui/header-icons/population.png';
import debrisIcon from '../../assets/ui/header-icons/debris.png';

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

/** Compatibility adapter for the legacy header spelling `mineral`. */
export function resolveResourceIconKind(kind: ResourceIconKind | 'mineral'): ResourceIconKind {
  return kind === 'mineral' ? 'minerals' : kind;
}
