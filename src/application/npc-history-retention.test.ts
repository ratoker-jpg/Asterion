import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSaveState } from './persistence.ts';
import {
  FOREIGN_PIRATE_BATTLE_REPORT_LIMIT,
  PIRATE_ROLL_LEDGER_MARGIN_MS,
  pruneCampaignHistory,
} from './history-retention.ts';
import type { SaveState } from './contracts.ts';
import type { BattleReport } from '../domain/combat/report.ts';
import type { FlightRecord } from '../domain/flights/types.ts';

const AT = Date.UTC(2026, 0, 10);

function base(): SaveState {
  return createInitialSaveState('production', AT);
}

function report(id: string, defender: string, missionType = 'pirate-raid', attacker = 'pirates'): BattleReport {
  return { id, missionType, attacker: { playerId: attacker }, defender: { playerId: defender } } as unknown as BattleReport;
}

function raidFlight(id: string, phase: FlightRecord['phase'], targetKind: 'npc' | 'player', owner: string): FlightRecord {
  return {
    id, requestId: `req-${id}`, ownerSide: 'pirate', missionId: 'pirate-raid', phase, targetKind,
    destinationOwnerId: owner, originPlanetId: `pirate-contact-${id}`,
  } as unknown as FlightRecord;
}

test('keeps the newest 200 pirate-vs-NPC reports and never touches player, saved or live-flight reports', () => {
  const state = base();
  const player = state.profile.playerId;
  const foreign = Array.from({ length: FOREIGN_PIRATE_BATTLE_REPORT_LIMIT + 50 }, (_, i) => report(`foreign-${i}`, `npc-gen-${i % 7}`));
  const own = [report('player-raid', player), report('player-attack', 'npc-gen-1', 'attack', player), report('elimination', 'pirates', 'pirate-elimination', player)];
  const live = raidFlight('live', 'returning', 'npc', 'npc-gen-2');
  const prepared: SaveState = {
    ...state,
    combat: { reports: [...own.slice(0, 1), ...foreign, ...own.slice(1), report('battle-pirate-raid-live', 'npc-gen-2')], savedReportIds: ['foreign-0'] },
    flights: { records: [live], requestIndex: { [live.requestId]: live.id } },
  };
  const pruned = pruneCampaignHistory(prepared);
  const ids = pruned.combat.reports.map((item) => item.id);
  for (const id of ['player-raid', 'player-attack', 'elimination', 'foreign-0', 'battle-pirate-raid-live']) assert.ok(ids.includes(id), id);
  const keptForeign = ids.filter((id) => id.startsWith('foreign-'));
  // Saved foreign-0 (and the live raid's report) stay on top of the newest 200.
  assert.equal(keptForeign.length, FOREIGN_PIRATE_BATTLE_REPORT_LIMIT + 1);
  assert.deepEqual(keptForeign.slice(1), foreign.slice(-FOREIGN_PIRATE_BATTLE_REPORT_LIMIT).map((item) => item.id));
  assert.deepEqual(pruned.combat.savedReportIds, ['foreign-0']);
  assert.equal(pruneCampaignHistory(pruned), pruned, 'nothing more to prune returns the same object');
});

test('drops only completed pirate raid flights against NPCs and their request index entries', () => {
  const state = base();
  const player = state.profile.playerId;
  const records = [
    raidFlight('done-npc', 'completed', 'npc', 'npc-gen-1'),
    raidFlight('back-npc', 'returning', 'npc', 'npc-gen-1'),
    raidFlight('out-npc', 'outbound', 'npc', 'npc-gen-2'),
    raidFlight('failed-npc', 'failed', 'npc', 'npc-gen-3'),
    raidFlight('done-player', 'completed', 'player', player),
  ];
  const prepared: SaveState = {
    ...state,
    flights: { records, requestIndex: Object.fromEntries(records.map((flight) => [flight.requestId, flight.id])) },
  };
  const pruned = pruneCampaignHistory(prepared);
  assert.deepEqual(pruned.flights.records.map((flight) => flight.id), ['back-npc', 'out-npc', 'failed-npc', 'done-player']);
  assert.deepEqual(Object.keys(pruned.flights.requestIndex).sort(), ['req-back-npc', 'req-done-player', 'req-failed-npc', 'req-out-npc']);
  const untouched = base();
  assert.equal(pruneCampaignHistory(untouched), untouched);
});

test('roll ledger keeps entries inside the margin and those whose raid is still flying', () => {
  const state = base();
  const cursor = AT;
  const old = cursor - PIRATE_ROLL_LEDGER_MARGIN_MS - 1;
  const live = raidFlight('live', 'outbound', 'npc', 'npc-gen-1');
  const prepared: SaveState = {
    ...state,
    flights: { records: [live], requestIndex: { [live.requestId]: live.id } },
    pirate: {
      ...state.pirate!,
      raidProcessedAt: cursor,
      raidRolls: {
        stale: { checkAt: old, seed: 's1' },
        staleFlying: { checkAt: old, seed: 's2', flightId: 'live' },
        margin: { checkAt: cursor - PIRATE_ROLL_LEDGER_MARGIN_MS, seed: 's3' },
        current: { checkAt: cursor, seed: 's4' },
      },
    },
  };
  const pruned = pruneCampaignHistory(prepared);
  assert.deepEqual(Object.keys(pruned.pirate!.raidRolls!), ['staleFlying', 'margin', 'current']);
  assert.equal(pruned.pirate!.raidProcessedAt, cursor);
  assert.deepEqual(pruned.pirate!.ownerThreats, prepared.pirate!.ownerThreats);
  assert.equal(pruneCampaignHistory(pruned), pruned);
});
