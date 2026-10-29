// The file work behind `web-terrarium stage`, `package`, `start` and `install-tools`.
/* eslint-disable no-console -- command-line tool */
import { execFileSync, execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { runtimeConfig, STATIC_SERVER, STATIC_SITE, stagePaths } from './config.mjs';
import { builderConfig } from './packageConfig.mjs';
import {
  buildInfo,
  electronPackageJson,
  esbuildOptions,
  nextBuildEnv,
  sharpSwap,
  findIcon,
  stagedIconName,
  standaloneAppDir,
  toolsLockfile,
} from './stage.mjs';

const RUNTIME_DIR = path.join(import.meta.dirname, 'runtime');
const RUNTIME_FILES = ['main.mjs', 'servers.mjs', 'window.mjs'];
const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';

const step = (text) => console.log(`\n> ${text}`);
const copy = (from, to) => fs.cpSync(from, to, { recursive: true });
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

// The web framework (next) comes from the project, so the build uses the project's own version.
const projectRequire = (config) => createRequire(path.join(config.root, 'package.json'));
// The desktop tools (electron, electron-builder, esbuild) are web-terrarium's own dependencies, so
// a web project never installs them itself.
const projectRequireResolves = (config, name) => {
  try {
    projectRequire(config).resolve(name);
    return true;
  } catch {
    return false;
  }
};
const ownRequire = createRequire(import.meta.url);
const importOwn = (name) => import(pathToFileURL(ownRequire.resolve(name)).href);

const buildNext = (config) => {
  if (!projectRequireResolves(config, 'next/package.json')) {
    throw new Error('app.type is next, but this project has no next package. Set app.type.');
  }
  step('Building the Next.js app (desktop mode)');
  execFileSync(process.execPath, [projectRequire(config).resolve('next/dist/bin/next'), 'build'], {
    cwd: config.root,
    stdio: 'inherit',
    env: nextBuildEnv(config, process.env),
  });
};

// Every server.js under `dir`, relative and with / separators. Skips node_modules, which only
// holds dependencies and is large.
const findServerFiles = (dir, prefix = '') =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : findServerFiles(path.join(dir, entry.name), relative);
    }
    return entry.name === 'server.js' ? [relative] : [];
  });

// Returns the app server's folder inside web/ ('' for web/ itself).
const stageWeb = (config, paths) => {
  step('Staging the Next.js server');
  const { distDir } = config.app;
  const built = path.join(config.root, distDir);
  const standalone = path.join(built, 'standalone');
  const appDir = fs.existsSync(standalone) ? standaloneAppDir(findServerFiles(standalone)) : undefined;
  if (appDir === undefined) {
    throw new Error(
      `No standalone server in ${built}. next.config.js needs output: 'standalone' and ` +
        'distDir from WEB_TERRARIUM_DIST_DIR (see the web-terrarium README).',
    );
  }
  copy(standalone, paths.web);
  // Next leaves static/ and public/ out of standalone; they go beside the app's server.js.
  const appWeb = path.join(paths.web, appDir);
  copy(path.join(built, 'static'), path.join(appWeb, distDir, 'static'));
  const publicDir = path.join(config.root, 'public');
  if (fs.existsSync(publicDir)) copy(publicDir, path.join(appWeb, 'public'));
  // Never ship local env files (they can hold real endpoints or keys).
  [...new Set([paths.web, appWeb])].forEach((dir) =>
    fs
      .readdirSync(dir)
      .filter((name) => name.startsWith('.env'))
      .forEach((name) => fs.rmSync(path.join(dir, name))),
  );
  return appDir;
};

// A static app: run its build command, then ship the output with web-terrarium's static server.
const stageStatic = (config, paths) => {
  const { build, dir, buildEnv } = config.app;
  step(`Building the web app (${build})`);
  execSync(build, { cwd: config.root, stdio: 'inherit', env: { ...process.env, ...buildEnv } });
  if (!fs.existsSync(path.join(dir, 'index.html'))) {
    throw new Error(
      `No index.html in ${dir} after "${build}". Set app.dir to the build output folder.`,
    );
  }
  step('Staging the static app');
  copy(dir, path.join(paths.web, STATIC_SITE));
  fs.copyFileSync(path.join(RUNTIME_DIR, 'staticServer.mjs'), path.join(paths.web, STATIC_SERVER));
};

const stageServers = async (config, paths) => {
  if (!config.servers.length) return;
  const { build } = await importOwn('esbuild');
  // Sequential so the log reads in order.
  // eslint-disable-next-line no-restricted-syntax
  for (const server of config.servers) {
    step(`Bundling the ${server.label}`);
    const dir = path.join(paths.servers, server.name);
    // eslint-disable-next-line no-await-in-loop
    await build(esbuildOptions(server.entry, path.join(dir, 'server.mjs')));
    const from = path.dirname(server.entry);
    server.copy.forEach((item) => copy(path.join(from, item), path.join(dir, item)));
  }
};

