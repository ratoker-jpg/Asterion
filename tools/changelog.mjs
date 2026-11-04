// Player patch notes (docs/RELEASES.md, «Что нового»). Each PR adds one file to
// changelog/notes/; a PR does not know its version, so the version is worked out
// at build time: a note belongs to the first release tag whose tree contains it,
// and a note in no tag yet belongs to the release being built. Nothing is pushed
// back to main, so the screen cannot drift from the tags.
//
// A note may pin `version` and `date` by hand: only for notes written after their
// release went out (backfill).
//
// CLI:
//   node tools/changelog.mjs check                validates every note
//   node tools/changelog.mjs pr-check             CI gate: env BASE_SHA, HEAD_SHA, PR_LABELS (JSON array)
//   node tools/changelog.mjs release-notes X.Y.Z  adds the player text to release-notes.md
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareVersions, formatVersion, parseVersion } from './next-version.mjs';

export const NOTES_DIR = 'changelog/notes';
export const IMAGES_DIR = 'changelog/images';
/** Versions shipped in the game: older notes and their pictures stay out of the installer. */
export const SHOWN_RELEASES = 5;
export const NO_NOTE_LABEL = 'changelog:none';
export const MAX_IMAGE_BYTES = 200 * 1024;
export const LIMITS = { headline: 90, title: 80, text: 520, where: 100, items: 8, imageAlt: 160 };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const IMAGE = /^images\/[a-z0-9][a-z0-9-]*\.(webp|jpe?g)$/;
const NOTE_PATH = /^changelog\/notes\/[^/]+\.json$/;

/** Words a player should never read. Game terms such as NPC are fine. */
const JARGON = [
  /\b(PR|CI|QA|API|JSON|UI|CPU|React|Electron|commit|merge)\b/i,
  /рефактор|коммит|мерж|тултип|воркер|рендер|хотфикс|бэкенд|фронтенд|селектор/i,
  // \b does not work with Cyrillic.
  /(?<![а-яё])(баг(и|а|ов|ах)?|тост(ы|а|ов|ах|ами)?|кэш\S*|кеш\S*|стейт|батч\S*)(?![а-яё])/i,
];
/** `2 × 3`, `a = b`: a formula instead of a description. */
const FORMULA = /\d\s*[×*/=]\s*\d|\w\s=\s\w/;

export function checkText(errors, file, field, value, limit) {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${file}: поле «${field}» обязательно`);
    return;
  }
  if (value.length > limit) errors.push(`${file}: «${field}» длиннее ${limit} знаков`);
  for (const pattern of JARGON) {
    const hit = pattern.exec(value);
    if (hit) errors.push(`${file}: «${field}»: техническое слово «${hit[0]}», пишите словами игрока`);
  }
  if (FORMULA.test(value)) errors.push(`${file}: «${field}»: похоже на формулу, опишите словами`);
}

/**
 * Wording and shape rules of one note. `imageBytes(relativePath)` returns the
 * file size or null when the picture is missing.
 */
export function validateNote(note, file, imageBytes = () => 0) {
  const errors = [];
  if (!note || typeof note !== 'object' || Array.isArray(note)) return [`${file}: заметка должна быть объектом`];
  if ((note.version === undefined) !== (note.date === undefined)) errors.push(`${file}: «version» и «date» указываются только вместе`);
  if (note.version !== undefined && !parseVersion(note.version)) errors.push(`${file}: «version» должна быть вида 1.8.16`);
  if (note.date !== undefined && !DATE.test(note.date)) errors.push(`${file}: «date» должна быть вида 2026-11-04`);
  checkText(errors, file, 'headline', note.headline, LIMITS.headline);
  if (!Array.isArray(note.items) || !note.items.length) {
    errors.push(`${file}: нужен хотя бы один пункт в «items»`);
    return errors;
  }
  if (note.items.length > LIMITS.items) errors.push(`${file}: больше ${LIMITS.items} пунктов`);
  note.items.forEach((item, at) => {
    const place = `items[${at}]`;
    checkText(errors, file, `${place}.title`, item?.title, LIMITS.title);
    checkText(errors, file, `${place}.text`, item?.text, LIMITS.text);
    checkText(errors, file, `${place}.where`, item?.where, LIMITS.where);
    if (item?.image === undefined) return;
    if (typeof item.image !== 'string' || !IMAGE.test(item.image)) {
      errors.push(`${file}: ${place}.image: нужен файл images/имя.webp или .jpg`);
      return;
    }
    checkText(errors, file, `${place}.imageAlt`, item.imageAlt, LIMITS.imageAlt);
    const bytes = imageBytes(item.image);
    if (bytes === null) errors.push(`${file}: ${place}.image: нет файла changelog/${item.image}`);
    else if (bytes > MAX_IMAGE_BYTES) errors.push(`${file}: ${place}.image: файл больше ${MAX_IMAGE_BYTES / 1024} КБ`);
  });
  return errors;
}

/**
 * Attaches a version and a date to each note. `tags` are the releases oldest
 * first: `{ version, date, files: Set<'changelog/notes/x.json'> }`. `current` is
 * the release being built (`{ version, date }`); without it a note in no tag
 * stays unreleased (version null), which only happens in dev and PR builds.
 */
export function assignVersions(notes, tags, current = null) {
  return notes.map((note) => {
    if (note.version) return note;
    const tag = tags.find((candidate) => candidate.files.has(`${NOTES_DIR}/${note.file}`));
    if (tag) return { ...note, version: tag.version, date: tag.date };
    return { ...note, version: current?.version ?? null, date: current?.date ?? null };
  });
}

/**
 * What the game shows: one entry per version, newest first, at most `limit`
 * entries. Versions with no note simply do not appear. An unreleased entry
 * (dev and PR builds) goes first.
 */
export function buildReleases(notes, limit = SHOWN_RELEASES) {
  const byVersion = new Map();
  for (const note of [...notes].sort((left, right) => left.file.localeCompare(right.file))) {
    const key = note.version ?? '';
    const entry = byVersion.get(key) ?? { version: note.version ?? null, date: note.date ?? null, headlines: [], items: [] };
    entry.headlines.push(note.headline);
    entry.items.push(...note.items);
    byVersion.set(key, entry);
  }
  const rank = (entry) => (entry.version ? parseVersion(entry.version) : [Infinity, 0, 0]);
  return [...byVersion.values()]
    .sort((left, right) => compareVersions(rank(right), rank(left)))
    .slice(0, limit)
    .map(({ version, date, headlines, items }) => ({ version, date, headline: headlines.join(' · '), items }));
}

/** The player text of one release for the GitHub Release body. */
export function releaseBody(release) {
  const lines = [`## ${release.headline}`, ''];
  for (const item of release.items) lines.push(`- **${item.title}.** ${item.text} _Где посмотреть: ${item.where}._`);
  return `${lines.join('\n')}\n`;
}

