import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';

const port = Number(process.env.OtterPatch_PORT || 44319);
const token = 'test-token';
const reviewToken = 'test-review-token';
const servers = [];

function startServer(serverPort, overrides, unset = []) {
  const env = { ...process.env, OtterPatch_PORT: String(serverPort), ...overrides };
  for (const name of unset) delete env[name];
  const child = spawn(process.execPath, ['apps/mcp-server/dist/serve.js'], {
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (data) => { stderr += String(data); });
  const instance = { child, port: serverPort, stderr: () => stderr };
  servers.push(instance);
  return instance;
}

async function waitForHealth(instance) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${instance.port}/health`);
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('serve did not become healthy: ' + safeDiagnostics(instance.stderr()));
}

async function waitForLog(instance, pattern) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const match = pattern.exec(instance.stderr());
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('expected startup log was not emitted: ' + safeDiagnostics(instance.stderr()));
}

async function stopServer(instance) {
  if (instance.child.exitCode !== null) return;
  instance.child.kill();
  await Promise.race([
    once(instance.child, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
}

function safeDiagnostics(stderr) {
  return stderr
    .replace(/(Generated local POST token \(shown once\): )\S+/g, '$1[REDACTED]')
    .replace(/(Generated review token \(shown once\): )\S+/g, '$1[REDACTED]');
}

try {
  const generated = startServer(
    port,
    {
      OtterPatch_MAX_BODY_BYTES: '1024',
      OtterPatch_POSTS_PER_MINUTE: '2',
      OtterPatch_ALLOWED_ORIGINS: '',
    },
    ['OtterPatch_TOKEN', 'OtterPatch_REVIEW_TOKEN'],
  );
  await waitForHealth(generated);
  const generatedToken = (await waitForLog(
    generated,
    /Generated local POST token \(shown once\): ([A-Za-z0-9_-]+)/,
  ))[1];
  assert.ok(generatedToken);
  assert.equal((generated.stderr().match(/Generated local POST token \(shown once\)/g) ?? []).length, 1);
  assert.equal((generated.stderr().match(/Generated review token \(shown once\)/g) ?? []).length, 1);

  const foreignLocalOrigin = await fetch(`http://127.0.0.1:${port}/health`, {
    headers: { Origin: 'http://localhost:9999' },
  });
  assert.equal(foreignLocalOrigin.status, 403);

  const allowedOrigin = await fetch(`http://127.0.0.1:${port}/health`, {
    headers: { Origin: 'http://localhost:5173' },
  });
  assert.equal(allowedOrigin.status, 200);
  assert.equal(allowedOrigin.headers.get('access-control-allow-origin'), 'http://localhost:5173');

  const defaultUnauth = await fetch(`http://127.0.0.1:${port}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(defaultUnauth.status, 401);

  const generatedAuth = await fetch(`http://127.0.0.1:${port}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OtterPatch-Token': generatedToken },
    body: '{}',
  });
  assert.equal(generatedAuth.status, 403);
  assert.match(await generatedAuth.text(), /review receipt required/);

  const rateLimited = await fetch(`http://127.0.0.1:${port}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.headers.get('retry-after'), '60');
  assert.equal((await rateLimited.json()).code, 'HTTP_RATE_LIMIT');
  await stopServer(generated);

  const configured = startServer(port + 1, {
    OtterPatch_MAX_BODY_BYTES: '1024',
    OtterPatch_POSTS_PER_MINUTE: '100',
    OtterPatch_ALLOWED_ORIGINS: '',
    OtterPatch_TOKEN: token,
    OtterPatch_REVIEW_TOKEN: reviewToken,
  });
  await waitForHealth(configured);
  assert.doesNotMatch(configured.stderr(), new RegExp(token));
  assert.doesNotMatch(configured.stderr(), new RegExp(reviewToken));

  const health = await fetch(`http://127.0.0.1:${port + 1}/health`);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.capabilities?.version, 'capabilities-v1');
  const excelCapabilities = healthBody.capabilities?.formats?.find((entry) => entry.format === 'excel');
  assert.deepEqual(excelCapabilities?.operations?.map((entry) => entry.proposalName || entry.op), ['setValue', 'setFormula', 'setStyle', 'setNumberFormat', 'clear']);

  const badOrigin = await fetch(`http://127.0.0.1:${port + 1}/health`, { headers: { Origin: 'http://evil.test' } });
  assert.equal(badOrigin.status, 403);

  const unauth = await fetch(`http://127.0.0.1:${port + 1}/propose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'excel', intent: 'x' }),
  });
  assert.equal(unauth.status, 401);

  const sourceFileSha256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
  const mismatchedRevision = await fetch(`http://127.0.0.1:${port + 1}/propose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OtterPatch-Token': token },
    body: JSON.stringify({ format: 'excel', intent: 'x', sourceFileSha256, baseRev: 0 }),
  });
  assert.equal(mismatchedRevision.status, 409);
  assert.match(await mismatchedRevision.text(), /baseRev does not match/);

  const oversizeBody = JSON.stringify({ format: 'excel', intent: 'x', context: 'x'.repeat(2048) });
  const oversize = await fetch(`http://127.0.0.1:${port + 1}/propose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OtterPatch-Token': token },
    body: oversizeBody,
  });
  assert.equal(oversize.status, 413);
  const oversizeError = await oversize.json();
  assert.equal(oversizeError.code, 'RESOURCE_LIMIT_EXCEEDED');
  assert.equal(oversizeError.resource, 'http_body_bytes');

  const unsignedReview = await fetch(`http://127.0.0.1:${port + 1}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OtterPatch-Token': token },
    body: '{}',
  });
  assert.equal(unsignedReview.status, 403);
  assert.match(await unsignedReview.text(), /review token/);

  const emptyChangeSet = { id: 'c', hostId: 'h', baseRev: 0, anchors: {}, origin: { by: 'human' }, meta: { intent: 'x' }, edits: [] };
  const unboundReview = await fetch(`http://127.0.0.1:${port + 1}/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OtterPatch-Token': token,
      'X-OtterPatch-Review-Token': reviewToken,
    },
    body: JSON.stringify({ fileBase64: 'aGVsbG8=', changeSet: emptyChangeSet, proposal: {}, acceptedEditIds: [] }),
  });
  assert.equal(unboundReview.status, 409);
  assert.match(await unboundReview.text(), /not bound to a source file/);

  const spoofedCurrentRevision = await fetch(`http://127.0.0.1:${port + 1}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OtterPatch-Token': token },
    body: JSON.stringify({
      format: 'excel', fileBase64: 'aGVsbG8=', changeSet: emptyChangeSet,
      proposal: { present: true }, reviewReceipt: { present: true }, currentRev: 0,
    }),
  });
  assert.equal(spoofedCurrentRevision.status, 409);
  assert.match(await spoofedCurrentRevision.text(), /currentRev does not match/);

  const unreviewedCommit = await fetch(`http://127.0.0.1:${port + 1}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OtterPatch-Token': token },
    body: JSON.stringify({
      format: 'excel', fileBase64: '',
      changeSet: emptyChangeSet,
    }),
  });
  assert.equal(unreviewedCommit.status, 403);
  assert.match(await unreviewedCommit.text(), /review receipt required/);

  console.log('[serve-security] auth=401 review=403 binding=409 revision=409 bodyLimit=413 rateLimit=429');
} finally {
  for (const instance of servers.reverse()) await stopServer(instance);
}
