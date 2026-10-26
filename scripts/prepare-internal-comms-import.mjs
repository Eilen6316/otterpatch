/** Prepare one explicit approval using the audited lock; never downloads/imports/enables. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`); const value = i < 0 ? undefined : process.argv[i + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} required`);
  return value;
};
const config = JSON.parse(readFileSync(new URL('../third-party/anthropic-internal-comms/import-approval.template.json', import.meta.url), 'utf8'));
config.registryDirectory = resolve(arg('registry'));
config.sources[0].checkoutDirectory = resolve(arg('checkout'));
config.sources[0].skills[0].approvedBy = arg('approved-by');
console.log(JSON.stringify(config, null, 2));
