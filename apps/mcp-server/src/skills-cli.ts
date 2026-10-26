#!/usr/bin/env node
/** Separate administrator CLI. Deliberately absent from model/HTTP/MCP mutation tools. */
import { lstatSync, readFileSync } from 'node:fs';
import { importAllowedSkill, readImportedRelease, setImportedSkillState, type SkillImportConfig } from '@otterpatch/skills';

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`--${name} is required`);
  return value;
}
try {
  const path = arg('config');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > 256 * 1024) throw new Error('invalid allowlist file/size');
  const config = JSON.parse(readFileSync(path, 'utf8')) as SkillImportConfig;
  if (config.version !== 1 || typeof config.registryDirectory !== 'string' || !config.registryDirectory.trim()) throw new Error('invalid configuration');
  const action = process.argv[2];
  if (action === 'import') {
    const result = importAllowedSkill(config, arg('source'), arg('path'));
    console.log(JSON.stringify({ id: result.id, release: result.release, activationChanged: false, card: result.card }, null, 2));
  } else if (action === 'inspect') {
    console.log(JSON.stringify(readImportedRelease(config.registryDirectory, arg('release')), null, 2));
  } else if (action === 'enable' || action === 'disable' || action === 'rollback') {
    const id = arg('id'); const release = arg('release');
    setImportedSkillState(config.registryDirectory, id, release, action !== 'disable');
    console.log(JSON.stringify({ id, release, enabled: action !== 'disable', restartHosts: true }));
  } else throw new Error('expected import, inspect, enable, disable, or rollback; no bulk import supported');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