export function isPlayerCode(path) {
  return path.startsWith('src/') && !/\.test\.(ts|tsx|mjs)$/.test(path) && !path.endsWith('test-asset-loader.mjs');
}

/** The CI gate. `changed` is `[{ status: 'A' | 'M' | 'D' | ..., path }]` of the PR. */
export function prNoteVerdict({ changed, labels }) {
  const code = changed.filter((entry) => isPlayerCode(entry.path)).map((entry) => entry.path);
  const notes = changed.filter((entry) => entry.status === 'A' && NOTE_PATH.test(entry.path)).map((entry) => entry.path);
  const declined = labels.includes(NO_NOTE_LABEL);
  if (!code.length) return { ok: true, reason: 'PR не меняет код игры в src/' };
  if (notes.length) return { ok: true, reason: `заметка: ${notes.join(', ')}` };
  if (declined) return { ok: true, reason: `метка ${NO_NOTE_LABEL}: для игрока ничего нового` };
  return {
    ok: false,
    reason: `PR меняет код игры (${code.length} файл.), но не добавляет заметку. Добавьте файл в ${NOTES_DIR}/ (docs/RELEASES.md) или поставьте метку ${NO_NOTE_LABEL}, если для игрока ничего не изменилось.`,
  };
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/** Release tags oldest first with the notes each one contains. Empty without git or tags (shallow CI checkouts). */
export function readTags(root) {
  let listing;
  try {
    listing = git(root, ['tag', '--list', 'v*', '--format=%(refname:short) %(creatordate:short)']);
  } catch {
    return [];
  }
  const tags = listing.split('\n').filter(Boolean).map((line) => {
    const [name, date] = line.split(' ');
    return { name, date, parsed: parseVersion(name) };
  }).filter((tag) => tag.parsed).sort((left, right) => compareVersions(right.parsed, left.parsed));
  const found = [];
  // Newest first: the walk stops at the first release from before the notes existed.
  for (const tag of tags) {
    const files = git(root, ['ls-tree', '-r', '--name-only', tag.name, '--', NOTES_DIR]).split('\n').filter(Boolean);
    if (!files.length) break;
    found.unshift({ version: formatVersion(tag.parsed), date: tag.date, files: new Set(files) });
  }
  return found;
}

export function readNotes(root) {
  const directory = join(root, NOTES_DIR);
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((file) => file.endsWith('.json')).sort().map((file) => {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(directory, file), 'utf8'));
    } catch (error) {
      throw new Error(`${NOTES_DIR}/${file}: не JSON (${error.message})`);
    }
    return { ...parsed, file };
  });
}

