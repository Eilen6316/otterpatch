import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdapterRegistry } from './registry.js';
import { capabilityManifestFor } from './capabilities.js';
import type { HostAdapter } from './adapter.js';

const stub = (hostId: string): HostAdapter => ({ hostId }) as unknown as HostAdapter;

test('AdapterRegistry: register / resolve / create / 优先级', () => {
  const reg = new AdapterRegistry();
  reg.register({ format: 'excel', aliases: ['xlsx'], engines: ['univer'], manifest: capabilityManifestFor('excel'), create: (h) => stub(h) });
  reg.register({ format: 'drawio', priority: 5, create: (h) => stub(h) });

  assert.deepEqual(reg.formats().sort(), ['drawio', 'excel', 'xlsx']);
  assert.ok(reg.resolve('excel'));
  assert.equal(reg.resolve('xlsx'), reg.resolve('excel'));
  assert.deepEqual(reg.manifests().map((manifest) => manifest.format), ['excel']);
  assert.equal(reg.resolve('pptx'), undefined);
  assert.equal(reg.create('excel', 'h1').hostId, 'h1');
  assert.throws(() => reg.create('pptx', 'h1'), /no adapter registered/);
});

test('AdapterRegistry: 高优先级覆盖同格式', () => {
  const reg = new AdapterRegistry();
  reg.register({ format: 'drawio', priority: 1, create: (h) => ({ hostId: 'low:' + h }) as unknown as HostAdapter });
  reg.register({ format: 'drawio', priority: 9, create: (h) => ({ hostId: 'high:' + h }) as unknown as HostAdapter });
  assert.equal(reg.create('drawio', 'x').hostId, 'high:x');
});
