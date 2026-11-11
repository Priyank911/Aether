/**
 * Runs Biome's linter through its WebAssembly build, with the rules in
 * biome.json. Same Biome release as the CLI (2.6.4); used because the native
 * biome.exe is blocked by Windows Application Control on the development
 * machine. Exits 1 when any error-level diagnostic is reported.
 *
 * Usage: node scripts/lint.mjs [path ...]   (defaults to the repository root)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Biome, spanInBytesToSpanInCodeUnits } from '@biomejs/js-api/nodejs';

const ROOT = process.cwd();
const EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.json', '.jsonc', '.css']);
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.output', '.wxt', 'assets']);

function collect(target, files) {
  const stats = statSync(target);
  if (stats.isFile()) {
    if (EXTENSIONS.has(path.extname(target))) files.push(target);
    return;
  }
  for (const entry of readdirSync(target)) {
    // Hidden directories (.git, .claude, editor state) are not project sources.
    if (SKIPPED_DIRECTORIES.has(entry) || entry.startsWith('.')) continue;
    collect(path.join(target, entry), files);
  }
}

const targets = process.argv.slice(2);
const files = [];
for (const target of targets.length > 0 ? targets : ['.']) collect(path.resolve(ROOT, target), files);

const biome = new Biome();
const { projectKey } = biome.openProject(ROOT);
biome.applyConfiguration(projectKey, JSON.parse(readFileSync(path.join(ROOT, 'biome.json'), 'utf8')));

/** 1-based line and column of a UTF-8 byte span start. */
function position(content, span) {
  if (!span) return '1:1';
  const [start] = spanInBytesToSpanInCodeUnits(span, content);
  const before = content.slice(0, start).split('\n');
  return `${before.length}:${(before.at(-1)?.length ?? 0) + 1}`;
}

let errors = 0;
let warnings = 0;
for (const file of files) {
  const filePath = path.relative(ROOT, file).split(path.sep).join('/');
  const content = readFileSync(file, 'utf8');
  // Assist actions such as import sorting belong to biome check, not biome lint.
  const diagnostics = biome.lintContent(projectKey, content, { filePath }).diagnostics.filter(
    (diagnostic) => !diagnostic.category?.startsWith('assist/'),
  );
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'error' || diagnostic.severity === 'fatal') errors++;
    else if (diagnostic.severity === 'warning') warnings++;
    const at = position(content, diagnostic.location?.span);
    console.log(`${filePath}:${at} ${diagnostic.severity} ${diagnostic.category ?? ''} ${diagnostic.description}`);
  }
}
biome.shutdown();

console.log(`Checked ${files.length} files: ${errors} errors, ${warnings} warnings.`);
process.exitCode = errors > 0 ? 1 : 0;
