import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  // Site build: bundled assets come from site Storage through the Function, so publicDir
  // is omitted from the package and no source maps are emitted.
  const storageAssets = mode === 'site';
  return {
    plugins: [react()],
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
