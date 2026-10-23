// Starts the app's local servers: any extra servers from the config (a mock backend, say), then
// the Next.js standalone server. All run on Electron's bundled Node (ELECTRON_RUN_AS_NODE) and
// listen on 127.0.0.1 only. Copied into the packaged app, so it imports nothing but Node.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const HOST = '127.0.0.1';
const LOG_NAME = 'next-desktop';

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

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const waitForHttp = async (
  url,
  { fetchImpl = fetch, intervalMs = 250, timeoutMs = 60000 } = {},
) => {
  const deadline = Date.now() + timeoutMs;
  const answers = () =>
    fetchImpl(url, { signal: AbortSignal.timeout(intervalMs * 4) }).then(
      (response) => response.ok,
      () => false,
    );
  const poll = async () => {
    if (await answers()) return;
    if (Date.now() >= deadline) throw new Error(`${url} did not start within ${timeoutMs} ms`);
    await sleep(intervalMs);
    await poll();
  };
  await poll();
};

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

const pickPorts = async (names, portImpl) => {
  const ports = {};
  const taken = new Set();
  // Sequential on purpose: each pick has to differ from the ones before.
  // eslint-disable-next-line no-restricted-syntax
  for (const name of names) {
    // eslint-disable-next-line no-await-in-loop
    let port = await portImpl();
    while (taken.has(port)) {
      // eslint-disable-next-line no-await-in-loop
      port = await portImpl();
    }
    taken.add(port);
    ports[name] = port;
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
  waitImpl = waitForHttp,
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
  const ports = await pickPorts(
    all.map((server) => server.name),
    portImpl,
  );

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
    const url = `http://${HOST}:${ports[server.name]}`;
    await Promise.race([waitImpl(`${url}${server.readyPath}`), startupFailed]);
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
