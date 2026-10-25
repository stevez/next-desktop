import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  cacheControl,
  contentType,
  createHandler,
  main,
  matchProxy,
  resolveFile,
} from '../staticServer';

describe('contentType', () => {
  it.each([
    ['index.html', 'text/html; charset=utf-8'],
    ['assets/app-C1wrO2-t.js', 'text/javascript; charset=utf-8'],
    ['style.CSS', 'text/css; charset=utf-8'],
    ['logo.svg', 'image/svg+xml'],
    ['font.woff2', 'font/woff2'],
    ['data.bin', 'application/octet-stream'],
    ['README', 'application/octet-stream'],
  ])('%s is %s', (file, type) => {
    expect(contentType(file)).toBe(type);
  });
});

describe('cacheControl', () => {
  it('caches files with a content hash in the name for good', () => {
    expect(cacheControl('assets/index-C1wrO2-t.js')).toBe('public, max-age=31536000, immutable');
    expect(cacheControl('assets/logo.4f9a2b7c1d.png')).toBe('public, max-age=31536000, immutable');
  });

  it('checks everything else again on each load', () => {
    expect(cacheControl('index.html')).toBe('no-cache');
    expect(cacheControl('favicon.ico')).toBe('no-cache');
    expect(cacheControl('assets/app.js')).toBe('no-cache');
  });
});

describe('resolveFile', () => {
  const root = path.resolve('site');

  it('maps a URL path into the root', () => {
    expect(resolveFile(root, '/assets/app.js')).toBe(path.join(root, 'assets', 'app.js'));
    expect(resolveFile(root, '/')).toBe(root);
    expect(resolveFile(root, '/my%20file.txt')).toBe(path.join(root, 'my file.txt'));
  });

  it('keeps ../ inside the root', () => {
    expect(resolveFile(root, '/../../etc/passwd')).toBe(path.join(root, 'etc', 'passwd'));
    expect(resolveFile(root, '/%2e%2e/secret')).toBe(path.join(root, 'secret'));
  });

  it('refuses paths that would leave the root or cannot be decoded', () => {
    expect(resolveFile(root, '/%E0%A4%A')).toBeNull();
    expect(resolveFile(root, '/a%00b')).toBeNull();
  });

  it('refuses an encoded ..\\ under Windows path rules, where a backslash is a separator', () => {
    const windowsRoot = 'C:\\app\\site';

    expect(resolveFile(windowsRoot, '/..%5C..%5Cwin.ini', path.win32)).toBeNull();
    expect(resolveFile(windowsRoot, '/a%5Cb.txt', path.win32)).toBe('C:\\app\\site\\a\\b.txt');
  });
});

describe('matchProxy', () => {
  const proxy = { '/api': 'http://a', '/api/v2': 'http://b', '/ws/': 'http://c' };

  it('picks the longest matching prefix', () => {
    expect(matchProxy(proxy, '/api')).toBe('/api');
    expect(matchProxy(proxy, '/api/tasks')).toBe('/api');
    expect(matchProxy(proxy, '/api/v2/tasks')).toBe('/api/v2');
    expect(matchProxy(proxy, '/ws/live')).toBe('/ws/');
  });

  it('only matches whole path segments', () => {
    expect(matchProxy(proxy, '/apix')).toBeUndefined();
    expect(matchProxy(proxy, '/')).toBeUndefined();
  });
});

