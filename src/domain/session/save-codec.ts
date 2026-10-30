/**
 * Compact save sections (save schema 29). Late campaigns are mostly the same
 * small records over and over (spy reports, missions, flights, NPC targets,
 * pirate profiles), and plain JSON repeats every field name in every record:
 * ~60% of a day-3 save was field names.
 *
 * A compact section stores each object as an array: a shape id, then the
 * values in that shape's key order. The section carries its shapes once:
 *
 *   "espionage": {"$c":1,"s":[[id,"key1","key2",...],...],"v":<value>}
 *   object -> [id, v1, v2, ...]     (id: the shape's 32-bit hash, >= 0)
 *   array  -> [-1, item1, item2, ...]
 *   object with many keys (a map) -> [-2, "key1", v1, "key2", v2, ...]
 *
 * Decoding is exact: decodeSection(parse(encodeSection(x))) builds the very
 * objects JSON.parse(JSON.stringify(x)) builds, keys in the same order,
 * because shapes are the objects' own key lists. Undefined members, NaN and
 * Infinity follow JSON's rules.
 *
 * Text is a pure function of the value (shape ids are hashes of the key lists,
 * not of what a process saw first), so the server and the client write the
 * same bytes for the same world. Encoded text is kept per object identity
 * (saves are immutable), so an autosave re-encodes only what changed.
 */

export const COMPACT_SECTION_MARK = '$c';
/** Top-level save sections stored compactly. The rest stays plain JSON (raw readers use it). */
export const COMPACT_SECTIONS = ['espionage', 'flights', 'pirate', 'npc', 'rating', 'exploration'] as const;

/** Objects with more keys than this are maps (ids → records): their keys are data, not a shape. */
const MAP_KEY_LIMIT = 24;
const ARRAY_TAG = -1;
const MAP_TAG = -2;

type Shape = Readonly<{ id: number; keys: readonly string[]; header: string }>;

const shapes = new Map<string, Shape>();

function hash32(text: string): number {
  // FNV-1a, 32-bit.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function shapeOf(keys: readonly string[]): Shape {
  const signature = JSON.stringify(keys);
  let shape = shapes.get(signature);
  if (!shape) {
    const id = hash32(signature);
    shape = { id, keys, header: `[${id}${keys.length ? `,${signature.slice(1, -1)}` : ''}]` };
    shapes.set(signature, shape);
  }
  return shape;
}

/** Encoded text of an object plus the shapes it uses. */
type Encoded = { text: string; shapes: readonly Shape[] };

const encodedText = new WeakMap<object, Encoded>();

function isSkipped(value: unknown): boolean {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol';
}

type Encoder = {
  /** Shape ids that collide within this section: objects of those shapes are written as maps. */
  readonly avoid: ReadonlySet<number> | null;
  used: Set<Shape>;
};

function encodeValue(value: unknown, encoder: Encoder, depth: number): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const json = (value as { toJSON?: unknown }).toJSON;
  if (typeof json === 'function') return encodeValue((json as () => unknown).call(value), encoder, depth);
  // Records a few levels down (one report, one flight, one target) keep their text.
  const cached = depth >= 1 && depth <= 3 && encoder.avoid === null ? encodedText.get(value) : undefined;
  if (cached) {
    for (const shape of cached.shapes) encoder.used.add(shape);
    return cached.text;
  }
  const outer = encoder.used;
  const own = depth >= 1 && depth <= 3 && encoder.avoid === null ? new Set<Shape>() : null;
  if (own) encoder.used = own;
  let text: string;
  if (Array.isArray(value)) {
    let out = `[${ARRAY_TAG}`;
    for (const item of value) out += `,${isSkipped(item) ? 'null' : encodeValue(item, encoder, depth + 1)}`;
    text = `${out}]`;
  } else {
    const record = value as Record<string, unknown>;
    const keys: string[] = [];
    for (const key of Object.keys(record)) if (!isSkipped(record[key])) keys.push(key);
    const shape = keys.length <= MAP_KEY_LIMIT ? shapeOf(keys) : null;
    if (shape && !encoder.avoid?.has(shape.id)) {
      encoder.used.add(shape);
      let out = `[${shape.id}`;
      for (const key of keys) out += `,${encodeValue(record[key], encoder, depth + 1)}`;
      text = `${out}]`;
    } else {
      let out = `[${MAP_TAG}`;
      for (const key of keys) out += `,${JSON.stringify(key)},${encodeValue(record[key], encoder, depth + 1)}`;
      text = `${out}]`;
    }
  }
  if (own) {
    encodedText.set(value, { text, shapes: [...own] });
    for (const shape of own) outer.add(shape);
    encoder.used = outer;
  }
  return text;
}

