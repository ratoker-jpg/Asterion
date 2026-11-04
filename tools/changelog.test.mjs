import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  MAX_IMAGE_BYTES,
  NO_NOTE_LABEL,
  SHOWN_RELEASES,
  assignVersions,
  buildReleases,
  collectReleases,
  prNoteVerdict,
  readTags,
  releaseBody,
  validateAll,
  validateNote,
  whatsNewModule,
} from './changelog.mjs';

const item = (title = 'Новая кнопка', extra = {}) => ({ title, text: 'Кнопка теперь на месте.', where: 'Планета → Империя', ...extra });
const note = (file, extra = {}) => ({ file, headline: `Заголовок ${file.replace(".json", "")}`, items: [item()], ...extra });
const tag = (version, date, ...files) => ({ version, date, files: new Set(files.map((file) => `changelog/notes/${file}`)) });

test('a note belongs to the first release tag that contains it', () => {
  const tags = [tag('1.8.20', '2026-11-05', 'a.json'), tag('1.8.21', '2026-11-06', 'a.json', 'b.json')];
  const [a, b] = assignVersions([note('a.json'), note('b.json')], tags);
  assert.deepEqual([a.version, a.date], ['1.8.20', '2026-11-05']);
  assert.deepEqual([b.version, b.date], ['1.8.21', '2026-11-06']);
});

test('a note in no tag goes to the release being built, or stays unreleased outside a release', () => {
  const tags = [tag('1.8.20', '2026-11-05', 'a.json')];
  const current = { version: '1.8.21', date: '2026-11-06' };
  assert.equal(assignVersions([note('b.json')], tags, current)[0].version, '1.8.21');
  assert.equal(assignVersions([note('b.json')], tags)[0].version, null);
});

test('a pinned version wins over the tags (notes written after their release)', () => {
  const tags = [tag('1.8.30', '2026-12-01', 'old.json')];
  const [old] = assignVersions([note('old.json', { version: '1.8.16', date: '2026-11-03' })], tags);
  assert.deepEqual([old.version, old.date], ['1.8.16', '2026-11-03']);
});

test('newest first, numeric order, limited, versions without a note do not appear', () => {
  const notes = ['1.8.9', '1.8.10', '1.8.100', '1.9.0', '2.0.0', '1.8.11', '1.8.12']
    .map((version, at) => note(`n${at}.json`, { version, date: '2026-11-01' }));
  const releases = buildReleases(notes);
  assert.equal(releases.length, SHOWN_RELEASES);
  assert.deepEqual(releases.map((release) => release.version), ['2.0.0', '1.9.0', '1.8.100', '1.8.12', '1.8.11']);
});

test('two notes in one release join into one entry; unreleased goes first', () => {
  const releases = buildReleases([
    note('b.json', { version: '1.8.20', date: '2026-11-05', headline: 'Б', items: [item('Два')] }),
    note('a.json', { version: '1.8.20', date: '2026-11-05', headline: 'А', items: [item('Один')] }),
    note('c.json', { version: null, date: null }),
  ]);
  assert.equal(releases[0].version, null);
  assert.equal(releases[1].headline, 'А · Б');
  assert.deepEqual(releases[1].items.map((entry) => entry.title), ['Один', 'Два']);
});

test('wording rules: jargon, formulas, length, missing fields, pins', () => {
  assert.deepEqual(validateNote(note('ok.json'), 'ok.json'), []);
  assert.match(validateNote(note('x', { headline: 'Починили баг в тостах' }), 'x').join(), /техническое слово/);
  assert.match(validateNote(note('x', { items: [item('Рефакторинг')] }), 'x').join(), /техническое слово/);
  assert.match(validateNote(note('x', { items: [item('T', { text: 'Добыча = 2 × 3 в час' })] }), 'x').join(), /формул/);
  assert.match(validateNote(note('x', { items: [item('T', { where: '' })] }), 'x').join(), /where/);
  assert.match(validateNote(note('x', { headline: 'я'.repeat(200) }), 'x').join(), /длиннее/);
  assert.match(validateNote(note('x', { items: [] }), 'x').join(), /пункт/);
  assert.match(validateNote(note('x', { version: '1.8.16' }), 'x').join(), /только вместе/);
  assert.match(validateNote(note('x', { version: '1.8.16a', date: '2026-11-03' }), 'x').join(), /вида 1\.8\.16/);
  // Words of the game stay allowed.
  assert.deepEqual(validateNote(note('x', { headline: 'NPC не атакуют впустую' }), 'x'), []);
});

