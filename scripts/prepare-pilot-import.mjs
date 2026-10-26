/** Print a reviewable allowlist for the two independently authored pilots. Never installs anything. */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { skillChecksum } from '../packages/skills/dist/index.js';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`--${name} is required`);
  return value;
};
const checkoutDirectory = resolve(arg('checkout'));
const revision = arg('revision');
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('use a full committed Git SHA');
const read = (path) => execFileSync('git', ['--no-lazy-fetch', '-C', checkoutDirectory, 'cat-file', 'blob', `${revision}:${path}`], {
  encoding: 'utf8', maxBuffer: 128 * 1024, timeout: 10_000,
  env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' },
});
const approvedBy = arg('approved-by');
const skills = ['excel-data-quality', 'word-technical-review'].map((name) => {
  const path = `examples/agent-skills/${name}/SKILL.md`;
  return { path, checksum: skillChecksum(read(path)), namespace: 'pilot', version: '1.0.0',
    formats: [name.startsWith('excel') ? 'excel' : 'word'],
    allowedOps: name.startsWith('excel') ? ['setNumberFormat'] : ['replaceText', 'setStyle'],
    mode: 'text-only', approvedBy,
    license: { path: 'LICENSE', spdx: 'Apache-2.0', checksum: skillChecksum(read('LICENSE')) },
    references: [{ path: 'references/checklist.md', checksum: skillChecksum(read(`examples/agent-skills/${name}/references/checklist.md`)) }],
  };
});
console.log(JSON.stringify({ version: 1, registryDirectory: resolve(arg('registry')), sources: [{
  id: 'otterpatch-pilots', checkoutDirectory, repository: 'Eilen6316/otterpatch', revision, skills,
}] }, null, 2));
