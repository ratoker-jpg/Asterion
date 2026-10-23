function guardSaveKeyUntilReload(saveKey) {
  return `(() => {
    const protectedKey = ${JSON.stringify(saveKey)};
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === window.localStorage && String(key) === protectedKey) return;
      return originalSetItem.call(this, key, value);
    };
    Object.defineProperty(window, '__asterionOfflineFixtureSaveKey', {
      configurable: true,
      value: protectedKey,
    });

    // Prove the guard protects just this localStorage key. These probes run in
    // the fixture document immediately before reload and are removed before it
    // navigates; the next document gets an unmodified Storage prototype.
    const fixtureValue = localStorage.getItem(protectedKey);
    const otherLocalKey = protectedKey + ':offline-fixture-guard-probe';
    localStorage.setItem(protectedKey, '__competing_fixture_overwrite__');
    const saveKeyProtected = localStorage.getItem(protectedKey) === fixtureValue;
    localStorage.setItem(otherLocalKey, 'allowed');
    const otherLocalKeyAllowed = localStorage.getItem(otherLocalKey) === 'allowed';
    localStorage.removeItem(otherLocalKey);
    sessionStorage.setItem(protectedKey, 'allowed');
    const sessionStorageAllowed = sessionStorage.getItem(protectedKey) === 'allowed';
    sessionStorage.removeItem(protectedKey);
    if (!saveKeyProtected || !otherLocalKeyAllowed || !sessionStorageAllowed) {
      throw new Error('Offline fixture guard did not preserve its exact storage boundary.');
    }
    window.location.reload();
    return true;
  })()`;
}

async function assertFreshDocumentHasNoFixtureGuard(win, label) {
  const guardPresent = await win.webContents.executeJavaScript(
    "typeof window.__asterionOfflineFixtureSaveKey !== 'undefined'",
  );
  if (guardPresent) throw new Error(`${label}: fixture storage guard leaked into the reloaded document`);
}

module.exports = { assertFreshDocumentHasNoFixtureGuard, guardSaveKeyUntilReload };
