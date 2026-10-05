export const NEMEXIA_COMBAT_ROUND_PARITY_FIXTURE = {
  provenance: {
    archiveFile: 'D:\\Desktop\\Nemexia\\simulation-battles\\battles-2026-09-16.jsonl',
    archiveLine: 1,
    runId: 'a5449dc74a9b',
    caseId: 'recon240-race-r1-r1-zero-r1',
    savedReportFile: 'D:\\Desktop\\Nemexia\\simulation-battles\\reports\\a5449dc74a9b\\0001_recon240-race-r1-r1-zero-r1\\page.html',
  },
  observed: {
    firstDisplayedVolley: {
      reportLine: 852,
      actorClass: 'Destroyer',
      actorCount: 138,
      targetClass: 'Battleship',
      targetCountBefore: 277,
      destroyedCount: 142,
      targetCountAfter: 135,
    },
    defenderActions: [
      { reportLine: 866, actorClass: 'Battleship', actorCount: 277, targetClass: 'Cruiser' },
      { reportLine: 868, actorClass: 'Battleship', actorCount: 277, targetClass: 'Bomber' },
    ],
    nextRoundAction: {
      reportLine: 973,
      round: 2,
      actorClass: 'Battleship',
      actorCount: 135,
    },
    partialLossResponses: [
      { class: 'Cruiser', asterionEntityId: 'cruiser', volleyLine: 846, responseLines: [860], countBefore: 595, destroyedByVolley: 324, countAfterVolley: 271, countOnResponse: 595 },
      { class: 'Scout', asterionEntityId: 'scout', volleyLine: 848, responseLines: [864], countBefore: 2109, destroyedByVolley: 978, countAfterVolley: 1131, countOnResponse: 2109 },
      { class: 'Defender', asterionEntityId: 'defender', volleyLine: 850, responseLines: [870], countBefore: 694, destroyedByVolley: 249, countAfterVolley: 445, countOnResponse: 694 },
      { class: 'Battleship', asterionEntityId: 'battleship', volleyLine: 852, responseLines: [866, 868], countBefore: 277, destroyedByVolley: 142, countAfterVolley: 135, countOnResponse: 277 },
      { class: 'Destroyer', asterionEntityId: 'destroyer', volleyLine: 854, responseLines: [858], countBefore: 138, destroyedByVolley: 58, countAfterVolley: 80, countOnResponse: 138 },
      { class: 'Bomber', asterionEntityId: 'bomber', volleyLine: 856, responseLines: [862], countBefore: 189, destroyedByVolley: 43, countAfterVolley: 146, countOnResponse: 189 },
    ],
  },
} as const;
