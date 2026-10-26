/** Real host startup: approved Git import -> registry -> HTTP/MCP/CLI discovery. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { importAllowedSkill, setImportedSkillState } from '@otterpatch/skills';

const root = mkdtempSync(join(tmpdir(), 'otterpatch-skill-surfaces-'));
let service;
let client;
let transport;
try {
  const source = join(root, 'source'); mkdirSync(source);
  cpSync('examples/agent-skills', join(source, 'examples', 'agent-skills'), { recursive: true });
  cpSync('LICENSE', join(source, 'LICENSE'));
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'Surface test'); git('config', 'user.email', 'test@example.invalid');
  git('remote', 'add', 'origin', 'https://github.com/Eilen6316/otterpatch.git'); git('add', '.'); git('commit', '-qm', 'pilot fixtures');
  const config = JSON.parse(execFileSync(process.execPath, ['scripts/prepare-pilot-import.mjs', '--checkout', source,
    '--revision', git('rev-parse', 'HEAD'), '--registry', join(root, 'registry'), '--approved-by', 'surface-test'], { encoding: 'utf8' }));
  const releases = config.sources[0].skills.map((skill) => importAllowedSkill(config, 'otterpatch-pilots', skill.path));
  for (const release of releases) setImportedSkillState(config.registryDirectory, release.id, release.release, true);
  const env = Object.fromEntries(Object.entries({ ...process.env,
    OtterPatch_SKILL_REGISTRY: config.registryDirectory, OtterPatch_SKILLS_DIR: '',
    OtterPatch_REVIEW_STATE_DIR: '', OtterPatch_AUDIT_DIR: '',
  }).filter(([, value]) => value !== undefined));
  const check = (skills) => {
    for (const release of releases) {
      const card = skills.find((skill) => skill.id === release.id);
      assert.ok(card, `missing ${release.id}`);
      assert.equal(card.trust, 'external'); assert.equal(card.checksum, release.card.checksum);
      assert.equal(card.license, 'Apache-2.0');
      assert.equal(card.provenance.revision, config.sources[0].revision);
    }
    assert.ok(!skills.some((skill) => skill.formats?.some((format) => ['pdf', 'ppt', 'pptx'].includes(format))));
  };
  const cli = JSON.parse(execFileSync(process.execPath, ['apps/mcp-server/dist/cli.js', '--list-skills'], { env, encoding: 'utf8', timeout: 10_000 }));
  assert.equal(cli.untrusted_data, true); check(cli.skills);

  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise((resolve) => socket.close(resolve));
  const token = randomBytes(32).toString('hex');
  service = spawn(process.execPath, ['apps/mcp-server/dist/serve.js'], {
    env: { ...env, OtterPatch_PORT: String(port), OtterPatch_TOKEN: token, OtterPatch_REVIEW_TOKEN: randomBytes(32).toString('hex') },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('HTTP startup timeout')), 10_000);
    service.once('exit', () => { clearTimeout(timer); reject(new Error('HTTP startup failed')); });
    let startup = '';
    service.stderr.on('data', (chunk) => { startup += String(chunk); if (startup.includes('Capability manifest:')) { clearTimeout(timer); resolve(); } });
  });
  const response = await fetch(`http://127.0.0.1:${port}/skills/list`, { method: 'POST', headers: { 'X-OtterPatch-Token': token, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200);
  const http = await response.json(); check(http.skills);
  assert.ok(http.skills.every((skill) => skill.untrusted_data === true));

  transport = new StdioClientTransport({ command: process.execPath, args: ['apps/mcp-server/dist/mcp.js'], env, stderr: 'pipe' });
  client = new Client({ name: 'skill-surface-regression', version: '1.0.0' });
  await client.connect(transport);
  const catalog = await client.callTool({ name: 'otterpatch_skills', arguments: {} });
  assert.equal(catalog.isError, undefined); const mcp = JSON.parse(catalog.content[0].text); check(mcp);
  assert.ok(mcp.every((skill) => skill.untrusted_data === true));
  const tools = await client.listTools();
  assert.ok(!tools.tools.some((tool) => /import|activate|shell|exec/i.test(tool.name)));
  await client.close(); client = undefined;
  await transport.close(); transport = undefined;

  for (const release of releases) setImportedSkillState(config.registryDirectory, release.id, release.release, false);
  const disabled = JSON.parse(execFileSync(process.execPath, ['apps/mcp-server/dist/cli.js', '--list-skills'], { env, encoding: 'utf8', timeout: 10_000 }));
  assert.ok(!disabled.skills.some((skill) => skill.id.startsWith('pilot/')));
  console.log('[skill-surfaces] HTTP/MCP/CLI discover both approved external pilots; restarted CLI honors disable; no install/exec tools');
} finally {
  await client?.close(); await transport?.close();
  if (service && service.exitCode === null && service.signalCode === null) {
    const exit = once(service, 'exit'); service.kill(); await exit;
  }
  rmSync(root, { recursive: true, force: true });
}
