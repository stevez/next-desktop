// Pure helpers for staging and packaging. build.mjs and cli.mjs do the file work.
import path from 'node:path';

const BUNDLE_SHIMS = path.join(import.meta.dirname, 'bundleShims.mjs');

export const nextBuildEnv = (config, baseEnv) => ({
  ...baseEnv,
  ...config.app.buildEnv,
  // next.config.js reads this to build standalone into its own folder (see ../README.md).
  // NEXT_DESKTOP_DIST_DIR is the name from before the rename, for configs that still read it.
  WEB_TERRARIUM_DIST_DIR: config.app.distDir,
  NEXT_DESKTOP_DIST_DIR: config.app.distDir,
  NEXT_TELEMETRY_DISABLED: '1',
});

export const electronPackageJson = (config) => ({
  name: config.artifactName.toLowerCase(),
  productName: config.name,
  version: config.version,
  description: config.description,
  author: config.author,
  private: true,
  main: 'main.mjs',
});

export const esbuildOptions = (entry, outfile) => ({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'warning',
  // Bundled CommonJS dependencies call require() and read __dirname and __filename, which ES
  // modules don't have. require goes on globalThis because esbuild's own require helper looks
  // for it there, and a global can't clash with a server's own `const require`. The other two
  // are injected only where nothing else declares them (see bundleShims.mjs).
  banner: {
    js: "import { createRequire as __webTerrariumCreateRequire } from 'node:module'; globalThis.require ??= __webTerrariumCreateRequire(import.meta.url);",
  },
  inject: [BUNDLE_SHIMS],
});

// sharp keeps its native binaries in @img/sharp-<os>-<arch> and @img/sharp-libvips-<os>-<arch>.
// A stage built on Linux has the Linux ones; swap in those npm installed for this system.
const isSharpBinary = (name) => name.startsWith('sharp-');

export const sharpSwap = ({ staged, installed }) => ({
  remove: staged.filter(isSharpBinary),
  copy: installed.filter(isSharpBinary),
});

const TOOLS = 'web-terrarium-tools';

// Where Node would find `name` from the package at `from`: its own node_modules, then each
// parent's, then the top level.
const resolveKey = (packages, from, name) => {
  for (let dir = from; ; ) {
    const key = `${dir}/node_modules/${name}`;
    if (packages[key]) return key;
    const parent = dir.lastIndexOf('/node_modules/');
    if (parent < 0) break;
    dir = dir.slice(0, parent);
  }
  return packages[`node_modules/${name}`] ? `node_modules/${name}` : undefined;
};

// A lockfile for just the packaging tools and their dependencies, cut from the project's lockfile.
// `resolved` is dropped so npm fetches from the registry it's given (the project's may be private),
// and `integrity` is kept so `npm ci` checks every tarball against the audited lockfile.
export const toolsLockfile = ({ lock, sharpVersion, overrides }) => {
  const packages = lock.packages ?? {};
  const names = ['electron', 'electron-builder'];
  if (sharpVersion) {
    const locked = packages['node_modules/sharp']?.version;
    if (locked !== sharpVersion) {
      throw new Error(
        `The stage has sharp ${sharpVersion}, but package-lock.json has ${locked ?? 'none'}.`,
      );
    }
    names.push('sharp');
  }

  const picked = {};
  const visit = (key) => {
    if (picked[key]) return;
    const { resolved, dev, devOptional, peer, ...entry } = packages[key];
    if (!entry.integrity) throw new Error(`${key} has no integrity hash in package-lock.json.`);
    picked[key] = entry;
    const required = Object.keys(entry.dependencies ?? {});
    const optional = [
      ...Object.keys(entry.optionalDependencies ?? {}),
      ...Object.keys(entry.peerDependencies ?? {}),
    ];
    required.forEach((name) => {
      const found = resolveKey(packages, key, name);
      if (!found) throw new Error(`${name}, needed by ${key}, is not in package-lock.json.`);
      visit(found);
    });
    // Optional ones for other systems, and peers the project didn't install, aren't in the lockfile.
    optional.forEach((name) => {
      const found = resolveKey(packages, key, name);
      if (found) visit(found);
    });
  };

  const dependencies = {};
  names.forEach((name) => {
    const key = `node_modules/${name}`;
    if (!packages[key]) {
      throw new Error(`${name} is not in package-lock.json. Add it as a devDependency.`);
    }
    dependencies[name] = packages[key].version;
    visit(key);
  });

  return {
    packageJson: { name: TOOLS, private: true, dependencies, ...(overrides && { overrides }) },
    lockfile: {
      name: TOOLS,
      lockfileVersion: 3,
      requires: true,
      packages: { '': { name: TOOLS, dependencies }, ...picked },
    },
  };
};
