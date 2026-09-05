# Operations prototype v1 — accepted visual, unfinished gameplay

Status: **PROTOTYPE / NOT FINAL GAMEPLAY**

This note records the product state after visual review of PR #33.

## What is accepted

The current **visual composition of the Operations screen is accepted as the direction** and should not be redesigned again without a new explicit visual request.

Keep:

- left operation/contact feed;
- right selected-operation tactical dossier;
- dark/cyan Asterion command-console language;
- tactical scan/radar presentation;
- current Threat / Intel / Objective / Reward hierarchy;
- materially different Unknown Signal presentation;
- Available / Active / Completed tabs as the high-level information architecture.

Future work should improve gameplay and data behind this screen, not restart the visual concept.

---

## Important: current operations are fixtures

The current operation catalog is **test/demo content used to prove domain, persistence and UI boundaries**.

It is not the final PvE operation set.

Do not treat the current four operation fixtures, their rewards, threat values, modifiers, names or distribution as final game design/balance.

Future Operations must add substantially more variation through combinations of:

- operation archetype;
- operation level;
- threat;
- intel;
- objective;
- optional objective;
- enemy package;
- environment/special modifier;
- reward package;
- failure rule;
- discovery/reveal source;
- later escalation / linked operation.

The intended replayability is **not** “many manually written cards”. It should primarily come from reusable objectives, intel states, modifiers and enemy packages.

---

## Intended lifecycle

The current PR proves only the early part of the lifecycle.

Target flow:

```text
AVAILABLE
  ↓
player inspects operation
  ↓
ACCEPT OPERATION
  ↓
ACTIVE / PREPARATION
  ↓
PREPARE FLEET
  ↓
choose actual owned ships + quantities
choose commander when commander assignment exists
validate operation requirements / population / restrictions
  ↓
DISPATCH THIS FLEET TO THIS OPERATION
  ↓
IN PROGRESS
  ↓
combat / non-combat resolution
  ↓
RESULT
  ↓
BattleReport / OperationReport
  ↓
COMPLETED / FAILED / RETREATED
```

### State rule

Default generated operations should start in **Available**.

Accepting an operation must move **only the selected operation** into the active/preparation state.

Operations must not all appear Active by default.

Visual QA reported a case where all operations appeared under Active. This must be reproduced before declaring the state flow final. Possible persisted-save influence must be checked rather than assumed.

Expected canonical behavior after Prototype Reset:

- generated fixtures: Available;
- Active: empty;
- Completed: empty.

---

## Fleet integration is currently incomplete

Current `К ФЛОТАМ` only navigates to the existing Fleet root.

That is **not sufficient final gameplay**.

The player currently has no clear way to answer:

> Which ships am I sending to the operation I just accepted?

The future integration must carry explicit operation context into Fleet preparation.

Recommended flow:

```text
Operations
→ accept operation
→ PREPARE FLEET / К ФЛОТАМ
→ Fleet opens with selected operation context
→ operation banner/summary remains visible
→ player selects owned ships and quantities
→ optional commander assignment
→ validation
→ SEND TO OPERATION
```

Fleet must not create a second copy of operation data and Operations must not create a second copy of Fleet composition UI.

The canonical operation should be referenced by `operationId`.

### Minimum Fleet preparation UI later

When entering Fleet from an active operation, show a compact persistent context block such as:

```text
ПОДГОТОВКА К ОПЕРАЦИИ
ПИРАТСКАЯ ЭСКАДРА
Угроза III · Система 1:07

Выбрано кораблей: 18
Население: 240 / лимит
Командир: —

[ОТПРАВИТЬ НА ОПЕРАЦИЮ]
```

The normal Fleet root must continue to work when opened without an operation context.

---

## Operation Level is missing

Threat Tier alone is not enough.

Future domain/UI should distinguish at least:

### Operation Level

Represents progression/content level.

It can influence later balancing such as:

- enemy budget / available enemy classes;
- reward budget;
- available modifiers;
- possible objectives;
- rarity/escalation pool;
- minimum progression or technology requirements.

