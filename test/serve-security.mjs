import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const port = Number(process.env.OtterPatch_PORT || 44319);
const token = 'test-token';
const child = spawn(process.execPath, ['apps/mcp-server/dist/serve.js'], {
  env: { ...process.env, OtterPatch_PORT: String(port), OtterPatch_MAX_BODY_BYTES: '1024', OtterPatch_TOKEN: token },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (d) => { stderr += String(d); });

async function waitForHealth() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.status === 200) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('serve did not become healthy: ' + stderr);
}

try {
  await waitForHealth();
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);

  const badOrigin = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Origin: 'http://evil.test' } });
  assert.equal(badOrigin.status, 403);

  const unauth = await fetch(`http://127.0.0.1:${port}/propose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'excel', intent: 'x' }),
  });
  assert.equal(unauth.status, 401);

  const oversizeBody = JSON.stringify({ format: 'excel', intent: 'x', context: 'x'.repeat(2048) });
  const oversize = await fetch(`http://127.0.0.1:${port}/propose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OtterPatch-Token': token },
    body: oversizeBody,
  });
  assert.equal(oversize.status, 413);

  console.log('[serve-security] health=200 badOrigin=403 unauth=401 oversize=413');
} finally {
  child.kill();
}