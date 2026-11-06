// Architecture guard: scans src/ imports for layer, cycle and barrel violations.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const ALLOWLIST = join(ROOT, 'scripts', 'architecture-allowlist.json');
const LAYER = {
  common: 0,
  model: 1, pattern: 1, avatar: 1, sim: 1, analysis: 1,
  render: 2, io: 2,
  runtime: 3, commands: 3,
  store: 4, ui: 4,
  api: 5, tools: 5, main: 5,
};
const layerOf = d => LAYER[d] ?? 3;
const FORBIDDEN_EXTERNAL = ['three', 'three/webgpu', 'three/tsl', 'react', 'react-dom', 'zustand'];
const IMPORT_RE = /\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const LIMITS = {
  upwardEdges: 0,
  cycleCount: 0,
  cycleFiles: 0,
  deepImports: 0,
  barrelViolations: 0,
  maxFileLines: 1000,
  commonForbidden: 0,
};

function collectFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) collectFiles(p, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const rel = f => f.slice(SRC.length + 1);
const domain = f => rel(f).split('/')[0].replace(/\.(ts|tsx)$/, '');

function resolveSpec(from, spec) {
  let base;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = join(dirname(from), spec);
  else return null;
  base = base.replace(/\\/g, '/');
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

function analyze() {
  const files = collectFiles(SRC).sort();
  const lines = new Map();
  const edges = [];
  const forbidden = [];
  const barrelViolations = [];
  let deepImports = 0;

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    lines.set(file, source.split('\n').length);
    const fromDomain = domain(file);
    let match;
    IMPORT_RE.lastIndex = 0;
    while ((match = IMPORT_RE.exec(source)) !== null) {
      const spec = match[1] ?? match[2] ?? match[3] ?? match[4];
      const typeOnly = /^\s*import\s+type\b/.test(match[0]);
      const target = resolveSpec(file, spec);

      if (spec.startsWith('.') && (spec.match(/\.\.\//g) ?? []).length >= 2) deepImports++;

      if (!target) {
        if (fromDomain === 'common' && FORBIDDEN_EXTERNAL.includes(spec)) {
          forbidden.push(`${rel(file)} -> ${spec}`);
        }
        continue;
      }
      if (target === file) continue;
      edges.push({ from: file, to: target, typeOnly });

      const toDomain = domain(target);
      if (fromDomain === 'common' && toDomain !== 'common') {
        forbidden.push(`${rel(file)} -> ${rel(target)}`);
      }
      // common is consumed by submodules, so its inbound edges are not barrel violations.
      if (fromDomain !== toDomain && toDomain !== 'common'
        && !/\/(index|types)\.tsx?$/.test(target)
        && !['main', 'api', 'tools'].includes(fromDomain)) {
        barrelViolations.push(`${rel(file)} -> ${rel(target)}`);
      }
    }
  }

  const cross = edges.filter(e => domain(e.from) !== domain(e.to));
  const runtimeCross = cross.filter(e => !e.typeOnly);
  const upward = runtimeCross.filter(e => layerOf(domain(e.from)) < layerOf(domain(e.to)));

  // Tarjan SCC on the file graph.
  const adj = new Map(files.map(f => [f, []]));
  for (const e of edges) adj.get(e.from).push(e.to);
  let counter = 0;
  const index = new Map(), low = new Map(), stack = [], onStack = new Set(), cycles = [];
  function visit(v) {
    index.set(v, counter); low.set(v, counter); counter++;
    stack.push(v); onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) {
      const group = []; let w;
      do { w = stack.pop(); onStack.delete(w); group.push(w); } while (w !== v);
      if (group.length > 1) cycles.push(group.map(rel).sort());
    }
  }
  for (const f of files) if (!index.has(f)) visit(f);

  const metrics = {
    files: files.length,
    lines: [...lines.values()].reduce((a, b) => a + b, 0),
    edges: edges.length,
    crossEdges: cross.length,
    runtimeCrossEdges: runtimeCross.length,
    nonCommonRuntimeCrossEdges: runtimeCross.filter(e => domain(e.to) !== 'common').length,
    upwardEdges: upward.length,
    cycleCount: cycles.length,
    cycleFiles: cycles.reduce((n, c) => n + c.length, 0),
    deepImports,
    barrelViolations: barrelViolations.length,
    maxFileLines: Math.max(...lines.values()),
    commonForbidden: forbidden.length,
    barrels: files.filter(f => /\/index\.tsx?$/.test(f)).length,
  };
  return { metrics, cycles, forbidden };
}

function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

const args = process.argv.slice(2);
const result = analyze();
const { metrics } = result;
const allowlist = new Set(readJson(ALLOWLIST, { forbidden: [] }).forbidden ?? []);
const activeForbidden = result.forbidden.filter(v => !allowlist.has(v));

console.log('Architecture scan (src/)');
for (const [key, value] of Object.entries(metrics)) console.log(`  ${key.padEnd(20)} ${value}`);
if (result.cycles.length) {
  console.log('\nFile-level cycles:');
  for (const group of result.cycles) console.log(`  ${group.length} files: ${group.slice(0, 6).join(', ')}`);
}
if (activeForbidden.length) {
  console.log('\nForbidden common-layer imports:');
  for (const item of activeForbidden.slice(0, 20)) console.log(`  ${item}`);
}

if (args.includes('--check')) {
  const values = { ...metrics, commonForbidden: activeForbidden.length };
  const failed = Object.entries(LIMITS)
    .filter(([key, limit]) => values[key] > limit)
    .map(([key]) => key);
  if (failed.length) {
    console.error(`\nFAIL: ${failed.join(', ')} exceed the architecture limits.`);
    process.exit(1);
  }
  console.log('\nPASS: all architecture limits satisfied.');
}