describe('createHandler', () => {
  const site = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'web-terrarium-site-')));
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(site, file)), { recursive: true });
    fs.writeFileSync(path.join(site, file), text);
  };
  write('index.html', '<h1>home</h1>');
  write('assets/index-C1wrO2-t.js', 'console.log(1)');
  write('docs/index.html', '<h1>docs</h1>');

  // An upstream server for the proxy, answering with what it received.
  const upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      res.writeHead(201, { 'content-type': 'application/json', 'x-upstream': 'yes' });
      res.end(JSON.stringify({ method: req.method, url: req.url, host: req.headers.host, body }));
    });
  });

  const servers = [];
  const serve = async (options) => {
    const server = http.createServer(createHandler({ root: site, ...options }));
    servers.push(server);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    return `http://127.0.0.1:${server.address().port}`;
  };

  let upstreamUrl;
  beforeAll(async () => {
    await new Promise((resolve) => {
      upstream.listen(0, '127.0.0.1', resolve);
    });
    upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  });
  afterAll(async () => {
    await Promise.all(
      [upstream, ...servers].map(
        (server) =>
          new Promise((resolve) => {
            server.close(resolve);
          }),
      ),
    );
    fs.rmSync(site, { recursive: true, force: true });
  });

  it('serves files with their type and caching', async () => {
    const base = await serve();

    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await page.text()).toBe('<h1>home</h1>');

    const script = await fetch(`${base}/assets/index-C1wrO2-t.js?v=1`);
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(script.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await script.text()).toBe('console.log(1)');
  });

  it("serves a folder's index.html", async () => {
    const base = await serve();

    expect(await (await fetch(`${base}/docs`)).text()).toBe('<h1>docs</h1>');
    expect(await (await fetch(`${base}/docs/`)).text()).toBe('<h1>docs</h1>');
  });

  it('answers HEAD with headers only', async () => {
    const base = await serve();

    const head = await fetch(`${base}/index.html`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await head.text()).toBe('');
  });

  it('sends index.html for client-side routes in a single-page app', async () => {
    const base = await serve({ spa: true });

    const route = await fetch(`${base}/tasks/42`);
    expect(route.status).toBe(200);
    expect(await route.text()).toBe('<h1>home</h1>');
  });

  it('still says 404 for a missing file with an extension', async () => {
    const base = await serve({ spa: true });

    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
  });

  it('says 404 for client-side routes when spa is off', async () => {
    const base = await serve({ spa: false });

    expect((await fetch(`${base}/tasks/42`)).status).toBe(404);
  });

  it('says 404 for routes when the site has no index.html', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'web-terrarium-empty-'));
    const base = await serve({ root: empty, spa: true });

    expect((await fetch(`${base}/tasks`)).status).toBe(404);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('refuses other methods and bad paths', async () => {
    const base = await serve();

    const post = await fetch(`${base}/`, { method: 'POST', body: 'x' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
    expect((await fetch(`${base}/%E0%A4%A`)).status).toBe(400);
  });

  it('forwards proxied paths to their target, with method, path, query and body', async () => {
    const base = await serve({ proxy: { '/api': upstreamUrl } });

    const answer = await fetch(`${base}/api/tasks?done=1`, { method: 'POST', body: 'hello' });
    expect(answer.status).toBe(201);
    expect(answer.headers.get('x-upstream')).toBe('yes');
    expect(await answer.json()).toEqual({
      method: 'POST',
      url: '/api/tasks?done=1',
      host: upstreamUrl.replace('http://', ''),
      body: 'hello',
    });
  });

  it('keeps the path of a target with one', async () => {
    const base = await serve({ proxy: { '/api': `${upstreamUrl}/v1/` } });

    expect((await (await fetch(`${base}/api/tasks`)).json()).url).toBe('/v1/api/tasks');
  });

  it('answers 502 when the target is down', async () => {
    const base = await serve({ proxy: { '/api': 'http://127.0.0.1:1' } });

    const answer = await fetch(`${base}/api/tasks`);
    expect(answer.status).toBe(502);
    expect(await answer.text()).toMatch(/^Proxy error: /);
  });

  it('drops the connection when the target fails after answering', () => {
    const upstreamRequest = new EventEmitter();
    const requestImpl = vi.fn((options, onAnswer) => {
      const answer = new EventEmitter();
      answer.statusCode = 200;
      answer.headers = {};
      answer.pipe = vi.fn();
      onAnswer(answer);
      return upstreamRequest;
    });
    const res = { headersSent: false, writeHead: vi.fn(), end: vi.fn(), destroy: vi.fn() };
    res.writeHead.mockImplementation(() => {
      res.headersSent = true;
    });
    const req = { url: '/api/x', method: 'GET', headers: {}, pipe: vi.fn() };

    createHandler({ root: site, proxy: { '/api': 'http://127.0.0.1:9' }, requestImpl })(req, res);
    const err = new Error('reset');
    upstreamRequest.emit('error', err);

    expect(res.destroy).toHaveBeenCalledWith(err);
    expect(res.end).not.toHaveBeenCalled();
  });
});

describe('main', () => {
  it('serves the site from WEB_TERRARIUM_STATIC on PORT and HOSTNAME', () => {
    const server = { listen: vi.fn((port, host, onListening) => onListening()) };
    const createServer = vi.fn(() => server);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const started = main({
      env: {
        WEB_TERRARIUM_STATIC: JSON.stringify({ root: 'site', spa: true, proxy: {} }),
        PORT: '23456',
        HOSTNAME: '127.0.0.1',
      },
      cwd: path.resolve('web'),
      createServer,
    });

    expect(started).toBe(server);
    expect(createServer).toHaveBeenCalledWith(expect.any(Function));
    expect(server.listen).toHaveBeenCalledWith(23456, '127.0.0.1', expect.any(Function));
    expect(log).toHaveBeenCalledWith('Serving site at http://127.0.0.1:23456');
    log.mockRestore();
  });

  it('listens on 127.0.0.1 when no HOSTNAME is set', () => {
    const server = { listen: vi.fn() };

    main({
      env: { WEB_TERRARIUM_STATIC: JSON.stringify({ root: 'site' }), PORT: '23456' },
      createServer: () => server,
    });

    expect(server.listen).toHaveBeenCalledWith(23456, '127.0.0.1', expect.any(Function));
  });
});
