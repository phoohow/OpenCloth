// Guard for the site build: fails when the bundle would ask the site for assets it cannot serve.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'dist/site';
const route = '/functions/v1/app/assets';
const bundledDirs = ['models', 'weights', 'env'];

const problems = [];

if (!existsSync(outDir)) {
  problems.push(`${outDir} does not exist; run "vite build --mode site" first.`);
} else {
  for (const dir of bundledDirs) {
    if (existsSync(join(outDir, dir))) problems.push(`${outDir}/${dir} exists; publicDir must be omitted from the site build.`);
  }
  const chunks = readdirSync(join(outDir, 'assets'), { recursive: true })
    .filter(name => String(name).endsWith('.js'))
    .map(name => readFileSync(join(outDir, 'assets', String(name)), 'utf8'));
  if (!chunks.some(source => source.includes(route))) {
    problems.push(`no chunk references ${route}; the build did not enable the Storage asset source.`);
  }
}

if (problems.length) {
  console.error(`site bundle check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`site bundle check passed: ${route} wired, bundled dirs excluded.`);
