import {
  keySetupAlternativeKeyNames,
  keySetupRequirementEnvVars,
} from '../keySetupCore.mjs';
import { t } from '../i18n/index.js';

// Localized key-guidance sentences. keySetupCore owns the machine values
// (env-var names, registry titles) because it also runs in node-side
// key-setup builds that stay English; this presentation boundary owns the
// sentences, composed with placeholders so word order can differ per language.

/** The Provider Settings hint for a missing key, or '' for a hidden key. */
export function keyRequirementText(requiresKeyId) {
  const envVars = keySetupRequirementEnvVars(requiresKeyId);
  return envVars
    ? t('Needs {envVars} — add it in Provider Settings', { envVars })
    : '';
}

/**
 * A requirement sentence, plus the switched-off sources that would draw with
 * a key already set.
 * @param {string} requirement What `keyRequirementText` said ('' allowed).
 * @param {Array<{label: string, requiresKeyId?: string|null}>} [alternatives]
 */
export function withKeyAlternatives(requirement, alternatives = []) {
  if (!alternatives.length) return requirement;
  const named = keySetupAlternativeKeyNames(alternatives);
  const option = ({ label, name }) =>
    name
      ? t('light {label} to use your {name} key', { label, name })
      : t('light {label}', { label });
  if (requirement)
    return t('{requirement}, or {offer}', {
      requirement,
      offer: named.map(option).join(t(', or ')),
    });
  // No requirement: the offer stands alone, so it opens with a capital.
  const { label, name } = named[0];
  const lead = name
    ? t('Light {label} to use your {name} key', { label, name })
    : t('Light {label}', { label });
  const tail = named.slice(1).map(option).join(t(', or '));
  return tail ? t('{lead}, or {tail}', { lead, tail }) : lead;
}
