import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationRequestServices } from './requests.js';
test('unknown capability replies recover after backoff', async () => {
  for (const first of [
    () => Response.json({ wrong: true }),
    () => new Response('bad', { status: 503 }),
  ]) {
    let probes = 0;
    let queries = 0;
    const services = createApplicationRequestServices({
      boundaryProbe: { timeoutMs: 1000, retryMs: 0 },
      fetchImpl: async (url) => {
        if (url.endsWith('/status'))
          return ++probes === 1
            ? first()
            : Response.json({ configured: false });
        queries++;
        return Response.json({ elements: [] });
      },
    });
    assert.deepEqual(await services.boundaries.query('fixture'), []);
    assert.equal(
      (await services.boundaries.query('fixture')).code,
      'OVERPASS_NOT_CONFIGURED',
    );
    assert.equal(
      (await services.boundaries.query('fixture')).code,
      'OVERPASS_NOT_CONFIGURED',
    );
    assert.equal(probes, 2);
    assert.equal(queries, 1);
  }
});
