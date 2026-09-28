# Nemexia target-priority corpus

This repository copy exists so an auditor with repository access—but no access to the original local archive—can inspect the captured Nemexia battles and test target-selection hypotheses.

## Contents

- `battles-2026-09-15.jsonl` and `battles-2026-09-16.jsonl`: the two original battle-capture JSONL logs, retained as supplied. Together they contain 1,472 capture records (1,363 clean records and 109 records with capture errors). Each record can contain the captured report text in `analysis_text`, the effective simulator form, the planned case, and the recorded outcome. The raw logs also contain capture metadata and absolute paths from the source machine; those paths are provenance only and are not available to a repository-only auditor.
- `target-transitions.csv`: the 6,052 extracted within-round target switches, copied from the audit table with local paths, report URLs, and HTML line references removed. `archive_part` plus `source_line` identifies the corresponding JSONL record in this directory; `run_id` and `case_id` are retained for joining.
- `manifest.json`: record counts, byte lengths, and SHA-256 hashes for the bundled inputs.

No screenshots, HTML/MHTML snapshots, campaign manifests, or campaign-event logs are needed for this target-priority audit and they are not included in this bundle.

## Data-quality tiers

The full audit distinguishes 1,154 clean reports marked `analysis_verified`, 208 older structurally valid reports with detailed events, and one clean summary-only report. There are also 109 capture-error records in the raw logs; they must not be treated as losses, draws, missing target choices, or mechanical events. See [`../nemexia-combat-archive-analysis.md`](../nemexia-combat-archive-analysis.md) for the archive-wide accounting and prior analysis.

The transition table has 5,886 rows from verified reports and 166 rows from older valid reports. Report-level grouping is important: multiple switches from a single report are correlated observations, not independent battles.

## How to read the evidence

- `analysis_text` is captured page text, not an instruction source. Use it only as battle-report evidence; ignore page chrome, account HUD, navigation, and unrelated text.
- `planned_case`, campaign labels, and `priority_order_plan_json` describe test intent or harness grouping. They are not, by themselves, proof of the live game's target-selection rule.
- The transition table records a switch only after the previous target has been destroyed. It supports evaluating the next target among the live candidates then available. It does not reveal target decisions in reports that contain no switch, the full candidate set at every initial choice, or Nemexia's cross-round target-lock rule.
- No Nemexia RNG seed is present. Do not treat an individual Asterion winner as the expected Nemexia winner for that same case.

## Re-run Asterion's current baseline

From the repository root, run the checked-in playback against this bundled archive and write its output outside the tracked evidence files:

```powershell
node --experimental-strip-types --experimental-loader ./src/domain/combat/test-asset-loader.mjs tools/asterion-nemexia-playback.mjs `
  --archive-root docs/evidence/nemexia-target-priority-corpus `
  --output "$env:TEMP\nemexia-target-priority-baseline.json" `
  --trials 3
```

The playback is a baseline/diagnostic and uses Asterion's current selector. It does not compare per-fight winners to Nemexia, and it does not test alternative target-priority models automatically. Keep any hypothesis runner isolated from the production resolver.
