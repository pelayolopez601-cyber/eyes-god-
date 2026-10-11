import test from 'node:test';
import assert from 'node:assert/strict';
import { validateValue } from './schema.js';
test('tool string schemas count Unicode characters rather than UTF-16 units', () => {
  const value = '𠮷野家😀';
  assert.deepEqual(validateValue({ type: 'string', maxLength: 4 }, value), []);
  assert.equal(
    validateValue({ type: 'string', minLength: 5 }, value).length,
    1,
  );
  assert.equal(
    validateValue({ type: 'string', maxLength: 3 }, value).length,
    1,
  );
  assert.deepEqual(
    validateValue({ type: 'string', minLength: 4, maxLength: 4 }, 'abcd'),
    [],
  );
  assert.equal(validateValue({ type: 'string', minLength: 2 }, '𠮷').length, 1);
});
