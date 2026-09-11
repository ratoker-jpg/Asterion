import {
  RUNTIME_STATE_CHANGED_EVENT,
  type RuntimeMode,
  type TestTimeScale,
} from '../domain/runtime/mode.ts';
import { publishRuntimeStateSnapshot } from '../domain/runtime/state-store.ts';
import { SCIENCE_RUNTIME_CHANGED_EVENT } from '../domain/science/runtime.ts';
import { createScienceSnapshot } from './science.ts';
import type { PlanetId, SaveState } from './contracts.ts';

export type RuntimeApplicationContext = {
  planetId: PlanetId;
  now: number;
  mode: RuntimeMode;
  testTimeScale: TestTimeScale;
};

export function publishApplicationRuntimeSnapshot(
  state: SaveState,
  context: RuntimeApplicationContext,
  target: EventTarget,
): void {
  const scienceSnapshot = createScienceSnapshot(state, context);
  target.dispatchEvent(new CustomEvent(SCIENCE_RUNTIME_CHANGED_EVENT, { detail: scienceSnapshot }));
  publishRuntimeStateSnapshot({ command: state.command, rating: state.rating });
  target.dispatchEvent(new CustomEvent(RUNTIME_STATE_CHANGED_EVENT, { detail: state }));
}
