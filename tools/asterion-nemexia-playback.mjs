import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

import { COMBAT_CATALOG } from '../src/domain/combat/catalog.ts';
import { COMMANDER_ABILITIES, COMMANDER_IDS } from '../src/domain/combat/commanders.ts';
import { SIMULATOR_MAX_ROUNDS } from '../src/domain/combat/config.ts';
import { getFactionDefenseCatalog, getFactionShipCatalog } from '../src/domain/combat/faction-catalog.ts';
import { createDefaultCombatPriority } from '../src/domain/combat/priority.ts';
import { COMBAT_ENGINE_VERSION } from '../src/domain/combat/report.ts';
import { resolveCombat } from '../src/domain/combat/resolver.ts';
import { COMBAT_TECHNOLOGIES, createDefaultCombatTechnologies } from '../src/domain/combat/technologies.ts';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const raceFaction = new Map([[1, 'aegis'], [2, 'synod'], [3, 'veyra']]);
const sourceShipNames = new Map();
const legacyShipSlots = new Map();
const ordinaryShipIds = new Set(COMBAT_CATALOG.filter((entity) => entity.kind === 'ship' && entity.ordinaryClass).map((entity) => entity.id));
const roundStartCounterfireShipIds = new Set([...ordinaryShipIds, 'death-star']);
const supportedCombatActorIds = new Set(COMBAT_CATALOG.filter((entity) => entity.combat.attack > 0
  && (entity.kind !== 'ship' || entity.category === 'Боевой корабль')).map((entity) => entity.id));
const supportHullIds = new Set(COMBAT_CATALOG.filter((entity) => entity.kind === 'ship' && entity.category !== 'Боевой корабль').map((entity) => entity.id));
const engineVersion = COMBAT_ENGINE_VERSION;
// Effective Nemexia defense form slots differ from Asterion's catalog order;
// the source population control is checked against the mapped race catalog.
const defenseFormSlotToCatalogIndex = [0, 1, null, 2, 3, 7, 8, 4, 5, 6];
const normalizeName = (value) => String(value).trim().toLocaleLowerCase('ru-RU');
const commanderIdByName = new Map([
  ...Object.entries(COMMANDER_ABILITIES).map(([id, definition]) => [normalizeName(definition.commanderName), id]),
  ...COMMANDER_IDS.map((id) => [normalizeName(id), id]),
]);

