const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isGamePageUrl } = require('./navigation-guard.cjs');

const page = path.join(__dirname, '..', 'dist', 'index.html');

test('only the game page may be navigated to: a reload and a route change pass, other sites and files do not', () => {
  const own = pathToFileURL(page).href;
  assert.equal(isGamePageUrl(own, page), true);
  assert.equal(isGamePageUrl(`${own}#/menu`, page), true);
  assert.equal(isGamePageUrl(`${own}?slot=1`, page), true);
  assert.equal(isGamePageUrl('https://example.com/', page), false);
  assert.equal(isGamePageUrl(pathToFileURL(path.join(__dirname, 'main.cjs')).href, page), false);
  assert.equal(isGamePageUrl('not a url', page), false);
});
