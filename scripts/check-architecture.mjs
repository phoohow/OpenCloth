import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const LAYER = {
  base: 0,
  model: 1, pattern: 1, garment: 1, avatar: 1, sim: 1, analysis: 1,
  scene: 2, production: 2, render: 2, io: 2,
  runtime: 3, commands: 3,
  app: 4, store: 4,
  ui: 5,
  api: 6, tools: 6, main: 6,
};
const layerOf = d => LAYER[d] ?? 3;
const FORBIDDEN_EXTERNAL = ['three', 'three/webgpu', 'three/tsl', 'react', 'react-dom', 'zustand'];
const IMPORT_RE = /\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const LIMITS = {
  upwardEdges: 0,
  renderLayerViolations: 0,
  cycleCount: 0,
  cycleFiles: 0,
  deepImports: 0,
  barrelViolations: 0,
  maxFileLines: 1000,
  baseForbidden: 0,
  commonImplImports: 0,
  threeOutsideBackend: 0,
  renderDomainImports: 0,
  runtimeBackendImports: 0,
  uiRenderImports: 0,
  backendAssemblyViolations: 0,
  worldBackendImports: 0,
  simLayerViolations: 0,
  simSiblingImports: 0,
  gpuOutsideGpu: 0,
  queueOutsideGpu: 0,
  wgslOutsideShaders: 0,
  contractDeviceTypes: 0,
  simDoorViolations: 0,
  patternAvatarImports: 0,
  patternBundlerApi: 0,
  scenePurityViolations: 0,
  runtimeAppImports: 0,
};