function parseArgs(args) {
  const result = { archiveRoot: '', output: resolve(repositoryRoot, 'docs/evidence/nemexia-asterion-playback-summary.json'), trials: 3, limit: Infinity };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--archive-root') result.archiveRoot = resolve(args[++index] ?? '');
    else if (arg === '--output') result.output = resolve(args[++index] ?? '');
    else if (arg === '--trials') result.trials = Number(args[++index]);
    else if (arg === '--limit') result.limit = Number(args[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!result.archiveRoot) throw new Error('Pass --archive-root <Nemexia simulation-battles directory>.');
  if (!Number.isInteger(result.trials) || result.trials < 1) throw new Error('--trials must be a positive integer.');
  if (!(result.limit > 0)) throw new Error('--limit must be a positive integer.');
  return result;
}

function intValue(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Expected non-negative integer, got ${JSON.stringify(value)}.`);
  return number;
}

function controlValue(fields, name, fallback = 0) {
  const control = fields?.[name];
  if (control?.type === 'checkbox' && control.checked === false) return fallback;
  return intValue(control?.value, fallback);
}

function factionForRace(raceId, row, side) {
  const factionId = raceFaction.get(intValue(raceId, -1));
  if (!factionId) throw new Error(`${row.case_id}: unsupported ${side} Nemexia race id ${raceId}.`);
  return factionId;
}

function ensureShipMap(factionId) {
  if (!sourceShipNames.size) {
    for (const faction of raceFaction.values()) {
      const fixturePath = resolve(repositoryRoot, `src/domain/combat/source-fixtures/${faction}-ships.json`);
      const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
      const catalog = getFactionShipCatalog(faction);
      if (fixture.records.length !== catalog.length) throw new Error(`${faction}: source fixture and combat catalog ship counts differ.`);
      const map = new Map(fixture.records.map((record, index) => [record.sourceName, { index, entityId: catalog[index].id }]));
      sourceShipNames.set(faction, map);
      for (const [name, slot] of map) {
        const known = legacyShipSlots.get(name);
        if (known && known.index !== slot.index) throw new Error(`Nemexia source ship name maps to multiple catalog slots: ${name}.`);
        legacyShipSlots.set(name, slot);
      }
    }
  }
  return sourceShipNames.get(factionId);
}

function nonEmptyRecord(value) {
  return value && typeof value === 'object' && Object.keys(value).length > 0 ? value : null;
}

function readShipStacks(row, side, factionId, plannedCase) {
  const shipMap = ensureShipMap(factionId);
  const plannedRoster = nonEmptyRecord(plannedCase[`${side}_ships`])
    ?? nonEmptyRecord(side === 'attacker' ? row.own_ships : row.enemy_ships)
    ?? {};
  const plannedLevels = plannedCase[`${side}_levels`] ?? (side === 'defender' ? row.enemy_levels : row.own_levels) ?? {};
  const catalog = getFactionShipCatalog(factionId);
  const stacks = [];
  const sourceMirror = side === 'attacker' ? row.own_ships : row.enemy_ships;
  for (const [name, rawCount] of Object.entries(plannedRoster)) {
    const definition = shipMap.get(name) ?? legacyShipSlots.get(name);
    if (!definition) throw new Error(`${row.case_id}: ${side} ship name is not mapped: ${name}.`);
    const count = intValue(rawCount);
    const sourceCount = sourceMirror?.[name];
    if (sourceCount !== undefined && intValue(sourceCount) !== count) {
      throw new Error(`${row.case_id}: ${side} planned ${name} count does not match its JSONL roster mirror.`);
    }
    if (definition.index >= catalog.length) throw new Error(`${row.case_id}: ${side} source ship index ${definition.index + 1} exceeds the Asterion catalog.`);
    const rawLevel = plannedLevels[name];
    if (count > 0 && rawLevel === undefined) throw new Error(`${row.case_id}: ${side} level is missing for ${name}.`);
    if (count > 0) stacks.push({ entityId: catalog[definition.index].id, count, level: intValue(rawLevel) });
  }
  return stacks;
}

function readDefenses(row, fields, plannedCase, defenderFactionId) {
  const catalog = getFactionDefenseCatalog(defenderFactionId);
  const stacks = [];
  for (let slot = 1; slot <= defenseFormSlotToCatalogIndex.length; slot += 1) {
    const count = controlValue(fields, `defenderDefenceCount-${slot}`);
    const level = controlValue(fields, `defenderDefenceLevel-${slot}`);
    const catalogIndex = defenseFormSlotToCatalogIndex[slot - 1];
    if (count > 0 && catalogIndex === null) throw new Error(`${row.case_id}: populated defense form slot ${slot} has no Asterion catalog mapping.`);
    if (catalogIndex !== null && catalogIndex !== undefined) {
      const entity = catalog[catalogIndex];
      if (!entity) throw new Error(`${row.case_id}: defense slot ${slot} maps outside ${defenderFactionId} catalog.`);
      const sourcePopulation = controlValue(fields, `defenderDefencePop-${slot}`, entity.population);
      if (sourcePopulation !== entity.population) {
        throw new Error(`${row.case_id}: defense slot ${slot} population ${sourcePopulation} does not match ${entity.id} catalog population ${entity.population}.`);
      }
      if (count > 0) stacks.push({ entityId: entity.id, count, level });
    }
  }
  const plannedDefense = nonEmptyRecord(plannedCase.defender_defence) ?? nonEmptyRecord(row.enemy_defence) ?? {};
  const plannedTotal = Object.values(plannedDefense).reduce((total, value) => total + intValue(value), 0);
  const formTotal = stacks.reduce((total, stack) => total + stack.count, 0);
  if (plannedTotal !== formTotal) throw new Error(`${row.case_id}: defender defense total ${formTotal} does not match planned case total ${plannedTotal}.`);
  for (let slot = defenseFormSlotToCatalogIndex.length + 1; slot <= 20; slot += 1) {
    const count = controlValue(fields, `defenderDefenceCount-${slot}`);
    if (count > 0) throw new Error(`${row.case_id}: defense form slot ${slot} has ${count}, outside the Asterion catalog.`);
  }
  for (let slot = 1; slot <= 20; slot += 1) {
    const count = controlValue(fields, `attackerDefenceCount-${slot}`);
    if (count > 0) throw new Error(`${row.case_id}: attacker defense input is unsupported by the shared combat input.`);
  }
  return stacks;
}

function readCommanders(row, side, plannedCase) {
  const roster = plannedCase[`${side}_commanders`] ?? {};
  const commanders = [];
  for (const [name, raw] of Object.entries(roster)) {
    const commanderId = commanderIdByName.get(normalizeName(name));
    if (!commanderId) throw new Error(`${row.case_id}: ${side} commander name is not mapped: ${name}.`);
    const count = Array.isArray(raw) ? intValue(raw[0]) : intValue(raw?.count);
    const level = Array.isArray(raw) ? intValue(raw[1]) : intValue(raw?.level);
    if (count > 0) commanders.push({ entityId: commanderId, count, level });
  }
  const leadName = plannedCase[`${side}_lead`] ?? '';
  const activeCommanderId = leadName ? commanderIdByName.get(normalizeName(leadName)) : null;
  if (leadName && (!activeCommanderId || !commanders.some((stack) => stack.entityId === activeCommanderId))) {
    throw new Error(`${row.case_id}: ${side} lead commander ${leadName} is not in its planned roster.`);
  }
  return { commanders, activeCommanderId };
}

function readTechnologies(fields, side, plannedCase) {
  const result = createDefaultCombatTechnologies();
  const planned = plannedCase[`${side}_sciences`] ?? {};
  for (const technology of COMBAT_TECHNOLOGIES) {
    const scienceId = technology.sourceScienceId;
    const value = fields?.[`${side}ScienceLevel-${scienceId}`]?.value;
    result[technology.id] = value === undefined
      ? intValue(planned[String(scienceId)], 0)
      : intValue(value, 0);
  }
  return result;
}

function mapInput(row, seed) {
  const effective = row.effective_form;
  const plannedCase = row.planned_case;
  if (!effective?.fields || !plannedCase) throw new Error(`${row.case_id}: no complete effective form or planned case.`);
  const attackerFactionId = factionForRace(effective.attackerRaceId, row, 'attacker');
  const defenderFactionId = factionForRace(effective.defenderRaceId, row, 'defender');
  const fields = effective.fields;
  const attackerShips = readShipStacks(row, 'attacker', attackerFactionId, plannedCase);
  const defenderShips = readShipStacks(row, 'defender', defenderFactionId, plannedCase);
  const defenses = readDefenses(row, fields, plannedCase, defenderFactionId);
  const attackerCommander = readCommanders(row, 'attacker', plannedCase);
  const defenderCommander = readCommanders(row, 'defender', plannedCase);
  const maxRounds = intValue(effective.rounds);
  if (!SIMULATOR_MAX_ROUNDS.includes(maxRounds)) throw new Error(`${row.case_id}: unsupported requested round limit ${maxRounds}.`);
  const priority = createDefaultCombatPriority();
  const raceNames = {
    aegis: 'Конфедерация',
    synod: 'Синод',
    veyra: 'Ноксы',
  };
  const timestamp = row.saved_at && Number.isFinite(Date.parse(row.saved_at)) ? new Date(row.saved_at).toISOString() : '2026-09-16T00:00:00.000Z';
  const attackerHasCombatActor = [...attackerShips, ...attackerCommander.commanders]
    .some((stack) => supportedCombatActorIds.has(stack.entityId));
  const defenderHasCombatActor = [...defenderShips, ...defenderCommander.commanders, ...defenses]
    .some((stack) => supportedCombatActorIds.has(stack.entityId));
  return {
    input: {
      scenarioId: `nemexia-archive:${row.run_id}:${row.case_id}`,
      timestamp,
      seed,
      maxRounds,
      attackerPriority: priority.attack,
      defenderPriority: priority.defense,
      technologyMode: 'independent',
      executionMode: 'production',
      attackerTechnologies: readTechnologies(fields, 'attacker', plannedCase),
      defenderTechnologies: readTechnologies(fields, 'defender', plannedCase),
      attacker: {
        participant: { playerId: `${row.run_id}:attacker`, playerName: 'Nemexia archive attacker', side: 'attacker', race: raceNames[attackerFactionId] },
        factionId: attackerFactionId,
        ships: attackerShips,
        commanders: attackerCommander.commanders,
        activeCommanderId: attackerCommander.activeCommanderId,
      },
      defender: {
        participant: { playerId: `${row.run_id}:defender`, playerName: 'Nemexia archive defender', side: 'defender', race: raceNames[defenderFactionId] },
        factionId: defenderFactionId,
        ships: defenderShips,
        commanders: defenderCommander.commanders,
        activeCommanderId: defenderCommander.activeCommanderId,
        defenses,
      },
    },
    attackerHasCombatActor,
    defenderHasCombatActor,
    hasCombatActor: attackerHasCombatActor || defenderHasCombatActor,
  };
}

async function* readRows(filePath) {
  const lines = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    yield JSON.parse(line);
  }
}

function collectRoundChecks(report, checks) {
  for (const round of report.rounds) {
    checks.rounds += 1;
    const attacks = round.events.filter((event) => event.actionType === 'attack');
    const attackerAttacks = attacks.filter((event) => event.actorSide === 'attacker');
    const defenderAttacks = attacks.filter((event) => event.actorSide === 'defender');
    if (attackerAttacks.length && defenderAttacks.length) {
      checks.attackPhaseOrderCases += 1;
      let sawDefender = false;
      for (const event of attacks) {
        if (event.actorSide === 'defender') sawDefender = true;
        else if (event.actorSide === 'attacker' && sawDefender) {
          checks.attackPhaseOrderFailures += 1;
          break;
        }
      }
    }

    const defenderStarts = new Map((round.defenderSnapshot?.stacks ?? []).map((stack) => [stack.entityId, stack.countBefore]));
    for (const event of defenderAttacks) {
      if (!roundStartCounterfireShipIds.has(event.actorEntityId)) continue;
      checks.defenderStartCountChecks += 1;
      if ((defenderStarts.get(event.actorEntityId) ?? 0) !== event.actorCount) checks.defenderStartCountFailures += 1;
    }

    const targetStarts = new Map([
      ...(round.defenderSnapshot?.stacks ?? []).map((stack) => [stack.entityId, stack.countBefore]),
      ...(round.defenderSnapshot?.defenses ?? []).map((stack) => [stack.entityId, stack.countBefore]),
    ]);
    const attackerKills = new Map();
    for (const event of attacks) {
      if (event.actorSide !== 'attacker' || event.targetSide !== 'defender' || !event.targetEntityId) continue;
      attackerKills.set(event.targetEntityId, (attackerKills.get(event.targetEntityId) ?? 0) + (event.destroyedCount ?? 0));
    }
    const responderIds = new Set(defenderAttacks.map((event) => event.actorEntityId));
    for (const [entityId, countBefore] of targetStarts) {
      if (countBefore > 0 && (attackerKills.get(entityId) ?? 0) >= countBefore && responderIds.has(entityId)) {
        checks.destroyedDefenderResponses += 1;
      }
    }
  }
}

function makeGroup(groups, row) {
  const runId = row.run_id ?? 'unknown-run';
  const experimentBlock = row.experiment_block ?? 'unassigned';
  const comparisonKey = row.comparison_key ?? '';
  const key = `${runId}||${experimentBlock}||${comparisonKey}`;
  if (!groups[key]) {
    groups[key] = {
      runId,
      experimentBlock,
      comparisonKey,
      sourceCases: 0,
      trials: 0,
      outcomes: { attacker: 0, defender: 0, draw: 0 },
      rounds: 0,
      meanRounds: 0,
    };
  }
  return groups[key];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const archiveFiles = (await readdir(options.archiveRoot)).filter((name) => /^battles-.*\.jsonl$/i.test(name)).sort();
  if (!archiveFiles.length) throw new Error(`No battles-*.jsonl files under ${options.archiveRoot}.`);

  const summary = {
    schemaVersion: 2,
    engineVersion,
    purpose: 'Structural resolver playback over saved Nemexia compositions; Nemexia seed is absent, so winner totals are diagnostics rather than per-fight parity targets.',
    inputSource: 'effective_form for actual race, technology, defense counts and requested round limit; planned_case ship names, counts, levels and commanders cross-checked against JSONL roster mirrors; campaign grouping fields retained as metadata only.',
    harnessBoundary: 'Target-priority/comparison/factor metadata is not mapped as a Nemexia game rule. Asterion uses its own default target selector. No points, rewards, stats or balance values are compared or changed.',
    correctionToPreviousPlayback: 'The previous 4,053-trial sweep omitted 12 support-order profiles. All 12 have combat hulls on both sides plus one additional support hull on the attacker; they are included here. The old “service-only” label was inaccurate, and the previous runner/filter was not persisted.',
    seedScheme: 'nemexia-archive-playback:v5:<run_id>:<case_id>:trial-<1-based trial>; deterministic unique explicit seeds saved per trial for replay.',
    archiveRows: 0,
    cleanRows: 0,
    supportedCases: 0,
    ran: 0,
    skippedServiceComposition: 0,
    validationFailureCount: 0,
    validationFailures: [],
    missingNames: {},
    outcomes: { attacker: 0, defender: 0, draw: 0 },
    checks: {
      rounds: 0,
      attackPhaseOrderCases: 0,
      attackPhaseOrderFailures: 0,
      defenderStartCountChecks: 0,
      defenderStartCountFailures: 0,
      destroyedDefenderResponses: 0,
    },
    compositionDiagnostics: { noAttackerCombatActor: [], noDefenderCombatActor: [] },
    grouped: {},
    supportHullCases: [],
    trials: [],
  };

  for (const fileName of archiveFiles) {
    for await (const row of readRows(resolve(options.archiveRoot, fileName))) {
      summary.archiveRows += 1;
      if (typeof row.error === 'string' && row.error.trim()) continue;
      if (!Number.isInteger(row.rounds) || row.rounds <= 0) continue;
      summary.cleanRows += 1;
      try {
        const supported = mapInput(row, 'preflight-seed');
        if (!supported.attackerHasCombatActor) summary.compositionDiagnostics.noAttackerCombatActor.push({ file: fileName, runId: row.run_id, caseId: row.case_id });
        if (!supported.defenderHasCombatActor) summary.compositionDiagnostics.noDefenderCombatActor.push({ file: fileName, runId: row.run_id, caseId: row.case_id });
        const presentSupportHulls = [...new Set([...supported.input.attacker.ships, ...supported.input.defender.ships]
          .map((stack) => stack.entityId).filter((entityId) => supportHullIds.has(entityId)))];
        if (presentSupportHulls.length) summary.supportHullCases.push({
          file: fileName,
          runId: row.run_id,
          caseId: row.case_id,
          supportHullIds: presentSupportHulls,
        });
        if (!supported.hasCombatActor) {
          summary.skippedServiceComposition += 1;
          continue;
        }
        summary.supportedCases += 1;
        const group = makeGroup(summary.grouped, row);
        group.sourceCases += 1;
        for (let trial = 1; trial <= options.trials; trial += 1) {
          const seed = `nemexia-archive-playback:v5:${row.run_id}:${row.case_id}:trial-${trial}`;
          const mapped = mapInput(row, seed);
          const report = resolveCombat(mapped.input, {
            reportId: `${row.run_id}:${row.case_id}:trial-${trial}`,
            allowPopulationOverflow: true,
          });
          if (report.metadata.rngProvenance.mode !== 'seeded' || report.metadata.rngProvenance.seed !== seed) {
            throw new Error(`${row.case_id}: resolved report did not persist its explicit playback seed.`);
          }
          summary.ran += 1;
          summary.outcomes[report.winner] += 1;
          collectRoundChecks(report, summary.checks);
          group.trials += 1;
          group.outcomes[report.winner] += 1;
          group.rounds += report.rounds.length;
          summary.trials.push({
            runId: row.run_id,
            caseId: row.case_id,
            experimentBlock: row.experiment_block ?? null,
            comparisonKey: row.comparison_key ?? null,
            replicate: row.replicate ?? null,
            trial,
            seed,
            winner: report.winner,
            rounds: report.rounds.length,
          });
        }
      } catch (error) {
        summary.validationFailureCount += 1;
        summary.validationFailures.push({ file: fileName, lineCaseId: row.case_id ?? null, message: error instanceof Error ? error.message : String(error) });
      }
      if (summary.cleanRows >= options.limit) break;
    }
    if (summary.cleanRows >= options.limit) break;
  }

  for (const group of Object.values(summary.grouped)) {
    group.meanRounds = group.trials ? group.rounds / group.trials : 0;
  }
  if (options.limit === Infinity && summary.ran !== summary.supportedCases * options.trials) {
    summary.validationFailureCount += 1;
    summary.validationFailures.push({ message: 'Run count does not equal supported case count times trials.' });
  }
  if (summary.validationFailureCount > 0) {
    const failurePath = options.output.replace(/\.json$/i, '.failures.json');
    writeFileSync(failurePath, `${JSON.stringify(summary.validationFailures, null, 2)}\n`);
    throw new Error(`${summary.validationFailureCount} archive playback validation failures; details: ${failurePath}`);
  }

  writeFileSync(options.output, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({
    archiveRows: summary.archiveRows,
    cleanRows: summary.cleanRows,
    supportedCases: summary.supportedCases,
    ran: summary.ran,
    skippedServiceComposition: summary.skippedServiceComposition,
    outcomes: summary.outcomes,
    checks: summary.checks,
    output: options.output,
  }, null, 2));
}

await main();
