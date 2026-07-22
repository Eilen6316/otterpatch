import { existsSync, lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = path.resolve(packageRoot, 'dist');
if (path.dirname(dist) !== packageRoot || path.basename(dist) !== 'dist') {
  throw new Error('refusing to clean an unexpected build directory');
}

function removeTree(target) {
  if (!existsSync(target)) return;
  const stat = lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    unlinkSync(target);
    return;
  }
  for (const entry of readdirSync(target)) removeTree(path.join(target, entry));
  rmdirSync(target);
}

removeTree(dist);
