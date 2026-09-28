# Nemexia target priority — stage 2 reverse-engineering audit

## Status

**Audit only. Production combat code was not changed by this stage.**

This report extends `docs/evidence/nemexia-target-priority-audit.md` and focuses on recovering an interpretable Nemexia-like retarget rule rather than fitting another opaque score.

## Executive conclusion

The current Asterion fallback (`threat -> population -> catalog`) is not a good reconstruction of Nemexia ordinary-ship retargeting.

For the six ordinary combat classes, the corpus is explained by a simple deterministic rule with **zero observed contradictions in the mapped ship-vs-ship retarget scope**:

1. Use the attacker's known Nemexia primary target class first.
2. If that class is no longer alive, use the fixed fallback class order:

```text
bomber > destroyer > battleship > defender > cruiser > scout
```

with the attacker's primary class removed from the fallback because it was already tested first.

Across the non-controlled corpus this rule matched **5,700 / 5,700** eligible ordinary ship-to-ship retarget transitions. It also matched **52 / 52** transitions in the separate `target_priority` controlled block.

This is a materially stronger reconstruction than the current Asterion static selector proxy, which matched about **62.76%** of the stage-1 holdout.

However, this does **not** establish the complete Nemexia target selector. The corpus is mainly retarget evidence after a previous target was destroyed. It does not safely determine initial target selection, defense-vs-ship ordering, death-star behavior, same-class tie-breaking, service-ship ordering, or the exact commander-vs-commander rule.

## Data and split

Source corpus:

- `docs/evidence/nemexia-target-priority-corpus/`
- 6,052 extracted target transitions total.
- 52 transitions in the dedicated `target_priority` controlled block.
- Remaining transitions retain the stage-1 deterministic group split:
  - discovery: 4,208 transitions;
  - holdout: 1,792 transitions.
- Discovery/holdout grouping is by experimental group/report identity rather than individual transition, preventing the same report group from appearing on both sides.

The stage-1 audit already established that all extracted transitions occur after the previous target was destroyed. Therefore this report calls the recovered rule a **retarget rule**, not an initial-target rule.

## Why stage 1 looked much weaker

Stage 1 tested broad scalar heuristics and the current Asterion policy:

| Selector / signal | Stage-1 holdout top-1 |
|---|---:|
| random expectation | ~40.90% |
| min stack count | 54.58% |
| base threat softmax | 62.87% |
| current Asterion static reconstruction | 62.76% |

Those models treated target choice mainly as a score problem.

Stage 2 instead tested the categorical relationship between the **attacking ordinary ship class** and the **target ordinary ship class**. That signal is dominant.

Exploratory conditional-logit models using actor-target class features immediately jumped to roughly 98–99% holdout accuracy, which was intentionally treated as a clue rather than accepted as the final game rule. The final hypothesis below removes fitted coefficients entirely.

## Recovered ordinary-class rule

Known primary class mapping already present in Asterion:

| Attacker class | Primary target class |
|---|---|
| scout | defender |
| cruiser | scout |
| defender | bomber |
| battleship | cruiser |
| destroyer | battleship |
| bomber | destroyer |

Global fallback after the primary is unavailable:

```text
bomber > destroyer > battleship > defender > cruiser > scout
```

Equivalent per-attacker target orders:

| Attacker | Observed-compatible target order |
|---|---|
| scout | defender → bomber → destroyer → battleship → cruiser → scout |
| cruiser | scout → bomber → destroyer → battleship → defender → cruiser |
| defender | bomber → destroyer → battleship → defender → cruiser → scout |
| battleship | cruiser → bomber → destroyer → battleship → defender → scout |
| destroyer | battleship → bomber → destroyer → defender → cruiser → scout |
| bomber | destroyer → bomber → battleship → defender → cruiser → scout |

This should be read as a target-class hierarchy among the six ordinary combat classes, not as a damage multiplier table.

## Exact corpus fit

The coefficient-free `primary + global fallback` rule was evaluated with `tools/audit-nemexia-primary-fallback.mjs`.

### Ordinary ship-to-ship retargeting

| Partition | Eligible transitions | Correct | Accuracy |
|---|---:|---:|---:|
| discovery | 3,988 | 3,988 | 100% |
| holdout | 1,712 | 1,712 | 100% |
| controlled `target_priority` | 52 | 52 | 100% |
| discovery + holdout | 5,700 | 5,700 | 100% |

No contradiction to this six-class rule was found in the eligible mapped retarget corpus.

### Important validation caveat

The holdout was untouched during the original stage-1 coefficient fitting, but the final simple stage-2 hierarchy was formulated **after** stage-2 inspection had already exposed very strong actor/target-class structure and controlled-block behavior.

Therefore `1,712 / 1,712` is extremely strong **same-corpus confirmation**, but it is not a pristine external validation of a hypothesis frozen before any holdout inspection.

