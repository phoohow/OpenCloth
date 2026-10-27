// Zero-dependency static file server for the built dist/ folder, for machines
// without network access (npm install / npx are unavailable there).
// Usage: node scripts/serve-dist.mjs [port]  ->  http://localhost:5173
import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST_ROOT = resolve(fileURLToPath(import.meta.url), '../..', 'dist');
const PORT = Number(process.argv[2] ?? 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.obj': 'text/plain; charset=utf-8',
  '.hdr': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Maps a request path to a file inside DIST_ROOT, or null when it escapes it. */
function toFilePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const candidate = resolve(join(DIST_ROOT, normalize(decoded)));
  return candidate === DIST_ROOT || candidate.startsWith(DIST_ROOT + sep) ? candidate : null;
}

const server = createServer(async (req, res) => {
  let target = toFilePath(req.url === '/' ? '/index.html' : req.url);
  if (!target) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  // Unknown paths fall back to index.html so the app still boots on any URL.
  if (!(await fs.stat(target).catch(() => null))?.isFile()) {
    target = join(DIST_ROOT, 'index.html');
  }
  const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  createReadStream(target).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`serving ${DIST_ROOT}`);
  console.log(`open http://localhost:${PORT}`);
});
