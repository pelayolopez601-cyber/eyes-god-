import test from 'node:test';
import assert from 'node:assert/strict';
import { createSurfaceKeyboard } from './surfaceKeyboard.js';
test('surface cycling never targets deliberately excluded controls', () => {
  let handler;
  const documentRef = {
    activeElement: {},
    addEventListener: (_, fn) => (handler = fn),
    removeEventListener() {},
  };
  const node = (extra) => ({
    hasAttribute: () => false,
    getClientRects: () => [{}],
    getAttribute: () => null,
    matches: () => false,
    closest: () => null,
    focus() {
      documentRef.activeElement = this;
    },
    ...extra,
  });
  const ignored = [
    node({ getAttribute: () => '-1' }),
    node({ matches: () => true }),
    node({ closest: () => ({ inert: true }) }),
  ];
  const first = node({}),
    last = node({});
  const controls = [...ignored, first, last];
  const root = {
    ownerDocument: documentRef,
    querySelectorAll: () => controls,
    contains: (n) => controls.includes(n),
  };
  const surface = createSurfaceKeyboard({
    root,
    isActive: () => true,
    onEscape() {},
  });
  surface.activate();
  const press = (shiftKey) =>
    handler({
      key: 'Tab',
      shiftKey,
      preventDefault() {},
      stopPropagation() {},
    });
  press(false);
  assert.equal(documentRef.activeElement, first);
  press(true);
  assert.equal(documentRef.activeElement, last);
  surface.destroy();
});
