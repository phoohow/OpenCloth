import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Directories whose files are imported as raw text through virtual modules. */
const RAW_ASSET_DIRS = [
  resolve(__dirname, 'assets/icons'),
  resolve(__dirname, 'assets/patterns'),
];

/** Virtual module id prefix for one raw asset source. */
const RAW_ASSET_PREFIX = '\0raw-asset:';

/** Keeps the virtual id on a JS-shaped path so Vite does not re-parse the raw text. */
const RAW_ASSET_SUFFIX = '.js';

/**
 * Serves `assets/icons/*.svg?raw` and `assets/patterns/*.ocpat?raw` from virtual modules.
 *
 * Both live under publicDir, and Vite refuses to import public files from JavaScript. Resolving
 * them to virtual ids keeps them importable while their files stay where the asset tree expects.
 */
function rawAssetPlugin(): Plugin {
  return {
    name: 'opencloth:raw-assets',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!source.endsWith('?raw')) return null;
      const specifier = source.slice(0, -'?raw'.length);
      const file = specifier.startsWith('/')
        ? resolve(__dirname, `.${specifier}`)
        : isAbsolute(specifier)
          ? specifier
          : resolve(importer ? dirname(importer) : __dirname, specifier);
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
  // Site build: bundled assets come from site Storage through the Function, so publicDir
  // is omitted from the package and no source maps are emitted.
  const storageAssets = mode === 'site';
  return {
    plugins: [rawAssetPlugin(), react()],
    // One switch drives both the omitted publicDir and the Storage-backed asset URLs.
    define: { __BUNDLED_ASSETS_FROM_STORAGE__: JSON.stringify(storageAssets) },
    // assets/ holds bundled model files; Vite serves them at the site root and copies them to dist.
    publicDir: storageAssets ? false : 'assets',
    resolve: {
      alias: [
        { find: '@', replacement: resolve(__dirname, 'src') },
        // 强制 three 的 examples/jsm 插件与主包共用同一个 WebGPU 构建，
        // 避免 three.module.js 与 three.webgpu.js 双实例导致灯光/材质节点失效
        // 仅精确匹配裸导入 'three'，不影响 'three/webgpu' 与 'three/examples/*'
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
