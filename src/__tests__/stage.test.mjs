import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { build } from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';

import { __dirname as shimDirname, __filename as shimFilename } from '../bundleShims';
import {
  buildInfo,
  electronPackageJson,
  esbuildOptions,
  findIcon,
  ICON_CANDIDATES,
  nextBuildEnv,
  sharpSwap,
  stagedIconName,
  standaloneAppDir,
  toolsLockfile,
} from '../stage';

const config = {
  name: 'Acme Demo',
  artifactName: 'Acme-Demo',
  version: '1.2.3',
  description: 'Acme on mock data',
  author: 'Acme Inc.',
  app: { type: 'next', distDir: '.next-demo', buildEnv: { E2E_MODE: 'true' } },
};

describe('nextBuildEnv', () => {
  it('adds the project build env and tells next.config.js where to build, by both names', () => {
    expect(nextBuildEnv(config, { PATH: 'p' })).toEqual({
      PATH: 'p',
      E2E_MODE: 'true',
      WEB_TERRARIUM_DIST_DIR: '.next-demo',
      NEXT_DESKTOP_DIST_DIR: '.next-demo',
      NEXT_TELEMETRY_DISABLED: '1',
    });
  });
});

describe('standaloneAppDir', () => {
  it('finds server.js at the top of standalone/ for most projects', () => {
    expect(standaloneAppDir(['server.js', 'node_modules/next/dist/server.js'])).toBe('');
  });

  it('finds it deeper when Next traced from a parent folder (a monorepo, or a parent lockfile)', () => {
    expect(
      standaloneAppDir([
        'node_modules/next/server.js',
        'development/my-app/node_modules/some-lib/server.js',
        'development/my-app/server.js',
      ]),
    ).toBe('development/my-app');
  });

  it('prefers the shallowest server.js outside node_modules', () => {
    expect(standaloneAppDir(['apps/web/src/server.js', 'apps/web/server.js'])).toBe('apps/web');
    expect(standaloneAppDir(['apps/web-admin/server.js', 'apps/web/server.js'])).toBe('apps/web');
  });

  it('finds nothing when every server.js is a dependency', () => {
    expect(standaloneAppDir(['node_modules/next/server.js'])).toBeUndefined();
    expect(standaloneAppDir([])).toBeUndefined();
  });
});

describe('findIcon', () => {
  const root = path.resolve('project');
  const has = (...files) => (file) => files.some((name) => file === path.join(root, name));

  it('uses the icon the config sets', () => {
    const icon = path.join(root, 'brand', 'app.png');

    expect(findIcon({ root, icon }, has('brand/app.png', 'src/app/favicon.ico'))).toBe(icon);
  });

  it('refuses a configured icon that does not exist', () => {
    const icon = path.join(root, 'brand', 'app.png');

    expect(() => findIcon({ root, icon }, has())).toThrow(`The icon ${icon} doesn't exist.`);
  });

  it("prefers Next's app icon over the favicon", () => {
    expect(findIcon({ root }, has('src/app/favicon.ico', 'app/icon.png'))).toBe(
      path.join(root, 'app', 'icon.png'),
    );
  });

  it('falls back to the favicon', () => {
    expect(findIcon({ root }, has('src/app/favicon.ico'))).toBe(path.join(root, 'src', 'app', 'favicon.ico'));
  });

  it('finds nothing when the app has no icon', () => {
    expect(findIcon({ root }, has())).toBeUndefined();
  });

  it('checks every usual place', () => {
    expect(ICON_CANDIDATES).toEqual([
      'src/app/icon.png',
      'app/icon.png',
      'public/icon.png',
      'src/app/favicon.ico',
      'app/favicon.ico',
      'public/favicon.ico',
    ]);
  });
});

describe('stagedIconName', () => {
  it('keeps the format, in lower case', () => {
    expect(stagedIconName(path.join('a', 'Logo.PNG'))).toBe('icon.png');
    expect(stagedIconName('favicon.ico')).toBe('icon.ico');
  });
});

describe('bundleShims', () => {
  it('gives the file and folder of the module it is bundled into', () => {
    expect(shimFilename).toBe(path.resolve(import.meta.dirname, '..', 'bundleShims.mjs'));
    expect(shimDirname).toBe(path.dirname(shimFilename));
  });
});

describe('electronPackageJson', () => {
  it('describes the staged Electron app', () => {
    expect(electronPackageJson(config)).toEqual({
      name: 'acme-demo',
      productName: 'Acme Demo',
      version: '1.2.3',
      description: 'Acme on mock data',
      author: 'Acme Inc.',
      private: true,
      main: 'main.mjs',
    });
  });
});

