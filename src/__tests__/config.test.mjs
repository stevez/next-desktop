import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { guessAppType, resolveConfig, runtimeConfig, stagePaths } from '../config';

const root = path.resolve('project');
const rootPackage = { version: '1.2.3' };
const minimal = { name: 'Acme Demo', appId: 'com.acme.demo' };
const resolve = (raw) => resolveConfig(raw, { root, rootPackage });

describe('resolveConfig', () => {
  it('fills in defaults for a minimal config', () => {
    expect(resolve(minimal)).toEqual({
      root,
      name: 'Acme Demo',
      appId: 'com.acme.demo',
      artifactName: 'Acme-Demo',
      version: '1.2.3',
      description: 'Acme Demo',
      author: '',
      outDir: path.join(root, 'dist-desktop'),
      app: { type: 'next', distDir: '.next-terrarium', buildEnv: {}, env: {}, readyPath: '/' },
      servers: [],
      startTimeoutMs: 60000,
      window: { width: 1280, height: 800, loadingText: 'Starting Acme Demo…' },
      errorHint: 'Close other copies of Acme Demo and try again.',
    });
  });

  it('keeps the values a project sets', () => {
    const app = {
      type: 'next',
      distDir: '.next-demo',
      buildEnv: { A: '1' },
      env: { B: '2' },
      readyPath: '/health',
    };
    const config = resolve({
      ...minimal,
      artifactName: 'Acme',
      version: '9.0.0',
      description: 'Acme on mock data',
      author: 'Acme Inc.',
      outDir: 'out-demo',
      app,
      startTimeoutMs: 120000,
      window: { width: 1440, loadingText: 'Wait…' },
      errorHint: 'Restart your laptop.',
    });

    expect(config).toMatchObject({
      artifactName: 'Acme',
      version: '9.0.0',
      description: 'Acme on mock data',
      author: 'Acme Inc.',
      outDir: path.join(root, 'out-demo'),
      app,
      startTimeoutMs: 120000,
      window: { width: 1440, height: 800, loadingText: 'Wait…' },
      errorHint: 'Restart your laptop.',
    });
  });

  it('reads the older next: { ... } as a Next.js app', () => {
    const config = resolve({ ...minimal, next: { distDir: '.next-demo', env: { B: '2' } } });

    expect(config.app).toEqual({
      type: 'next',
      distDir: '.next-demo',
      buildEnv: {},
      env: { B: '2' },
      readyPath: '/',
    });
  });

  it.each([['dist-desktop'], ['build/desktop'], [path.join(path.dirname(root), 'elsewhere')]])(
    'accepts outDir %s, which holds no part of the project',
    (outDir) => {
      expect(resolve({ ...minimal, outDir }).outDir).toBe(path.resolve(root, outDir));
    },
  );

  it('uses the author from package.json', () => {
    const config = resolveConfig(minimal, { root, rootPackage: { version: '1.0.0', author: 'Pkg' } });

    expect(config.author).toBe('Pkg');
  });

  it('resolves server entries from the project root and fills in server defaults', () => {
    const config = resolve({
      ...minimal,
      servers: [
        { name: 'mock', entry: 'mocks/server.mjs' },
        {
          name: 'search',
          label: 'search engine',
          entry: 'search/index.js',
          copy: ['data'],
          env: { PORT: '{port}' },
          readyPath: '/ready',
        },
        { name: 'db', entry: 'db/server.mjs', ready: 'tcp' },
      ],
    });

    expect(config.servers).toEqual([
      {
        name: 'mock',
        label: 'mock server',
        entry: path.join(root, 'mocks', 'server.mjs'),
        copy: [],
        env: {},
        ready: 'http',
        readyPath: '/',
      },
      {
        name: 'search',
        label: 'search engine',
        entry: path.join(root, 'search', 'index.js'),
        copy: ['data'],
        env: { PORT: '{port}' },
        ready: 'http',
        readyPath: '/ready',
      },
      {
        name: 'db',
        label: 'db server',
        entry: path.join(root, 'db', 'server.mjs'),
        copy: [],
        env: {},
        ready: 'tcp',
        readyPath: '/',
      },
    ]);
  });

  it.each([
    [{}, 'needs a name'],
    [{ name: 'Acme' }, 'needs an appId'],
    [{ ...minimal, app: { type: 'next', distDir: '.next' } }, 'must not be .next'],
    [{ ...minimal, next: { distDir: '.next' } }, 'must not be .next'],
    [{ ...minimal, next: { distDir: './.next' } }, 'must not be .next'],
    [{ ...minimal, next: { distDir: '.next/' } }, 'must not be .next'],
    [{ ...minimal, next: { distDir: 'build/../.next' } }, 'must not be .next'],
    [{ ...minimal, app: { type: 'next' }, next: {} }, 'Use app or next in the config, not both'],
    [{ ...minimal, app: { type: 'rails' } }, 'app.type must be one of next, static, got "rails"'],
    [{ ...minimal, outDir: '.' }, 'outDir must be a folder inside the project, got "."'],
    [{ ...minimal, outDir: './' }, 'outDir must be a folder inside the project'],
    [{ ...minimal, outDir: '..' }, 'outDir must be a folder inside the project'],
    [{ ...minimal, outDir: '../..' }, 'outDir must be a folder inside the project'],
    [{ ...minimal, outDir: 'out/../..' }, 'outDir must be a folder inside the project'],
    [{ ...minimal, outDir: path.parse(root).root }, 'outDir must be a folder inside the project'],
    [{ ...minimal, startTimeoutMs: 0 }, 'startTimeoutMs must be a whole number'],
    [{ ...minimal, startTimeoutMs: -5 }, 'startTimeoutMs must be a whole number'],
    [{ ...minimal, startTimeoutMs: 1.5 }, 'startTimeoutMs must be a whole number'],
    [{ ...minimal, startTimeoutMs: '60000' }, 'got "60000"'],
    [{ ...minimal, servers: [{ entry: 'a.mjs' }] }, 'Each server needs a name'],
    [{ ...minimal, servers: [{ name: 'app', entry: 'a.mjs' }] }, 'not "app"'],
    [{ ...minimal, servers: [{ name: 'my mock', entry: 'a.mjs' }] }, 'my mock'],
    [{ ...minimal, servers: [{ name: 'mock' }] }, 'Server mock needs an entry'],
    [
      { ...minimal, servers: [{ name: 'db', entry: 'a.mjs', ready: 'udp' }] },
      'Server db: ready must be one of http, tcp, got "udp"',
    ],
    [
      {
        ...minimal,
        servers: [
          { name: 'mock', entry: 'a.mjs' },
          { name: 'mock', entry: 'b.mjs' },
        ],
      },
      'Two servers are named mock',
    ],
  ])('refuses an invalid config %#', (raw, message) => {
    expect(() => resolve(raw)).toThrow(message);
  });

  it('refuses a missing config', () => {
    expect(() => resolve(undefined)).toThrow('needs a name');
  });
});

