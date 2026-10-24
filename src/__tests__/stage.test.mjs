import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { build } from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';

import { __dirname as shimDirname, __filename as shimFilename } from '../bundleShims';
import { electronPackageJson, esbuildOptions, nextBuildEnv, sharpSwap, toolsLockfile } from '../stage';

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
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-terrarium-bundle-'));
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
  const lock = {
    packages: {
      '': { name: 'app', devDependencies: { electron: '^44.0.0' } },
      'node_modules/electron': entry('44.7.0', {
        hasInstallScript: true,
        dependencies: { '@electron/get': '^2.0.0', extract: '^1.0.0' },
      }),
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
      'node_modules/electron-builder': entry('26.15.3', {
        dependencies: { semver: '^7.0.0', extract: '^1.0.0' },
      }),
      'node_modules/sharp': entry('0.35.4', {
        optionalDependencies: { '@img/sharp-win32-x64': '0.35.4' },
      }),
      'node_modules/@img/sharp-win32-x64': entry('0.35.4', { optional: true, cpu: ['x64'] }),
      'node_modules/unrelated': entry('1.0.0'),
    },
  };
  const dependencies = { electron: '44.7.0', 'electron-builder': '26.15.3', sharp: '0.35.4' };

  it('pins the tools to the lockfile and keeps every integrity hash', () => {
    const { packageJson, lockfile } = toolsLockfile({ lock, sharpVersion: '0.35.4' });

    expect(packageJson).toEqual({ name: 'web-terrarium-tools', private: true, dependencies });
    expect(lockfile).toEqual({
      name: 'web-terrarium-tools',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { name: 'web-terrarium-tools', dependencies },
        'node_modules/electron': {
          version: '44.7.0',
          integrity: 'sha512-44.7.0',
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
          version: '26.15.3',
          integrity: 'sha512-26.15.3',
          dependencies: { semver: '^7.0.0', extract: '^1.0.0' },
        },
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
      },
    });
  });

  it('skips sharp when the app does not use it', () => {
    const { packageJson, lockfile } = toolsLockfile({ lock, sharpVersion: undefined });

    expect(packageJson.dependencies).toEqual({ electron: '44.7.0', 'electron-builder': '26.15.3' });
    expect(lockfile.packages['node_modules/sharp']).toBeUndefined();
  });

  it("carries the project's overrides, which npm ci checks the lockfile against", () => {
    const overrides = { semver: '7.7.0', extract: { yauzl: '2.10.0' } };
    const { packageJson } = toolsLockfile({ lock, sharpVersion: undefined, overrides });

    expect(packageJson).toEqual({
      name: 'web-terrarium-tools',
      private: true,
      dependencies: { electron: '44.7.0', 'electron-builder': '26.15.3' },
      overrides,
    });
  });

  it('refuses a lockfile without the packaging tools', () => {
    expect(() => toolsLockfile({ lock: { packages: {} }, sharpVersion: undefined })).toThrow(
      'electron is not in package-lock.json. Add it as a devDependency.',
    );
    expect(() => toolsLockfile({ lock: {}, sharpVersion: undefined })).toThrow(
      'electron is not in package-lock.json',
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
      '@electron/get, needed by node_modules/electron, is not in package-lock.json.',
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
