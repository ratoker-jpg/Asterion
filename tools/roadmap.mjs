// «Весь роадмэп»: the reviewed history file changelog/roadmap.json (rules in
// changelog/README.md). Refreshed by hand once per 150 PRs: this tool only helps,
// nothing checks freshness in CI, on purpose.
//
// CLI:
//   node tools/roadmap.mjs check             validates the file
//   node tools/roadmap.mjs pull [out.json]   pulls the raw list from GitHub (dates in Moscow time,
//                                            version from the tags) and prints what the file lacks
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkText } from './changelog.mjs';

export const ROADMAP_FILE = 'changelog/roadmap.json';
export const REFRESH_EVERY = 150;
export const MAX_BYTES = 200 * 1024;
export const LIMITS = { prTitle: 60, prText: 360, decision: 300, eraTitle: 40, eraStory: 420, milestone: 70, rail: 18, planTitle: 70, planText: 300, reason: 200 };
export const STATUSES = ['done', 'open', 'closed'];
/** From this PR on every merge is a release, so the first tag holding it is its version. */
export const FIRST_RELEASE_PR = 117;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
/** The history is public and must stay free of anything about the server or the build setup. */
const PRIVATE = [
  /\b\d{1,3}(\.\d{1,3}){3}\b/, // an address
  /[\w.+-]+@[\w-]+\.\w+/, // an email
  /[a-z]:[\\/]/i, // a local folder
  /\/(etc|home|root|var|usr)\//i,
  /%[a-z]+%/i,
  /https?:|\bssh\b|\bvps\b|tochka/i,
  /access-key|cloud-key|токен|пароль|парол/i,
  /claude|opus|sonnet|\bgpt\b|терра|субагент|сесси[яию]|нейросет/i,
  /nemexia|немекси/i,
];

function checkField(errors, where, field, value, limit) {
  checkText(errors, where, field, value, limit);
  if (typeof value !== 'string') return;
  for (const pattern of PRIVATE) {
    const hit = pattern.exec(value);
    if (hit) errors.push(`${where}: «${field}»: нельзя в публичной истории: «${hit[0]}»`);
  }
}

const compareEntries = (left, right) => (left.date === right.date ? left.n - right.n : left.date < right.date ? -1 : 1);

/** Everything the screen and the refresh rule rely on. Returns a list of problems. */
export function validateRoadmap(data) {
  const errors = [];
  const { lastPr, refresh, updated, releases, eras, prs, excluded, milestones, plans } = data ?? {};
  if (!Number.isInteger(lastPr) || lastPr < 1) errors.push('lastPr: нужен номер последнего PR в файле');
  if (!DATE.test(updated ?? '')) errors.push('updated: нужна дата');
  if (refresh?.every !== REFRESH_EVERY) errors.push(`refresh.every: правило владельца, раз в ${REFRESH_EVERY} PR`);
  if (!Number.isInteger(refresh?.nextAt) || refresh.nextAt <= lastPr || refresh.nextAt % REFRESH_EVERY !== 0) errors.push('refresh.nextAt: следующая кратная граница');
  if (!Number.isInteger(releases?.count) || releases.count < 1) errors.push('releases.count');
  if (!VERSION.test(releases?.first ?? '') || !VERSION.test(releases?.last ?? '')) errors.push('releases.first/last: нужны версии');
  if (!DATE.test(releases?.firstDate ?? '')) errors.push('releases.firstDate: нужна дата');
  if (!Array.isArray(eras) || !Array.isArray(prs) || !Array.isArray(excluded) || !Array.isArray(milestones) || !Array.isArray(plans)) {
    errors.push('нужны списки eras, prs, excluded, milestones, plans');
    return errors;
  }

  const eraIds = new Set();
  for (const era of eras) {
    if (typeof era.id !== 'string' || !era.id || eraIds.has(era.id)) errors.push(`эра «${era.id}»: id пустой или повторяется`);
    eraIds.add(era.id);
    checkField(errors, `эра ${era.id}`, 'title', era.title, LIMITS.eraTitle);
    checkField(errors, `эра ${era.id}`, 'story', era.story, LIMITS.eraStory);
  }

  const seen = new Set();
  let previous = null;
  let eraAt = 0;
  for (const pr of prs) {
    const where = `№${pr.n}`;
    if (!Number.isInteger(pr.n) || pr.n < 1 || pr.n > lastPr) errors.push(`${where}: номер вне 1..${lastPr}`);
    if (seen.has(pr.n)) errors.push(`${where}: номер повторяется`);
    seen.add(pr.n);
    if (!DATE.test(pr.date ?? '')) errors.push(`${where}: нет даты`);
    if (!STATUSES.includes(pr.status)) errors.push(`${where}: статус ${pr.status}`);
    if (pr.version !== undefined && !VERSION.test(pr.version)) errors.push(`${where}: версия ${pr.version}`);
    if (pr.status !== 'done' && pr.version !== undefined) errors.push(`${where}: у невыпущенного не бывает версии`);
    checkField(errors, where, 'title', pr.title, LIMITS.prTitle);
    checkField(errors, where, 'text', pr.text, LIMITS.prText);
    if (pr.decision !== undefined) checkField(errors, where, 'decision', pr.decision, LIMITS.decision);
    if (previous && compareEntries(previous, pr) > 0) errors.push(`${where}: идёт раньше №${previous.n}: порядок по дате, потом по номеру`);
    previous = pr;
    const at = eras.findIndex((era) => era.id === pr.era);
    if (at < 0) errors.push(`${where}: нет эры ${pr.era}`);
    else if (at < eraAt) errors.push(`${where}: эры идут подряд, не вперемешку`);
    else eraAt = at;
  }
  for (const era of eras) if (!prs.some((pr) => pr.era === era.id)) errors.push(`эра ${era.id}: пустая`);

  const excludedSeen = new Set();
  for (const entry of excluded) {
    if (seen.has(entry.n) || excludedSeen.has(entry.n)) errors.push(`№${entry.n}: одновременно в списке и в исключённых`);
    excludedSeen.add(entry.n);
    checkField(errors, `исключён №${entry.n}`, 'reason', entry.reason, LIMITS.reason);
  }
  for (let n = 1; n <= lastPr; n += 1) if (!seen.has(n) && !excludedSeen.has(n)) errors.push(`№${n}: нет ни в списке, ни в исключённых с причиной`);

  const milestonePrs = new Set();
  for (const milestone of milestones) {
    const where = `веха №${milestone.pr}`;
    const pr = prs.find((entry) => entry.n === milestone.pr);
    if (!pr) errors.push(`${where}: такого PR нет`);
    else if (pr.status !== 'done') errors.push(`${where}: веха только у выпущенного`);
    if (milestonePrs.has(milestone.pr)) errors.push(`${where}: повторяется`);
    milestonePrs.add(milestone.pr);
    checkField(errors, where, 'title', milestone.title, LIMITS.milestone);
    if (milestone.rail !== undefined) checkField(errors, where, 'rail', milestone.rail, LIMITS.rail);
  }

  if (plans.length === 0) errors.push('plans: раздел «Дальше» не должен быть пустым');
  for (const plan of plans) {
    checkField(errors, 'план', 'title', plan.title, LIMITS.planTitle);
    checkField(errors, 'план', 'text', plan.text, LIMITS.planText);
  }
  return errors;
}

