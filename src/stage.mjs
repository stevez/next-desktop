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

// Next writes the app's server.js to standalone/<the project's path from its tracing root>/. That's
// standalone/ itself for most projects, but a folder deeper in a monorepo, or when Next finds a
// lockfile in a parent folder and traces from there. Given every server.js under standalone/
// (relative, with / separators), returns the app's folder: the shallowest one outside
// node_modules, or '' for standalone/ itself.
export const standaloneAppDir = (serverFiles) => {
  const dirs = serverFiles
    .filter((file) => !file.split('/').includes('node_modules'))
    .map((file) => path.posix.dirname(file))
    .map((dir) => (dir === '.' ? '' : dir))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length);
  return dirs[0];
};

// Where a Next.js app keeps its icon, best first: Next's app icon, then the favicon.
export const ICON_CANDIDATES = [
  'src/app/icon.png',
  'app/icon.png',
  'public/icon.png',
  'src/app/favicon.ico',
  'app/favicon.ico',
  'public/favicon.ico',
];

// The app's icon: `config.icon` if set, else the first of ICON_CANDIDATES in the project, else
// undefined (Electron's own icon).
export const findIcon = ({ root, icon }, exists) => {
  if (icon) {
    if (!exists(icon)) throw new Error(`The icon ${icon} doesn't exist.`);
    return icon;
  }
  return ICON_CANDIDATES.map((file) => path.join(root, file)).find((file) => exists(file));
};

// The staged icon's file name, next to main.mjs.
export const stagedIconName = (icon) => `icon${path.extname(icon).toLowerCase()}`;

// Which build this is, for the app's About box: the version, the git branch and short commit
// (when the project is a git checkout) and when it was staged. `git(args)` runs git in the project
// and returns its output. On GitHub Actions the checkout has no branch, so the branch comes from
// the workflow's env.
export const buildInfo = ({ version, git, env, now }) => {
  const run = (args) => {
    try {
      return git(args).trim() || undefined;
    } catch {
      return undefined;
    }
  };
  const branch =
    env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || run(['rev-parse', '--abbrev-ref', 'HEAD']);
  const commit = run(['rev-parse', '--short', 'HEAD']);
  return {
    version,
    ...(branch && branch !== 'HEAD' && { branch }),
    ...(commit && { commit }),
    builtAt: now.toISOString(),
  };
};

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

// A lockfile for just the packaging tools and their dependencies, cut from the project's lockfile:
// web-terrarium itself (which brings Electron, electron-builder and esbuild, wherever npm put
// them) and sharp. `resolved` is dropped so npm fetches from the registry it's given (the
// project's may be private), and `integrity` is kept so `npm ci` checks every tarball against the
// audited lockfile.
export const toolsLockfile = ({ lock, sharpVersion, overrides }) => {
  const packages = lock.packages ?? {};
  const names = ['web-terrarium'];
  if (packages['node_modules/web-terrarium']?.link) {
    throw new Error(
      'web-terrarium is installed from a local folder. install-tools needs it from a registry, ' +
        'with an integrity hash in package-lock.json.',
    );
  }
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
  // `withPeers` is off for web-terrarium itself: its peer is the project's framework (next), which
  // packaging doesn't need.
  const visit = (key, { withPeers = true } = {}) => {
    if (picked[key]) return;
    const { resolved, dev, devOptional, peer, ...entry } = packages[key];
    if (!entry.integrity) throw new Error(`${key} has no integrity hash in package-lock.json.`);
    picked[key] = entry;
    const required = Object.keys(entry.dependencies ?? {});
    const optional = [
      ...Object.keys(entry.optionalDependencies ?? {}),
      ...(withPeers ? Object.keys(entry.peerDependencies ?? {}) : []),
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
    visit(key, { withPeers: name !== 'web-terrarium' });
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
