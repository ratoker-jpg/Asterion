# Nemexia target-priority audit

Date: 2026-09-28  
Scope: target selection / retargeting only. Damage, repair, action order, RNG implementation and other combat mechanics are outside this audit except where they constrain interpretation of target selection.

## Executive summary

**Recommendation: retain the current Asterion production selector as an explicitly `not-calibrated` approximation; do not replace it with a newly inferred Nemexia rule from this corpus.**

The corpus contains a real out-of-sample signal, but it does not identify one safe deterministic Nemexia target selector:

- Smaller live stacks are selected more often than chance. A discovery-fitted softmax proportional to approximately `count^-0.45` reaches **0.9296 mean log loss** and **978/1,792 = 54.58% top-1** on the untouched holdout. Report-clustered 95% bootstrap intervals are **0.8979–0.9620 log loss** and **52.47–57.13% top-1**.
- This is not a deterministic “attack the smallest stack” rule: the hard smallest-stack rule is contradicted in **814/1,792** holdout transitions.
- Stable report/list order is not supported. The discovery-fitted order coefficient is exactly `0`; first-live and last-live order score only **40.23%** and **40.74%** top-1 respectively on holdout.
- A source-stat threat proxy is more predictive than count alone on this holdout: **0.9232 mean log loss** and **1,126/1,791 = 62.87% top-1**. This is a predictive correlation, not proof that Nemexia computes the same threat score.
- A static reconstruction of the current Asterion selector, using source base stats instead of battle-specific upgraded runtime stats, gives **1,124/1,791 = 62.76% top-1**; report-clustered 95% bootstrap interval **60.73–65.18%**. It is therefore not justified to replace the current selector with the simpler smallest-stack heuristic.
- On the independent controlled `target_priority` block, count-only gives **42/52 = 80.77%**, count+order gives **44/52 = 84.62%**, while “first legal target in `priority_order_plan`” gives only **6/52 = 11.54%**. This rejects the supplied plan as a literal hard selector for these retarget events.
- The transition export does **not** contain per-candidate live shield %, live hull %, exact HP pool, exact kill probability, or spatial target-slot geometry. Those requested hypotheses cannot be honestly identified from this table and are marked untestable rather than guessed.

The strongest conclusion is therefore negative but useful: **fixed order, literal priority-plan order, pure min-count and pure random choice are all insufficient explanations.** The remaining evidence is consistent with a heterogeneous / hierarchical selector, but the exact hierarchy is not recoverable safely from these retarget transitions alone.

## 1. Corpus integrity and evidence tiers

Source bundle: `docs/evidence/nemexia-target-priority-corpus/`.

| Item | Count |
|---|---:|
| Raw report rows | 1,472 |
| Capture-error rows | 109 |
| Clean rows used for quantitative work | 1,363 |
| Clean verified rows | 1,154 |
| Clean older rows | 209 |
| Exported target transitions | 6,052 |
| Verified transitions | 5,886 |
| Older structurally valid transitions | 166 |

Per the bundle README, the older tier contains 208 detailed rows plus one clean summary-only row. Error rows are excluded from quantitative inference.

The audit runner revalidated all exported transitions against the raw JSONL source locator and keys:

- duplicate transition IDs: **0**;
- orphan transitions: **0**;
- `run_id` / `case_id` join disagreements: **0**;
- chosen target missing from the exported live candidate set: **0**;
- transitions where the previous target was still live at the switch: **0**.

This confirms that the 6,052 rows are retarget events after the prior target was destroyed; they are **not** independent initial-target observations.

## 2. Leakage-safe discovery / holdout design

The 52 transitions in experiment block `target_priority` were reserved as a separate controlled stratum and never used to fit coefficients.

All remaining rows were grouped by:

`experiment_block + comparison_key`

with raw report locator as fallback when no comparison key exists. Each whole group is assigned deterministically by SHA-256 bucket:

