// Reads a project's terrarium.config.mjs and fills in the defaults. See ../README.md for the options.
import path from 'node:path';

const SERVER_NAME = /^[a-z][\w-]*$/i;
export const APP_TYPES = ['next'];
const DEFAULT_START_TIMEOUT_MS = 60000;

// True when `dir` is `root` itself or a folder above it, so deleting `dir` would delete the project.
const containsRoot = (dir, root) => {
  const relative = path.relative(dir, root);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

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

// `app: { type: 'next', ... }`, or the older `next: { ... }`, which means the same.
const resolveApp = (raw, root) => {
  if (raw.app && raw.next) throw new Error('Use app or next in the config, not both.');
  const app = raw.app ?? { type: 'next', ...raw.next };
  if (!APP_TYPES.includes(app.type)) {
    throw new Error(`app.type must be one of ${APP_TYPES.join(', ')}, got "${app.type}".`);
  }
  const distDir = app.distDir ?? '.next-terrarium';
  // Compare resolved paths, so ./.next or .next/ can't sneak the desktop build into the normal one.
  if (path.resolve(root, distDir) === path.resolve(root, '.next')) {
    throw new Error('app.distDir must not be .next, so the desktop build never mixes with the normal one.');
  }
  return {
    type: app.type,
    distDir,
    buildEnv: app.buildEnv ?? {},
    env: app.env ?? {},
    readyPath: app.readyPath ?? '/',
  };
};

export const resolveConfig = (raw, { root, rootPackage }) => {
  if (!raw?.name) throw new Error('The desktop config needs a name (the app and window title).');
  if (!raw.appId) throw new Error('The desktop config needs an appId, like com.example.app.');
  const app = resolveApp(raw, root);
  const outDir = path.resolve(root, raw.outDir ?? 'dist-desktop');
  // stage deletes outDir first, so it must never hold the project.
  if (containsRoot(outDir, root)) {
    throw new Error(`outDir must be a folder inside the project, got "${raw.outDir}".`);
  }
  const startTimeoutMs = raw.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  if (!Number.isInteger(startTimeoutMs) || startTimeoutMs <= 0) {
    throw new Error(`startTimeoutMs must be a whole number of milliseconds, got "${startTimeoutMs}".`);
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
    outDir,
    app,
    servers,
    startTimeoutMs,
    window: { width: 1280, height: 800, loadingText: `Starting ${raw.name}…`, ...raw.window },
    errorHint: raw.errorHint ?? `Close other copies of ${raw.name} and try again.`,
  };
};

// What the packaged app reads at start-up (app.json next to main.mjs). Build-time settings, such
// as the app's build env, stay out of it.
export const runtimeConfig = (config) => ({
  name: config.name,
  window: config.window,
  errorHint: config.errorHint,
  startTimeoutMs: config.startTimeoutMs,
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
    env: config.app.env,
    readyPath: config.app.readyPath,
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
