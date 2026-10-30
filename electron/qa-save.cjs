// Reading saves in QA: production saves (schema 29) store some sections in the
// compact form of src/domain/session/save-codec.ts. PARSE_SAVE is the source
// of a page-side function (raw text -> the plain object JSON.parse gave before);
// parseSave is the same in the QA process.
function parseSave(raw) {
  const parsed = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
  const decode = (value, table) => {
    if (!Array.isArray(value)) return value;
    if (value[0] === -1) return value.slice(1).map((item) => decode(item, table));
    const record = {};
    const assign = (key, item) => Object.defineProperty(record, key, { value: item, enumerable: true, writable: true, configurable: true });
    if (value[0] === -2) {
      for (let index = 1; index + 1 < value.length; index += 2) assign(value[index], decode(value[index + 1], table));
      return record;
    }
    const keys = table.get(value[0]);
    if (!keys || keys.length !== value.length - 1) throw new Error(`Compact save: unknown shape ${value[0]}`);
    keys.forEach((key, index) => assign(key, decode(value[index + 1], table)));
    return record;
  };
  for (const key of Object.keys(parsed)) {
    const section = parsed[key];
    if (!section || typeof section !== 'object' || Array.isArray(section) || section.$c !== 1 || !Array.isArray(section.s)) continue;
    parsed[key] = decode(section.v, new Map(section.s.map((entry) => [entry[0], entry.slice(1)])));
  }
  return parsed;
}

module.exports = { parseSave, PARSE_SAVE: `(${parseSave.toString()})` };
