// God's Eye View i18n: the English source text is the message key.
//
//   t('Save keys')                                   → 'Сохранить ключи'
//   t('Cleared {name}', { name })                    → named interpolation
//   tn(count, '{count} camera', '{count} cameras')   → plural by Intl.PluralRules
//   msg('Live Flights')                              → marks a string kept in data
//                                                      for a later t(); returns it as is
//
// English needs no catalog. Every other locale is one flat JSON file,
// locales/<code>.json, keyed by the English text (for tn, by the English
// plural form). A missing entry falls back to English.
// `npm run i18n` keeps the catalogs in step with the code. Guide: docs/I18N.md.
import {
  DEFAULT_LOCALE,
  normalizeLocale,
  writeStoredLocale,
} from './locale.js';
import es from './locales/es.json' with { type: 'json' };
import ru from './locales/ru.json' with { type: 'json' };

const CATALOGS = Object.freeze({ es, ru });

let currentLocale = DEFAULT_LOCALE;

/** The catalog for a locale; null for English and unknown codes. */
export function getCatalog(locale) {
  return CATALOGS[normalizeLocale(locale)] ?? null;
}

/** Active locale. */
export function getLocale() {
  return currentLocale;
}

/**
 * Switch the active locale. Pure state change: call applyDocumentLanguage /
 * applyDocumentTranslations to reflect it in the DOM.
 * @returns {string} The locale actually applied (normalized).
 */
export function setLocale(locale) {
  const normalized = normalizeLocale(locale) || DEFAULT_LOCALE;
  if (normalized !== currentLocale) {
    currentLocale = normalized;
    formatterCache.clear();
  }
  return currentLocale;
}

/** Development-only warning; silent under node:test and in production. */
function warnMissing(text) {
  if (import.meta.env?.DEV !== true) return;
  console.warn(
    `[i18n] no ${currentLocale} translation for ${JSON.stringify(text)}`,
  );
}

const PLACEHOLDER_PATTERN = /\{([A-Za-z0-9_]+)\}/g;

/** Named {placeholder} interpolation. Unknown names stay literal so a gap
 * stays visible instead of silently vanishing. */
function interpolate(pattern, values) {
  if (!values) return pattern;
  return pattern.replace(PLACEHOLDER_PATTERN, (literal, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : literal,
  );
}

function lookup(text) {
  const catalog = CATALOGS[currentLocale];
  if (!catalog) return undefined;
  if (Object.hasOwn(catalog, text)) return catalog[text];
  warnMissing(text);
  return undefined;
}

/**
 * Translate English source text into the active locale.
 * @param {string} text English text, e.g. 'Hold Space to talk'
 * @param {object} [values] Named interpolation values
 * @returns {string}
 */
export function t(text, values) {
  const entry = lookup(text);
  return interpolate(typeof entry === 'string' ? entry : text, values);
}

/**
 * Translate a count-dependent message. The catalog entry for `other` holds
 * one form per Intl.PluralRules category of the locale ({ one, few, many, other }
 * for Russian). `{count}` is always available to the pattern.
 * @param {number} count
 * @param {string} one English singular, e.g. '{count} camera'
 * @param {string} other English plural, e.g. '{count} cameras'
 * @param {object} [values] Extra interpolation values
 * @returns {string}
 */
export function tn(count, one, other, values) {
  const entry = lookup(other);
  const category = pluralRules(currentLocale).select(count);
  let pattern;
  if (entry && typeof entry === 'object') {
    pattern = entry[category] ?? entry.other ?? other;
  } else {
    pattern = pluralRules(DEFAULT_LOCALE).select(count) === 'one' ? one : other;
  }
  return interpolate(pattern, { ...values, count });
}

/** Mark English text that is stored in data and translated later by t(). */
export function msg(text) {
  return text;
}

const pluralRulesCache = new Map();

function pluralRules(locale) {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRulesCache.set(locale, rules);
  }
  return rules;
}