describe('esbuildOptions', () => {
  // The real path: on macOS the temp folder is a symlink (/var -> /private/var), and Node
  // reports a module's real path in import.meta.url.
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'web-terrarium-bundle-')));
  afterAll(() => fs.rmSync(temp, { recursive: true, force: true }));
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(temp, file)), { recursive: true });
    fs.writeFileSync(path.join(temp, file), text);
  };

  it('bundles a server into one ESM file for Node', () => {
    expect(esbuildOptions('in/server.mjs', 'out/server.mjs')).toMatchObject({
      entryPoints: ['in/server.mjs'],
      outfile: 'out/server.mjs',
      bundle: true,
      platform: 'node',
      format: 'esm',
      inject: [path.resolve(import.meta.dirname, '..', 'bundleShims.mjs')],
    });
  });

  // A real bundle: CommonJS dependencies get require, __dirname and __filename, and a server
  // that declares its own (the usual ESM pattern) still builds and keeps them.
  it('runs CommonJS dependencies and keeps the server its own __dirname and require', async () => {
    write(
      'node_modules/legacy/index.js',
      "module.exports = { dir: __dirname, file: __filename, os: typeof require('os').cpus };",
    );
    write('node_modules/legacy/package.json', '{ "name": "legacy", "main": "index.js" }');
    write(
      'entry.mjs',
      [
        "import { createRequire } from 'node:module';",
        "import path from 'node:path';",
        "import { fileURLToPath } from 'node:url';",
        "import legacy from 'legacy';",
        'const __dirname = path.dirname(fileURLToPath(import.meta.url)) + "-own";',
        'const require = createRequire(import.meta.url);',
        "console.log(JSON.stringify({ legacy, own: __dirname, req: typeof require('node:os').cpus }));",
      ].join('\n'),
    );
    const outfile = path.join(temp, 'out', 'server.mjs');

    await build({ ...esbuildOptions(path.join(temp, 'entry.mjs'), outfile), logLevel: 'silent' });
    const result = JSON.parse(execFileSync(process.execPath, [outfile], { encoding: 'utf8' }));

    expect(result).toEqual({
      legacy: { dir: path.dirname(outfile), file: outfile, os: 'function' },
      own: `${path.dirname(outfile)}-own`,
      req: 'function',
    });
  });
});

describe('sharpSwap', () => {
  it('removes the staged sharp binaries and copies the ones installed for this system', () => {
    const swap = sharpSwap({
      staged: ['colour', 'sharp-linux-x64', 'sharp-libvips-linux-x64', 'sharp-linuxmusl-x64'],
      installed: ['colour', 'sharp-win32-x64'],
    });

    expect(swap).toEqual({
      remove: ['sharp-linux-x64', 'sharp-libvips-linux-x64', 'sharp-linuxmusl-x64'],
      copy: ['sharp-win32-x64'],
    });
  });
});

