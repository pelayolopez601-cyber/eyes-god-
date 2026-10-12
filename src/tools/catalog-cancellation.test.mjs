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

test('cancellation during an awaited interceptor cannot publish its late result', async () => {
  const controller = new AbortController();
  const reason = new Error('interceptor caller canceled');
  let calls = 0;
  const action = defineTool({
    name: 'fixture_intercepted_action',
    kind: 'action',
    title: 'Fixture',
    description: 'Offline fixture',
    inputSchema: { type: 'object' },
    run: async () => {
      calls++;
      return { summary: 'completed action', data: {} };
    },
  });
  const catalog = composeCatalog({
    tools: [action],
    interceptors: [
      async (call, next) => {
        const result = await next(call);
        await Promise.resolve();
        controller.abort(reason);
        return result;
      },
    ],
  });
  await assert.rejects(
    catalog.call(
      'fixture_intercepted_action',
      {},
      { signal: controller.signal },
    ),
    (error) => error === reason,
  );
  assert.equal(calls, 1, 'completed actions are not rolled back or rerun');
});
