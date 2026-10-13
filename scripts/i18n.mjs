// Keeps the locale catalogs in step with the code.
//
//   npm run i18n                     check every catalog (also run by npm test)
//   npm run i18n -- --prune          also drop entries the code no longer uses
//   npm run i18n -- --missing ru     print what ru lacks, as JSON to translate
//
// Messages are the English literals passed to t(), tn() and msg() in src/,
// plus the markup opted in with data-i18n* in src/ui/templates and index.html.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES_DIR = path.join(ROOT, 'src/i18n/locales');

const STRING = String.raw`'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|\`(?:\\.|[^\`\\$])*\``;
const CALL = new RegExp(
  String.raw`\b(t|msg)\(\s*(${STRING})|\btn\(\s*[^,]+?,\s*(${STRING})\s*,\s*(${STRING})`,
  'g',
);

function unquote(literal) {
  const body = literal.slice(1, -1);
  return body.replace(
    /\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/gs,
    (_, esc) => {
      if (esc[0] === 'u' || esc[0] === 'x') {
        return String.fromCodePoint(parseInt(esc.replace(/[ux{}]/g, ''), 16));
      }
      return { n: '\n', t: '\t', r: '\r' }[esc] ?? esc;
    },
  );
}

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
function decodeHtml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name) => {
    if (name[0] === '#') {
      const hex = name[1] === 'x' || name[1] === 'X';
      return String.fromCodePoint(
        parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10),
      );
    }
    return ENTITIES[name.toLowerCase()] ?? all;
  });
}

const normalize = (text) => text.replace(/\s+/g, ' ').trim();

function trackedFiles(...pathspecs) {
  return execFileSync(
    'git',
    [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      ...pathspecs,
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  )
    .split('\n')
    .filter(Boolean);
}

/**
 * Every message the code can ask for.
 * @returns {Map<string, {plural: boolean, one?: string, where: string}>}
 */
export function extractMessages() {
  const messages = new Map();
  const add = (text, where, plural = null) => {
    if (!text) return;
    const known = messages.get(text);
    if (known && Boolean(known.plural) !== Boolean(plural)) {
      throw new Error(
        `${where}: "${text}" is used both as plural and plain text (also ${known.where})`,
      );
    }
    if (!known)
      messages.set(text, { plural: Boolean(plural), one: plural?.one, where });
  };

  const sources = trackedFiles(
    'src/*.js',
    'src/*.mjs',
    'src/**/*.js',
    'src/**/*.mjs',
  ).filter(
    (file) =>
      !file.startsWith('src/i18n/') &&
      !/\.test\.mjs$|\/testSupport\//.test(file),
  );
  for (const file of sources) {
    const source = readFileSync(path.join(ROOT, file), 'utf8');
    for (const match of source.matchAll(CALL)) {
      const line = source.slice(0, match.index).split('\n').length;
      const where = `${file}:${line}`;
      if (match[2]) {
        if (match[2][0] === '`' && match[2].includes('${')) continue;
        add(unquote(match[2]), where);
      } else {
        add(unquote(match[4]), where, { one: unquote(match[3]) });
      }
    }
  }

  const markup = trackedFiles('index.html', 'src/ui/templates/*.html');
  const TAG = /<([a-zA-Z][\w-]*)(\s[^>]*?)\/?>([^<]*)/gs;
  for (const file of markup) {
    const html = readFileSync(path.join(ROOT, file), 'utf8');
    for (const [, tag, attrs, text] of html.matchAll(TAG)) {
      const where = `${file} <${tag}>`;
      if (/\sdata-i18n(\s|=|$)/.test(attrs))
        add(normalize(decodeHtml(text)), where);
      for (const [, name] of attrs.matchAll(
        /\sdata-i18n-(title|aria-label|placeholder)\b/g,
      )) {
        const value = attrs.match(new RegExp(String.raw`\s${name}="([^"]*)"`));
        if (value) add(decodeHtml(value[1]), where);
        else
          throw new Error(
            `${where}: data-i18n-${name} without a ${name} attribute`,
          );
      }
    }
  }
  return messages;
}

const placeholders = (text) =>
  [...String(text).matchAll(/\{([A-Za-z0-9_]+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');

export function catalogPath(locale) {
  return path.join(LOCALES_DIR, `${locale}.json`);
}

export function readCatalog(locale) {
  return JSON.parse(readFileSync(catalogPath(locale), 'utf8'));
}

export function shippedLocales() {
  return trackedFiles('src/i18n/locales/*.json').map((file) =>
    path.basename(file, '.json'),
  );
}

/**
 * Compare one catalog with the extracted messages.
 * @returns {{missing: string[], stale: string[], errors: string[]}}
 */
export function checkCatalog(locale, catalog, messages) {
  const categories = new Intl.PluralRules(locale).resolvedOptions()
    .pluralCategories;
  const missing = [];
  const errors = [];
  for (const [text, info] of messages) {
    if (!Object.hasOwn(catalog, text)) {
      missing.push(text);
      continue;
    }
    const entry = catalog[text];
    if (info.plural) {
      if (!entry || typeof entry !== 'object') {
        errors.push(`"${text}" needs plural forms ${categories.join('/')}`);
        continue;
      }
      for (const category of categories) {
        if (typeof entry[category] !== 'string')
          errors.push(`"${text}" lacks the "${category}" form`);
        else if (placeholders(entry[category]) !== placeholders(text))
          errors.push(
            `"${text}" [${category}] placeholders differ: ${entry[category]}`,
          );
      }
    } else if (typeof entry !== 'string') {
      errors.push(`"${text}" must be a string`);
    } else if (placeholders(entry) !== placeholders(text)) {
      errors.push(`"${text}" placeholders differ: ${entry}`);
    }
  }
  const stale = Object.keys(catalog).filter((text) => !messages.has(text));
  return { missing, stale, errors };
}

function main(args) {
  const messages = extractMessages();
  const missingFor = args.includes('--missing')
    ? args[args.indexOf('--missing') + 1]
    : null;
  if (missingFor) {
    const catalog = readCatalog(missingFor);
    const out = {};
    for (const text of checkCatalog(missingFor, catalog, messages).missing) {
      const info = messages.get(text);
      out[text] = info.plural ? { one: info.one, other: text } : '';
    }
    console.log(JSON.stringify(out, null, 2));
    return 0;
  }
  let failed = false;
  for (const locale of shippedLocales()) {
    let catalog = readCatalog(locale);
    const { missing, stale, errors } = checkCatalog(locale, catalog, messages);
    if (args.includes('--prune') && stale.length) {
      catalog = Object.fromEntries(
        Object.entries(catalog).filter(([text]) => messages.has(text)),
      );
      writeFileSync(
        catalogPath(locale),
        `${JSON.stringify(catalog, null, 2)}\n`,
      );
      console.log(`${locale}: pruned ${stale.length} unused entries`);
    } else if (stale.length) {
      failed = true;
      console.log(
        `${locale}: ${stale.length} entries the code no longer uses (npm run i18n -- --prune):`,
      );
      for (const text of stale) console.log(`  ${JSON.stringify(text)}`);
    }
    if (missing.length) {
      failed = true;
      console.log(
        `${locale}: ${missing.length} missing (npm run i18n -- --missing ${locale}):`,
      );
      for (const text of missing)
        console.log(`  ${JSON.stringify(text)}  ${messages.get(text).where}`);
    }
    for (const error of errors) {
      failed = true;
      console.log(`${locale}: ${error}`);
    }
    if (!missing.length && !stale.length && !errors.length) {
      console.log(`${locale}: ${messages.size} messages, complete`);
    }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