describe('toolsLockfile', () => {
  const entry = (version, extra = {}) => ({
    version,
    resolved: `https://private.example/-/${version}.tgz`,
    integrity: `sha512-${version}`,
    dev: true,
    ...extra,
  });
  // web-terrarium as a devDependency. Its electron is nested under it (the project has another
  // electron at the top), electron-builder and esbuild are hoisted, and next (its peer) is the
  // project's own.
  const lock = {
    packages: {
      '': { name: 'app', devDependencies: { 'web-terrarium': '^0.1.0' } },
      'node_modules/web-terrarium': entry('0.1.0', {
        dependencies: { electron: '^45.0.0', 'electron-builder': '^26.18.0', esbuild: '^0.28.2' },
        peerDependencies: { next: '>=15' },
      }),
      'node_modules/web-terrarium/node_modules/electron': entry('45.0.0', {
        hasInstallScript: true,
        dependencies: { '@electron/get': '^2.0.0', extract: '^1.0.0' },
      }),
      'node_modules/electron': entry('33.0.0'),
      'node_modules/@electron/get': entry('2.0.3', { dependencies: { semver: '^6.0.0' } }),
      'node_modules/@electron/get/node_modules/semver': entry('6.3.1', {
        dependencies: { 'lru-cache': '^5.0.0' },
      }),
      'node_modules/@electron/get/node_modules/lru-cache': entry('5.1.1'),
      'node_modules/lru-cache': entry('10.0.0'),
      'node_modules/extract': entry('1.0.0', {
        optionalDependencies: { yauzl: '^2.0.0', 'not-for-this-os': '^1.0.0' },
        peerDependencies: { 'peer-dep': '*', 'missing-peer': '*' },
      }),
      'node_modules/yauzl': entry('2.10.0', { optional: true }),
      'node_modules/peer-dep': entry('1.0.0', { peer: true, devOptional: true }),
      'node_modules/semver': entry('7.7.0'),
      'node_modules/electron-builder': entry('26.18.0', {
        dependencies: { semver: '^7.0.0', extract: '^1.0.0' },
      }),
      'node_modules/esbuild': entry('0.28.2'),
      'node_modules/next': entry('15.5.9', { dependencies: { 'next-only': '^1.0.0' } }),
      'node_modules/next-only': entry('1.0.0'),
      'node_modules/sharp': entry('0.35.4', {
        optionalDependencies: { '@img/sharp-win32-x64': '0.35.4' },
      }),
      'node_modules/@img/sharp-win32-x64': entry('0.35.4', { optional: true, cpu: ['x64'] }),
      'node_modules/unrelated': entry('1.0.0'),
    },
  };
  // What the tools lockfile keeps: no `resolved`, `dev` or `peer`, every integrity hash.
  const tools = {
    'node_modules/web-terrarium': {
      version: '0.1.0',
      integrity: 'sha512-0.1.0',
      dependencies: { electron: '^45.0.0', 'electron-builder': '^26.18.0', esbuild: '^0.28.2' },
      peerDependencies: { next: '>=15' },
    },
    'node_modules/web-terrarium/node_modules/electron': {
      version: '45.0.0',
      integrity: 'sha512-45.0.0',
      hasInstallScript: true,
      dependencies: { '@electron/get': '^2.0.0', extract: '^1.0.0' },
    },
    'node_modules/@electron/get': {
      version: '2.0.3',
      integrity: 'sha512-2.0.3',
      dependencies: { semver: '^6.0.0' },
    },
    'node_modules/@electron/get/node_modules/semver': {
      version: '6.3.1',
      integrity: 'sha512-6.3.1',
      dependencies: { 'lru-cache': '^5.0.0' },
    },
    'node_modules/@electron/get/node_modules/lru-cache': {
      version: '5.1.1',
      integrity: 'sha512-5.1.1',
    },
    'node_modules/extract': {
      version: '1.0.0',
      integrity: 'sha512-1.0.0',
      optionalDependencies: { yauzl: '^2.0.0', 'not-for-this-os': '^1.0.0' },
      peerDependencies: { 'peer-dep': '*', 'missing-peer': '*' },
    },
    'node_modules/yauzl': { version: '2.10.0', integrity: 'sha512-2.10.0', optional: true },
    'node_modules/peer-dep': { version: '1.0.0', integrity: 'sha512-1.0.0' },
    'node_modules/semver': { version: '7.7.0', integrity: 'sha512-7.7.0' },
    'node_modules/electron-builder': {
      version: '26.18.0',
      integrity: 'sha512-26.18.0',
      dependencies: { semver: '^7.0.0', extract: '^1.0.0' },
    },
    'node_modules/esbuild': { version: '0.28.2', integrity: 'sha512-0.28.2' },
  };
  const sharp = {
    'node_modules/sharp': {
      version: '0.35.4',
      integrity: 'sha512-0.35.4',
      optionalDependencies: { '@img/sharp-win32-x64': '0.35.4' },
    },
    'node_modules/@img/sharp-win32-x64': {
      version: '0.35.4',
      integrity: 'sha512-0.35.4',
      optional: true,
      cpu: ['x64'],
    },
  };

  it('pins web-terrarium, its tools and sharp to the lockfile and keeps every integrity hash', () => {
    const dependencies = { 'web-terrarium': '0.1.0', sharp: '0.35.4' };
    const { packageJson, lockfile } = toolsLockfile({ lock, sharpVersion: '0.35.4' });

    expect(packageJson).toEqual({ name: 'web-terrarium-tools', private: true, dependencies });
    expect(lockfile).toEqual({
      name: 'web-terrarium-tools',
      lockfileVersion: 3,
      requires: true,
      packages: { '': { name: 'web-terrarium-tools', dependencies }, ...tools, ...sharp },
    });
  });

  it('takes the electron web-terrarium depends on, not another one in the project', () => {
    const { lockfile } = toolsLockfile({ lock, sharpVersion: undefined });

    expect(lockfile.packages['node_modules/web-terrarium/node_modules/electron'].version).toBe(
      '45.0.0',
    );
    expect(lockfile.packages['node_modules/electron']).toBeUndefined();
  });

  it('leaves out the peer of web-terrarium, which is the project framework', () => {
    const { lockfile } = toolsLockfile({ lock, sharpVersion: undefined });

    expect(lockfile.packages['node_modules/next']).toBeUndefined();
    expect(lockfile.packages['node_modules/next-only']).toBeUndefined();
  });

  it('skips sharp when the app does not use it', () => {
    const { packageJson, lockfile } = toolsLockfile({ lock, sharpVersion: undefined });

    expect(packageJson.dependencies).toEqual({ 'web-terrarium': '0.1.0' });
    expect(lockfile.packages).toEqual({ '': expect.anything(), ...tools });
  });

  it('carries the project overrides, which npm ci checks the lockfile against', () => {
    const overrides = { semver: '7.7.0', extract: { yauzl: '2.10.0' } };
    const { packageJson } = toolsLockfile({ lock, sharpVersion: undefined, overrides });

    expect(packageJson).toEqual({
      name: 'web-terrarium-tools',
      private: true,
      dependencies: { 'web-terrarium': '0.1.0' },
      overrides,
    });
  });

  it('refuses a lockfile without web-terrarium', () => {
    expect(() => toolsLockfile({ lock: { packages: {} }, sharpVersion: undefined })).toThrow(
      'web-terrarium is not in package-lock.json. Add it as a devDependency.',
    );
    expect(() => toolsLockfile({ lock: {}, sharpVersion: undefined })).toThrow(
      'web-terrarium is not in package-lock.json',
    );
  });

  it('refuses web-terrarium installed from a local folder', () => {
    const linked = {
      packages: { 'node_modules/web-terrarium': { resolved: '../web-terrarium', link: true } },
    };

    expect(() => toolsLockfile({ lock: linked, sharpVersion: undefined })).toThrow(
      'web-terrarium is installed from a local folder. install-tools needs it from a registry',
    );
  });

  it('refuses a staged sharp that differs from the lockfile', () => {
    expect(() => toolsLockfile({ lock, sharpVersion: '0.34.0' })).toThrow(
      'The stage has sharp 0.34.0, but package-lock.json has 0.35.4.',
    );
    const noSharp = { packages: { ...lock.packages, 'node_modules/sharp': undefined } };
    expect(() => toolsLockfile({ lock: noSharp, sharpVersion: '0.34.0' })).toThrow(
      'package-lock.json has none',
    );
  });

  it('refuses a required dependency missing from the lockfile', () => {
    const broken = { packages: { ...lock.packages, 'node_modules/@electron/get': undefined } };
    expect(() => toolsLockfile({ lock: broken, sharpVersion: undefined })).toThrow(
      '@electron/get, needed by node_modules/web-terrarium/node_modules/electron, is not in package-lock.json.',
    );
  });

  it('refuses a package without an integrity hash', () => {
    const { integrity, ...unhashed } = lock.packages['node_modules/yauzl'];
    const broken = { packages: { ...lock.packages, 'node_modules/yauzl': unhashed } };
    expect(integrity).toBeDefined();
    expect(() => toolsLockfile({ lock: broken, sharpVersion: undefined })).toThrow(
      'node_modules/yauzl has no integrity hash in package-lock.json.',
    );
  });
});

