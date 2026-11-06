// Pure parts of the game updater (electron/updater.cjs): where updates come
// from, how an error is told apart, when a failed download is tried again and
// the log file. No Electron here, so tools/updater-core.test.mjs runs it in node.
const fs = require('node:fs');
const path = require('node:path');

/** The game server mirrors the release installer here (server/deploy/mirror-installer.sh). Public files only. */
const SERVER_FEED_URL = 'https://abstract-latent-blaze.majordomo-client.ru/updates';

/**
 * Feeds in the order they are tried: the server first (close to Russia, supports
 * ranged downloads, so only the changed part of the installer is fetched), then GitHub.
 * GitHub answers «501 Unsupported client range» to the multi-range requests of a
 * differential download, so there the installer is downloaded whole.
 */
function feedList(env = process.env) {
  const server = String(env.ASTERION_UPDATE_FEED_URL || SERVER_FEED_URL).replace(/\/+$/, '');
  const feeds = [];
  if (env.ASTERION_UPDATE_FEED_URL !== 'off') {
    feeds.push({ name: 'server', options: { provider: 'generic', url: server, channel: 'latest' }, differential: true });
  }
  feeds.push({
    name: 'github',
    options: { provider: 'github', owner: 'ratoker-jpg', repo: 'Asterion', releaseType: 'release' },
    differential: false,
  });
  return feeds;
}

const OFFLINE = /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|ERR_CONNECTION|ERR_TIMED_OUT|net::|socket hang up|getaddrinfo|timeout/i;

/**
 * kind: 'offline' (no connection), 'download' (the installer download broke off)
 * or 'check' (the list of releases could not be read). `phase` is what the
 * updater was doing: 'download' once an update was found.
 */
function classifyError(error, phase) {
  const text = String(error && error.message || error || '');
  const offline = OFFLINE.test(text) || OFFLINE.test(String(error && error.code || ''));
  if (offline) return { kind: 'offline', message: 'Нет связи с сервером обновлений' };
  if (phase === 'download') return { kind: 'download', message: 'Загрузка обновления прервалась' };
  return { kind: 'check', message: 'Не удалось проверить обновления' };
}

/** Pause before the next automatic try, seconds; null: give up until the player or the next start asks again. */
const RETRY_DELAYS_S = [60, 180, 600, 1800, 3600, 3600];
function retryDelaySeconds(attempt) {
  return attempt >= 0 && attempt < RETRY_DELAYS_S.length ? RETRY_DELAYS_S[attempt] : null;
}

function retryText(seconds) {
  if (seconds === null) return '';
  return seconds < 120 ? `повторю через ${seconds} с` : `повторю через ${Math.round(seconds / 60)} мин`;
}

/** Nothing secret reaches the log: URL query strings (signed links), keys, tokens, authorization lines. */
function scrubLog(text) {
  return String(text)
    .replace(/\?[^\s"')]*/g, '?…')
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .replace(/(authorization|token|api[-_ ]?key|access[-_ ]?key|secret|password)(["']?\s*[:=]\s*)(?!\*\*\*)(\S+)/gi, '$1$2***')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, '%USERPROFILE%');
}

const MAX_LOG_BYTES = 512 * 1024;

/** electron-updater's logger: appends to <logs>/updater.log (one old copy kept), never throws. */
function createFileLogger(dir, now = () => new Date()) {
  const file = path.join(dir, 'updater.log');
  const write = (level, args) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      try {
        if (fs.statSync(file).size > MAX_LOG_BYTES) fs.renameSync(file, path.join(dir, 'updater.old.log'));
      } catch { /* no log yet */ }
      const text = args.map((value) => (value instanceof Error ? value.stack || value.message : typeof value === 'string' ? value : JSON.stringify(value))).join(' ');
      fs.appendFileSync(file, `${now().toISOString()} ${level} ${scrubLog(text)}\n`);
    } catch { /* a log must never break the game */ }
  };
  return {
    file,
    info: (...args) => write('INFO', args),
    warn: (...args) => write('WARN', args),
    error: (...args) => write('ERROR', args),
    debug: (...args) => write('DEBUG', args),
  };
}

module.exports = {
  SERVER_FEED_URL,
  feedList,
  classifyError,
  retryDelaySeconds,
  retryText,
  scrubLog,
  createFileLogger,
};
