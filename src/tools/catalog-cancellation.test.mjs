import test from 'node:test';
import assert from 'node:assert/strict';
import { composeCatalog, defineTool } from './catalog.js';
test('cancelled catalog calls cannot execute or return late results', async () => {
  let calls = 0,
    release,
    block = false;
  const action = defineTool({
    name: 'fixture_action',
    kind: 'action',
    title: 'Fixture',
    description: 'Offline fixture',
    inputSchema: { type: 'object' },
    run: async () => {
      calls++;
      return block
        ? new Promise((r) => (release = r))
        : { summary: 'fixture', data: {} };
    },
  });
  const catalog = composeCatalog({ tools: [action] });
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    catalog.call('fixture_action', {}, { signal: c.signal }),
    { name: 'AbortError' },
  );
  assert.equal(calls, 0);
  block = true;
  const running = new AbortController();
  const pending = catalog.call(
    'fixture_action',
    {},
    { signal: running.signal },
  );
  while (!release) await Promise.resolve();
  running.abort();
  release({ summary: 'late', data: {} });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls, 1);
});