export function readRoadmap(root = process.cwd()) {
  return JSON.parse(readFileSync(resolve(root, ROADMAP_FILE), 'utf8'));
}

/** The owner plays in Moscow: a PR belongs to the day it was on his clock. */
export function moscowDate(iso) {
  return new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** A raw GitHub pull request → what the file needs. */
export function rawEntry(pull, version) {
  const status = pull.merged_at ? 'done' : pull.state === 'open' ? 'open' : 'closed';
  const date = moscowDate(pull.merged_at ?? pull.created_at);
  const entry = { n: pull.number, status, date, githubTitle: pull.title };
  if (status === 'done' && version) entry.version = version;
  return entry;
}

function gh(path) {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 1 << 28 }));
}

function firstTagWith(sha) {
  try {
    const tags = execFileSync('git', ['tag', '--contains', sha, '--sort=version:refname', 'v*'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n');
    return tags[0] ? tags[0].slice(1) : undefined;
  } catch {
    return undefined;
  }
}

export function pullRaw(repo = 'ratoker-jpg/Asterion') {
  const pulls = [];
  for (let page = 1; ; page += 1) {
    const list = gh(`repos/${repo}/pulls?state=all&per_page=100&page=${page}&sort=created&direction=asc`);
    pulls.push(...list);
    if (list.length < 100) break;
  }
  const entries = pulls.map((pull) => rawEntry(pull, pull.number >= FIRST_RELEASE_PR && pull.merge_commit_sha && pull.merged_at ? firstTagWith(pull.merge_commit_sha) : undefined));
  const releases = [];
  for (let page = 1; ; page += 1) {
    const list = gh(`repos/${repo}/releases?per_page=100&page=${page}`);
    releases.push(...list);
    if (list.length < 100) break;
  }
  const published = releases.filter((release) => !release.draft).map((release) => ({ version: release.tag_name.replace(/^v/, ''), date: moscowDate(release.published_at) }));
  return { entries, releases: published };
}

function main() {
  const [command, out] = process.argv.slice(2);
  if (command === 'check') {
    const data = readRoadmap();
    const errors = validateRoadmap(data);
    const bytes = readFileSync(resolve(ROADMAP_FILE)).length;
    if (bytes > MAX_BYTES) errors.push(`файл ${bytes} байт, предел ${MAX_BYTES}`);
    for (const error of errors) console.error(error);
    if (errors.length) process.exit(1);
    console.log(`Роадмэп в порядке: ${data.prs.length} записей до №${data.lastPr}, ${bytes} байт. Следующее обновление на №${data.refresh.nextAt}.`);
    return;
  }
  if (command === 'pull') {
    const raw = pullRaw();
    if (out) writeFileSync(out, JSON.stringify(raw, null, 1));
    const data = readRoadmap();
    const known = new Map(data.prs.map((pr) => [pr.n, pr]));
    for (const entry of raw.entries) {
      const mine = known.get(entry.n);
      if (!mine) console.log(`нет в файле: №${entry.n} ${entry.status} ${entry.date} ${entry.githubTitle}`);
      else if (mine.status !== entry.status) console.log(`статус изменился: №${entry.n} ${mine.status} → ${entry.status}`);
    }
    console.log(`Всего на GitHub: ${raw.entries.length}, выпусков: ${raw.releases.length}.`);
    return;
  }
  console.error('node tools/roadmap.mjs check | pull [out.json]');
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
