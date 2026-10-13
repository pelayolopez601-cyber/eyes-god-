import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrainHeights } from './terrainHeights.js';
test('warm batch consumers retain their terrain cells ahead of unused cells', async () => {
  let calls = 0;
  const terrain = createTerrainHeights({
    maxCacheEntries: 2,
    source: {
      async getHeights(points) {
        calls++;
        return points.map((p) => ({ ellipsoid: 100 + p.lon }));
      },
    },
  });
  const p = (lon) => ({ lat: 0, lon });
  await terrain.resolveEllipsoidalGround([p(1)]);
  await terrain.resolveEllipsoidalGround([p(2)]);
  await terrain.resolveEllipsoidalGround([p(1)]);
  assert.equal(calls, 2);
  await terrain.resolveEllipsoidalGround([p(3)]);
  assert.equal(terrain.cachedEllipsoidalGround(0, 1), 101);
  assert.equal(terrain.cachedEllipsoidalGround(0, 2), null);
  assert.equal(calls, 3);
});
