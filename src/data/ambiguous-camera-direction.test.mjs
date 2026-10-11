import test from 'node:test';
import assert from 'node:assert/strict';
import { directionToHeading } from './directionText.js';
test('conflicting facing directions cannot manufacture one heading', () => {
  for (const bare of [false, true]) {
    for (const value of ['NB / SB', 'EASTBOUND WESTBOUND', 'NE SW'])
      assert.ok(Number.isNaN(directionToHeading(value, bare)), value);
    assert.equal(directionToHeading('NB northbound', bare), 0);
    assert.equal(directionToHeading('IH-35 SOUTHBOUND AT 15TH', bare), 180);
  }
  assert.ok(Number.isNaN(directionToHeading('North / East', true)));
  assert.equal(directionToHeading('West / SR-24', true), 270);
});
