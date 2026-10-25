import assert from 'node:assert/strict';
import test from 'node:test';

import { createAlliance, applyToAlliance, acceptApplication } from '../domain/command/membership.ts';
import { DEFAULT_ALLIANCE_EMBLEM } from '../domain/command/catalog.ts';
import { createResourceRequest, grantAidChargesForTest } from '../domain/command/aid.ts';
import { beginFlightReturn } from '../domain/flights/runtime.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import { createInitialSaveState } from './persistence.ts';
import type { SaveState } from './contracts.ts';
import { dispatchNpcAid, getNpcAidCandidates, resolveNpcAidArrival, settleNpcAidReturn } from './npc-aid.ts';

const NOW = Date.UTC(2026, 9, 24);

function setup() {
  const config = createDefaultNewGameConfig({ seed: 'NPC-AID-ADAPTER', factionId: 'aegis', playerName: 'Aid Test' });
  const initial = createInitialSaveState('production', NOW, { ...config, world: { ...config.world, npcCount: 1 } });
  const ownerId = Object.keys(initial.npc!.profiles)[0]!;
  const source = Object.values(initial.espionage?.targets ?? {}).find((target) => target.ownerId === ownerId)!;
  const origin = {
    ...source,
    fleet: { ...source.fleet, ships: { ...source.fleet.ships, transporter: 100, 'mega-transporter': 20 } },
    // Full stores with room to grow: the free surplus above the owner's reserve covers a 50 000 request.
    buildings: { ...source.buildings, 'metal-storage': Math.max(Number(source.buildings['metal-storage'] ?? 0), 8) },
    resources: { ...source.resources, metal: 0, minerals: 75_000, gas: 75_000, debris: 75_000 },
  };
  origin.resources.metal = getStorageCapacities(origin.buildings).metal;
  let state: SaveState = {
    ...initial,
    espionage: { ...initial.espionage!, targets: { ...(initial.espionage?.targets ?? {}), [origin.id]: origin } },
  };
  const alliance = createAlliance(state.command, {
    ownerId,
    displayName: source.ownerName,
    settings: { name: 'Aid NPC Union', tag: 'AIDNPC', motto: '', description: '', emblem: DEFAULT_ALLIANCE_EMBLEM },
  }, { now: NOW, random: () => 0.25 });
  assert.ok(alliance.ok);
  state = { ...state, command: alliance.state };
  const application = applyToAlliance(state.command, {
    ownerId: state.profile.playerId, displayName: state.profile.displayName, allianceId: alliance.allianceId,
  }, { now: NOW + 1, random: () => 0.25 });
  assert.ok(application.ok);
  const accepted = acceptApplication(application.state, ownerId, application.applicationId, { now: NOW + 2, random: () => 0.25 });
  assert.ok(accepted.ok);
  state = { ...state, command: grantAidChargesForTest(accepted.state, state.profile.playerId, 1, NOW + 2) };
  const planetId = state.currentPlanetId;
  const planet = state.planets[planetId]!;
  const request = createResourceRequest(state.command, {
    ownerId: state.profile.playerId,
    authorName: state.profile.displayName,
    planet: {
      id: planetId,
      name: planet.name,
      coordinate: {
        galaxy: planet.universeGalaxy ?? 1,
        system: planet.universeSystem ?? 1,
        position: planet.universePosition ?? 1,
      },
    },
    resource: 'metal',
    amount: 50_000,
    resourcePoints: 1_000_000,
    hallLevel: 1,
  }, NOW + 3);
  assert.ok(request.ok);
  state = { ...state, command: request.state };
  return { state, ownerId, originId: origin.id, requestId: request.requestId };
}

test('NPC aid candidates are limited to open same-alliance requests and own cargo capacity', () => {
  const { state, ownerId, originId, requestId } = setup();
  const profile = state.npc!.profiles[ownerId]!;
  const candidates = getNpcAidCandidates(state, profile, NOW + 10);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.kind, 'aid');
  assert.equal(candidates[0]!.payload.requestId, requestId);
  assert.equal(candidates[0]!.payload.originPlanetId, originId);
  assert.equal(candidates[0]!.payload.units, 50_000);
  // Owner rule 25.10.2026: an ally gives only what it can spare. With a store
  // near empty the same request gets nothing.
  const poor = { ...state.espionage!.targets![originId]!, resources: { ...state.espionage!.targets![originId]!.resources, metal: 60_000 } };
  const poorState = { ...state, espionage: { ...state.espionage!, targets: { ...state.espionage!.targets, [originId]: poor } } };
  const capacity = getStorageCapacities(poor.buildings).metal;
  const keeps = (0.65 - 0.3 * (profile.traits.cooperation ?? 0.5)) * capacity;
  const offered = getNpcAidCandidates(poorState, profile, NOW + 10)[0]?.payload.units ?? 0;
  assert.equal(offered, Math.max(0, Math.min(50_000, Math.floor(60_000 - keeps))));
  assert.ok(candidates[0]!.payload.transporter + candidates[0]!.payload.megaTransporter > 0);
  assert.deepEqual(getNpcAidCandidates(state, { ...profile, ownerId: state.profile.playerId }, NOW + 10), []);
});

