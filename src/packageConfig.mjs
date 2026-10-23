// Command line and electron-builder settings for next-desktop.
import path from 'node:path';

const COMMANDS = {
  build: { stage: true, package: true },
  stage: { stage: true, package: false },
  package: { stage: false, package: true },
  start: { stage: false, package: false },
  'install-tools': { stage: false, package: false },
};

// `stage` stops before packaging. `package` packages a stage built earlier, possibly on another
// machine: CI builds the web app where the private registry is reachable and packages it on a
// Windows or Mac runner.
export const parseCli = (args) => {
  let command = 'build';
  let config = 'desktop.config.mjs';
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--config') {
      config = args[i + 1];
      if (!config) throw new Error('--config needs a file.');
      i += 1;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option "${arg}".`);
    } else if (arg in COMMANDS) {
      command = arg;
    } else {
      throw new Error(`Unknown command "${arg}". Use ${Object.keys(COMMANDS).join(', ')}.`);
    }
  }
  return { command, ...COMMANDS[command], config };
};

// electron-builder only builds a Mac app on a Mac, and the Next server's native modules match the
// machine they were installed on, so build for the host system.
export const hostTarget = (platform, arch) => {
  if (platform === 'win32') return { platform: 'WINDOWS', arch: 'x64', label: 'Windows' };
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
