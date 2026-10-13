import test from 'node:test';
import assert from 'node:assert/strict';
import { MapSourceController } from './controller.js';
function fixture() {
  return new MapSourceController(
    {
      scene: {
        globe: { show: true },
        requestRender() {},
        frameState: {
          creditDisplay: { addStaticCredit() {}, removeStaticCredit() {} },
        },
        primitives: { add() {}, remove() {} },
      },
      imageryLayers: { add() {}, remove() {} },
    },
    {
      registry: {
        defaultId: 'fixture',
        sources: [
          {
            descriptor: { id: 'fixture', label: 'Fixture', kind: 'imagery' },
            imagery: async () => ({}),
          },
        ],
      },
      createImageryLayer: (provider) => ({ provider }),
    },
  );
}
test('an unsubscribed owner is skipped in the same map settlement delivery', async () => {
  const controller = fixture();
  const calls = [];
  let detach;
  controller.subscribe(() => {
    calls.push('first');
    detach();
  });
  detach = controller.subscribe(() => calls.push('detached'));
  controller.subscribe(() => calls.push('last'));
  await controller.setStack('fixture');
  assert.deepEqual(calls, ['first', 'last']);
  controller.destroy();
});
test('destroying the controller during delivery stops remaining listeners', async () => {
  const controller = fixture();
  const calls = [];
  controller.subscribe(() => {
    calls.push('destroy');
    controller.destroy();
  });
  controller.subscribe(() => calls.push('detached'));
  await controller.setStack('fixture');
  assert.deepEqual(calls, ['destroy']);
});