test('denied owner and source requests do not debit NPC resources or ships', () => {
  const { state, ownerId } = setup();
  const profile = state.npc!.profiles[ownerId]!;
  const candidate = getNpcAidCandidates(state, profile, NOW + 10)[0]!;
  const source = state.espionage?.targets?.[candidate.payload.originPlanetId]!;
  const denied = dispatchNpcAid(state, 'other-owner', candidate, NOW + 10, 'npc-aid-denied', 1);
  assert.equal(denied.ok, false);
  assert.equal(denied.state, state);
  assert.deepEqual(denied.state.espionage?.targets?.[source.id]!.resources, source.resources);
  assert.deepEqual(denied.state.espionage?.targets?.[source.id]!.fleet, source.fleet);
});

test('aid dispatch and arrival are idempotent and credit only the recipient accepted amount', () => {
  const { state, ownerId } = setup();
  const candidate = getNpcAidCandidates(state, state.npc!.profiles[ownerId]!, NOW + 10)[0]!;
  const sent = dispatchNpcAid(state, ownerId, candidate, NOW + 10, 'npc-aid:once', 1);
  assert.equal(sent.ok, true);
  const flight = sent.flight!;
  assert.equal(flight.ownerSide, 'npc');
  assert.equal(flight.ownerId, ownerId);
  assert.equal(flight.missionId, 'aid');
  const repeatedDispatch = dispatchNpcAid(sent.state, ownerId, candidate, NOW + 20, 'npc-aid:once', 1);
  assert.equal(repeatedDispatch.ok, true);
  assert.equal(repeatedDispatch.state, sent.state);

  const arrival = resolveNpcAidArrival(sent.state, flight, flight.arrivalAt);
  assert.equal(arrival.ok, true);
  const twice = resolveNpcAidArrival(arrival.state, flight, flight.arrivalAt + 1);
  assert.equal(twice.ok, true, twice.reason ?? 'expected repeated arrival to be idempotent');
  assert.equal(twice.state, arrival.state);
  const request = twice.state.command.requests.find((item) => item.id === flight.aid!.requestId)!;
  const settledFlight = twice.state.flights.records.find((item) => item.id === flight.id)!;
  assert.equal(request.delivered, settledFlight.aid!.creditedUnits);
  assert.equal(request.delivered, 50_000);
  assert.equal(twice.state.command.aidEvents.filter((event) => event.id === `aid_delivered:${flight.id}`).length, 1);
});

test('return handler restores loaded cargo to its NPC source once and leaves ship restoration to flight runtime', () => {
  const { state, ownerId } = setup();
  const candidate = getNpcAidCandidates(state, state.npc!.profiles[ownerId]!, NOW + 10)[0]!;
  const sent = dispatchNpcAid(state, ownerId, candidate, NOW + 10, 'npc-aid:return', 1);
  assert.equal(sent.ok, true);
  const sourceBefore = state.espionage?.targets?.[candidate.payload.originPlanetId]!;
  const sourceDebited = sent.state.espionage?.targets?.[sourceBefore.id]!;
  assert.ok(sourceDebited.resources.metal < sourceBefore.resources.metal);

  const returningFlights = beginFlightReturn(sent.state.flights, sent.flight!.id, sent.flight!.arrivalAt, 'recalled');
  const returning = returningFlights.records.find((item) => item.id === sent.flight!.id)!;
  const returningState = { ...sent.state, flights: returningFlights };
  const restored = settleNpcAidReturn(returningState, returning, returning.returnAt!);
  assert.equal(restored.ok, true);
  assert.equal(restored.state.espionage?.targets?.[sourceBefore.id]!.resources.metal, sourceBefore.resources.metal);
  assert.equal(restored.state.espionage?.targets?.[sourceBefore.id]!.fleet.ships.transporter,
    sourceDebited.fleet.ships.transporter, 'the generic flight return path restores the ships separately');
  const twice = settleNpcAidReturn(restored.state, returning, returning.returnAt! + 1);
  assert.equal(twice.ok, false);
  assert.equal(twice.state, restored.state);
});
