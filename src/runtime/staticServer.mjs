// Serves a static app (the build output of Vite and the like) for the packaged app: copied into
// resources/web as static-server.mjs and started like any other server, with PORT, HOSTNAME and
// WEB_TERRARIUM_STATIC ({ root, spa, proxy }, placeholders already filled). Node built-ins only.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
};

export const contentType = (file) =>
  TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

// Build tools put a content hash in file names (index-C1wrO2-t.js), so those can be cached for good.
// Everything else, index.html above all, is checked again on each load.
const HASHED = /[.-][\w-]{8,}\.[a-z0-9]+$/i;
export const cacheControl = (relativePath) =>
  HASHED.test(path.basename(relativePath)) ? 'public, max-age=31536000, immutable' : 'no-cache';

// The file a URL path points to inside `root`, or null if it would leave `root` or can't be read.
// `pathImpl` is the platform's path rules; on Windows a decoded backslash is a separator too, so
// tests pass path.win32 to check that case on every system.
export const resolveFile = (root, urlPath, pathImpl = path) => {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const file = pathImpl.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`);
  if (file !== root && !file.startsWith(`${root}${pathImpl.sep}`)) return null;
  return file;
};

// The proxy rule for a URL path: the longest matching prefix, or undefined.
export const matchProxy = (proxy, urlPath) =>
  Object.keys(proxy)
    .filter((prefix) => urlPath === prefix || urlPath.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))
    .sort((a, b) => b.length - a.length)[0];

const send = (res, status, headers, body) => {
  res.writeHead(status, headers);
  res.end(body);
};

/**
 * A request handler that serves files from `root`. With `spa`, a GET for a path with no file
 * extension that matches no file gets index.html, so client-side routes work on reload. Paths
 * under a `proxy` prefix are forwarded to their target, path and query kept.
 */
export const createHandler = ({ root, spa = true, proxy = {}, fsImpl = fs, requestImpl = http.request }) => {
  const absoluteRoot = path.resolve(root);
  const isFile = (file) => {
    try {
      return fsImpl.statSync(file).isFile();
    } catch {
      return false;
    }
  };

  const forward = (req, res, prefix) => {
    const target = new URL(proxy[prefix]);
    const upstream = requestImpl(
      {
        hostname: target.hostname,
        port: target.port,
        method: req.method,
        path: `${target.pathname.replace(/\/$/, '')}${req.url}`,
        headers: { ...req.headers, host: target.host },
      },
      (answer) => {
        res.writeHead(answer.statusCode, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on('error', (err) => {
      if (!res.headersSent) send(res, 502, { 'content-type': 'text/plain' }, `Proxy error: ${err.message}`);
      else res.destroy(err);
    });
    req.pipe(upstream);
  };

  const serveFile = (req, res, file) => {
    const relative = path.relative(absoluteRoot, file);
    const headers = {
      'content-type': contentType(file),
      'cache-control': cacheControl(relative),
      'x-content-type-options': 'nosniff',
    };
    if (req.method === 'HEAD') {
      send(res, 200, headers);
      return;
    }
    res.writeHead(200, headers);
    fsImpl.createReadStream(file).pipe(res);
  };

  return (req, res) => {
    const urlPath = new URL(req.url, 'http://localhost').pathname;
    const prefix = matchProxy(proxy, urlPath);
    if (prefix) {
      forward(req, res, prefix);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, { allow: 'GET, HEAD', 'content-type': 'text/plain' }, 'Method not allowed');
      return;
    }
    const file = resolveFile(absoluteRoot, urlPath);
    if (!file) {
      send(res, 400, { 'content-type': 'text/plain' }, 'Bad request');
      return;
    }
    const candidates = [file, path.join(file, 'index.html')];
    const found = candidates.find(isFile);
    if (found) {
      serveFile(req, res, found);
      return;
    }
    const index = path.join(absoluteRoot, 'index.html');
    if (spa && !path.extname(urlPath) && isFile(index)) {
      serveFile(req, res, index);
      return;
    }
    send(res, 404, { 'content-type': 'text/plain' }, 'Not found');
  };
};

// Started as a server by the packaged app: node static-server.mjs, from resources/web.
export const main = ({ env = process.env, cwd = process.cwd(), createServer = http.createServer } = {}) => {
  const { root, spa, proxy } = JSON.parse(env.WEB_TERRARIUM_STATIC);
  const host = env.HOSTNAME ?? '127.0.0.1';
  const server = createServer(createHandler({ root: path.resolve(cwd, root), spa, proxy }));
  server.listen(Number(env.PORT), host, () => {
    // eslint-disable-next-line no-console -- goes to servers.log
    console.log(`Serving ${root} at http://${host}:${env.PORT}`);
  });
  return server;
};

// Only true when run as its own process, which unit tests can't measure; main() itself is tested.
/* v8 ignore next */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