- bucket `< 70`: discovery;
- bucket `>= 70`: holdout.

Result:

| Split | Transitions | Raw reports | Experimental groups |
|---|---:|---:|---:|
| Discovery | 4,208 | 710 | 443 |
| Holdout | 1,792 | 286 | 157 |
| Controlled `target_priority` | 52 | separate | separate |

Leakage checks:

- discovery/holdout experimental-group overlap: **0**;
- discovery/holdout raw-report overlap: **0**.

Uncertainty intervals are bootstrapped by **raw report**, not by individual transition row, because multiple transitions from the same battle are correlated.

For a genuinely uniform random choice among current candidates, expected holdout top-1 accuracy is **40.90%**. The runner also reports a deterministic first-order tie-break for equal uniform probabilities; that value is not the randomized expectation and is not used as the random baseline conclusion.

## 3. Candidate information actually available

Each transition contains, for every currently live candidate:

- source name;
- live unit count;
- report/list `order`;
- kind;
- chosen current target;
- actor class/count/race/faction;
- round and side;
- experiment/comparison metadata.

The audit additionally maps candidate names to the existing Asterion source catalogs to derive **source-base** population and attack proxies.

Mapping coverage is 1,791/1,792 holdout rows and 52/52 controlled rows. The single holdout exclusion from source-stat models is a naming-mapping edge around `Polias`; count/order models still use that row.

Not available per alternative candidate:

- current shield percentage;
- current hull percentage / exact live HP pool;
- exact damage-to-kill probability for the acting stack;
- spatial target slot / coordinates / distance.

Therefore those variables cannot be reconstructed without inventing data.

## 4. Hypothesis audit

| Hypothesis | Test status | Holdout / controlled evidence | Verdict |
|---|---|---|---|
| Minimum shield % | Not identifiable | No per-candidate shield state in transition export | **Untestable with current corpus** |
| Minimum hull % only | Not identifiable | No per-candidate live HP/hull state | **Untestable** |
| Maximum kill probability | Not identifiable exactly | Requires actor effective damage + candidate current HP/armor state; not present for every alternative | **Untestable exactly** |
| Hard priority class / anti-class | Partially testable, heavily conditioned | Retarget rows only observe survivors after earlier kills. Count+preferred-class does not improve safely; fitted sign is negative, which is compatible with depletion/survivor bias rather than a real anti-preference | **Inconclusive from retarget corpus** |
| Actor-slot preference | Not identifiable | Actor source slot is not exported | **Untestable** |
| Stable target table/order independent of HP | Testable | first order 721/1,792 = 40.23%; last order 730/1,792 = 40.74%; order-only fitted coefficient `0` | **Rejected** |
| Nearest target slot / geometry | Not identifiable | `order` is report/list order, not spatial geometry | **Untestable** |
| Pure random / unexplained | Testable as baseline | uniform mean log loss 1.0698; expected randomized top-1 40.90%; count/threat models improve materially | **Rejected as sole explanation** |
| Minimum live stack count | Testable | soft count model LL 0.9296, top-1 54.58%; hard min-count has 814 contradictions | **Supported tendency, rejected as deterministic rule** |
| Maximum live stack count | Testable | 390/1,792 = 21.76% | **Rejected** |
| Minimum source-base total population | Testable proxy | 605/1,791 = 33.78% | **Rejected as simple rule** |
| Maximum source-base total population | Testable proxy | 947/1,791 = 52.88% | **Predictive signal, not sufficient rule** |
| Source-base threat proxy | Testable proxy | LL 0.9232; 1,126/1,791 = 62.87% | **Strong predictive signal; not proof of Nemexia formula** |
| Small lexicographic / hierarchical combinations | Limited test | count+order and count+source matchup tested; gains are inconsistent between log loss and top-1 and signs are confounded by survivor conditioning | **No safe source rule recovered** |

### Earliest / clear falsifiers

