import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const port = Number(process.env.OtterPatch_PORT || 44319);
const token = 'test-token';
const reviewToken = 'test-review-token';
const child = spawn(process.execPath, ['apps/mcp-server/dist/serve.js'], {
  env: { ...process.env, OtterPatch_PORT: String(port), OtterPatch_MAX_BODY_BYTES: '1024', OtterPatch_TOKEN: token, OtterPatch_REVIEW_TOKEN: reviewToken },
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
  const healthBody = await health.json();
  assert.equal(healthBody.capabilities?.version, 'capabilities-v1');
  const excelCapabilities = healthBody.capabilities?.formats?.find((entry) => entry.format === 'excel');
  assert.deepEqual(excelCapabilities?.operations?.map((entry) => entry.proposalName || entry.op), ['setValue', 'setFormula', 'setStyle', 'setNumberFormat', 'clear']);

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
  const oversizeError = await oversize.json();
  assert.equal(oversizeError.code, 'RESOURCE_LIMIT_EXCEEDED');
  assert.equal(oversizeError.resource, 'http_body_bytes');

  const unsignedReview = await fetch(`http://127.0.0.1:${port}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OtterPatch-Token': token },
    body: '{}',
  });
  assert.equal(unsignedReview.status, 403);
  assert.match(await unsignedReview.text(), /review token/);

  const unreviewedCommit = await fetch(`http://127.0.0.1:${port}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OtterPatch-Token': token },
    body: JSON.stringify({
      format: 'excel', fileBase64: '',
      changeSet: { id: 'c', hostId: 'h', baseRev: 0, anchors: {}, origin: { by: 'human' }, meta: { intent: 'x' }, edits: [] },
    }),
  });
  assert.equal(unreviewedCommit.status, 403);
  assert.match(await unreviewedCommit.text(), /review receipt required/);

  console.log('[serve-security] health=200 badOrigin=403 unauth=401 oversize=413 unsignedReview=403 unreviewedCommit=403');
} finally {
  child.kill();
}