describe('runtimeConfig', () => {
  it('keeps only what the packaged app needs, with staged folder names', () => {
    const config = resolve({
      ...minimal,
      app: { type: 'next', env: { API_URL: 'http://{host}:{port:mock}' }, buildEnv: { SECRET: 'x' } },
      servers: [{ name: 'mock', entry: 'mocks/server.mjs', copy: ['seeds'], env: { P: '{port}' } }],
      startTimeoutMs: 90000,
    });

    expect(runtimeConfig(config)).toEqual({
      name: 'Acme Demo',
      window: { width: 1280, height: 800, loadingText: 'Starting Acme Demo…' },
      errorHint: 'Close other copies of Acme Demo and try again.',
      startTimeoutMs: 90000,
      servers: [
        {
          name: 'mock',
          label: 'mock server',
          dir: 'servers/mock',
          entry: 'server.mjs',
          env: { P: '{port}' },
          ready: 'http',
          readyPath: '/',
        },
      ],
      app: {
        name: 'app',
        label: 'app server',
        dir: 'web',
        entry: 'server.js',
        env: { API_URL: 'http://{host}:{port:mock}' },
        readyPath: '/',
      },
    });
  });
});

describe('runtimeConfig appDir', () => {
  it('starts the app server from its folder inside web/ when Next put it deeper', () => {
    const app = runtimeConfig(resolve(minimal), { appDir: 'development/my-app' }).app;

    expect(app).toMatchObject({ dir: 'web/development/my-app', entry: 'server.js' });
  });
});

