import assert from 'node:assert/strict';
import test from 'node:test';
import { battleFactionArtIdFor } from './battle-report-faction-art.ts';

test('battle faction art can display an existing raw pirate ID without adding combat factions', () => {
  assert.equal(battleFactionArtIdFor('pirates', 'aegis'), 'pirates');
  assert.equal(battleFactionArtIdFor('Астеры', 'aegis'), 'aegis');
  assert.equal(battleFactionArtIdFor('Илары', 'synod'), 'synod');
  assert.equal(battleFactionArtIdFor('Рой', 'veyra'), 'veyra');
  assert.equal(battleFactionArtIdFor(null, 'synod'), 'synod');
});
