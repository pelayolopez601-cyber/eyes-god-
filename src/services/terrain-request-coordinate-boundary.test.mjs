import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationRequestServices } from './requests.js';
test('invalid terrain batches are refused atomically before transport', async () => {
  const urls = [];
  const service = createApplicationRequestServices({
    fetchImpl: async (url) => {
      urls.push(url);
      return Response.json({ results: [{ ellipsoid: 12 }] });
    },
  });
  for (const points of [
    [{ lat: 91, lon: 0 }],
    [{ lat: 0, lon: 181 }],
    [
      { lat: 0, lon: 0 },
      { lat: NaN, lon: 1 },
    ],
    [null],
    [{ lat: null, lon: 0 }],
    null,
  ]) {
    await assert.rejects(service.terrain.getHeights(points), TypeError);
  }
  assert.equal(urls.length, 0);
  assert.deepEqual(await service.terrain.getHeights([]), []);
  assert.equal(urls.length, 0);
  assert.deepEqual(await service.terrain.getHeights([{ lat: 0, lon: -180 }]), [
    { ellipsoid: 12 },
  ]);
  assert.match(urls[0], /points=-180.00000%2C0.00000/);
});
