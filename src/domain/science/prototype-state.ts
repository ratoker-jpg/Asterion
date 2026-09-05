import type { ScienceQueuePreviewItem } from './types.ts';

export type SciencePrototypeDisplayState = {
  laboratoryLevel: number;
  queue: readonly ScienceQueuePreviewItem[];
};

export const SCIENCE_PROTOTYPE_DISPLAY_STATE: SciencePrototypeDisplayState = {
  laboratoryLevel: 7,
  queue: [
    {
      scienceId: 1,
      name: 'Физика',
      capturedLevelLabel: 'Уровень 6',
      capturedRemainingTime: '01:11:09',
    },
  ],
};
