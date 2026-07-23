import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAPABILITY_MANIFEST_VERSION } from '@otterpatch/core';
import { createBuiltinAdapterRegistry } from './adapters.js';

test('built-in adapters conform to their capability manifests and writeback declarations', () => {
  const registry = createBuiltinAdapterRegistry();
  const expectedFormats = ['drawio', 'excel', 'ppt', 'word'];
  assert.deepEqual(registry.manifests().map((manifest) => manifest.format).sort(), expectedFormats);

  for (const manifest of registry.manifests()) {
    const registration = registry.resolve(manifest.format);
    assert.ok(registration, `missing registration for ${manifest.format}`);
    assert.equal(manifest.version, CAPABILITY_MANIFEST_VERSION);
    assert.deepEqual(
      [...new Set([registration.format, ...(registration.aliases ?? [])])].sort(),
      [...new Set(manifest.aliases)].sort(),
      `${manifest.format} aliases differ between registration and manifest`,
    );

    const adapter = registration.create(`conformance-${manifest.format}`);
    try {
      assert.deepEqual(adapter.manifest(), manifest, `${manifest.format} adapter returned a different manifest`);
      assert.equal(adapter.meta.format, manifest.format);
      const capabilities = adapter.capabilities();
      assert.deepEqual(Object.keys(capabilities.ops).sort(), manifest.operations.map((operation) => operation.op).sort());

      const backends = adapter.writebacks();
      const backendIds = new Set<string>(backends.map((backend) => backend.id));
      assert.equal(backendIds.size, backends.length, `${manifest.format} has duplicate backend ids`);

      for (const operation of manifest.operations) {
        assert.equal(capabilities.supports({ op: operation.op }).ok, operation.propose || operation.writeback);
        if (!operation.writeback) continue;
        for (const backendId of operation.backend) {
          assert.ok(backendIds.has(backendId), `${manifest.format}/${operation.op} declares missing backend ${backendId}`);
        }
        assert.ok(
          backends.some((backend) => backend.supports(operation.op, { path: `conformance/${manifest.format}` })),
          `${manifest.format}/${operation.op} has no backend that reports support`,
        );
      }
    } finally {
      adapter.dispose();
    }
  }
});

test('every built-in alias resolves to the same manifest and adapter format', () => {
  const registry = createBuiltinAdapterRegistry();
  for (const manifest of registry.manifests()) {
    for (const alias of manifest.aliases) {
      const registration = registry.resolve(alias);
      assert.ok(registration, `missing alias registration for ${alias}`);
      const adapter = registry.create(alias, `alias-${alias}`);
      try {
        assert.equal(adapter.meta.format, manifest.format);
        assert.deepEqual(adapter.manifest(), manifest);
      } finally {
        adapter.dispose();
      }
    }
  }
});
