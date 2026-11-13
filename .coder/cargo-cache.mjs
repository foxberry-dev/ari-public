import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = join(process.env.HOME, '.cargo');
mkdirSync(directory, { recursive: true });
const path = join(directory, 'config.toml');
let configuration;
try {
  configuration = readFileSync(path, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  configuration = '';
}
configuration = configuration.replace(/^\[source\.(?:"?crates-io"?|"?foxberry"?)\][^\n]*\n(?:(?!^\[)[\s\S])*/gm, '');
writeFileSync(path, `${configuration.trimEnd()}\n\n[source.crates-io]\nreplace-with = "foxberry"\n\n[source.foxberry]\nregistry = ${JSON.stringify(process.env.CARGO_REGISTRIES_FOXBERRY_INDEX)}\n`);