- **Stable first-order rule:** transition `1`, `battles-2026-09-15.jsonl:37`, round 1. All five candidate counts are 1, yet the selected target is `Бомбардировщик` at report order 4, not the first live entry.
- **Pure minimum-count rule:** transition `104`, `battles-2026-09-15.jsonl:294`, round 3. Candidate `Боевой корабль` has count 35, but `БомберБот` selects `Бомбардировщик` with count 115.
- **Pure minimum-count rule again:** transition `113`, same raw report, round 4. `Звездная Армада` has count 17, while the observed target is `БомберБот` with count 85.
- **Literal first-legal `priority_order_plan`:** only 6/52 controlled retargets match.

## 5. Holdout model comparison

Coefficients below were selected **only on discovery** and then frozen.

Discovery fits of interest:

- count model: `score = -0.45 * log(count)`;
- order model: `score = 0 * order`;
- count+order: `score = -0.45 * log(count) + 0.05 * order`;
- source-base threat: `score = 1.30 * log(count * baseAttack)`.

| Model | n | Mean log loss | Top-1 | Notes |
|---|---:|---:|---:|---|
| Uniform random probabilities | 1,792 | 1.0698 | 40.90% expected | random baseline |
| Count softmax | 1,792 | **0.9296** | 978/1,792 = **54.58%** | `p ∝ count^-0.45` |
| Count + order softmax | 1,792 | 0.9315 | 985/1,792 = 54.97% | order slightly helps top-1 but **worsens** LL vs count-only |
| Source-base population softmax | 1,791 | 1.0197 | 947/1,791 = 52.88% | fitted toward larger total population |
| Source-base threat softmax | 1,791 | **0.9232** | 1,126/1,791 = **62.87%** | predictive proxy only |
| Count + preferred-class softmax | 1,791 | 0.9267 | 977/1,791 = 54.55% | retarget survivor bias makes coefficient unsafe to interpret causally |
| Count + matchup softmax | 1,791 | **0.9159** | 921/1,791 = 51.42% | best tested LL but poor top-1 and negative matchup coefficient; unsafe as a game rule |
| Hard first report order | 1,792 | ∞ | 40.23% | 1,071 zero-probability misses |
| Hard last report order | 1,792 | ∞ | 40.74% | 1,062 misses |
| Hard smallest stack | 1,792 | ∞ | 54.58% | 814 misses |
| Hard largest stack | 1,792 | ∞ | 21.76% | 1,402 misses |
| Hard smallest source population | 1,791 | ∞ | 33.78% | 1,186 misses |
| Hard largest source population | 1,791 | ∞ | 52.88% | 844 misses |
| Current Asterion, static source-stat reconstruction | 1,791 | ∞ | **62.76%** | 667 misses; not exact runtime replay |

`∞` is intentional: a deterministic point-mass model assigns zero probability to every contradictory observed choice, so mean log loss is infinite once any contradiction exists.

### Report-clustered uncertainty

| Model | 95% top-1 interval | 95% log-loss interval |
|---|---:|---:|
| Count softmax | **52.47–57.13%** | **0.8979–0.9620** |
| Count + order | 52.69–57.44% | 0.9006–0.9639 |
| Current Asterion static reconstruction | **60.73–65.18%** | not a probabilistic model |

A separate bootstrap interval was not generated for source-base threat softmax, so only its point estimate is reported here.

## 6. Controlled `target_priority` block

This block was kept fully outside discovery fitting.

| Model | n | Mean log loss | Top-1 |
|---|---:|---:|---:|
| Uniform probabilities | 52 | 1.1990 | n/a as a unique ranking |
| Count softmax | 52 | **0.8830** | 42/52 = **80.77%** |
| Count + order | 52 | **0.8701** | 44/52 = **84.62%** |
| Source-base population softmax | 52 | 1.2236 | 6/52 = 11.54% |
| Current Asterion static reconstruction | 52 | ∞ | 36/52 = 69.23% |
| First legal entry from `priority_order_plan` | 52 | ∞ | **6/52 = 11.54%** |

