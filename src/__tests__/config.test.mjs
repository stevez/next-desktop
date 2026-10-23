import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveConfig, runtimeConfig, stagePaths } from '../config';

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
      next: { distDir: '.next-desktop', buildEnv: {}, env: {}, readyPath: '/' },
      servers: [],
      window: { width: 1280, height: 800, loadingText: 'Starting Acme Demo…' },
      errorHint: 'Close other copies of Acme Demo and try again.',
    });
  });

  it('keeps the values a project sets', () => {
    const config = resolve({
      ...minimal,
      artifactName: 'Acme',
      version: '9.0.0',
      description: 'Acme on mock data',
      author: 'Acme Inc.',
      outDir: 'out-demo',
      next: { distDir: '.next-demo', buildEnv: { A: '1' }, env: { B: '2' }, readyPath: '/health' },
      window: { width: 1440, loadingText: 'Wait…' },
      errorHint: 'Restart your laptop.',
    });

    expect(config).toMatchObject({
      artifactName: 'Acme',
      version: '9.0.0',
      description: 'Acme on mock data',
      author: 'Acme Inc.',
      outDir: path.join(root, 'out-demo'),
      next: { distDir: '.next-demo', buildEnv: { A: '1' }, env: { B: '2' }, readyPath: '/health' },
      window: { width: 1440, height: 800, loadingText: 'Wait…' },
      errorHint: 'Restart your laptop.',
    });
  });

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
      ],
    });

    expect(config.servers).toEqual([
      {
        name: 'mock',
        label: 'mock server',
        entry: path.join(root, 'mocks', 'server.mjs'),
        copy: [],
        env: {},
        readyPath: '/',
      },
      {
        name: 'search',
        label: 'search engine',
        entry: path.join(root, 'search', 'index.js'),
        copy: ['data'],
        env: { PORT: '{port}' },
        readyPath: '/ready',
      },
    ]);
  });

  it.each([
    [{}, 'needs a name'],
    [{ name: 'Acme' }, 'needs an appId'],
    [{ ...minimal, next: { distDir: '.next' } }, 'must not be .next'],
    [{ ...minimal, next: { distDir: './.next' } }, 'must not be .next'],
    [{ ...minimal, next: { distDir: '.next/' } }, 'must not be .next'],
    [{ ...minimal, next: { distDir: 'build/../.next' } }, 'must not be .next'],
    [{ ...minimal, servers: [{ entry: 'a.mjs' }] }, 'Each server needs a name'],
    [{ ...minimal, servers: [{ name: 'app', entry: 'a.mjs' }] }, 'not "app"'],
    [{ ...minimal, servers: [{ name: 'my mock', entry: 'a.mjs' }] }, 'my mock'],
    [{ ...minimal, servers: [{ name: 'mock' }] }, 'Server mock needs an entry'],
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
      next: { env: { API_URL: 'http://{host}:{port:mock}' }, buildEnv: { SECRET: 'x' } },
      servers: [{ name: 'mock', entry: 'mocks/server.mjs', copy: ['seeds'], env: { P: '{port}' } }],
    });

    expect(runtimeConfig(config)).toEqual({
      name: 'Acme Demo',
      window: { width: 1280, height: 800, loadingText: 'Starting Acme Demo…' },
      errorHint: 'Close other copies of Acme Demo and try again.',
      servers: [
        {
          name: 'mock',
          label: 'mock server',
          dir: 'servers/mock',
          entry: 'server.mjs',
          env: { P: '{port}' },
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
