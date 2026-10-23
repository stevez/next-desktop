import { describe, expect, it } from 'vitest';

import { electronPackageJson, esbuildOptions, nextBuildEnv, sharpSwap, toolsLockfile } from '../stage';

const config = {
  name: 'Acme Demo',
  artifactName: 'Acme-Demo',
  version: '1.2.3',
  description: 'Acme on mock data',
  author: 'Acme Inc.',
  next: { distDir: '.next-demo', buildEnv: { E2E_MODE: 'true' } },
};

describe('nextBuildEnv', () => {
  it('adds the project build env and tells next.config.js where to build', () => {
    expect(nextBuildEnv(config, { PATH: 'p' })).toEqual({
      PATH: 'p',
      E2E_MODE: 'true',
      NEXT_DESKTOP_DIST_DIR: '.next-demo',
      NEXT_TELEMETRY_DISABLED: '1',
    });
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
  it('bundles a server into one ESM file that can still require CommonJS', () => {
    const options = esbuildOptions('in/server.mjs', 'out/server.mjs');

    expect(options).toMatchObject({
      entryPoints: ['in/server.mjs'],
      outfile: 'out/server.mjs',
      bundle: true,
      platform: 'node',
      format: 'esm',
    });
    expect(options.banner.js).toContain('createRequire');
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

    expect(packageJson).toEqual({ name: 'next-desktop-tools', private: true, dependencies });
    expect(lockfile).toEqual({
      name: 'next-desktop-tools',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { name: 'next-desktop-tools', dependencies },
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
      name: 'next-desktop-tools',
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
