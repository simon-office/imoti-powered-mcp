import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createMcpbManifest } from './mcpb-manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const outputIndex = process.argv.indexOf('--output-dir');
const outputDir = resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : join(root, 'release'));
if (outputIndex >= 0 && !process.argv[outputIndex + 1]) throw new Error('--output-dir requires a path');

const temporary = await mkdtemp(join(tmpdir(), 'imoti-release-'));
const bundle = join(temporary, 'mcpb');
try {
  await cp(join(root, 'dist'), join(bundle, 'dist'), { recursive: true });
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n');
  const copied = new Set();
  const pending = Object.keys(packageJson.dependencies ?? {}).map(name => ({ name, parent: root }));
  while (pending.length) {
    const { name, parent } = pending.pop();
    let packageEntry;
    try { packageEntry = createRequire(join(parent, 'package.json')).resolve(name); }
    catch (error) { throw new Error(`Cannot resolve production dependency ${name} from ${parent}: ${error.message}`); }
    let source = dirname(packageEntry);
    let metadata;
    while (source !== dirname(source)) {
      try { metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')); } catch { metadata = undefined; }
      if (metadata?.name === name) break;
      source = dirname(source);
    }
    if (metadata?.name !== name) throw new Error(`Cannot locate package root for ${name}`);
    const destination = join(bundle, 'node_modules', relative(join(root, 'node_modules'), source));
    const key = relative(bundle, destination);
    if (destination.startsWith(join(bundle, 'node_modules') + '/') && !copied.has(key)) {
      copied.add(key);
      await mkdir(dirname(destination), { recursive: true });
      await cp(source, destination, { recursive: true, dereference: true });
      for (const dependencyName of Object.keys({ ...metadata.dependencies, ...metadata.optionalDependencies })) {
        pending.push({ name: dependencyName, parent: source });
      }
    }
  }

  const manifest = createMcpbManifest(packageJson);
  await writeFile(join(bundle, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await mkdir(outputDir, { recursive: true });
  const mcpbPath = join(outputDir, `imoti-powered-mcp-${packageJson.version}.mcpb`);
  const skillPath = join(outputDir, `property-search-skill-${packageJson.version}.zip`);
  const zipMcpb = spawnSync('python3', ['-c', 'import sys,zipfile,pathlib; root=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2], "w", zipfile.ZIP_DEFLATED); [z.write(p, p.relative_to(root).as_posix()) for p in root.rglob("*") if p.is_file()]; z.close()', bundle, mcpbPath], { encoding: 'utf8' });
  if (zipMcpb.status !== 0) throw new Error(`Unable to create MCPB archive: ${zipMcpb.stderr}`);
  const zipSkill = spawnSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[2], "w", zipfile.ZIP_DEFLATED); z.write(sys.argv[1], "SKILL.md"); z.close()', join(root, 'skills/property-search/SKILL.md'), skillPath], { encoding: 'utf8' });
  if (zipSkill.status !== 0) throw new Error(`Unable to create skill archive: ${zipSkill.stderr}`);
  process.stdout.write(`Created ${mcpbPath}\nCreated ${skillPath}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
