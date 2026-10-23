// The file work behind `next-desktop stage`, `package`, `start` and `install-tools`.
/* eslint-disable no-console -- command-line tool */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// eslint-disable-next-line import-x/extensions
import { runtimeConfig, stagePaths } from './config.mjs';
// eslint-disable-next-line import-x/extensions
import { builderConfig } from './packageConfig.mjs';
// eslint-disable-next-line import-x/extensions
import { electronPackageJson, esbuildOptions, nextBuildEnv, sharpSwap, toolsLockfile } from './stage.mjs';

const RUNTIME_DIR = path.join(import.meta.dirname, 'runtime');
const RUNTIME_FILES = ['main.mjs', 'servers.mjs', 'window.mjs'];
const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';

const step = (text) => console.log(`\n> ${text}`);
const copy = (from, to) => fs.cpSync(from, to, { recursive: true });
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

// Packages come from the project, not from next-desktop's own folder.
const projectRequire = (config) => createRequire(path.join(config.root, 'package.json'));
const importFromProject = (config, name) =>
  import(pathToFileURL(projectRequire(config).resolve(name)).href);

const buildNext = (config) => {
  step('Building the Next.js app (desktop mode)');
  execFileSync(process.execPath, [projectRequire(config).resolve('next/dist/bin/next'), 'build'], {
    cwd: config.root,
    stdio: 'inherit',
    env: nextBuildEnv(config, process.env),
  });
};

const stageWeb = (config, paths) => {
  step('Staging the Next.js server');
  const { distDir } = config.next;
  const built = path.join(config.root, distDir);
  if (!fs.existsSync(path.join(built, 'standalone', 'server.js'))) {
    throw new Error(
      `No standalone server in ${built}. next.config.js needs output: 'standalone' and ` +
        'distDir from NEXT_DESKTOP_DIST_DIR (see the next-desktop README).',
    );
  }
  copy(path.join(built, 'standalone'), paths.web);
  copy(path.join(built, 'static'), path.join(paths.web, distDir, 'static'));
  const publicDir = path.join(config.root, 'public');
  if (fs.existsSync(publicDir)) copy(publicDir, path.join(paths.web, 'public'));
  // Never ship local env files (they can hold real endpoints or keys).
  fs.readdirSync(paths.web)
    .filter((name) => name.startsWith('.env'))
    .forEach((name) => fs.rmSync(path.join(paths.web, name)));
};

const stageServers = async (config, paths) => {
  if (!config.servers.length) return;
  const { build } = await importFromProject(config, 'esbuild');
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

const stageElectron = (config, paths) => {
  step('Staging the Electron app');
  fs.mkdirSync(paths.stage, { recursive: true });
  RUNTIME_FILES.forEach((file) =>
    fs.copyFileSync(path.join(RUNTIME_DIR, file), path.join(paths.stage, file)),
  );
  writeJson(path.join(paths.stage, 'package.json'), electronPackageJson(config));
  writeJson(path.join(paths.stage, 'app.json'), runtimeConfig(config));
};

export const stageApp = async (config) => {
  const paths = stagePaths(config);
  fs.rmSync(config.outDir, { recursive: true, force: true });
  buildNext(config);
  stageWeb(config, paths);
  await stageServers(config, paths);
  stageElectron(config, paths);
};

const requireStage = (paths) => {
  if (!fs.existsSync(path.join(paths.stage, 'app.json'))) {
    throw new Error(`Nothing staged in ${paths.stage}. Run next-desktop stage first.`);
  }
};

export const packageApp = async (config, target) => {
  const paths = stagePaths(config);
  requireStage(paths);
  step(`Packaging the ${target.label} app`);
  fs.rmSync(paths.packaged, { recursive: true, force: true });
  const { Arch, build, Platform } = await importFromProject(config, 'electron-builder');
  await build({
    targets: Platform[target.platform].createTarget('zip', Arch[target.arch]),
    projectDir: paths.stage,
    config: builderConfig({
      config,
      paths,
      electronVersion: projectRequire(config)('electron/package.json').version,
      copy,
    }),
  });
  console.log(`\nDone. The app is in ${paths.packaged}`);
};

export const startStaged = (config) => {
  const paths = stagePaths(config);
  requireStage(paths);
  const electron = projectRequire(config)('electron');
  const child = spawn(electron, [paths.stage], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// For CI runners that can't reach the project's private registry: installs Electron,
// electron-builder and sharp from public npm into ./node_modules with `npm ci`, at the versions
// and integrity hashes in package-lock.json, then swaps the stage's sharp binaries for this system's.
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
