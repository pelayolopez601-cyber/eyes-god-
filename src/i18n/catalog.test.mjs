import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkCatalog,
  extractMessages,
  readCatalog,
  shippedLocales,
} from '../../scripts/i18n.mjs';
import { LOCALES } from './locale.js';

const messages = extractMessages();

test('every catalog file is a shipped locale and every non-English locale has a catalog', () => {
  assert.deepEqual(
    shippedLocales().sort(),
    LOCALES.filter((locale) => locale !== 'en').sort(),
  );
});

for (const locale of shippedLocales()) {
  test(`${locale} catalog matches the code (npm run i18n)`, () => {
    const { missing, stale, errors } = checkCatalog(
      locale,
      readCatalog(locale),
      messages,
    );
    assert.deepEqual(
      { missing, stale, errors },
      { missing: [], stale: [], errors: [] },
    );
  });
}

test('checkCatalog reports missing, stale, placeholder and plural problems', () => {
  const fixture = new Map([
    ['Saved {name}', { plural: false }],
    ['{count} keys', { plural: true, one: '{count} key' }],
    ['Untranslated', { plural: false }],
  ]);
  const result = checkCatalog(
    'ru',
    {
      'Saved {name}': 'Сохранено {nmae}',
      '{count} keys': {
        one: '{count} ключ',
        few: '{count} ключа',
        many: '{count} ключей',
      },
      Removed: 'Удалено',
    },
    fixture,
  );
  assert.deepEqual(result.missing, ['Untranslated']);
  assert.deepEqual(result.stale, ['Removed']);
  assert.equal(result.errors.length, 2);
});
