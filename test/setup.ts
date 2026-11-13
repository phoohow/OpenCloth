import { readFileSync } from 'node:fs';
import { loadMakehumanBody } from '@/avatar/makehuman/data';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, the base every served asset path resolves against. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** publicDir: site paths such as `/makehuman/body.bin` resolve into `assets/`. */
const ASSET_ROOT = resolve(ROOT, 'assets');
/** Site paths Vite serves from publicDir, which is `assets/` in the dev and test setup. */
const BUNDLED_PREFIXES = ['/makehuman/', '/weights/', '/env/'];

const nativeFetch = globalThis.fetch.bind(globalThis);

/**
 * Serves project-relative asset URLs from disk, so modules that fetch bundled binaries work in
 * the node test environment the same way they do in the browser.
 */
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('/') || url.startsWith('file:')) {
    // Vite hands asset imports over as `/@fs/<absolute path>`; bundled files use their site path,
    // which starts at the publicDir root rather than at the repository root.
    const pathOnly = url.split(/[?#]/)[0]!;
    const path = pathOnly.startsWith('file:') ? fileURLToPath(url)
      : pathOnly.startsWith('/@fs/') ? decodeURIComponent(pathOnly.slice('/@fs/'.length))
        : BUNDLED_PREFIXES.some(prefix => pathOnly.startsWith(prefix))
          ? resolve(ASSET_ROOT, `.${pathOnly}`)
          : resolve(ROOT, `.${pathOnly}`);
    return new Response(new Uint8Array(readFileSync(path)));
  }
  return nativeFetch(input, init);
}) as typeof fetch;

// Every body measurement reads the MakeHuman mesh, so the data is ready before the first test.
await loadMakehumanBody();