describe('buildInfo', () => {
  const now = new Date('2026-10-27T14:03:00Z');
  const git = (answers) => (args) => {
    const answer = answers[args.join(' ')];
    if (answer === undefined) throw new Error('not a git repository');
    return answer;
  };

  it('takes the branch and commit from git', () => {
    const checkout = git({
      'rev-parse --abbrev-ref HEAD': 'feat/x\n',
      'rev-parse --short HEAD': '2a40250\n',
    });

    expect(buildInfo({ version: '1.2.3', git: checkout, env: {}, now })).toEqual({
      version: '1.2.3',
      branch: 'feat/x',
      commit: '2a40250',
      builtAt: '2026-10-27T14:03:00.000Z',
    });
  });

  it('takes the branch from GitHub Actions, where the checkout has none', () => {
    const detached = git({
      'rev-parse --abbrev-ref HEAD': 'HEAD',
      'rev-parse --short HEAD': 'abc1234',
    });
    const branch = (env) => buildInfo({ version: '1.2.3', git: detached, env, now }).branch;

    expect(branch({ GITHUB_HEAD_REF: 'feat/x', GITHUB_REF_NAME: '14/merge' })).toBe('feat/x');
    expect(branch({ GITHUB_HEAD_REF: '', GITHUB_REF_NAME: 'v1.2.3' })).toBe('v1.2.3');
    expect(branch({})).toBeUndefined();
  });

  it('has only the version and time outside a git checkout', () => {
    const empty = git({ 'rev-parse --abbrev-ref HEAD': '\n' });

    expect(buildInfo({ version: '1.2.3', git: git({}), env: {}, now })).toEqual({
      version: '1.2.3',
      builtAt: '2026-10-27T14:03:00.000Z',
    });
    expect(buildInfo({ version: '1.2.3', git: empty, env: {}, now })).toEqual({
      version: '1.2.3',
      builtAt: '2026-10-27T14:03:00.000Z',
    });
  });
});