const isThree = s => /^three($|\/|-)/.test(s) || s.startsWith('oidn-webgpu');
const DOMAIN_MODULES = ['model', 'pattern', 'sim', 'analysis', 'io', 'runtime'];

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
const RENDER_LAYER = { common: 0, backend: 1, world: 2, renderer: 3 };
const SIM_DOORS = ['sim/common/', 'sim/solver/'];
const SIM_LAYER = { common: 0, particles: 1, device: 1, solver: 2 };
const simLayerOf = f => {
  const parts = rel(f).split('/');
  if (parts[0] !== 'sim' || parts[1] === 'index.ts') return -1;
  const layer = SIM_LAYER[parts[1]];
  if (layer === undefined) throw new Error(`sim/${parts[1]} has no layer in SIM_LAYER`);
  return layer;
};
const GPU_CALL_RE = /\b(createComputePipeline|beginComputePass|createBindGroup|createShaderModule|createCommandEncoder)\b/;
const QUEUE_CALL_RE = /\.queue\b/;
const GPU_TYPE_RE = /\bGPU(Buffer|BindGroup|BindGroupLayout|ComputePipeline|ShaderModule|Device|CommandEncoder|Texture)\b/;
const WGSL_RE = /\/\* wgsl \*\//;
const renderLayerOf = f => {
  const parts = rel(f).split('/');
  if (parts[0] !== 'render' || parts[1] === 'index.ts') return -1;
  return RENDER_LAYER[parts[1]] ?? 2;
};

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
  const threeOutsideBackend = [];
  const renderDomainImports = [];
  const runtimeBackendImports = [];
  const uiRenderImports = [];
  const backendAssemblyViolations = [];
  const worldBackendImports = [];
  const commonImplImports = [];
  const gpuOutsideGpu = [];
  const queueOutsideGpu = [];
  const wgslOutsideShaders = [];
  const contractDeviceTypes = [];
  const simDoorViolations = [];
  const patternAvatarImports = [];
  const patternBundlerApi = [];
  const scenePurityViolations = [];
  const runtimeAppImports = [];
  let deepImports = 0;

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    lines.set(file, source.split('\n').length);
    const fromDomain = domain(file);
    const relFile = rel(file);
    const inBackend = relFile.startsWith('render/backend/');
    if (fromDomain === 'sim') {
      const inDevice = relFile.startsWith('sim/device/');
      if (GPU_CALL_RE.test(source) && !inDevice) gpuOutsideGpu.push(relFile);
      if (QUEUE_CALL_RE.test(source) && !inDevice) queueOutsideGpu.push(relFile);
      if (WGSL_RE.test(source) && !relFile.startsWith('sim/device/shaders/')) wgslOutsideShaders.push(relFile);
      if ((relFile.startsWith('sim/common/') || relFile.startsWith('sim/particles/')) && GPU_TYPE_RE.test(source)) {
        contractDeviceTypes.push(relFile);
      }
    }
    if (fromDomain === 'pattern' && /import\.meta/.test(source)) patternBundlerApi.push(relFile);
    if (fromDomain === 'scene' && /\b(window|document)\./.test(source)) scenePurityViolations.push(relFile);
    let match;
    IMPORT_RE.lastIndex = 0;
    while ((match = IMPORT_RE.exec(source)) !== null) {
      const spec = match[1] ?? match[2] ?? match[3] ?? match[4];
      const typeOnly = /^\s*import\s+type\b/.test(match[0]);
      if (isThree(spec) && !inBackend) threeOutsideBackend.push(`${relFile} -> ${spec}`);
      const target = resolveSpec(file, spec);

      if (spec.startsWith('.') && (spec.match(/\.\.\//g) ?? []).length >= 2) deepImports++;

      if (!target) {
        if (fromDomain === 'base' && FORBIDDEN_EXTERNAL.includes(spec)) {
          forbidden.push(`${rel(file)} -> ${spec}`);
        }
        continue;
      }
      if (target === file) continue;
      edges.push({ from: file, to: target, typeOnly });

      const toDomain = domain(target);
      const toRel = rel(target);
      if (fromDomain === 'render' && DOMAIN_MODULES.includes(toDomain)) {
        renderDomainImports.push(`${relFile} -> ${toRel}`);
      }
      if (fromDomain === 'runtime' && toRel.startsWith('render/backend/')) {
        runtimeBackendImports.push(`${relFile} -> ${toRel}`);
      }
      if (fromDomain === 'ui' && toRel.startsWith('render/') && !toRel.startsWith('render/common/')) {
        uiRenderImports.push(`${relFile} -> ${toRel}`);
      }
      if (fromDomain === 'pattern' && toDomain === 'avatar') {
        patternAvatarImports.push(`${relFile} -> ${toRel}`);
      }
      if (fromDomain === 'scene' && (isThree(spec) || /^(react|react-dom|zustand)/.test(spec) || toRel.startsWith('render/'))) {
        scenePurityViolations.push(`${relFile} -> ${spec}`);
      }
      if (fromDomain === 'runtime' && toDomain === 'app') {
        runtimeAppImports.push(`${relFile} -> ${toRel}`);
      }
      if (toRel.startsWith('render/backend/') && fromDomain !== 'render' && relFile !== 'main.tsx') {
        backendAssemblyViolations.push(`${relFile} -> ${toRel}`);
      }
      if (relFile.startsWith('render/common/') && /^render\/(backend|world|renderer)\//.test(toRel)) {
        commonImplImports.push(`${relFile} -> ${toRel}`);
      }
      if (relFile.startsWith('render/world/') && toRel.startsWith('render/backend/')) {
        worldBackendImports.push(`${relFile} -> ${toRel}`);
      }
      if (toDomain === 'sim' && fromDomain !== 'sim' && !SIM_DOORS.some(door => toRel.startsWith(door))) {
        simDoorViolations.push(`${relFile} -> ${toRel}`);
      }
      if (fromDomain === 'base' && toDomain !== 'base') {
        forbidden.push(`${rel(file)} -> ${rel(target)}`);
      }
      if (fromDomain !== toDomain && toDomain !== 'base'
        && !/\/(index|types)\.tsx?$/.test(target)
        && !['main', 'api', 'tools'].includes(fromDomain)) {
        barrelViolations.push(`${rel(file)} -> ${rel(target)}`);
      }
    }
  }

  const cross = edges.filter(e => domain(e.from) !== domain(e.to));
  const runtimeCross = cross.filter(e => !e.typeOnly);
  const upward = runtimeCross.filter(e => layerOf(domain(e.from)) < layerOf(domain(e.to)));
  if (process.env.ARCH_DEBUG) for (const e of upward) console.log('UP', rel(e.from), '->', rel(e.to));
  const renderLayerViolations = edges.filter(e => {
    const from = renderLayerOf(e.from);
    const to = renderLayerOf(e.to);
    return from >= 0 && to >= 0 && from < to;
  });

  const simLayerViolations = edges.filter(e => {
    const from = simLayerOf(e.from);
    const to = simLayerOf(e.to);
    return from >= 0 && to >= 0 && from < to;
  });
  const simSiblingImports = edges.filter(e => {
    const from = rel(e.from);
    const to = rel(e.to);
    return (from.startsWith('sim/particles/') && to.startsWith('sim/device/'))
      || (from.startsWith('sim/device/') && to.startsWith('sim/particles/'));
  });

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
    nonBaseRuntimeCrossEdges: runtimeCross.filter(e => domain(e.to) !== 'base').length,
    upwardEdges: upward.length,
    renderLayerViolations: renderLayerViolations.length,
    cycleCount: cycles.length,
    cycleFiles: cycles.reduce((n, c) => n + c.length, 0),
    deepImports,
    barrelViolations: barrelViolations.length,
    maxFileLines: Math.max(...lines.values()),
    baseForbidden: forbidden.length,
    threeOutsideBackend: threeOutsideBackend.length,
    renderDomainImports: renderDomainImports.length,
    runtimeBackendImports: runtimeBackendImports.length,
    uiRenderImports: uiRenderImports.length,
    backendAssemblyViolations: backendAssemblyViolations.length,
    worldBackendImports: worldBackendImports.length,
    commonImplImports: commonImplImports.length,
    simLayerViolations: simLayerViolations.length,
    simSiblingImports: simSiblingImports.length,
    gpuOutsideGpu: gpuOutsideGpu.length,
    queueOutsideGpu: queueOutsideGpu.length,
    wgslOutsideShaders: wgslOutsideShaders.length,
    contractDeviceTypes: contractDeviceTypes.length,
    simDoorViolations: simDoorViolations.length,
    patternAvatarImports: patternAvatarImports.length,
    patternBundlerApi: patternBundlerApi.length,
    scenePurityViolations: scenePurityViolations.length,
    runtimeAppImports: runtimeAppImports.length,
    barrels: files.filter(f => /\/index\.tsx?$/.test(f)).length,
  };
  return {
    metrics, cycles, forbidden, renderLayerViolations, barrelViolations,
    threeOutsideBackend, renderDomainImports, runtimeBackendImports, uiRenderImports,
    backendAssemblyViolations, worldBackendImports, commonImplImports,
    simLayerViolations, simSiblingImports, gpuOutsideGpu, queueOutsideGpu, wgslOutsideShaders,
    contractDeviceTypes, simDoorViolations,
    patternAvatarImports, patternBundlerApi, scenePurityViolations, runtimeAppImports,
  };
}

