import { readFileSync } from 'node:fs';
import { loadMakehumanBody } from '@/avatar/makehuman/data';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_ROOT = resolve(ROOT, 'assets');
const BUNDLED_PREFIXES = ['/makehuman/', '/weights/', '/env/'];

const nativeFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('/') || url.startsWith('file:')) {
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

await loadMakehumanBody();
