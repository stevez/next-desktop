// Starts the app's local servers: any extra servers from the config (a mock backend, say), then
// the Next.js standalone server. All run on Electron's bundled Node (ELECTRON_RUN_AS_NODE) and
// listen on 127.0.0.1 only. Copied into the packaged app, so it imports nothing but Node.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const HOST = '127.0.0.1';
// Prefix for web-terrarium's own lines in servers.log. CI smoke tests match on it.
export const LOG_NAME = 'web-terrarium';

export const freePort = ({ createServer = net.createServer } = {}) =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, HOST, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

// Whether `port` can be bound on 127.0.0.1 right now.
export const portIsFree = (port, { createServer = net.createServer } = {}) =>
  new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen(port, HOST, () => {
      server.close(() => resolve(true));
    });
  });

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// Calls `answers` every intervalMs until it resolves true, or throws after timeoutMs.
const pollUntil = async (answers, { url, intervalMs, timeoutMs }) => {
  const deadline = Date.now() + timeoutMs;
  const poll = async () => {
    if (await answers()) return;
    if (Date.now() >= deadline) throw new Error(`${url} did not start within ${timeoutMs} ms`);
    await sleep(intervalMs);
    await poll();
  };
  await poll();
};

export const waitForHttp = (url, { fetchImpl = fetch, intervalMs = 250, timeoutMs = 60000 } = {}) =>
  pollUntil(
    () =>
      fetchImpl(url, { signal: AbortSignal.timeout(intervalMs * 4) }).then(
        (response) => response.ok,
        () => false,
      ),
    { url, intervalMs, timeoutMs },
  );

// For servers that don't speak HTTP, such as a database: ready once the port takes a connection.
// `url` is tcp://host:port.
export const waitForTcp = (
  url,
  { connectImpl = net.connect, intervalMs = 250, timeoutMs = 60000 } = {},
) => {
  const { hostname, port } = new URL(url);
  const connects = () =>
    new Promise((resolve) => {
      const socket = connectImpl({ host: hostname, port: Number(port) });
      socket.setTimeout(intervalMs * 4);
      const done = (ok) => {
        socket.destroy();
        resolve(ok);
      };
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.once('timeout', () => done(false));
    });
  return pollUntil(connects, { url, intervalMs, timeoutMs });
};

// Waits for a tcp:// URL with waitForTcp and anything else with waitForHttp.
export const waitUntilReady = (url, options) =>
  url.startsWith('tcp://') ? waitForTcp(url, options) : waitForHttp(url, options);

// {host} is 127.0.0.1, {port} the server's own port, {port:name} another server's port.
export const fillTemplate = (value, { ports, self }) =>
  value.replace(/\{host\}|\{port(?::([\w-]+))?\}/g, (match, name) => {
    if (match === '{host}') return HOST;
    const target = name ?? self;
    if (!(target in ports)) throw new Error(`Unknown server "${target}" in ${value}`);
    return String(ports[target]);
  });

export const serverEnv = ({ server, ports, baseEnv, isApp = false }) => {
  const { NODE_OPTIONS, ...base } = baseEnv;
  const env = { ...base, ELECTRON_RUN_AS_NODE: '1' };
  Object.entries(server.env).forEach(([key, value]) => {
    env[key] = fillTemplate(String(value), { ports, self: server.name });
  });
  if (isApp) {
    Object.assign(env, {
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      HOSTNAME: HOST,
      PORT: String(ports.app),
    });
  }
  return env;
};

// A port for each server, all different. A server with a `port` (the app server: a fixed port
// keeps the browser's storage between launches) gets it if it's free, before the others pick.
const pickPorts = async (servers, { portImpl, portFreeImpl, onOutput }) => {
  const ports = {};
  const taken = new Set();
  const preferred = servers.filter((server) => server.port);
  // Sequential on purpose: each pick has to differ from the ones before.
  // eslint-disable-next-line no-restricted-syntax
  for (const server of preferred) {
    // eslint-disable-next-line no-await-in-loop
    if (await portFreeImpl(server.port)) {
      taken.add(server.port);
      ports[server.name] = server.port;
    } else {
      onOutput(
        LOG_NAME,
        `port ${server.port} for the ${server.label} is in use; using another, so data the app ` +
          'saved in the browser (local storage, cookies) is not available this time\n',
      );
    }
  }
  // eslint-disable-next-line no-restricted-syntax
  for (const server of servers.filter((s) => !(s.name in ports))) {
    // eslint-disable-next-line no-await-in-loop
    let port = await portImpl();
    while (taken.has(port)) {
      // eslint-disable-next-line no-await-in-loop
      port = await portImpl();
    }
    taken.add(port);
    ports[server.name] = port;
  }
  return ports;
};

/**
 * Starts the servers in order. Aborting `signal` kills the ones already running and stops the
 * rest from starting. If a server exits after start-up, the others are stopped and `onExit` gets
 * the error.
 * @returns {Promise<{ url: string, stop: () => void }>}
 */
export const startServers = async ({
  config,
  resourcesDir,
  execPath,
  baseEnv,
  onOutput,
  onExit = () => {},
  signal,
  spawnImpl = spawn,
  portImpl = freePort,
  portFreeImpl = portIsFree,
  waitImpl = waitUntilReady,
}) => {
  const children = [];
  let stopping = false;
  const stop = () => {
    stopping = true;
    children.forEach((child) => child.kill());
  };

  let failStartup;
  const startupFailed = new Promise((_, reject) => {
    failStartup = reject;
  });
  // Handled by the races below or after start-up; this only avoids an unhandled-rejection warning.
  startupFailed.catch(() => {});
  const cancelled = new Error('Start-up was cancelled.');
  if (signal?.aborted) throw cancelled;
  // Kill at once: the app may be quitting and won't wait for promises to settle.
  signal?.addEventListener('abort', () => {
    stop();
    failStartup(cancelled);
  });

  const all = [...config.servers, config.app];
  const ports = await pickPorts(all, { portImpl, portFreeImpl, onOutput });

  const run = (server) => {
    const cwd = path.join(resourcesDir, server.dir);
    const child = spawnImpl(execPath, [path.join(cwd, server.entry)], {
      cwd,
      env: serverEnv({ server, ports, baseEnv, isApp: server === config.app }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    children.push(child);
    const forward = (chunk) => onOutput(server.name, chunk.toString());
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('error', failStartup);
    child.on('exit', (code) =>
      failStartup(new Error(`The ${server.label} stopped (exit code ${code})`)),
    );
  };

  const startInOrder = async ([server, ...rest]) => {
    if (!server) return;
    if (stopping) throw cancelled;
    run(server);
    const tcp = server.ready === 'tcp';
    const url = `${tcp ? 'tcp' : 'http'}://${HOST}:${ports[server.name]}`;
    await Promise.race([
      waitImpl(tcp ? url : `${url}${server.readyPath}`, { timeoutMs: config.startTimeoutMs }),
      startupFailed,
    ]);
    onOutput(LOG_NAME, `${server.name} ready at ${url}\n`);
    await startInOrder(rest);
  };

  try {
    await startInOrder(all);
  } catch (err) {
    stop();
    throw err;
  }
  startupFailed.catch((err) => {
    if (stopping) return;
    stop();
    onExit(err);
  });
  return { url: `http://${HOST}:${ports.app}/`, stop };
};
