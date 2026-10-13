import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraAtProgress } from './timeline.js';
const camera = (lon) => ({
  lat: 10,
  lon,
  alt: 1000,
  heading: 0,
  pitch: -40,
  roll: 0,
});
test('director seek follows the short dateline arc in both directions', () => {
  for (const [a, b] of [
    [179, -179],
    [-179, 179],
  ]) {
    assert.equal(
      Math.abs(cameraAtProgress(camera(a), camera(b), 0.5).lon),
      180,
    );
    assert.equal(cameraAtProgress(camera(a), camera(b), 0).lon, a);
    assert.equal(cameraAtProgress(camera(a), camera(b), 1).lon, b);
    assert.ok(Math.abs(cameraAtProgress(camera(a), camera(b), 0.25).lon) > 179);
  }
  assert.equal(cameraAtProgress(camera(20), camera(24), 0.5).lon, 22);
});
