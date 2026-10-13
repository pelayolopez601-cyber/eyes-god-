import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBox, boxCentre } from './model.js';
test('missing imagery edges do not turn into invented zero coordinates', () => {
  for (const value of [null, undefined, '', ' ', false, true]) {
    const box = { west: value, south: 0, east: 1, north: 1 };
    assert.equal(validateBox(box).ok, false);
    assert.equal(validateBox(box).reason, 'invalid');
    assert.equal(boxCentre(box), null);
  }
  assert.equal(validateBox({ west: 0, south: 0, east: 1, north: 1 }).ok, true);
  assert.equal(
    validateBox({ west: '0', south: '0', east: '1', north: '1' }).ok,
    true,
  );
});