### Threat Tier

Represents the danger of this **specific generated instance**.

Example:

```text
Операция: уровень 6
Угроза: III — серьёзная
Intel: 2 / 3
```

Exact formulas and level ranges are **not defined yet** and must not be invented in the current PR.

Do not silently reinterpret current Threat I–VI as Operation Level.

---

## Accept feedback is too weak

Current player feedback after `ПРИНЯТЬ ОПЕРАЦИЮ` is not strong enough.

The player must immediately see a meaningful state change.

Future polish should make acceptance obvious without redesigning the whole screen, for example:

- selected operation disappears from Available and appears in Active;
- Active tab count changes clearly;
- dossier command bar changes from `ПРИНЯТЬ ОПЕРАЦИЮ` to preparation actions;
- strong `ОПЕРАЦИЯ ПРИНЯТА / ПОДГОТОВКА` state label;
- primary action becomes `ПОДГОТОВИТЬ ФЛОТ` / `К ФЛОТАМ`;
- return from Fleet should preserve the operation context.

This is interaction/state feedback work, not a visual-layout redesign.

---

## Rewards are placeholder balance

Current examples such as resource rewards are **preview fixtures only**.

Do not lock balance around the current values.

Future rewards should use a reward budget influenced by at least:

- operation level;
- threat;
- objective;
- optional objective;
- rarity;
- later modifier/intel risk.

Potential reward categories from the PvE research include:

- metal;
- minerals;
- gas;
- salvage;
- intel;
- research data;
- operation/escalation unlock;
- later blueprint/module/rare reward.

Avoid introducing a new universal Operations currency without a separate product decision.

---

## Operation variety is intentionally incomplete

The current fixture set must expand later.

Priority future archetypes/patterns:

1. Pirate elimination.
2. Raider/interception contact.
3. Unknown signal → reveal.
4. Derelict/recovery.
5. Convoy interception when escape objectives exist.
6. Convoy defense when protected-unit objectives exist.
7. Target/flagship hunt when target objectives exist.
8. Wave defense when reinforcement/wave hooks exist.
9. Anomaly/science operation when a real non-combat check exists.
10. Rare escalation / linked follow-up operation.

Do not expose a card as if its special gameplay exists when the underlying resolver does not support it yet.

---

## Global scroll remains a QA requirement

PR #33 changed Operations from fixed/clipped height to natural height so it can participate in the existing shared `GlobalPageScrollController` contract.

However visual QA still raised uncertainty that the global scroll may not behave correctly in all Operations states.

Do not mark this as fully resolved based only on CSS/build success.

Before final Operations completion, manually verify:

1. no scrollbar when the 1920×1080 Operations screen fits;
2. global document scrollbar appears when Operations is genuinely taller;
3. mouse wheel/PageDown scroll the whole Asterion page;
4. no nested whole-screen Operations scrollbar;
5. bottom actions are reachable;
6. no clipping;
7. no huge empty tail;
8. returning to Planet / Universe / Fleet restores normal geometry.

If it fails, fix the existing generic global-scroll contract rather than adding a separate Operations scroll system.

---

## Explicitly deferred after PR #33

PR #33 should not be interpreted as implementing the following:

- real operation fleet dispatch;
- owned-fleet binding to an operation;
- commander assignment;
- operation level/balance model;
- procedural operation generator;
- enemy budget generation;
- combat execution;
- completion/failure runtime;
- reward application;
- BattleReport/OperationReport linkage;
- Repair Workshop flow;
- optional objectives;
- escalation chains;
- operation refresh/progression rules;
- final global-scroll manual certification.

---

## Product direction summary

**Keep the current visual Operations console. Rebuild the gameplay loop underneath it.**

Next meaningful Operations implementation should focus on:

```text
Operation Level
+ correct Available → Active lifecycle
+ visible acceptance feedback
+ operation-aware Fleet preparation
+ actual ship selection and dispatch contract
```

Only after that should the project invest heavily in procedural variety, advanced objectives, modifiers and escalation.
