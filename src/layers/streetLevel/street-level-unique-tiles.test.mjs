import test from 'node:test';
import assert from 'node:assert/strict';
import { tilesForBbox } from './tileMath.js';

test('reachable polar dateline coverage ranks 24 distinct tiles before overview truncation', () => {
  // coverage uses the actual view bbox above zoom 1; polar views can wrap.
  const bbox = [-10, 60, -20, 85];
  const result = tilesForBbox(bbox, 3);
  const keys = result.tiles.map((tile) => `${tile.x}/${tile.y}/${tile.z}`);
  assert.equal(keys.length, 24);
  assert.equal(new Set(keys).size, 24);
  assert.equal(result.total, 24);
  assert.equal(result.truncated, false);
  const overview = tilesForBbox(bbox, 3, { limit: 16 });
  assert.equal(overview.total, 24);
  assert.equal(overview.tiles.length, 16);
  assert.equal(
    new Set(overview.tiles.map((tile) => `${tile.x}/${tile.y}/${tile.z}`)).size,
    16,
  );
  assert.equal(overview.truncated, true);
});