function imageSize(root) {
  return (relative) => {
    const path = join(root, 'changelog', relative);
    return existsSync(path) ? statSync(path).size : null;
  };
}

export function validateAll(root) {
  return readNotes(root).flatMap((note) => validateNote(note, note.file, imageSize(root)));
}

/**
 * The releases of a build. With `version` (the release job) every note must end
 * up under a real version, so missing tags are an error rather than a screen
 * that quietly says «следующая версия».
 */
export function collectReleases(root, { version = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const tags = readTags(root);
  if (version && !tags.length && git(root, ['tag', '--list', 'v*']).length === 0) {
    throw new Error('Сборка релиза без тегов v*: нужен checkout с fetch-depth: 0.');
  }
  const current = version ? { version, date: today } : null;
  return buildReleases(assignVersions(readNotes(root), tags, current));
}

const VIRTUAL_ID = 'virtual:asterion-whats-new';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/** The virtual module the game imports. Pictures are real imports, so only the shipped ones reach the installer. */
export function whatsNewModule(root, releases) {
  const imports = [];
  const data = releases.map((release) => ({
    ...release,
    items: release.items.map(({ title, text, where, image, imageAlt }) => {
      if (!image) return { title, text, where };
      const name = `__whatsNewImage${imports.length}`;
      imports.push(`import ${name} from ${JSON.stringify(resolve(root, 'changelog', image).replaceAll('\\', '/'))};`);
      return { title, text, where, image: `@@${name}@@`, imageAlt };
    }),
  }));
  const body = JSON.stringify(data, null, 2).replace(/"@@(__whatsNewImage\d+)@@"/g, '$1');
  return `${imports.join('\n')}\nexport const WHATS_NEW_RELEASES = ${body};\n`;
}

export function whatsNewVitePlugin() {
  let root = process.cwd();
  return {
    name: 'asterion-whats-new',
    configResolved(config) { root = config.root; },
    resolveId(id) { return id === VIRTUAL_ID ? RESOLVED_ID : null; },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      const errors = validateAll(root);
      if (errors.length) throw new Error(`Заметки «Что нового»:\n${errors.join('\n')}`);
      return whatsNewModule(root, collectReleases(root, { version: process.env.ASTERION_VERSION || null }));
    },
  };
}

function runCheck(root) {
  const errors = validateAll(root);
  for (const error of errors) console.error(`::error::${error}`);
  console.log(`[changelog] заметок: ${readNotes(root).length}, ошибок: ${errors.length}`);
  return errors.length ? 1 : 0;
}

function runPrCheck(root) {
  const { BASE_SHA, HEAD_SHA, PR_LABELS } = process.env;
  if (!BASE_SHA || !HEAD_SHA) throw new Error('BASE_SHA and HEAD_SHA are required.');
  const changed = git(root, ['diff', '--name-status', '--no-renames', `${BASE_SHA}...${HEAD_SHA}`])
    .split('\n').filter(Boolean).map((line) => {
      const [status, path] = line.split('\t');
      return { status, path };
    });
  const verdict = prNoteVerdict({ changed, labels: JSON.parse(PR_LABELS || '[]') });
  console.log(`[changelog] ${verdict.reason}`);
  if (!verdict.ok) console.error(`::error::${verdict.reason}`);
  return verdict.ok ? runCheck(root) : 1;
}

/** Puts the player text above the list of merged PRs that next-version.mjs wrote. */
function runReleaseNotes(root, version) {
  if (!parseVersion(version)) throw new Error(`Bad version: ${version}`);
  const release = collectReleases(root, { version }).find((entry) => entry.version === version);
  if (!release) {
    console.log(`[changelog] в ${version} нет заметки для игрока`);
    return 0;
  }
  const file = join(root, 'release-notes.md');
  const merged = existsSync(file) ? readFileSync(file, 'utf8') : '';
  writeFileSync(file, `${releaseBody(release)}\n---\n\n${merged}`, 'utf8');
  console.log(`[changelog] заметка добавлена в release-notes.md: ${release.headline}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, argument] = process.argv.slice(2);
  const root = process.cwd();
  const commands = { check: () => runCheck(root), 'pr-check': () => runPrCheck(root), 'release-notes': () => runReleaseNotes(root, argument) };
  if (!commands[command]) {
    console.error('Usage: node tools/changelog.mjs check | pr-check | release-notes X.Y.Z');
    process.exit(2);
  }
  try {
    process.exitCode = commands[command]();
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
