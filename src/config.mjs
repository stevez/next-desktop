// Reads a project's terrarium.config.mjs and fills in the defaults. See ../README.md for the options.
import path from 'node:path';

const SERVER_NAME = /^[a-z][\w-]*$/i;
export const APP_TYPES = ['next', 'static'];
const DEFAULT_START_TIMEOUT_MS = 60000;
// http: readyPath answers 2xx. tcp: the port takes a connection (a database, say).
const READY_CHECKS = ['http', 'tcp'];
// The app's port is fixed per app (see appPort), in a range below the systems' ephemeral ports.
const PORT_RANGE = { first: 20000, size: 10000 };

// True when `dir` is `root` itself or a folder above it, so deleting `dir` would delete the project.
const containsRoot = (dir, root) => {
  const relative = path.relative(dir, root);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

// The browser keeps localStorage, IndexedDB and cookies per origin (http://127.0.0.1:<port>), so
// the app server gets the same port on every launch: one derived from the appId (FNV-1a), unless
// the config sets `port`.
export const appPort = (appId) => {
  let hash = 0x811c9dc5;
  [...appId].forEach((char) => {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  });
  return PORT_RANGE.first + (hash % PORT_RANGE.size);
};

const resolveServer = (server, root) => {
  const { name } = server;
  if (!name || !SERVER_NAME.test(name) || name === 'app') {
    throw new Error(
      `Each server needs a name made of letters, digits, - or _ (not "app"), got "${name}".`,
    );
  }
  if (!server.entry) throw new Error(`Server ${name} needs an entry file.`);
  const ready = server.ready ?? 'http';
  if (!READY_CHECKS.includes(ready)) {
    throw new Error(`Server ${name}: ready must be one of ${READY_CHECKS.join(', ')}, got "${ready}".`);
  }
  return {
    name,
    label: server.label ?? `${name} server`,
    entry: path.resolve(root, server.entry),
    copy: server.copy ?? [],
    env: server.env ?? {},
    ready,
    readyPath: server.readyPath ?? '/',
  };
};

// With no app type set: next if the project depends on Next.js, static if it uses Vite, else next
// (what 0.1 did).
export const guessAppType = (rootPackage) => {
  const deps = { ...rootPackage.dependencies, ...rootPackage.devDependencies };
  if (deps.next) return 'next';
  if (deps.vite) return 'static';
  return 'next';
};

const resolveNext = (app, root) => {
  const distDir = app.distDir ?? '.next-terrarium';
  // Compare resolved paths, so ./.next or .next/ can't sneak the desktop build into the normal one.
  if (path.resolve(root, distDir) === path.resolve(root, '.next')) {
    throw new Error('app.distDir must not be .next, so the desktop build never mixes with the normal one.');
  }
  return {
    type: 'next',
    distDir,
    buildEnv: app.buildEnv ?? {},
    env: app.env ?? {},
    readyPath: app.readyPath ?? '/',
  };
};

const resolveStatic = (app, root) => {
  const dir = app.dir ?? 'dist';
  if (containsRoot(path.resolve(root, dir), root)) {
    throw new Error(`app.dir must be the build output folder inside the project, got "${dir}".`);
  }
  const proxy = app.proxy ?? {};
  Object.entries(proxy).forEach(([prefix, target]) => {
    if (!prefix.startsWith('/')) {
      throw new Error(`app.proxy paths must start with /, got "${prefix}".`);
    }
    if (typeof target !== 'string' || !target.startsWith('http://')) {
      throw new Error(`app.proxy["${prefix}"] must be an http:// URL, got "${target}".`);
    }
  });
  return {
    type: 'static',
    build: app.build ?? 'npm run build',
    dir: path.resolve(root, dir),
    spa: app.spa ?? true,
    proxy,
    buildEnv: app.buildEnv ?? {},
    readyPath: app.readyPath ?? '/',
  };
};

// `app: { type, ... }`, or the older `next: { ... }`, which means a Next.js app.
const resolveApp = (raw, root, rootPackage) => {
  if (raw.app && raw.next) throw new Error('Use app or next in the config, not both.');
  const app = raw.app ?? { ...raw.next, type: raw.next ? 'next' : guessAppType(rootPackage) };
  const type = app.type ?? guessAppType(rootPackage);
  if (type === 'next') return resolveNext(app, root);
  if (type === 'static') return resolveStatic(app, root);
  throw new Error(`app.type must be one of ${APP_TYPES.join(', ')}, got "${type}".`);
};

export const resolveConfig = (raw, { root, rootPackage }) => {
  if (!raw?.name) throw new Error('The desktop config needs a name (the app and window title).');
  if (!raw.appId) throw new Error('The desktop config needs an appId, like com.example.app.');
  const app = resolveApp(raw, root, rootPackage);
  const outDir = path.resolve(root, raw.outDir ?? 'dist-desktop');
  // stage deletes outDir first, so it must never hold the project.
  if (containsRoot(outDir, root)) {
    throw new Error(`outDir must be a folder inside the project, got "${raw.outDir}".`);
  }
  const startTimeoutMs = raw.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  if (!Number.isInteger(startTimeoutMs) || startTimeoutMs <= 0) {
    throw new Error(`startTimeoutMs must be a whole number of milliseconds, got "${startTimeoutMs}".`);
  }
  const port = raw.port ?? appPort(raw.appId);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`port must be a whole number from 1024 to 65535, got "${port}".`);
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
    icon: raw.icon && path.resolve(root, raw.icon),
    app,
    port,
    servers,
    startTimeoutMs,
    window: { width: 1280, height: 800, loadingText: `Starting ${raw.name}…`, ...raw.window },
    errorHint: raw.errorHint ?? `Close other copies of ${raw.name} and try again.`,
  };
};

// The staged static app: the built site in web/site, served by web/static-server.mjs.
export const STATIC_SERVER = 'static-server.mjs';
export const STATIC_SITE = 'site';

// How the packaged app starts the app server.
const appServer = (config, appDir) => {
  const base = {
    name: 'app',
    label: 'app server',
    port: config.port,
    readyPath: config.app.readyPath,
  };
  if (config.app.type === 'static') {
    const { spa, proxy } = config.app;
    return {
      ...base,
      dir: 'web',
      entry: STATIC_SERVER,
      // Placeholders in the proxy targets ({host}, {port:<name>}) are filled at start-up, like any
      // env value.
      env: { WEB_TERRARIUM_STATIC: JSON.stringify({ root: STATIC_SITE, spa, proxy }) },
    };
  }
  return {
    ...base,
    // Not "app": Electron would load resources/app as its own app.
    dir: appDir ? `web/${appDir}` : 'web',
    entry: 'server.js',
    env: config.app.env,
  };
};

// What the packaged app reads at start-up (app.json next to main.mjs). Build-time settings, such
// as the app's build env, stay out of it. `appDir` is the Next server's folder inside web/, found
// at stage time (see standaloneAppDir in stage.mjs). `icon` is the staged icon's file name.
export const runtimeConfig = (config, { appDir = '', icon } = {}) => ({
  name: config.name,
  ...(icon && { icon }),
  window: config.window,
  errorHint: config.errorHint,
  startTimeoutMs: config.startTimeoutMs,
  servers: config.servers.map(({ name, label, env, ready, readyPath }) => ({
    name,
    label,
    dir: `servers/${name}`,
    entry: 'server.mjs',
    env,
    ready,
    readyPath,
  })),
  app: appServer(config, appDir),
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