test('pictures must exist, be webp or jpg, and stay small', () => {
  const withImage = (image) => note('x', { items: [item('T', { image, imageAlt: 'Экран' })] });
  assert.deepEqual(validateNote(withImage('images/a.webp'), 'x', () => 1000), []);
  assert.match(validateNote(withImage('images/a.png'), 'x', () => 1000).join(), /webp/);
  assert.match(validateNote(withImage('images/a.webp'), 'x', () => null).join(), /нет файла/);
  assert.match(validateNote(withImage('images/a.webp'), 'x', () => MAX_IMAGE_BYTES + 1).join(), /больше/);
  assert.match(validateNote(note('x', { items: [item('T', { image: 'images/a.webp' })] }), 'x', () => 1).join(), /imageAlt/);
});

test('the CI gate wants a new note for game code unless the PR says there is nothing for the player', () => {
  const code = { status: 'M', path: 'src/App.tsx' };
  const newNote = { status: 'A', path: 'changelog/notes/x.json' };
  assert.equal(prNoteVerdict({ changed: [code], labels: [] }).ok, false);
  assert.equal(prNoteVerdict({ changed: [code, newNote], labels: [] }).ok, true);
  assert.equal(prNoteVerdict({ changed: [code], labels: [NO_NOTE_LABEL] }).ok, true);
  // Editing an old note does not document a new change.
  assert.equal(prNoteVerdict({ changed: [code, { ...newNote, status: 'M' }], labels: [] }).ok, false);
  // Tests, docs and tools need nothing.
  assert.equal(prNoteVerdict({ changed: [{ status: 'M', path: 'src/a/b.test.ts' }, { status: 'M', path: 'docs/x.md' }, { status: 'A', path: 'tools/y.mjs' }], labels: [] }).ok, true);
});

test('only shipped pictures become imports of the game module', () => {
  const code = whatsNewModule('/repo', [{ version: '1.8.20', date: '2026-11-05', headline: 'H', items: [item('A', { image: 'images/a.webp', imageAlt: 'Экран' }), item('B')] }]);
  assert.equal((code.match(/^import /gm) ?? []).length, 1);
  assert.match(code, /import __whatsNewImage0 from ".*changelog\/images\/a\.webp"/);
  assert.match(code, /"image": __whatsNewImage0/);
  assert.doesNotMatch(code, /@@/);
});

test('the release body speaks to the player', () => {
  const body = releaseBody({ headline: 'H', items: [item('A')] });
  assert.match(body, /## H/);
  assert.match(body, /Где посмотреть: Планета → Империя/);
});

test('end to end in a real git repository: tags decide the version', () => {
  const root = mkdtempSync(join(tmpdir(), 'asterion-changelog-'));
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', ...args], { stdio: 'ignore' });
  const write = (file) => writeFileSync(join(root, 'changelog/notes', file), JSON.stringify({ headline: file.replace('.json', ''), items: [item()] }), 'utf8');
  try {
    git('init', '--quiet');
    mkdirSync(join(root, 'changelog/notes'), { recursive: true });
    writeFileSync(join(root, 'a.txt'), 'before the notes', 'utf8');
    git('add', '.');
    git('commit', '--quiet', '-m', 'old release');
    git('tag', 'v1.8.19');
    write('first.json');
    git('add', '.');
    git('commit', '--quiet', '-m', 'first note');
    git('tag', 'v1.8.20');
    write('second.json');
    git('add', '.');
    git('commit', '--quiet', '-m', 'second note');

    assert.deepEqual(readTags(root).map((entry) => entry.version), ['1.8.20']);
    assert.deepEqual(validateAll(root), []);
    // Dev build: the untagged note has no version yet.
    assert.deepEqual(collectReleases(root).map((release) => release.version), [null, '1.8.20']);
    // Release job: it belongs to the release being built.
    const released = collectReleases(root, { version: '1.8.21', today: '2026-11-07' });
    assert.deepEqual(released.map((release) => [release.version, release.headline]), [['1.8.21', 'second'], ['1.8.20', 'first']]);
    assert.equal(released[0].date, '2026-11-07');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a release build without any tags fails instead of guessing', () => {
  const root = mkdtempSync(join(tmpdir(), 'asterion-changelog-'));
  try {
    execFileSync('git', ['-C', root, 'init', '--quiet'], { stdio: 'ignore' });
    assert.throws(() => collectReleases(root, { version: '1.8.21' }), /fetch-depth/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the notes of this repository pass the rules', () => {
  assert.deepEqual(validateAll(process.cwd()), []);
});
