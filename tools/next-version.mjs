// Next release version for a push to main (docs/RELEASES.md). The source of
// truth is the newest `vX.Y.Z` tag on GitHub, never package.json: CI stamps the
// version into the build (-c.extraMetadata.version) and pushes nothing back.
//
// Every merge bumps PATCH; a merged PR labelled `release:minor` bumps MINOR
// (PATCH=0), `release:major` bumps MAJOR (MINOR=PATCH=0). When several PRs
// landed since the last release (a pending CI run on main was superseded),
// the largest bump among them wins, once.
//
// CLI (GitHub Actions, release job): node tools/next-version.mjs
//   env GITHUB_REPOSITORY, GITHUB_SHA, GH_TOKEN; writes version/tag/title to
//   $GITHUB_OUTPUT and the release notes to release-notes.md.
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Version of a project with no release yet: the first release is 1.0.1. */
export const INITIAL_VERSION = '1.0.0';
export const MAJOR_LABEL = 'release:major';
export const MINOR_LABEL = 'release:minor';
/** Merge commits looked at since the last tag (more means the history is unusual). */
export const MAX_COMMITS = 30;

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** `v1.2.3` or `1.2.3` → [1, 2, 3]; anything else (pre-releases included) → null. */
export function parseVersion(text) {
  const match = SEMVER.exec(String(text).trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function formatVersion([major, minor, patch]) {
  return `${major}.${minor}.${patch}`;
}

export function compareVersions(left, right) {
  for (let at = 0; at < 3; at += 1) if (left[at] !== right[at]) return left[at] - right[at];
  return 0;
}

/** The newest release among tag names (`refs/tags/` prefixes allowed); the initial version without any. */
export function latestVersion(tags) {
  let best = parseVersion(INITIAL_VERSION);
  for (const tag of tags) {
    const version = parseVersion(String(tag).replace(/^refs\/tags\//, '').replace(/\^\{\}$/, ''));
    if (version && compareVersions(version, best) > 0) best = version;
  }
  return best;
}

/** 'major' | 'minor' | 'patch' for one PR's labels. */
export function bumpFor(labels) {
  const names = new Set(labels.map((label) => String(label).trim().toLowerCase()));
  if (names.has(MAJOR_LABEL)) return 'major';
  if (names.has(MINOR_LABEL)) return 'minor';
  return 'patch';
}

const BUMP_RANK = { patch: 0, minor: 1, major: 2 };

/** The largest bump among several merged PRs (no PR at all: a direct push, patch). */
export function combinedBump(labelSets) {
  let bump = 'patch';
  for (const labels of labelSets) {
    const next = bumpFor(labels);
    if (BUMP_RANK[next] > BUMP_RANK[bump]) bump = next;
  }
  return bump;
}

export function bumpVersion([major, minor, patch], bump) {
  if (bump === 'major') return [major + 1, 0, 0];
  if (bump === 'minor') return [major, minor + 1, 0];
  return [major, minor, patch + 1];
}

/**
 * The version to release: the newest tag bumped by the merged PRs' labels.
 * A tag that already exists (another release won a race) is skipped: the
 * patch is raised until the tag is free.
 */
export function nextVersion({ tags, labelSets }) {
  const taken = new Set(tags.map((tag) => {
    const version = parseVersion(String(tag).replace(/^refs\/tags\//, '').replace(/\^\{\}$/, ''));
    return version ? formatVersion(version) : null;
  }).filter(Boolean));
  let version = bumpVersion(latestVersion(tags), combinedBump(labelSets));
  while (taken.has(formatVersion(version))) version = bumpVersion(version, 'patch');
  return formatVersion(version);
}

/** Release title and notes: the merged PR(s) with links. */
export function releaseNotes(version, pulls, commitSha = '') {
  const title = `Asterion ${version}`;
  const lines = pulls.length
    ? pulls.map((pull) => `- ${pull.title} ([#${pull.number}](${pull.url}))`)
    : [`- Изменения в main${commitSha ? ` (${commitSha.slice(0, 7)})` : ''}`];
  return { title, body: `${lines.join('\n')}\n` };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

async function github(path) {
  const response = await fetch(`https://api.github.com/${path}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${process.env.GH_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!response.ok) throw new Error(`GitHub API ${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA || git(['rev-parse', 'HEAD']);
  if (!repository || !process.env.GH_TOKEN) throw new Error('GITHUB_REPOSITORY and GH_TOKEN are required.');
  // Tags on GitHub, not the local clone: a release made a minute ago counts.
  const tags = git(['ls-remote', '--tags', 'origin', 'refs/tags/v*']).split('\n').filter(Boolean).map((line) => line.split('\t')[1]);
  const last = formatVersion(latestVersion(tags));
  const lastTagKnown = tags.some((tag) => tag.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '') === `v${last}`);
  // Merge commits on main since the last release (first parent = main's own history).
  let commits = [sha];
  if (lastTagKnown) {
    git(['fetch', '--quiet', '--no-tags', 'origin', `+refs/tags/v${last}:refs/tags/v${last}`]);
    const range = git(['rev-list', '--first-parent', `--max-count=${MAX_COMMITS}`, `v${last}..${sha}`]).split('\n').filter(Boolean);
    if (range.length) commits = range;
  }
  const pulls = new Map();
  for (const commit of commits) {
    const found = await github(`repos/${repository}/commits/${commit}/pulls`);
    for (const pull of found) {
      if (pull.merged_at && pull.base?.ref === 'main' && !pulls.has(pull.number)) {
        pulls.set(pull.number, { number: pull.number, title: pull.title, url: pull.html_url, labels: pull.labels.map((label) => label.name) });
      }
    }
  }
  const merged = [...pulls.values()].sort((left, right) => left.number - right.number);
  const version = nextVersion({ tags, labelSets: merged.map((pull) => pull.labels) });
  const notes = releaseNotes(version, merged, sha);
  writeFileSync('release-notes.md', notes.body, 'utf8');
  const summary = { previous: last, version, bump: combinedBump(merged.map((pull) => pull.labels)), pulls: merged.map((pull) => pull.number), commits: commits.length };
  console.log(JSON.stringify(summary, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=v${version}\ntitle=${notes.title}\n`, 'utf8');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
