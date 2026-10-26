/** Conservative declaration resolver. A filename is never evidence of a license grant. */
import { createHash } from 'node:crypto';
import { posix } from 'node:path';

export interface ApprovedSkillLicense { spdx: string; path: string; checksum: string; declaration?: string; reviewSource?: string }
const KNOWN_DIRECT = new Set(['Apache-2.0', 'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'MPL-2.0']);
// SHA-256 of whitespace-normalized Apache 2.0 normative terms, through END OF TERMS
// AND CONDITIONS (not the variable copyright appendix). Reviewed against the standard
// terms and the pinned upstream LICENSE.txt; this is not a natural-language classifier.
const APACHE_TERMS_SHA256 = '59d8f0ba87ad9a2f1a431123c8d16646e5b89ba53653e818f16d136d77263c99';
export function validateSkillLicense(declaration: string | undefined, license: ApprovedSkillLicense, text: string, skillPath: string): void {
  if (!KNOWN_DIRECT.has(license.spdx)) throw new Error('unknown or unsupported approved SPDX license; additional review rule required');
  if (license.declaration !== undefined && license.declaration !== declaration) throw new Error('original license declaration differs from approval');
  if (/proprietary|no license granted|not licensed/i.test(text)) throw new Error('license text conflicts with reviewed Apache/SPDX approval');
  if (text.includes('Apache License') && license.spdx !== 'Apache-2.0') throw new Error('license text conflicts with approved SPDX');
  const fileReference = declaration !== undefined && /^Complete terms in /.test(declaration);
  if (license.spdx === 'Apache-2.0' && fileReference) {
    const end = text.indexOf('END OF TERMS AND CONDITIONS');
    const terms = end < 0 ? '' : text.slice(0, end + 'END OF TERMS AND CONDITIONS'.length).replace(/\s+/g, ' ').trim();
    if (createHash('sha256').update(terms).digest('hex') !== APACHE_TERMS_SHA256) throw new Error('license text does not match reviewed Apache-2.0 terms');
  }
  if (license.spdx === 'Apache-2.0' && !['Apache License', 'Version 2.0', 'Grant of Copyright License', 'Grant of Patent License', 'Redistribution', 'END OF TERMS AND CONDITIONS'].every((term) => text.includes(term))) {
    throw new Error('license text lacks reviewed Apache-2.0 grant');
  }
  if (declaration === undefined) return; // Existing manually approved, hash-locked skills without a declaration.
  if (declaration === license.spdx) return;
  const reference = /^Complete terms in ([A-Za-z0-9][A-Za-z0-9._/-]*)$/.exec(declaration);
  if (!reference || license.spdx !== 'Apache-2.0') throw new Error('license declaration conflicts with approval or requires manual review');
  const path = reference[1]!;
  if (path.split('/').some((part) => !part || part === '.' || part === '..')
    || posix.join(posix.dirname(skillPath), path) !== license.path) throw new Error('license declaration references a different file');
  if (license.declaration !== declaration || typeof license.reviewSource !== 'string' || !license.reviewSource.trim() || license.reviewSource.length > 2000) {
    throw new Error('file-reference license requires exact declaration and explicit audit source');
  }
}
