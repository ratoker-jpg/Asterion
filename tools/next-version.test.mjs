import assert from 'node:assert/strict';
import test from 'node:test';
import { bumpFor, combinedBump, latestVersion, nextVersion, parseVersion, releaseNotes } from './next-version.mjs';

test('first release after 1.0.0 is 1.0.1', () => {
  assert.equal(nextVersion({ tags: [], labelSets: [[]] }), '1.0.1');
  assert.equal(nextVersion({ tags: [], labelSets: [] }), '1.0.1');
});

test('an unlabelled merge bumps PATCH from the newest tag', () => {
  assert.equal(nextVersion({ tags: ['refs/tags/v1.0.1', 'refs/tags/v1.0.1^{}', 'refs/tags/v1.0.9', 'refs/tags/v1.0.10'], labelSets: [['bug']] }), '1.0.11');
});

test('release:minor bumps MINOR and resets PATCH', () => {
  assert.equal(nextVersion({ tags: ['v1.0.7'], labelSets: [['release:minor']] }), '1.1.0');
});

test('release:major bumps MAJOR and resets MINOR and PATCH', () => {
  assert.equal(nextVersion({ tags: ['v1.4.7'], labelSets: [['ui', 'Release:Major']] }), '2.0.0');
});

test('several merged PRs: the largest bump wins once', () => {
  assert.equal(combinedBump([[], ['release:minor'], []]), 'minor');
  assert.equal(combinedBump([['release:minor'], ['release:major']]), 'major');
  assert.equal(nextVersion({ tags: ['v1.2.3'], labelSets: [['release:minor'], [], ['release:minor']] }), '1.3.0');
});

test('a taken tag is skipped instead of reused', () => {
  // v1.1.0 already exists although the newest tag says otherwise (e.g. made by hand).
  assert.equal(nextVersion({ tags: ['v1.0.5', 'v1.1.0', 'v1.1.1'], labelSets: [['release:minor']] }), '1.2.0');
  assert.equal(nextVersion({ tags: ['v1.0.5', 'v1.0.6'], labelSets: [[]] }), '1.0.7');
});

test('tags that are not plain semver are ignored', () => {
  assert.equal(latestVersion(['v2.0.0-beta.1', 'v1.a.3', 'nightly', 'v01.2.3']).join('.'), '1.0.0');
  assert.equal(parseVersion('1.0.0b'), null);
  assert.deepEqual(parseVersion('v3.10.2'), [3, 10, 2]);
});

test('labels decide the bump case-insensitively', () => {
  assert.equal(bumpFor([]), 'patch');
  assert.equal(bumpFor(['release:patch']), 'patch');
  assert.equal(bumpFor([' RELEASE:MINOR ']), 'minor');
  assert.equal(bumpFor(['release:minor', 'release:major']), 'major');
});

test('release notes link the merged PRs', () => {
  const notes = releaseNotes('1.0.1', [{ number: 117, title: 'Автообновление игры', url: 'https://github.com/ratoker-jpg/Asterion/pull/117' }]);
  assert.equal(notes.title, 'Asterion 1.0.1');
  assert.equal(notes.body, '- Автообновление игры ([#117](https://github.com/ratoker-jpg/Asterion/pull/117))\n');
  assert.match(releaseNotes('1.0.2', [], 'abcdef1234').body, /abcdef1/);
});
