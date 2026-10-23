import { EventEmitter } from 'node:events';
import net from 'node:net';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { fillTemplate, freePort, serverEnv, startServers, waitForHttp } from '../servers';

const fakeChild = () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
};

describe('freePort', () => {
  it('returns a port that can be bound on 127.0.0.1', async () => {
    const port = await freePort();

    expect(port).toBeGreaterThan(0);
    const server = net.createServer();
    await new Promise((resolve) => {
      server.listen(port, '127.0.0.1', resolve);
    });
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  it('rejects when no port can be bound', async () => {
    const createServer = () => {
      const server = new EventEmitter();
      server.unref = vi.fn();
      server.listen = () => server.emit('error', new Error('EACCES'));
      return server;
    };

    await expect(freePort({ createServer })).rejects.toThrow('EACCES');
  });
});

describe('waitForHttp', () => {
  it('resolves once the URL answers, retrying while it is down', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ ok: true });

    await waitForHttp('http://127.0.0.1:1/x', { fetchImpl, intervalMs: 1 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:1/x', expect.anything());
  });

  it('keeps waiting while the URL answers with an error status', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });

    await waitForHttp('http://127.0.0.1:1/x', { fetchImpl, intervalMs: 1 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after the timeout', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      waitForHttp('http://127.0.0.1:1/x', { fetchImpl, intervalMs: 1, timeoutMs: 5 }),
    ).rejects.toThrow('http://127.0.0.1:1/x did not start within 5 ms');
  });
});

describe('fillTemplate', () => {
  const ports = { mock: 4001, app: 4002 };

  it('fills in the host, the own port and other servers ports', () => {
    expect(fillTemplate('{host}:{port}', { ports, self: 'mock' })).toBe('127.0.0.1:4001');
    expect(fillTemplate('http://{host}:{port:mock}/api', { ports, self: 'app' })).toBe(
      'http://127.0.0.1:4001/api',
    );
  });

  it('leaves plain values alone', () => {
    expect(fillTemplate('true', { ports, self: 'mock' })).toBe('true');
  });

  it('refuses an unknown server', () => {
    expect(() => fillTemplate('{port:search}', { ports, self: 'app' })).toThrow(
      'Unknown server "search" in {port:search}',
    );
  });
});

describe('serverEnv', () => {
  const ports = { mock: 4001, app: 4002 };

  it('runs a server as Node with its filled-in env', () => {
    const env = serverEnv({
      server: { name: 'mock', env: { MOCK_PORT: '{port}', BASELINE: 'true' } },
      ports,
      baseEnv: { PATH: 'p' },
    });

    expect(env).toEqual({
      PATH: 'p',
      ELECTRON_RUN_AS_NODE: '1',
      MOCK_PORT: '4001',
      BASELINE: 'true',
    });
  });

  it('runs the Next app in production mode on 127.0.0.1, whatever the config says', () => {
    const env = serverEnv({
      server: { name: 'app', env: { API_URL: 'http://{host}:{port:mock}', PORT: '1' } },
      ports,
      baseEnv: {},
      isApp: true,
    });

    expect(env).toEqual({
      ELECTRON_RUN_AS_NODE: '1',
      API_URL: 'http://127.0.0.1:4001',
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      HOSTNAME: '127.0.0.1',
      PORT: '4002',
    });
  });

  it('drops NODE_OPTIONS so a user setting cannot change how the servers run', () => {
    const env = serverEnv({
      server: { name: 'mock', env: {} },
      ports,
      baseEnv: { NODE_OPTIONS: '--inspect' },
    });

    expect(env).not.toHaveProperty('NODE_OPTIONS');
  });
});

