import type { SaveState } from './contracts.ts';
import type { SpyReportSnapshot } from '../domain/espionage/types.ts';
import type { PatchOp, WorldPatch } from './world-diff.ts';

/**
 * What the window keeps of the world (PR 9, part 1).
 *
 * The window renders the world and computes the player's commands on its own
 * copy, and writes it out in a few places (an explicit save, leaving to the
 * menu, an export, the fall-back when the worker stops). So the copy has to stay
 * a complete world, but it need not hold every part as live objects. Spy
 * reports of the bots (`espionage.reports` of other owners: 32 000 of them on a
 * day-3 world, 33 of its 85 MB) are read by no screen and no command of the
 * player - the feed filters to the player's own - yet as objects they are the
 * largest part of the window's heap.
 *
 * The window therefore holds a bot's report as a `ForeignSpyReportStub`: the
 * four fields a lookup can ask for (id, owner, mission, time) and the report's
 * own JSON text. The stub sits in the report's place, so every index, length and
 * run of every patch stays valid, and it serializes (`toJSON`) back into the
 * very report, so a save made from the window is byte-identical to one made
 * from the full world. `rehydrateWorld` turns them all back (the fall-back that
 * runs the world on the window's thread).
 *
 * The same four fields are what `UiWorld`'s reports stay readable by; any other
 * field of a bot's report is not part of what a screen may read.
 */

const RAW = '__stubRaw';

export type ForeignSpyReportFields = Pick<SpyReportSnapshot, 'id' | 'missionId' | 'createdAt'> & { ownerId: string };

export class ForeignSpyReportStub {
  readonly id: string;
  readonly ownerId: string;
  readonly missionId: string;
  readonly createdAt: number;
  /** The report as JSON (own, enumerable: it travels with a copy of the stub made by postMessage). */
  readonly __stubRaw: string;

  constructor(fields: ForeignSpyReportFields, raw: string) {
    this.id = fields.id;
    this.ownerId = fields.ownerId;
    this.missionId = fields.missionId;
    this.createdAt = fields.createdAt;
    this.__stubRaw = raw;
  }

  /** The report this stands for. */
  toJSON(): unknown {
    return JSON.parse(this.__stubRaw);
  }

  /** The text the save puts in the report's place (save-json.ts reads it without parsing). */
  toRawJSON(): string {
    return this.__stubRaw;
  }
}

/** A stub, or a copy of one that crossed postMessage (a plain object with the same fields). */
function isStubLike(value: unknown): value is ForeignSpyReportFields & { __stubRaw: string } {
  return value !== null && typeof value === 'object' && typeof (value as Record<string, unknown>)[RAW] === 'string';
}

function stubFromLike(value: ForeignSpyReportFields & { __stubRaw: string }): ForeignSpyReportStub {
  return value instanceof ForeignSpyReportStub ? value : new ForeignSpyReportStub(value, value.__stubRaw);
}

function realFromStub(stub: { __stubRaw: string }): SpyReportSnapshot {
  return JSON.parse(stub.__stubRaw) as SpyReportSnapshot;
}

function isForeign(report: SpyReportSnapshot, playerId: string): report is SpyReportSnapshot & { ownerId: string } {
  return report.ownerId !== undefined && report.ownerId !== playerId;
}

const stubOf = new WeakMap<object, ForeignSpyReportStub>();
const projectedArrays = new WeakMap<readonly SpyReportSnapshot[], { playerId: string; out: readonly SpyReportSnapshot[] }>();
const projectedWorlds = new WeakMap<SaveState, { playerId: string; out: SaveState }>();

function stubFor(report: SpyReportSnapshot & { ownerId: string }): ForeignSpyReportStub {
  let stub = stubOf.get(report);
  if (!stub) {
    stub = new ForeignSpyReportStub(report as unknown as ForeignSpyReportFields, JSON.stringify(report));
    stubOf.set(report, stub);
  }
  return stub;
}

function projectReports(reports: readonly SpyReportSnapshot[], playerId: string): readonly SpyReportSnapshot[] {
  const known = projectedArrays.get(reports);
  if (known && known.playerId === playerId) return known.out;
  let out: SpyReportSnapshot[] | null = null;
  for (let index = 0; index < reports.length; index += 1) {
    const report = reports[index]!;
    if (isForeign(report, playerId)) {
      if (!out) out = reports.slice(0, index);
      out.push(stubFor(report) as unknown as SpyReportSnapshot);
    } else if (out) out.push(report);
  }
  const result = out ?? reports;
  projectedArrays.set(reports, { playerId, out: result });
  return result;
}

