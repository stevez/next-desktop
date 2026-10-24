// Command line and electron-builder settings for web-terrarium.
import path from 'node:path';

const COMMANDS = {
  build: { stage: true, package: true },
  stage: { stage: true, package: false },
  package: { stage: false, package: true },
  start: { stage: false, package: false },
  'install-tools': { stage: false, package: false },
  help: { stage: false, package: false },
  version: { stage: false, package: false },
};
const FLAG_COMMANDS = { '--help': 'help', '-h': 'help', '--version': 'version', '-v': 'version' };

export const CONFIG_FILE = 'terrarium.config.mjs';
// The name from before the rename, still read when terrarium.config.mjs isn't there.
export const OLD_CONFIG_FILE = 'desktop.config.mjs';

export const usage = (version) => `web-terrarium ${version}

Packages a Node.js web app and its local servers as a Windows or Mac desktop app.

Usage: web-terrarium [command] [--config <file>]

Commands:
  build          stage, then package (the default)
  stage          build the web app and stage the desktop app in <outDir>
  package        package the stage into a zip for this system
  start          open the staged app without packaging it
  install-tools  install Electron, electron-builder and sharp on a CI runner (see the README)
  help           show this help (also --help, -h)
  version        show the version (also --version, -v)

Options:
  --config <file>  config file (default: ${CONFIG_FILE}, or ${OLD_CONFIG_FILE} if that's the one there)

Docs: https://github.com/stevez/web-terrarium#readme
`;

// `stage` stops before packaging. `package` packages a stage built earlier, possibly on another
// machine: CI builds the web app where the private registry is reachable and packages it on a
// Windows or Mac runner. `config` is undefined unless --config is given (see configFile).
export const parseCli = (args) => {
  let command = 'build';
  let config;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--config') {
      config = args[i + 1];
      if (!config) throw new Error('--config needs a file.');
      i += 1;
    } else if (arg in FLAG_COMMANDS) {
      command = FLAG_COMMANDS[arg];
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option "${arg}". Run web-terrarium --help for the options.`);
    } else if (arg in COMMANDS) {
      command = arg;
    } else {
      throw new Error(`Unknown command "${arg}". Use ${Object.keys(COMMANDS).join(', ')}.`);
    }
  }
  return { command, ...COMMANDS[command], config };
};

// The config file to load: --config if given, else terrarium.config.mjs, else the old
// desktop.config.mjs if only that one exists.
export const configFile = ({ cwd, config, exists }) => {
  if (config) return path.resolve(cwd, config);
  const file = path.resolve(cwd, CONFIG_FILE);
  const oldFile = path.resolve(cwd, OLD_CONFIG_FILE);
  return !exists(file) && exists(oldFile) ? oldFile : file;
};

// electron-builder only builds a Mac app on a Mac, and the Next server's native modules match the
// machine they were installed on, so build for the host system.
export const hostTarget = (platform, arch) => {
  if (platform === 'win32') {
    // On Windows ARM, npm installs ARM native modules, which an x64 app can't load.
    if (arch !== 'x64') {
      throw new Error(`Windows ${arch} isn't supported. Build on an x64 Windows machine.`);
    }
    return { platform: 'WINDOWS', arch: 'x64', label: 'Windows' };
  }
  if (platform === 'darwin') return { platform: 'MAC', arch, label: 'Mac' };
  throw new Error(`The desktop app builds on Windows or macOS only, not ${platform}.`);
};

export const builderConfig = ({ config, paths, electronVersion, copy }) => ({
  appId: config.appId,
  productName: config.name,
  electronVersion,
  directories: { app: paths.stage, output: paths.packaged },
  extraResources: config.servers.length ? [{ from: paths.servers, to: 'servers' }] : [],
  // extraResources drops node_modules, which the Next server needs, so copy it as is. The
  // resources folder is resources/ on Windows and <name>.app/Contents/Resources on Mac.
  afterPack: ({ appOutDir, packager }) =>
    copy(paths.web, path.join(packager.getResourcesDir(appOutDir), 'web')),
  npmRebuild: false,
  // A zip of the app folder, the simplest unsigned format. electron-builder fills in ${version}.
  win: { artifactName: `${config.artifactName}-\${version}-win.\${ext}` },
  mac: {
    artifactName: `${config.artifactName}-\${version}-mac.\${ext}`,
    // Apple Silicon only runs signed apps, so sign ad hoc (no Apple certificate). Without the
    // hardened runtime, macOS lets the ad-hoc signed app load the Next server's native modules.
    identity: '-',
    hardenedRuntime: false,
    notarize: false,
  },
});