const stageElectron = (config, paths, { appDir }) => {
  step('Staging the Electron app');
  fs.mkdirSync(paths.stage, { recursive: true });
  RUNTIME_FILES.forEach((file) =>
    fs.copyFileSync(path.join(RUNTIME_DIR, file), path.join(paths.stage, file)),
  );
  const iconFile = findIcon(config, fs.existsSync);
  const icon = iconFile && stagedIconName(iconFile);
  if (iconFile) {
    fs.copyFileSync(iconFile, path.join(paths.stage, icon));
    console.log(`Icon: ${path.relative(config.root, iconFile)}`);
  }
  writeJson(path.join(paths.stage, 'package.json'), electronPackageJson(config));
  const build = buildInfo({
    version: config.version,
    git: (args) =>
      execFileSync('git', args, {
        cwd: config.root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    env: process.env,
    now: new Date(),
  });
  console.log(`Build: ${[build.version, build.branch, build.commit].filter(Boolean).join(' ')}`);
  writeJson(path.join(paths.stage, 'app.json'), runtimeConfig(config, { appDir, icon, build }));
};

export const stageApp = async (config) => {
  const paths = stagePaths(config);
  fs.rmSync(config.outDir, { recursive: true, force: true });
  let appDir;
  if (config.app.type === 'static') {
    stageStatic(config, paths);
  } else {
    buildNext(config);
    appDir = stageWeb(config, paths);
  }
  await stageServers(config, paths);
  stageElectron(config, paths, { appDir });
};

const requireStage = (paths) => {
  if (!fs.existsSync(path.join(paths.stage, 'app.json'))) {
    throw new Error(`Nothing staged in ${paths.stage}. Run web-terrarium stage first.`);
  }
};

export const packageApp = async (config, target) => {
  const paths = stagePaths(config);
  requireStage(paths);
  step(`Packaging the ${target.label} app`);
  fs.rmSync(paths.packaged, { recursive: true, force: true });
  const { Arch, build, Platform } = await importOwn('electron-builder');
  // From the stage, which may have been built on another machine.
  const { icon } = readJson(path.join(paths.stage, 'app.json'));
  await build({
    targets: Platform[target.platform].createTarget('zip', Arch[target.arch]),
    projectDir: paths.stage,
    config: builderConfig({
      config,
      paths,
      icon: icon && path.join(paths.stage, icon),
      electronVersion: ownRequire('electron/package.json').version,
      copy,
    }),
  });
  console.log(`\nDone. The app is in ${paths.packaged}`);
};

export const startStaged = (config) => {
  const paths = stagePaths(config);
  requireStage(paths);
  const electron = ownRequire('electron');
  const child = spawn(electron, [paths.stage], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// For CI runners that can't reach the project's private registry: installs web-terrarium (with
// Electron, electron-builder and esbuild) and sharp from public npm into ./node_modules with
// `npm ci`, at the versions and integrity hashes in package-lock.json, then swaps the stage's sharp
// binaries for this system's. `npx web-terrarium package` then runs that installed copy.
export const installTools = (config, { registry = PUBLIC_REGISTRY } = {}) => {
  const paths = stagePaths(config);
  requireStage(paths);
  const nodeModules = path.join(config.root, 'node_modules');
  if (fs.existsSync(nodeModules)) {
    throw new Error('node_modules already exists. install-tools is for CI runners without it.');
  }
  const sharpPackage = path.join(paths.web, 'node_modules', 'sharp', 'package.json');
  const { packageJson, lockfile } = toolsLockfile({
    lock: readJson(path.join(config.root, 'package-lock.json')),
    sharpVersion: fs.existsSync(sharpPackage) ? readJson(sharpPackage).version : undefined,
    overrides: readJson(path.join(config.root, 'package.json')).overrides,
  });

  const specs = Object.entries(packageJson.dependencies).map(([name, v]) => `${name}@${v}`);
  step(`Installing ${specs.join(', ')} from ${registry}, checked against package-lock.json`);
  const tools = path.join(config.outDir, 'tools');
  fs.mkdirSync(tools, { recursive: true });
  writeJson(path.join(tools, 'package.json'), packageJson);
  writeJson(path.join(tools, 'package-lock.json'), lockfile);
  execFileSync('npm', ['ci', '--registry', registry, '--no-audit', '--no-fund'], {
    cwd: tools,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    // Packaging downloads the Electron it packs itself, so skip the 100 MB `npm start` binary.
    env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
  });
  fs.renameSync(path.join(tools, 'node_modules'), nodeModules);
  fs.rmSync(tools, { recursive: true, force: true });

  const stagedImg = path.join(paths.web, 'node_modules', '@img');
  if (!fs.existsSync(stagedImg)) return;
  step('Swapping in the sharp binaries for this system');
  const installedImg = path.join(nodeModules, '@img');
  const swap = sharpSwap({
    staged: fs.readdirSync(stagedImg),
    installed: fs.existsSync(installedImg) ? fs.readdirSync(installedImg) : [],
  });
  swap.remove.forEach((name) => fs.rmSync(path.join(stagedImg, name), { recursive: true }));
  swap.copy.forEach((name) => copy(path.join(installedImg, name), path.join(stagedImg, name)));
  console.log(`Now in the stage: ${fs.readdirSync(stagedImg).join(', ')}`);
};
