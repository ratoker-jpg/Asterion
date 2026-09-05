import type { ReportItem } from './types.ts';

// Reports are event history, not a decorative inbox. Do not invent completed
// flights, spy results, alliance attacks or achievements before their runtime
// domains emit those events. Real combat, Operations intel and current Command
// invitations are adapted in adapters.ts.
export const NON_COMBAT_REPORT_FIXTURES: readonly ReportItem[] = [];
