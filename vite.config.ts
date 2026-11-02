import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Directory whose SVG files are imported as raw text through virtual modules. */
const RAW_SVG_DIR = resolve(__dirname, 'assets/icons');

/** Virtual module id prefix for one raw SVG source. */
const RAW_SVG_PREFIX = '\0raw-svg:';

/**
 * Serves `assets/icons/*.svg?raw` from virtual modules.
 *
 * Icons live under publicDir, and Vite refuses to import public files from JavaScript. Resolving
 * them to virtual ids keeps them importable while their files stay where the asset tree expects.
 */
function rawSvgPlugin(): Plugin {
  return {
    name: 'opencloth:raw-svg',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!source.endsWith('?raw')) return null;
      const specifier = source.slice(0, -'?raw'.length);
      const file = specifier.startsWith('/')
        ? resolve(__dirname, `.${specifier}`)
        : isAbsolute(specifier)
          ? specifier
          : resolve(importer ? dirname(importer) : __dirname, specifier);
      const inside = relative(RAW_SVG_DIR, file);
      if (!inside || inside.startsWith('..') || isAbsolute(inside)) return null;
      return RAW_SVG_PREFIX + file;
    },
    load(id) {
      if (!id.startsWith(RAW_SVG_PREFIX)) return null;
      const file = id.slice(RAW_SVG_PREFIX.length);
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
    plugins: [rawSvgPlugin(), react()],
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
    build: {
      target: 'es2022',
      outDir: storageAssets ? 'dist/site' : 'dist',
      emptyOutDir: true,
      sourcemap: !storageAssets,
    },
  };
});