const args = process.argv.slice(2);
const result = analyze();
const { metrics } = result;

console.log('Architecture scan (src/)');
for (const [key, value] of Object.entries(metrics)) console.log(`  ${key.padEnd(20)} ${value}`);
if (result.cycles.length) {
  console.log('\nFile-level cycles:');
  for (const group of result.cycles) console.log(`  ${group.length} files: ${group.slice(0, 6).join(', ')}`);
}
if (result.renderLayerViolations.length) {
  console.log('\nRender layer violations (bottom-up only):');
  for (const edge of result.renderLayerViolations.slice(0, 24)) {
    console.log(`  ${rel(edge.from)} -> ${rel(edge.to)}`);
  }
}
if (result.barrelViolations.length) {
  console.log('\nBarrel violations (import the domain index or types):');
  for (const item of result.barrelViolations.slice(0, 40)) console.log(`  ${item}`);
}
const boundaryChecks = [
  ['three outside render/backend', result.threeOutsideBackend],
  ['render importing domain/runtime', result.renderDomainImports],
  ['runtime importing render/backend', result.runtimeBackendImports],
  ['ui importing render/*', result.uiRenderImports],
  ['render/backend assembled outside main.tsx', result.backendAssemblyViolations],
  ['world importing render/backend', result.worldBackendImports],
  ['render/common importing render implementation', result.commonImplImports],
  ['sim layers importing upward', result.simLayerViolations.map(e => `${rel(e.from)} -> ${rel(e.to)}`)],
  ['sim particles importing device or back', result.simSiblingImports.map(e => `${rel(e.from)} -> ${rel(e.to)}`)],
  ['sim GPU calls outside sim/device', result.gpuOutsideGpu],
  ['sim queue access outside sim/device', result.queueOutsideGpu],
  ['sim WGSL outside sim/device/shaders', result.wgslOutsideShaders],
  ['sim common/particles naming a device type', result.contractDeviceTypes],
  ['sim reached outside sim/common or sim/solver', result.simDoorViolations],
  ['pattern importing avatar (drape moved to garment)', result.patternAvatarImports],
  ['pattern using bundler api (import.meta)', result.patternBundlerApi],
  ['scene touching gpu/react/render/dom', result.scenePurityViolations],
  ['runtime importing app', result.runtimeAppImports],
];
for (const [label, items] of boundaryChecks) {
  if (!items.length) continue;
  console.log(`\nBoundary violations (${label}):`);
  for (const item of items.slice(0, 24)) console.log(`  ${item}`);
}
if (result.forbidden.length) {
  console.log('\nForbidden base-layer imports:');
  for (const item of result.forbidden.slice(0, 20)) console.log(`  ${item}`);
}

if (args.includes('--check')) {
  const values = { ...metrics, baseForbidden: result.forbidden.length };
  const failed = Object.entries(LIMITS)
    .filter(([key, limit]) => values[key] > limit)
    .map(([key]) => key);
  if (failed.length) {
    console.error(`\nFAIL: ${failed.join(', ')} exceed the architecture limits.`);
    process.exit(1);
  }
  console.log('\nPASS: all architecture limits satisfied.');
}
