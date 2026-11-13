import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('Cargo uses the public cache and preserves unrelated settings across starts', () => {
  const home = mkdtempSync(join(tmpdir(), 'coder-cargo-'));
  const registry = 'sparse+http://cache.test/repository/cargo-proxy/';
  const run = () => execFileSync(process.execPath, [new URL('cargo-cache.mjs', import.meta.url).pathname], {
    env: { ...process.env, HOME: home, CARGO_REGISTRIES_FOXBERRY_INDEX: registry },
  });
  const path = join(home, '.cargo/config.toml');
  try {
    run();
    const expected = '\n\n[source.crates-io]\nreplace-with = "foxberry"\n\n[source.foxberry]\nregistry = "' + registry + '"\n';
    assert.equal(readFileSync(path, 'utf8'), expected);
    mkdirSync(join(home, '.cargo'), { recursive: true });
    writeFileSync(path, '[build]\njobs = 2\n\n[source."crates-io"]\nreplace-with = "old"\n\n[source.foxberry]\nregistry = "old"\n\n[net]\nretry = 4\n');
    run();
    const configured = '[build]\njobs = 2\n\n[net]\nretry = 4' + expected;
    assert.equal(readFileSync(path, 'utf8'), configured);
    run();
    assert.equal(readFileSync(path, 'utf8'), configured);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