The controlled block therefore strengthens the existence of a count-related signal, but it still does not justify a universal min-count rule: 10/52 events contradict hard min-count, and the main holdout contains 814 contradictions.

The modest controlled gain from adding `order` is not stable enough to promote order into a rule: on the main holdout count+order has **worse log loss** than count-only, and order-alone fitted to zero on discovery.

## 7. Stratified results and heterogeneity

### Verified vs older holdout

Count+order top-1:

- verified: 956/1,748 = **54.69%**;
- older: 29/44 = **65.91%** — too small to treat as a stable advantage.

Current Asterion static reconstruction:

- verified: 1,094/1,748 = **62.59%**;
- older: 30/43 = **69.77%**.

The one-row denominator difference is the unmapped `Polias` source-name edge.

### Actor faction

Count+order:

- Тертета: 51.59%;
- Конфедерация: 52.55%;
- Ноксы: 61.89%.

Current Asterion static reconstruction:

- Тертета: 59.67%;
- Конфедерация: 68.37%;
- Ноксы: 63.52%.

This is material heterogeneity; one global count coefficient is not a convincing complete mechanism.

### Actor-class examples

Count+order varies substantially by actor class: `Разрушитель` 32.38%, `Голиаф` 36.11%, `Бот Щит` 77.89%, `Немезис` 76.71%. Current Asterion static reconstruction changes the pattern: `Разрушитель` 64.76%, `Бомбардировщик` 74.65%, `Перехватчик` 49.65%, `Призрак` 47.06%.

Again, this is evidence against one simple universal scalar rule.

### Candidate composition

The holdout target sets are ships-only in this transition export. This audit therefore cannot establish a Nemexia ship-vs-defense target-order rule from the holdout data.

Actor slot is not exported, so actor-slot strata cannot be evaluated.

## 8. Raw-report spot checks

The runner reads the raw JSONL files directly and checks every transition locator against `run_id`, `case_id`, capture status and the chosen candidate set. All 6,052 joins pass.

Several disagreement rows were additionally inspected as source-anchored spot checks:

1. `battles-2026-09-15.jsonl:37`, run `c42bbc851806`, case `priority-4`, transition `1`. The raw `analysis_text` contains the observed action where `Перехватчик` attacks `Бомбардировщик`; this is the stable-order falsifier described above.
2. `battles-2026-09-15.jsonl:291`, run `043b7db1563a`, case `science-attacker-18-10`, transitions `89–91`. The raw row joins cleanly by both IDs and has no capture error; these transitions include cases where count and current Asterion static predictions disagree.
3. `battles-2026-09-15.jsonl:294`, run `043b7db1563a`, case `science-attacker-20-5`, including transition `104`. The raw row joins cleanly and provides a direct counterexample to hard min-count.

For older reports the free-form `analysis_text` is not consistently convenient for string-level action recovery. The audit therefore relies on the exported structured transition record only after its raw source join is validated; it does not invent missing text fields.

## 9. Current Asterion selector audit

Production-relevant target selection is in `src/domain/combat/resolver.ts`, not in commander-priority persistence code.

Current flow:

1. `selectShipTarget(...)` checks the saved Nemexia primary target class for a combat ship.
2. If at least one live candidate belongs to that preferred class, selection is restricted to that class.
3. `selectCombatTarget(...)` then applies target tiers:
   - ordinary combat ships and defense in the normal tier;
   - civilian/service ships later;
   - commanders last.
4. Default fallback priority is `threat`:
   - descending threat;
   - descending population;
   - stable catalog order;
   - lexical fallback.

`COMBAT_RULE_PROVENANCE.targetSelection` already marks this as `not-calibrated` with low confidence and explicitly states that the fallback is an Asterion policy rather than a proven Nemexia parity rule. That labeling is consistent with this audit and should remain.

