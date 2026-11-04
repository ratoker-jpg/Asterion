import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WHATS_NEW_SEEN_KEY,
  formatReleaseDate,
  isNewerVersion,
  isUnseenRelease,
  latestVersion,
  readSeenVersion,
  whatsNewStatus,
  writeSeenVersion,
  type WhatsNewRelease,
} from './whats-new.ts';

const release = (version: string | null): WhatsNewRelease => ({ version, date: version ? '2026-11-04' : null, headline: 'H', items: [] });
const releases = [release('1.8.18'), release('1.8.17'), release('1.8.9')];

test('versions compare as numbers', () => {
  assert.equal(isNewerVersion('1.8.10', '1.8.9'), true);
  assert.equal(isNewerVersion('1.8.9', '1.8.10'), false);
  assert.equal(isNewerVersion('1.8.9', '1.8.9'), false);
  assert.equal(isNewerVersion('2.0.0', '1.99.99'), true);
  assert.equal(isNewerVersion(null, '1.8.9'), false);
  assert.equal(isNewerVersion('1.8.9', 'garbage'), false);
});

test('a dev build entry with no release does not count as the latest version', () => {
  assert.equal(latestVersion([release(null), ...releases]), '1.8.18');
  assert.equal(latestVersion([release(null)]), null);
});

test('fresh install: no mark, starts at the newest version', () => {
  assert.deepEqual(whatsNewStatus({ stored: null, hasCampaigns: false, releases }), { seen: '1.8.18', hasNew: false, store: '1.8.18' });
});

test('update from a version older than this screen: the mark shows', () => {
  assert.deepEqual(whatsNewStatus({ stored: null, hasCampaigns: true, releases }), { seen: null, hasNew: true, store: null });
});

test('update after the player saw an older version: the mark shows until seen', () => {
  assert.equal(whatsNewStatus({ stored: '1.8.17', hasCampaigns: true, releases }).hasNew, true);
  assert.equal(whatsNewStatus({ stored: '1.8.18', hasCampaigns: true, releases }).hasNew, false);
});

test('a release with no note for the player raises no mark', () => {
  // The app is on 1.8.19, but the newest note is 1.8.18 and it was seen.
  assert.equal(whatsNewStatus({ stored: '1.8.18', hasCampaigns: true, releases }).hasNew, false);
});

test('a downgrade or a dev build raises no mark and stores nothing', () => {
  assert.equal(whatsNewStatus({ stored: '1.9.0', hasCampaigns: true, releases }).hasNew, false);
  assert.deepEqual(whatsNewStatus({ stored: null, hasCampaigns: true, releases: [release(null)] }), { seen: null, hasNew: false, store: null });
  assert.deepEqual(whatsNewStatus({ stored: null, hasCampaigns: false, releases: [] }), { seen: null, hasNew: false, store: null });
});

test('a broken stored value counts as nothing stored', () => {
  assert.equal(whatsNewStatus({ stored: 'abc', hasCampaigns: true, releases }).hasNew, true);
});

test('the list tags what is newer than the last seen version', () => {
  const tagged = (seen: string | null) => releases.filter((entry) => isUnseenRelease(entry, seen, releases)).map((entry) => entry.version);
  assert.deepEqual(tagged('1.8.9'), ['1.8.18', '1.8.17']);
  assert.deepEqual(tagged('1.8.18'), []);
  // No record of what was seen: only the newest, not everything at once.
  assert.deepEqual(tagged(null), ['1.8.18']);
});

test('the seen version survives storage errors and round-trips', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
  assert.equal(readSeenVersion(storage), null);
  writeSeenVersion(storage, '1.8.18');
  assert.equal(values.get(WHATS_NEW_SEEN_KEY), '1.8.18');
  assert.equal(readSeenVersion(storage), '1.8.18');
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(readSeenVersion(broken), null);
  assert.doesNotThrow(() => writeSeenVersion(broken, '1.8.18'));
  assert.equal(readSeenVersion(null), null);
});

test('dates read like a person wrote them', () => {
  assert.equal(formatReleaseDate('2026-11-04'), '4 ноября 2026');
  assert.equal(formatReleaseDate('2026-03-21'), '21 марта 2026');
  assert.equal(formatReleaseDate(null), '');
  assert.equal(formatReleaseDate('soon'), '');
});