/*
 * Intl formatters are memoized per (kind, locale, options): the constructors
 * are expensive and panels format on refresh paths. The cache is cleared
 * whenever the active locale changes.
 */
const formatterCache = new Map();

function cachedFormatter(kind, Constructor, options) {
  const cacheKey = `${kind}|${currentLocale}|${options ? JSON.stringify(options) : ''}`;
  let formatter = formatterCache.get(cacheKey);
  if (!formatter) {
    formatter = new Constructor(currentLocale, options);
    formatterCache.set(cacheKey, formatter);
  }
  return formatter;
}

/** Locale-aware number formatting (Intl.NumberFormat). */
export function formatNumber(value, options) {
  return cachedFormatter('number', Intl.NumberFormat, options).format(value);
}

/** Locale-aware date/time formatting (Intl.DateTimeFormat). */
export function formatDate(value, options) {
  return cachedFormatter('date', Intl.DateTimeFormat, options).format(value);
}

/**
 * Locale-aware relative time (Intl.RelativeTimeFormat), e.g.
 * formatRelativeTime(-5, 'minute') → '5 minutes ago' / '5 минут назад'.
 */
export function formatRelativeTime(value, unit = 'second', options) {
  return cachedFormatter('relative', Intl.RelativeTimeFormat, {
    numeric: 'auto',
    ...options,
  }).format(value, unit);
}

/** Collapse markup whitespace so a message reads the same in HTML and JS. */
export function normalizeMarkupText(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Markup opt-in: the element's own English text or attribute is the source.
 *   <span data-i18n>Normal</span>
 *   <button title="Pin" data-i18n-title>…</button>
 * Also data-i18n-aria-label and data-i18n-placeholder.
 */
const DOCUMENT_TRANSLATION_TARGETS = Object.freeze([
  ['data-i18n', null],
  ['data-i18n-title', 'title'],
  ['data-i18n-aria-label', 'aria-label'],
  ['data-i18n-placeholder', 'placeholder'],
]);

/**
 * Translate every opted-in element in `doc`. Runs once at boot; switching
 * locale reloads the page.
 * @param {Document|Element} doc
 * @returns {number} Count of element/attribute writes performed.
 */
export function applyDocumentTranslations(doc) {
  if (typeof doc?.querySelectorAll !== 'function') return 0;
  if (!CATALOGS[currentLocale]) return 0;
  let applied = 0;
  for (const [marker, attribute] of DOCUMENT_TRANSLATION_TARGETS) {
    for (const element of doc.querySelectorAll(`[${marker}]`)) {
      const source = attribute
        ? element.getAttribute(attribute)
        : normalizeMarkupText(element.textContent);
      if (!source) continue;
      const text = t(source);
      if (text === source) continue;
      if (attribute) element.setAttribute(attribute, text);
      else element.textContent = text;
      applied += 1;
    }
  }
  return applied;
}

/**
 * Persist a locale choice, then reload preserving window.location.hash exactly
 * and stripping ?lang from the search string, so the override is one-shot.
 * Storage is best-effort: where it is blocked the choice will not survive.
 * @returns {boolean} true when a reload was triggered.
 */
export function persistLocaleAndReload(
  locale,
  {
    location = globalThis.location,
    history = globalThis.history,
    storage,
  } = {},
) {
  const normalized = normalizeLocale(locale) || DEFAULT_LOCALE;
  writeStoredLocale(normalized, storage);
  if (!location || typeof location.assign !== 'function') return false;
  let target = location.href;
  try {
    const url = new URL(location.href);
    url.searchParams.delete('lang');
    target = url.href;
  } catch {
    // Keep the current href.
  }
  // location.assign() to the identical URL does not navigate, so strip ?lang
  // in place and force a real reload instead.
  try {
    history?.replaceState?.(null, '', target);
  } catch {
    // replaceState is best-effort; the reload below still applies.
  }
  if (typeof location.reload === 'function') {
    location.reload();
  } else {
    location.assign(target);
  }
  return true;
}