/** The compact text of one section value. */
export function encodeSection(value: unknown): string {
  let encoder: Encoder = { avoid: null, used: new Set() };
  let body = encodeValue(value, encoder, 0);
  // Two different key lists with one hash in the same section cannot share
  // the table: write those objects as maps (decided by this section alone).
  const byId = new Map<number, Shape>();
  const collisions = new Set<number>();
  for (const shape of encoder.used) {
    const seen = byId.get(shape.id);
    if (seen && seen !== shape) collisions.add(shape.id);
    byId.set(shape.id, shape);
  }
  if (collisions.size) {
    encoder = { avoid: collisions, used: new Set() };
    body = encodeValue(value, encoder, 0);
  }
  const table = [...encoder.used].sort((left, right) => left.id - right.id).map((shape) => shape.header);
  return `{"${COMPACT_SECTION_MARK}":1,"s":[${table.join(',')}],"v":${body}}`;
}

export function isCompactSection(value: unknown): value is { $c: 1; s: unknown[]; v: unknown } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>)[COMPACT_SECTION_MARK] === 1 && Array.isArray((value as Record<string, unknown>).s);
}

function decodeValue(value: unknown, table: ReadonlyMap<number, readonly string[]>): unknown {
  if (!Array.isArray(value)) {
    if (value !== null && typeof value === 'object') throw new Error('Compact save: an object outside the encoding.');
    return value;
  }
  const tag = value[0];
  if (tag === ARRAY_TAG) {
    const items = new Array(value.length - 1);
    for (let index = 1; index < value.length; index += 1) items[index - 1] = decodeValue(value[index], table);
    return items;
  }
  const record: Record<string, unknown> = {};
  const assign = (key: string, item: unknown) => {
    // JSON.parse makes "__proto__" an own field; plain assignment would not.
    if (key === '__proto__') Object.defineProperty(record, key, { value: item, enumerable: true, writable: true, configurable: true });
    else record[key] = item;
  };
  if (tag === MAP_TAG) {
    for (let index = 1; index + 1 < value.length; index += 2) assign(value[index] as string, decodeValue(value[index + 1], table));
    return record;
  }
  const keys = typeof tag === 'number' ? table.get(tag) : undefined;
  if (!keys || keys.length !== value.length - 1) throw new Error(`Compact save: unknown shape ${String(tag)}.`);
  for (let index = 0; index < keys.length; index += 1) assign(keys[index]!, decodeValue(value[index + 1], table));
  return record;
}

/** The plain value of a compact section; anything else is returned as it is. */
export function decodeSection(value: unknown): unknown {
  if (!isCompactSection(value)) return value;
  const table = new Map<number, readonly string[]>();
  for (const entry of value.s) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'number') throw new Error('Compact save: a broken shape table.');
    table.set(entry[0], entry.slice(1) as string[]);
  }
  return decodeValue(value.v, table);
}

/** A parsed save with every compact section expanded (in place; returns the same object). */
export function decodeCompactSave<T>(parsed: T): T {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
  const record = parsed as Record<string, unknown>;
  for (const key of Object.keys(record)) if (isCompactSection(record[key])) record[key] = decodeSection(record[key]);
  return parsed;
}

/** Whether a raw save text holds compact sections (cheap: no parse). */
export function hasCompactSections(raw: string): boolean {
  return raw.includes(`{"${COMPACT_SECTION_MARK}":1,`);
}
