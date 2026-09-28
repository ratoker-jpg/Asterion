export const NEMEXIA_REPAIR_TIMING_FIXTURES = {
  attackerReanimator: {
    provenance: {
      archiveFile: 'D:/Desktop/Nemexia/simulation-battles/battles-2026-09-16.jsonl',
      archiveLine: 933,
      runId: '43ab63a38378',
      caseId: 'calibration180-commander-attacker-10',
      savedReportFile: 'D:/Desktop/Nemexia/simulation-battles/reports/43ab63a38378/0094_calibration180-commander-attacker-10/page.html',
    },
    observations: {
      finalDefenderActionRound: 4,
      finalDefenderActionReportLine: 1135,
      repairActions: [
        { side: 'attacker', target: 'Goliath', restored: 4, reportLine: 1137 },
        { side: 'attacker', target: 'Bot Shield', restored: 18, reportLine: 1143 },
      ],
      nextRoundHeadingReportLine: 1147,
    },
  },
  repairWithBothSidesSelectingReanimator: {
    provenance: {
      archiveFile: 'D:/Desktop/Nemexia/simulation-battles/battles-2026-09-15.jsonl',
      archiveLine: 433,
      runId: '3203f5167424',
      caseId: 'science150-19-r2-priority',
      savedReportFile: 'D:/Desktop/Nemexia/simulation-battles/reports/3203f5167424/0130_science150-19-r2-priority/page.html',
    },
    observations: {
      finalDefenderActionRound: 1,
      finalDefenderActionReportLine: 850,
      repairActions: [
        { side: 'defender', target: 'Star Armada', restored: 48, reportLine: 852 },
        { side: 'defender', target: 'BomberBot', restored: 21, reportLine: 858 },
      ],
      nextRoundHeadingReportLine: 860,
      nextRoundRestoredStackActionReportLine: 933,
    },
  },
  repairWithoutReanimator: {
    provenance: {
      archiveFile: 'D:/Desktop/Nemexia/simulation-battles/battles-2026-09-16.jsonl',
      archiveLine: 985,
      runId: '43ab63a38378',
      caseId: 'calibration180-target-r1-a3-primary_removed',
      savedReportFile: 'D:/Desktop/Nemexia/simulation-battles/reports/43ab63a38378/0146_calibration180-target-r1-a3-primary_removed/page.html',
    },
    observations: {
      repairedStackReportLine: 832,
      plannedReanimatorCount: 0,
    },
  },
} as const;
