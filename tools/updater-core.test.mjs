import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../electron/updater-core.cjs');

test('feeds: the server first, GitHub second; differential only from the server', () => {
  const feeds = core.feedList({});
  assert.deepEqual(feeds.map((feed) => feed.name), ['server', 'github']);
  assert.equal(feeds[0].options.provider, 'generic');
  assert.ok(feeds[0].options.url.startsWith('https://'));
  assert.equal(feeds[0].differential, true);
  assert.equal(feeds[1].options.provider, 'github');
  assert.equal(feeds[1].differential, false);
});

test('feeds: the address can be replaced or the server switched off', () => {
  assert.equal(core.feedList({ ASTERION_UPDATE_FEED_URL: 'https://example.test/u/' })[0].options.url, 'https://example.test/u');
  assert.deepEqual(core.feedList({ ASTERION_UPDATE_FEED_URL: 'off' }).map((feed) => feed.name), ['github']);
});

test('errors are told apart: no connection, broken download, failed check', () => {
  assert.equal(core.classifyError(new Error('getaddrinfo ENOTFOUND github.com'), 'check').kind, 'offline');
  assert.equal(core.classifyError(new Error('net::ERR_INTERNET_DISCONNECTED'), 'download').kind, 'offline');
  assert.equal(core.classifyError({ code: 'ECONNRESET', message: 'x' }, 'download').kind, 'offline');
  assert.deepEqual(core.classifyError(new Error('sha512 checksum mismatch'), 'download'), { kind: 'download', message: 'Загрузка обновления прервалась' });
  assert.deepEqual(core.classifyError(new Error('Cannot parse latest.yml'), 'check'), { kind: 'check', message: 'Не удалось проверить обновления' });
  assert.equal(core.classifyError(undefined, 'check').kind, 'check');
});

test('retries: growing pauses, then it stops', () => {
  assert.equal(core.retryDelaySeconds(0), 60);
  assert.ok(core.retryDelaySeconds(1) > core.retryDelaySeconds(0));
  assert.equal(core.retryDelaySeconds(99), null);
  assert.equal(core.retryText(60), 'повторю через 60 с');
  assert.equal(core.retryText(180), 'повторю через 3 мин');
  assert.equal(core.retryText(null), '');
});

test('the log keeps no query strings, keys or user folders', () => {
  const text = core.scrubLog(String.raw`GET https://x.test/a.exe?X-Amz-Signature=abc123 Authorization: Bearer sekret token=zzz C:\Users\Den\AppData`);
  assert.ok(!/abc123|sekret|zzz|Den/.test(text), text);
});

test('the file logger appends lines, rotates and never throws', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-updater-log-'));
  try {
    const logger = core.createFileLogger(path.join(dir, 'logs'), () => new Date('2026-11-05T10:00:00Z'));
    logger.info('start');
    logger.error('failed', new Error('boom'));
    const lines = fs.readFileSync(logger.file, 'utf8').trim().split('\n');
    assert.match(lines[0], /^2026-11-05T10:00:00.000Z INFO start$/);
    assert.match(lines[1], /ERROR failed Error: boom/);
    fs.writeFileSync(logger.file, 'x'.repeat(600 * 1024));
    logger.info('after');
    assert.ok(fs.existsSync(path.join(dir, 'logs', 'updater.old.log')));
    assert.match(fs.readFileSync(logger.file, 'utf8'), /INFO after/);
    assert.doesNotThrow(() => core.createFileLogger(path.join(dir, 'logs', 'updater.log', 'nope')).info('x'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
