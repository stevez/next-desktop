// Reads a project's desktop.config.mjs and fills in the defaults. See ../README.md for the options.
import path from 'node:path';

const SERVER_NAME = /^[a-z][\w-]*$/i;

const resolveServer = (server, root) => {
  const { name } = server;
  if (!name || !SERVER_NAME.test(name) || name === 'app') {
    throw new Error(
      `Each server needs a name made of letters, digits, - or _ (not "app"), got "${name}".`,
    );
  }
  if (!server.entry) throw new Error(`Server ${name} needs an entry file.`);
  return {
    name,
    label: server.label ?? `${name} server`,
    entry: path.resolve(root, server.entry),
    copy: server.copy ?? [],
    env: server.env ?? {},
    readyPath: server.readyPath ?? '/',
  };
};

export const resolveConfig = (raw, { root, rootPackage }) => {
  if (!raw?.name) throw new Error('The desktop config needs a name (the app and window title).');
  if (!raw.appId) throw new Error('The desktop config needs an appId, like com.example.app.');
  const distDir = raw.next?.distDir ?? '.next-desktop';
  // Compare resolved paths, so ./.next or .next/ can't sneak the demo build into the normal one.
  if (path.resolve(root, distDir) === path.resolve(root, '.next')) {
    throw new Error('next.distDir must not be .next, so the desktop build never mixes with the normal one.');
  }
  const servers = (raw.servers ?? []).map((server) => resolveServer(server, root));
  const names = servers.map((server) => server.name);
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate) throw new Error(`Two servers are named ${duplicate}.`);

  return {
    root,
    name: raw.name,
    appId: raw.appId,
    artifactName: raw.artifactName ?? raw.name.replace(/\s+/g, '-'),
    version: raw.version ?? rootPackage.version,
    description: raw.description ?? raw.name,
    author: raw.author ?? rootPackage.author ?? '',
    outDir: path.resolve(root, raw.outDir ?? 'dist-desktop'),
    next: {
      distDir,
      buildEnv: raw.next?.buildEnv ?? {},
      env: raw.next?.env ?? {},
      readyPath: raw.next?.readyPath ?? '/',
    },
    servers,
    window: { width: 1280, height: 800, loadingText: `Starting ${raw.name}…`, ...raw.window },
    errorHint: raw.errorHint ?? `Close other copies of ${raw.name} and try again.`,
  };
};

// What the packaged app reads at start-up (app.json next to main.mjs). Build-time settings, such
// as the Next build env, stay out of it.
export const runtimeConfig = (config) => ({
  name: config.name,
  window: config.window,
  errorHint: config.errorHint,
  servers: config.servers.map(({ name, label, env, readyPath }) => ({
    name,
    label,
    dir: `servers/${name}`,
    entry: 'server.mjs',
    env,
    readyPath,
  })),
  // Not "app": Electron would load resources/app as its own app.
  app: {
    name: 'app',
    label: 'app server',
    dir: 'web',
    entry: 'server.js',
    env: config.next.env,
    readyPath: config.next.readyPath,
  },
});

export const stagePaths = ({ outDir }) => {
  const resources = path.join(outDir, 'resources');
  return {
    stage: path.join(outDir, 'stage'),
    resources,
    web: path.join(resources, 'web'),
    servers: path.join(resources, 'servers'),
    packaged: path.join(outDir, 'out'),
  };
};