/**
 * `state` as the window holds it: the same world with the bots' spy reports as
 * stubs. The same object when there is nothing to replace; the same result for
 * the same world (a patch is made from two projections, and a record that did
 * not change must stay the same object in both).
 */
export function projectWorld(state: SaveState, playerId: string = state.profile.playerId): SaveState {
  const known = projectedWorlds.get(state);
  if (known && known.playerId === playerId) return known.out;
  const reports = state.espionage?.reports;
  let out = state;
  if (reports && reports.length) {
    const projected = projectReports(reports, playerId);
    if (projected !== reports) out = { ...state, espionage: { ...state.espionage!, reports: projected as SpyReportSnapshot[] } };
  }
  projectedWorlds.set(state, { playerId, out });
  return out;
}

/** True when `state` holds any stub. */
export function hasProjection(state: SaveState): boolean {
  const reports = state.espionage?.reports;
  if (!reports) return false;
  for (let index = 0; index < reports.length; index += 1) if (isStubLike(reports[index])) return true;
  return false;
}

const realOf = new WeakMap<object, SpyReportSnapshot>();

/** `state` with every stub turned back into the report it stands for (the same object when it has none). */
export function rehydrateWorld(state: SaveState): SaveState {
  const reports = state.espionage?.reports;
  if (!reports || !hasProjection(state)) return state;
  const restored = reports.map((report) => {
    if (!isStubLike(report)) return report;
    let real = realOf.get(report);
    if (!real) { real = realFromStub(report); realOf.set(report, real); }
    return real;
  });
  return { ...state, espionage: { ...state.espionage!, reports: restored } };
}

/**
 * Applies `convert` to every report the patch carries as a value: whole
 * (`espionage`, `espionage.reports`, `espionage.reports[i]`, or the world
 * itself) or inserted by a run. Other paths cannot hold a report.
 */
function convertPatch(patch: WorldPatch, convert: (report: unknown) => unknown): WorldPatch {
  let changed = false;
  const ops: PatchOp[] = patch.map((op) => {
    const path = op.p;
    if (path.length > 3 || (path.length > 0 && path[0] !== 'espionage')) return op;
    if (path.length >= 2 && path[1] !== 'reports') return op;
    if ('d' in op || 'k' in op) return op;
    if ('r' in op) {
      if (path.length !== 2) return op;
      let runsChanged = false;
      const runs = op.r.map((run) => {
        if (run.length !== 1) return run;
        const values = run[0];
        const mapped = values.map(convert);
        if (mapped.some((value, index) => value !== values[index])) { runsChanged = true; return [mapped] as const; }
        return run;
      });
      if (!runsChanged) return op;
      changed = true;
      return { p: op.p, r: runs };
    }
    const mapped = convertValueAt(path, op.v, convert);
    if (mapped === op.v) return op;
    changed = true;
    return { p: op.p, v: mapped };
  });
  return changed ? ops : patch;
}

function convertReports(reports: unknown, convert: (report: unknown) => unknown): unknown {
  if (!Array.isArray(reports)) return reports;
  const mapped = reports.map(convert);
  return mapped.some((value, index) => value !== reports[index]) ? mapped : reports;
}

function convertValueAt(path: readonly (string | number)[], value: unknown, convert: (report: unknown) => unknown): unknown {
  if (path.length === 0) {
    const world = value as { espionage?: { reports?: unknown } } | null;
    const espionage = world?.espionage;
    if (!espionage || !espionage.reports) return value;
    const reports = convertReports(espionage.reports, convert);
    return reports === espionage.reports ? value : { ...world, espionage: { ...espionage, reports } };
  }
  if (path.length === 1) {
    const espionage = value as { reports?: unknown } | null;
    if (!espionage || typeof espionage !== 'object' || !espionage.reports) return value;
    const reports = convertReports(espionage.reports, convert);
    return reports === espionage.reports ? value : { ...espionage, reports };
  }
  if (path.length === 2) return convertReports(value, convert);
  return convert(value);
}

/** The patch the window made, in terms of the full world: a stub in it becomes its report. */
export function unprojectPatch(patch: WorldPatch): WorldPatch {
  return convertPatch(patch, (value) => (isStubLike(value) ? realFromStub(value) : value));
}

/** The patch the worker made, in terms of the window's world: a stub that crossed postMessage is a stub again. */
export function adoptPatch(patch: WorldPatch): WorldPatch {
  return convertPatch(patch, (value) => (isStubLike(value) && !(value instanceof ForeignSpyReportStub) ? stubFromLike(value) : value));
}