Fresh controlled Nemexia runs should still be used before calling the rule externally replicated.

## The controlled block exposed the direction of the priority plan

Stage 1 tested the first legal item in `priority_order_plan` and obtained only:

- 6 / 52 = 11.54%.

Stage 2 tested the **last** legal item and obtained:

- 52 / 52 = 100%.

This explains why the original interpretation of the saved priority order was misleading. The controlled rows are consistent with the recovered class hierarchy when the plan direction is interpreted correctly.

## Count, threat and population are not the ordinary-class selector

The recovered class hierarchy explains all eligible ordinary retargets without using:

- stack count;
- target population;
- target base threat;
- report position;
- fitted probabilities.

The earlier apparent usefulness of threat/count is therefore largely explained by correlation with which classes remain alive at a retarget point.

This does **not** prove those fields can never be used as a tie-break outside the observed scope. It proves they are not required to explain ordinary-class choice in the current corpus.

## Same-class tie-break remains unknown

The holdout contains **zero** eligible rows where two live candidates map to the same ordinary target class.

Therefore the audit cannot distinguish a same-class tie-break based on:

- report order;
- smallest count;
- largest threat;
- population;
- another hidden rule.

All of those tie-break variants produce the same result on the observed ordinary holdout because there is never a same-class choice to make.

For current faction catalogs this may be rare or structurally impossible for ordinary classes, but the selector should not claim a calibrated same-class rule from this corpus.

## Ordinary ships versus commanders

The scope audit found **188** transitions where at least one ordinary combat ship and at least one commander were simultaneously alive:

- discovery: 137;
- holdout: 51.

Observed behavior:

- Nemexia chose an ordinary combat ship in **188 / 188** cases.
- Applying the recovered ordinary-class order to the live ordinary candidates predicted the chosen ordinary target in **188 / 188** cases.

This strongly supports the existing broad Asterion idea that commanders are protected behind ordinary combat ships.

It does not yet prove their position relative to defenses or civilian/service ships.

## Commander-only evidence

There are 107 commander-only retarget transitions in the discovery + holdout corpus:

- discovery: 78;
- holdout: 29.

But 100 of those 107 transitions have only one live commander, so they contain no commander-order information.

Only **7** transitions contain two live commanders.

### Corsair vs Annihilator

Four rows contain the same two commanders at count 1 each, but the chosen target changes with the experiment:

| Transition | Case | Chosen |
|---:|---|---|
| 22 | `leader-Аннигилятор` | Корсар |
| 24 | `leader-Корсар` | Аннигилятор |
| 57 | `defender-leader-Аннигилятор` | Корсар |
| 59 | `defender-leader-Корсар` | Аннигилятор |

A fixed commander order is therefore falsified for these rows. The `leader-*` cases strongly indicate that active/leading-commander state matters, but the corpus export does not carry enough explicit leader-state metadata at each target decision to reconstruct the exact rule safely.

### Corsair vs Hunter

Three additional pair rows are available:

| Transition | Case | Chosen |
|---:|---|---|
| 2145 | `recon240-commanders-pair-Корсар-Охотник` | Охотник |
| 5865 | `calibration180-leader-attacker-pair-Охотник` | Корсар |
| 5880 | `calibration180-leader-defender-pair-Охотник` | Охотник |

Again, this is incompatible with a single unconditional `Корсар > Охотник` or `Охотник > Корсар` rule.

**Conclusion:** preserve commander-vs-commander behavior as uncalibrated until leader state is captured explicitly in controlled runs.

## Civilian/service ships

Only five relevant service-target transitions were found, all in discovery:

- transporter;
- mega-transporter;
- colonizer;
- recycler;
- spy-probe.

Every one of those rows had exactly one live candidate. They prove only that the entity can eventually be targeted. They contain **no ordering evidence** between service ships and no mixed ordinary/service comparison.

Do not infer a service priority table from these five rows.

## Defenses

The ordinary-class candidate mixes used for this stage are ship-only. This corpus does not establish the relative target priority of:

- ordinary ships versus defenses;
- one defense type versus another;
- commanders versus defenses.

The current Asterion defense behavior should not be rewritten from this audit.

## Death star

The six-class reconstruction intentionally excludes `death-star`. The current corpus does not provide comparable evidence strong enough to validate a death-star target hierarchy.

Keep the existing death-star handling explicitly uncalibrated until dedicated runs exist.

## Initial target selection is still a critical gap

The transition corpus records target changes after a previous target is destroyed. It does not directly capture the very first target decision of a battle.

The recovered retarget hierarchy may also be the initial hierarchy, but that is currently an extrapolation.

For parity work, initial selection must be tested independently before replacing the entire production selector with this rule.

## What this means for current Asterion code

