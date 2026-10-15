# PR3 — playable pirate operations

## Scope

Real pirate reconnaissance and elimination flights connect the existing Universe, Operations, Fleet and Reports screens. The branch starts at `a32e9cbdd664f54109c2d5d88c77961f00954c40`. Publication remains Draft; merging and marking Ready are outside this task.

| Rule | Implementation |
| --- | --- |
| Contact identity | Versioned galaxy/system/cycle/start key; flights retain the exact key and launch coordinates. |
| World schedule | Existing 90% spawn, 45–75 minute lifetime, 15 minute quiet interval; a full victory ends that instance globally and moves the next eligible cycle to victory + 15 minutes. |
| Owner profile | Resource and battle points only; the persisted first-contact profile is frozen separately for each owner and cycle. |
| Recon | One real probe, shared route/fuel/reservation runtime, a persisted seeded 70% roll, 120 second dispatch cooldown and concurrent-flight exclusion. |
| Recon output | Ship composition as allowed Russian names and population percentages totaling 100%, plus ship level only; no applied technologies. Historical reports survive the contact. |
| Elimination | Existing combat resolver and six ordinary pirate hulls; rounded 90% combat population allocation, frozen player ships/commanders/technology and a fresh garrison each fight. |
| Accounting | Existing 30% ordinary hull debris and 60% pirate debris with surviving Corsair bonus; no pirate PvE Battle Points or direct resource loot. |
| Missing target | Original cycle validation at logical arrival; return without combat, exact absence message and persisted flight-history message. |
| Replay | Request index, stable report identities, materialized outcome, chronological arrival/return processing and flight-ID tie-break. |
| Save safety | Schema 23; legacy defaults; strict snapshot/report/ledger checks isolate invalid pirate records from the main save. |

## Integration and verification

Detailed command outcomes and proven scenarios are recorded in [the verification evidence](docs/evidence/pirate-operations-pr3-verification.md). The known baseline `test:attack` result is 18/20: two pre-existing loot assertions at `attack.test.ts` were reproduced before implementation and remain outside PR3.

Final Electron QA completed reconnaissance and elimination end to end at 1920×1080 and 390×844. Both missions returned, the recon dossier had no horizontal overflow, and neither viewport reported failed requests or load failures. The mobile viewport keeps the current fixed stage scaled to fit; it has no clipping or horizontal overflow, though text is small. The user reviewed this tradeoff and asked to retain the current composition.

The user clarified that pirate recon reports must contain only ship composition and ship level. This overrides the attached prompt's applied-technology disclosure. Recon reports and feed text omit pirate technologies, and save normalization strips technology fields from older recon reports while retaining their ship data.

New pirate domain and application integration tests are included in CI. The Pages deployment workflow is unchanged. Automatic pirate raids, planet destruction and the PR89 battle viewer redesign are excluded.

## Auditor protocol

The appendix was copied verbatim to `docs/process/ASTERION_AUDITOR_PROTOCOL.md` (marker lines excluded, normalized text compared).

- SHA256: `41CB346764209AF7B8DF60ACFC2C85E83DAC341C62D7291DDB3BDA03E259126C`
- Git blob: `b519fe76766d98659aa6ee82d52292f2492591bb`

The next auditor must explicitly open that file; storing it in GitHub does not automatically load it into a new chat.

## Publication

The PR URL, final commit, CI and preview verification will be added after the draft is published. Preview validation must compare `pr/<number>/preview-sha.txt` with the actual PR head and verify that the application loads.

Delegated implementation and verification work was handled by explicitly selected GPT-6 Luna workers to conserve account usage. The main thread handled integration and release review.