describe('icon', () => {
  it('resolves a configured icon from the project root', () => {
    expect(resolve({ ...minimal, icon: 'brand/app.png' }).icon).toBe(path.join(root, 'brand', 'app.png'));
  });

  it('passes the staged icon name to the packaged app', () => {
    expect(runtimeConfig(resolve(minimal), { icon: 'icon.ico' }).icon).toBe('icon.ico');
  });
});

describe('stagePaths', () => {
  it('lays out the output folder', () => {
    const out = path.join(root, 'dist-desktop');

    expect(stagePaths(resolve(minimal))).toEqual({
      stage: path.join(out, 'stage'),
      resources: path.join(out, 'resources'),
      web: path.join(out, 'resources', 'web'),
      servers: path.join(out, 'resources', 'servers'),
      packaged: path.join(out, 'out'),
    });
  });
});

describe('static apps', () => {
  const staticApp = (app) => resolve({ ...minimal, app: { type: 'static', ...app } });

  it('fills in defaults: npm run build, dist, single-page app, no proxy', () => {
    expect(staticApp({}).app).toEqual({
      type: 'static',
      build: 'npm run build',
      dir: path.join(root, 'dist'),
      spa: true,
      proxy: {},
      buildEnv: {},
      readyPath: '/',
    });
  });

  it('keeps the values a project sets', () => {
    const app = staticApp({
      build: 'pnpm build',
      dir: 'build/web',
      spa: false,
      proxy: { '/api': 'http://{host}:{port:mock}' },
      buildEnv: { VITE_MODE: 'demo' },
      readyPath: '/health.txt',
    }).app;

    expect(app).toEqual({
      type: 'static',
      build: 'pnpm build',
      dir: path.join(root, 'build', 'web'),
      spa: false,
      proxy: { '/api': 'http://{host}:{port:mock}' },
      buildEnv: { VITE_MODE: 'demo' },
      readyPath: '/health.txt',
    });
  });

  it.each([
    [{ dir: '.' }, 'app.dir must be the build output folder inside the project, got "."'],
    [{ dir: '..' }, 'app.dir must be the build output folder inside the project'],
    [{ proxy: { api: 'http://{host}:{port:mock}' } }, 'app.proxy paths must start with /, got "api"'],
    [{ proxy: { '/api': 'https://example.com' } }, 'app.proxy["/api"] must be an http:// URL, got "https://example.com"'],
    [{ proxy: { '/api': 5 } }, 'must be an http:// URL, got "5"'],
  ])('refuses a bad static config %#', (app, message) => {
    expect(() => staticApp(app)).toThrow(message);
  });

  it('runs the static server from web/, with the site and the proxy in its env', () => {
    const config = staticApp({ spa: false, proxy: { '/api': 'http://{host}:{port:mock}' } });

    expect(runtimeConfig(config).app).toEqual({
      name: 'app',
      label: 'app server',
      dir: 'web',
      entry: 'static-server.mjs',
      env: {
        WEB_TERRARIUM_STATIC: JSON.stringify({
          root: 'site',
          spa: false,
          proxy: { '/api': 'http://{host}:{port:mock}' },
        }),
      },
      readyPath: '/',
    });
  });
});

describe('guessAppType', () => {
  it.each([
    [{ dependencies: { next: '^15' } }, 'next'],
    [{ dependencies: { next: '^15' }, devDependencies: { vite: '^7' } }, 'next'],
    [{ devDependencies: { vite: '^7' } }, 'static'],
    [{ dependencies: { react: '^19' } }, 'next'],
    [{}, 'next'],
  ])('reads %j as %s', (rootPackage, type) => {
    expect(guessAppType(rootPackage)).toBe(type);
  });

  it('guesses when the config sets no app type', () => {
    const vite = { version: '1.0.0', devDependencies: { vite: '^7' } };

    expect(resolveConfig(minimal, { root, rootPackage: vite }).app.type).toBe('static');
    expect(resolveConfig({ ...minimal, app: {} }, { root, rootPackage: vite }).app.type).toBe('static');
    expect(resolveConfig({ ...minimal, next: {} }, { root, rootPackage: vite }).app.type).toBe('next');
  });
});
