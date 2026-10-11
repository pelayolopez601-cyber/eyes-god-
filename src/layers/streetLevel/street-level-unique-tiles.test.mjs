import test from 'node:test';
import assert from 'node:assert/strict';
import { tilesForBbox } from './tileMath.js';
test('coarse dateline coverage counts each tile exactly once', () => {
  for (const z of [0, 1, 2]) {
    const result = tilesForBbox([170, -1, -170, 1], z);
    const keys = result.tiles.map((t) => `${t.x}/${t.y}/${t.z}`);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(result.total, keys.length);
    const limited = tilesForBbox([170, -1, -170, 1], z, { limit: 1 });
    assert.equal(limited.total, keys.length);
    assert.equal(limited.truncated, keys.length > 1);
    assert.equal(limited.tiles.length, 1);
  }
});