### Static counterfactual limitation

The audit reconstruction uses source-base attack/population values because the transition CSV does not export the complete level/technology/effective-stat state for every alternative in a form sufficient to replay the exact Asterion runtime selector.

Therefore **62.76% is not claimed as exact production-runtime accuracy**. It is a static counterfactual showing that the current selector family is at least competitive with — and on top-1 clearly stronger than — the proposed simple count rule on the held-out corpus.

## 10. Counterfactual interpretation

### Reordering candidates

If report/list order were causal, an order coefficient should survive discovery and improve holdout robustly. It does not:

- order-only discovery coefficient = `0`;
- count+order changes holdout top-1 by only +0.39 percentage points;
- count+order worsens mean log loss from 0.9296 to 0.9315.

No safe order rule follows.

### Changing only stack count

The fitted count model monotonically favors smaller stacks, so count changes can flip its prediction. But 814 holdout contradictions prove that count alone is insufficient.

### Primary / matchup class

The current Asterion preferred-class rule originates from saved ship-page evidence and is not equivalent to the fallback selector. Retarget transitions are conditioned on earlier targets already having been destroyed, so later survivor pools are a biased place to re-estimate the initial class preference.

The negative fitted coefficients for preferred/matchup features must therefore **not** be interpreted as proof that Nemexia dislikes its documented preferred classes. A preferred class may simply have been consumed earlier in the battle.

### Threat / population

Source-base threat is a strong predictor here, but correlation does not identify the implementation. It may proxy for class, stack size, source stats, earlier depletion, or another hidden variable. The audit does not claim Nemexia literally calculates `count * baseAttack`.

## 11. Final recommendation

### Decision

**Retain current Asterion target selection for now. Do not change production combat code from this audit.**

Keep the rule provenance at `not-calibrated` / low confidence. Do not replace it with:

- hard minimum stack count;
- first/last report order;
- literal `priority_order_plan` order;
- an opaque fitted count+matchup formula.

### Confidence

- **High confidence:** stable report order is not the selector.
- **High confidence:** literal first-legal `priority_order_plan` is not the retarget selector in the controlled block.
- **High confidence:** hard min-count is incomplete / false as a universal rule.
- **Medium confidence:** live count and source-stat threat contain genuine predictive information.
- **Low confidence:** exact Nemexia hierarchy / RNG / tie-break mechanism. The current corpus does not identify it safely.

### Evidence needed to move from approximation to parity

Run targeted controlled experiments where only one factor changes at a time and record **initial target as well as retargets**:

1. Same actor and same candidate classes, vary only candidate counts over several ratios.
2. Same counts/classes, permute display/report order.
3. Same counts/order, swap one candidate into/out of the documented preferred class.
4. Capture per-candidate live shield, hull/HP and armor before every target decision.
5. Capture actor effective damage at the decision point so exact kill probability can be computed for every candidate.
6. Capture actual target-slot/position identifiers if the UI/server exposes them.
7. Repeat each controlled condition enough times to distinguish deterministic rules from weighted/random selection and save the Nemexia seed if any seed becomes observable.

That evidence would directly test the currently unidentifiable shield/hull/kill-probability/geometry hypotheses instead of fitting proxies.

## 12. Reproducibility

Audit runner added at:

`tools/audit-nemexia-target-priority.mjs`

It is isolated from the production combat runtime and reads only the evidence corpus plus existing source catalog data.

Suggested invocation from repository root:

```bash
node --experimental-strip-types --experimental-loader ./src/domain/combat/test-asset-loader.mjs tools/audit-nemexia-target-priority.mjs
```

The audit run used the PR #83 head corpus and calculated discovery coefficients before exposing holdout results. A temporary test hook was used only to execute the large-corpus runner in GitHub CI because the GitHub connector does not return the ~6.35 MB CSV directly. That hook was removed after metrics were captured.

No production combat file was modified by this audit.
