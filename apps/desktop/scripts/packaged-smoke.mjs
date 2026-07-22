import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const releaseDir = path.resolve(process.cwd(), 'release');
const candidates = process.platform === 'win32'
  ? [path.join(releaseDir, 'win-unpacked', 'OtterPatch.exe')]
  : process.platform === 'darwin'
    ? [
        path.join(releaseDir, 'mac', 'OtterPatch.app', 'Contents', 'MacOS', 'OtterPatch'),
        path.join(releaseDir, 'mac-arm64', 'OtterPatch.app', 'Contents', 'MacOS', 'OtterPatch'),
      ]
    : [];
const executable = candidates.find(existsSync);
if (!executable) {
  throw new Error(`packaged OtterPatch executable not found for ${process.platform}: ${candidates.join(', ')}`);
}

const child = spawn(executable, ['--ci-smoke-test'], {
  cwd: path.dirname(executable),
  env: { ...process.env, OTTERPATCH_PACKAGED_SMOKE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => { stdout += chunk; });
child.stderr.on('data', (chunk) => { stderr += chunk; });

const result = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error('packaged Electron smoke timed out after 45 seconds'));
  }, 45_000);
  child.once('error', (error) => {
    clearTimeout(timeout);
    reject(error);
  });
  child.once('exit', (code, signal) => {
    clearTimeout(timeout);
    resolve({ code, signal });
  });
});

if (result.code !== 0 || !stdout.includes('OTTERPATCH_PACKAGED_SMOKE_OK')) {
  throw new Error(
    `packaged Electron smoke failed (code=${result.code}, signal=${result.signal})\nstdout:\n${stdout.slice(-4000)}\nstderr:\n${stderr.slice(-4000)}`,
  );
}
process.stdout.write('Packaged Electron loaded its production UI successfully.\n');