describe('startServers', () => {
  const config = {
    servers: [
      {
        name: 'mock',
        label: 'mock server',
        dir: 'servers/mock',
        entry: 'server.mjs',
        env: { MOCK_PORT: '{port}' },
        readyPath: '/ready',
      },
    ],
    app: {
      name: 'app',
      label: 'app server',
      dir: 'web',
      entry: 'server.js',
      env: { API_URL: 'http://{host}:{port:mock}' },
      readyPath: '/api/health',
    },
  };

  const setup = ({ waitImpl = vi.fn().mockResolvedValue(), ports = [4001, 4002] } = {}) => {
    const children = [];
    const spawnImpl = vi.fn(() => {
      const child = fakeChild();
      children.push(child);
      return child;
    });
    const portImpl = vi.fn();
    ports.forEach((port) => portImpl.mockResolvedValueOnce(port));
    const onOutput = vi.fn();
    const start = (cfg = config, extra = {}) =>
      startServers({
        config: cfg,
        resourcesDir: 'R',
        execPath: 'electron.exe',
        baseEnv: {},
        spawnImpl,
        portImpl,
        waitImpl,
        onOutput,
        ...extra,
      });
    return { children, spawnImpl, portImpl, onOutput, waitImpl, start };
  };

  it('starts the servers in order, then the app, and returns the app URL', async () => {
    const { spawnImpl, waitImpl, start } = setup();

    const running = await start();

    expect(running.url).toBe('http://127.0.0.1:4002/');
    expect(spawnImpl).toHaveBeenNthCalledWith(
      1,
      'electron.exe',
      [path.join('R', 'servers/mock', 'server.mjs')],
      expect.objectContaining({
        cwd: path.join('R', 'servers/mock'),
        env: expect.objectContaining({ MOCK_PORT: '4001' }),
        windowsHide: true,
      }),
    );
    expect(spawnImpl).toHaveBeenNthCalledWith(
      2,
      'electron.exe',
      [path.join('R', 'web', 'server.js')],
      expect.objectContaining({
        cwd: path.join('R', 'web'),
        env: expect.objectContaining({ PORT: '4002', API_URL: 'http://127.0.0.1:4001' }),
      }),
    );
    expect(waitImpl).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:4001/ready');
    expect(waitImpl).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:4002/api/health');
  });

  it('starts just the Next app when there are no other servers', async () => {
    const { spawnImpl, start } = setup({ ports: [5000] });

    const running = await start({ ...config, app: { ...config.app, env: {} }, servers: [] });

    expect(running.url).toBe('http://127.0.0.1:5000/');
    expect(spawnImpl).toHaveBeenCalledTimes(1);
  });

  it('logs each server URL once it answers', async () => {
    const { onOutput, start } = setup();

    await start();

    expect(onOutput).toHaveBeenCalledWith('next-desktop', 'mock ready at http://127.0.0.1:4001\n');
    expect(onOutput).toHaveBeenCalledWith('next-desktop', 'app ready at http://127.0.0.1:4002\n');
  });

  it('asks for another port when a pick is already taken', async () => {
    const { portImpl, start } = setup({ ports: [4001, 4001, 4003] });

    const running = await start();

    expect(portImpl).toHaveBeenCalledTimes(3);
    expect(running.url).toBe('http://127.0.0.1:4003/');
  });

  it('forwards server output with the server name', async () => {
    const { children, onOutput, start } = setup();

    await start();
    children[0].stdout.emit('data', Buffer.from('mock says hi'));
    children[1].stderr.emit('data', Buffer.from('next warn'));

    expect(onOutput).toHaveBeenCalledWith('mock', 'mock says hi');
    expect(onOutput).toHaveBeenCalledWith('app', 'next warn');
  });

  it('stops all servers', async () => {
    const { children, start } = setup();

    const running = await start();
    running.stop();

    expect(children[0].kill).toHaveBeenCalled();
    expect(children[1].kill).toHaveBeenCalled();
  });

  const tick = () =>
    new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

  it('stops the other servers and reports it when a server exits after start-up', async () => {
    const onExit = vi.fn();
    const { children, start } = setup();

    await start(config, { onExit });
    children[1].emit('exit', 1);
    await tick();

    expect(children[0].kill).toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledWith(new Error('The app server stopped (exit code 1)'));
  });

  it('copes with no exit callback when a server exits after start-up', async () => {
    const { children, start } = setup();

    await start();
    children[1].emit('exit', 1);
    await tick();

    expect(children[0].kill).toHaveBeenCalled();
  });

  it('does not report the exits that stop() itself causes', async () => {
    const onExit = vi.fn();
    const { children, start } = setup();

    const running = await start(config, { onExit });
    running.stop();
    children.forEach((child) => child.emit('exit', null));
    await tick();

    expect(onExit).not.toHaveBeenCalled();
  });

  it('kills started servers at once and fails when start-up is cancelled', async () => {
    const controller = new AbortController();
    let children;
    const waitImpl = vi.fn(() => {
      controller.abort();
      expect(children[0].kill).toHaveBeenCalled();
      return new Promise(() => {});
    });
    const ctx = setup({ waitImpl });
    ({ children } = ctx);

    await expect(ctx.start(config, { signal: controller.signal })).rejects.toThrow(
      'Start-up was cancelled.',
    );
    expect(ctx.spawnImpl).toHaveBeenCalledTimes(1);
  });

  it('starts nothing when cancelled while picking ports', async () => {
    const controller = new AbortController();
    const ctx = setup();
    ctx.portImpl.mockReset();
    ctx.portImpl.mockImplementationOnce(async () => {
      controller.abort();
      return 4001;
    });
    ctx.portImpl.mockResolvedValueOnce(4002);

    await expect(ctx.start(config, { signal: controller.signal })).rejects.toThrow(
      'Start-up was cancelled.',
    );
    expect(ctx.spawnImpl).not.toHaveBeenCalled();
  });

  it('starts nothing when cancelled before it begins', async () => {
    const controller = new AbortController();
    controller.abort();
    const { spawnImpl, start } = setup();

    await expect(start(config, { signal: controller.signal })).rejects.toThrow(
      'Start-up was cancelled.',
    );
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('fails and stops everything when a server exits during start-up', async () => {
    let children;
    const waitImpl = vi.fn(() => {
      children[0].emit('exit', 3);
      return new Promise(() => {});
    });
    const ctx = setup({ waitImpl });
    ({ children } = ctx);

    await expect(ctx.start()).rejects.toThrow('The mock server stopped (exit code 3)');
    expect(children[0].kill).toHaveBeenCalled();
  });

  it('fails when a server cannot be spawned', async () => {
    let children;
    const waitImpl = vi.fn(() => {
      children[0].emit('error', new Error('ENOENT'));
      return new Promise(() => {});
    });
    const ctx = setup({ waitImpl });
    ({ children } = ctx);

    await expect(ctx.start()).rejects.toThrow('ENOENT');
  });

  it('fails and stops everything when a server never answers', async () => {
    const waitImpl = vi
      .fn()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('did not start'));
    const { children, start } = setup({ waitImpl });

    await expect(start()).rejects.toThrow('did not start');
    expect(children[0].kill).toHaveBeenCalled();
    expect(children[1].kill).toHaveBeenCalled();
  });
});