Current `selectShipTarget` already applies `NEMEXIA_PRIMARY_TARGET_CLASS` when the preferred class is alive. If it is not alive, it falls back to `selectCombatTarget`, whose default policy is currently threat-led.

That fallback is the main ordinary-ship mismatch exposed by this audit.

### Safe implementation direction once approved

Do **not** replace `selectCombatTarget` globally.

A narrow parity patch should:

1. preserve the existing primary target mapping;
2. add the recovered ordinary-class fallback order;
3. apply it only to the six ordinary combat classes in evidence-backed ordinary-ship selection;
4. preserve current handling for commander-only, defense, service and death-star situations until separate evidence exists;
5. avoid claiming count/threat as a calibrated same-class tie-break;
6. add regression tests based on corpus examples and explicit class-order cases.

Because initial selection and mixed defense cases are not established, the exact production integration point should be decided only after the controlled probes below. A patch that blindly applies the retarget hierarchy to every target decision would exceed the evidence.

## Minimum fresh Nemexia probes before broad production replacement

### P0 — initial target selection

For each of the six ordinary attacker classes:

- put all six ordinary target classes alive at battle start;
- keep counts and technologies fixed;
- capture the first chosen target;
- repeat with the primary class removed;
- repeat with the next fallback class removed.

Goal: verify that the recovered retarget hierarchy is also the initial hierarchy.

### P0 — ordinary ship + defense

For each ordinary attacker class, create controlled candidate sets containing:

- its primary ordinary target + one defense;
- its first fallback ordinary target + one defense;
- defense only.

Goal: establish whether defense participates in the same hierarchy, has a separate tier, or is chosen by another rule.

### P1 — commander leader state

Use exactly two commanders with equal counts and no ordinary targets.

For each pair:

- commander A active leader;
- commander B active leader;
- swap report/list order without changing leader;
- repeat both attack and defense sides.

Export explicit leader identity with each target decision.

Goal: distinguish leader protection from list order or another commander rule.

### P1 — service ships

Create two or more simultaneous civilian/service targets and repeat with their list order permuted.

Goal: recover service ordering instead of relying on singleton rows.

### P1 — death star

Test death-star as:

- attacker against all ordinary classes;
- target alongside ordinary classes;
- target alongside commanders;
- only remaining combat target.

Goal: validate or replace current special handling.

### P2 — deterministic repeatability

Repeat identical target-choice setups enough times to detect RNG. Save the RNG seed if the game or harness exposes one.

## Confidence

| Claim | Confidence | Reason |
|---|---|---|
| Current threat fallback is wrong for ordinary ship-to-ship retargeting | **High** | recovered rule is 5,700/5,700 on non-controlled mapped retargets |
| Primary + fixed six-class fallback explains observed ordinary retargeting | **High in-corpus** | zero contradictions + 52/52 controlled |
| Ordinary combat ships are targeted before commanders when both remain | **High** | 188/188 mixed rows |
| Count/threat is required for ordinary-class selection | **Low / unsupported** | class rule explains all observed eligible rows without them |
| Same-class tie-break | **Unknown** | no holdout row with duplicate ordinary target class |
| Fixed commander order | **Rejected** | identical commander pairs produce different chosen commanders |
| Leader state affects commander selection | **Medium** | explicit `leader-*` cases correlate strongly, but state is not exported directly |
| Service ordering | **Unknown** | only singleton service targets |
| Defense ordering | **Unknown** | no suitable mixed evidence |
| Death-star ordering | **Unknown** | not calibrated by this scope |
| Initial selection uses the same hierarchy | **Plausible but unproven** | corpus is retarget-centric |

## Recommendation

The ordinary ship-to-ship **retarget** problem is no longer a vague 63%-accuracy inference problem. Within the available corpus, its class hierarchy is effectively recovered.

The next parity work should therefore stop fitting generic threat/count formulas and instead validate the remaining boundaries of the deterministic hierarchy with small controlled experiments.

Until those P0 probes exist, production combat should not receive a broad selector rewrite. If a narrow implementation is desired earlier, it must be explicitly scoped so it cannot silently invent behavior for defenses, initial target selection, death-star, services or commander-only situations.

## Reproducibility

Stage-2 analytical tools added on the audit branch:

- `tools/audit-nemexia-target-priority-stage2.mjs` — exploratory regularized conditional-logit feature audit;
- `tools/audit-nemexia-target-priority-ranking.mjs` — interpretable ordinary-class ranking diagnostics;
- `tools/audit-nemexia-primary-fallback.mjs` — coefficient-free final ordinary-class hypothesis test;
- `tools/audit-nemexia-target-priority-scope.mjs` — coverage and non-core scope diagnostics.

Temporary CI hooks/workflows used to execute large-corpus diagnostics were removed after result capture. No production combat behavior was changed by this stage.
