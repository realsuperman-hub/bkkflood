import test from 'node:test';
import assert from 'node:assert/strict';
import { checkForUpdate, APP_VERSION } from '../src/lib/app-version.js';

const reply = (body, ok = true) => async () => ({ ok, json: async () => body });

test('outdated only when the server reports a different real version id', async () => {
  assert.deepEqual(await checkForUpdate(reply({ v: 'abcdef12' }), 'abcdef12'), { current: 'abcdef12', latest: 'abcdef12', outdated: false });
  assert.deepEqual(await checkForUpdate(reply({ v: '12345678' }), 'abcdef12'), { current: 'abcdef12', latest: '12345678', outdated: true });
});

test('a bad answer, a failure or a dev build never nags', async () => {
  assert.equal((await checkForUpdate(reply({ v: 'not-a-hash' }), 'abcdef12')).outdated, false);
  assert.equal((await checkForUpdate(reply({}, false), 'abcdef12')).outdated, false);
  assert.equal((await checkForUpdate(async () => { throw new Error('offline'); }, 'abcdef12')).outdated, false);
  assert.deepEqual(await checkForUpdate(reply({ v: '12345678' }), 'dev'), { current: 'dev', latest: null, outdated: false });
  assert.equal(APP_VERSION, 'dev'); // under node there is no build-time define
});
