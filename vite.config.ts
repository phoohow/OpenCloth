import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const RAW_ASSET_DIRS = [
  resolve(import.meta.dirname, 'assets/icons'),
  resolve(import.meta.dirname, 'assets/patterns'),
];

const RAW_ASSET_PREFIX = '\0raw-asset:';

const RAW_ASSET_SUFFIX = '.js';

function rawAssetPlugin(): Plugin {
  return {
    name: 'opencloth:raw-assets',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!source.endsWith('?raw')) return null;
      const specifier = source.slice(0, -'?raw'.length);
      const file = specifier.startsWith('/')
        ? resolve(import.meta.dirname, `.${specifier}`)
        : isAbsolute(specifier)
          ? specifier
          : resolve(importer ? dirname(importer) : import.meta.dirname, specifier);
      const allowed = RAW_ASSET_DIRS.some(dir => {
        const inside = relative(dir, file);
        return !!inside && !inside.startsWith('..') && !isAbsolute(inside);
      });
      if (!allowed) return null;
      return RAW_ASSET_PREFIX + file + RAW_ASSET_SUFFIX;
    },
    load(id) {
      if (!id.startsWith(RAW_ASSET_PREFIX) || !id.endsWith(RAW_ASSET_SUFFIX)) return null;
      const file = id.slice(RAW_ASSET_PREFIX.length, -RAW_ASSET_SUFFIX.length);
      this.addWatchFile(file);
      return `export default ${JSON.stringify(readFileSync(file, 'utf-8'))};`;
    },
  };
}

export default defineConfig(({ mode }) => {
  const storageAssets = mode === 'site';
  return {
    plugins: [rawAssetPlugin(), react()],
    define: { __BUNDLED_ASSETS_FROM_STORAGE__: JSON.stringify(storageAssets) },
    publicDir: storageAssets ? false : 'assets',
    resolve: {
      alias: [
        { find: '@', replacement: resolve(import.meta.dirname, 'src') },
        { find: /^three$/, replacement: 'three/webgpu' },
      ],
    },
    server: {
      port: 5173,
      open: true,
    },
    test: {
      setupFiles: ['./test/setup.ts'],
    },
    build: {
      target: 'es2022',
      outDir: storageAssets ? 'dist/site' : 'dist',
      emptyOutDir: true,
      sourcemap: !storageAssets,
    },
  };
});
