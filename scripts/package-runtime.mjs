import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const output = resolve(process.argv[2] ?? join(root, 'scratch/release'));
const source = join(output, 'source');
mkdirSync(output, { recursive: true });
execFileSync(process.execPath, [join(root, 'scripts/export-runtime.mjs'), source], { stdio: 'inherit' });
const runtime = JSON.parse(readFileSync(join(source, 'runtime.json'), 'utf8'));
const archive = 'open-brain-runtime.tar.gz';
execFileSync('tar', ['-czf', join(output, archive), '-C', source, '.']);
const bytes = readFileSync(join(output, archive));
const manifest = { schemaVersion: 1, apiVersion: runtime.apiVersion, version: runtime.version, revision: runtime.revision, archive,
  sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
writeFileSync(join(output, 'open-brain-runtime.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
