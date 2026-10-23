import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { builderConfig, hostTarget, parseCli } from '../packageConfig';

describe('parseCli', () => {
  it('builds, stages and packages by default', () => {
    expect(parseCli([])).toEqual({
      command: 'build',
      stage: true,
      package: true,
      config: 'desktop.config.mjs',
    });
  });

  it('only builds and stages with stage', () => {
    expect(parseCli(['stage'])).toMatchObject({ command: 'stage', stage: true, package: false });
  });

  it('only packages an existing stage with package', () => {
    expect(parseCli(['package'])).toMatchObject({ command: 'package', stage: false, package: true });
  });

  it('runs the other commands without build steps', () => {
    expect(parseCli(['start'])).toMatchObject({ command: 'start', stage: false, package: false });
    expect(parseCli(['install-tools'])).toMatchObject({ command: 'install-tools' });
  });

  it('reads another config file', () => {
    expect(parseCli(['stage', '--config', 'demo/app.mjs']).config).toBe('demo/app.mjs');
  });

  it.each([
    [['ship'], 'Unknown command "ship"'],
    [['--config'], '--config needs a file'],
    [['build', '--verbose'], 'Unknown option "--verbose"'],
  ])('refuses %j', (args, message) => {
    expect(() => parseCli(args)).toThrow(message);
  });
});

describe('hostTarget', () => {
  it('builds a 64-bit Windows app on Windows', () => {
    expect(hostTarget('win32', 'x64')).toEqual({ platform: 'WINDOWS', arch: 'x64', label: 'Windows' });
  });

  it('builds for Apple Silicon on an Apple Silicon Mac', () => {
    expect(hostTarget('darwin', 'arm64')).toEqual({ platform: 'MAC', arch: 'arm64', label: 'Mac' });
  });

  it('builds for Intel on an Intel Mac', () => {
    expect(hostTarget('darwin', 'x64')).toEqual({ platform: 'MAC', arch: 'x64', label: 'Mac' });
  });

  it('refuses other systems', () => {
    expect(() => hostTarget('linux', 'x64')).toThrow('builds on Windows or macOS only');
  });
});

describe('builderConfig', () => {
  const config = {
    name: 'Acme Demo',
    appId: 'com.acme.demo',
    artifactName: 'Acme-Demo',
    servers: [{ name: 'mock' }, { name: 'search' }],
  };
  const paths = {
    stage: path.join('dist', 'stage'),
    packaged: path.join('dist', 'out'),
    servers: path.join('dist', 'resources', 'servers'),
    web: path.join('dist', 'resources', 'web'),
  };
  const make = (copy = vi.fn()) => builderConfig({ config, paths, electronVersion: '44.0.0', copy });

  it('packages the staged app with the extra servers as resources', () => {
    expect(make()).toMatchObject({
      appId: 'com.acme.demo',
      productName: 'Acme Demo',
      electronVersion: '44.0.0',
      directories: { app: paths.stage, output: paths.packaged },
      extraResources: [{ from: paths.servers, to: 'servers' }],
      npmRebuild: false,
    });
  });

  it('adds no extra resources when there are no extra servers', () => {
    const { extraResources } = builderConfig({
      config: { ...config, servers: [] },
      paths,
      electronVersion: '44.0.0',
      copy: vi.fn(),
    });

    expect(extraResources).toEqual([]);
  });

  it('names the zips per platform', () => {
    const { win, mac } = make();

    // eslint-disable-next-line no-template-curly-in-string -- electron-builder placeholders
    expect(win.artifactName).toBe('Acme-Demo-${version}-win.${ext}');
    // eslint-disable-next-line no-template-curly-in-string -- electron-builder placeholders
    expect(mac.artifactName).toBe('Acme-Demo-${version}-mac.${ext}');
  });

  it('ad-hoc signs the Mac app without the hardened runtime or notarization', () => {
    expect(make().mac).toMatchObject({ identity: '-', hardenedRuntime: false, notarize: false });
  });

  it('copies the Next server into the packaged app resources folder', () => {
    const copy = vi.fn();
    const { afterPack } = make(copy);
    const appOutDir = path.join('out', 'mac-arm64');
    const resources = path.join(appOutDir, 'Acme Demo.app', 'Contents', 'Resources');
    const getResourcesDir = vi.fn(() => resources);

    afterPack({ appOutDir, packager: { getResourcesDir } });

    expect(getResourcesDir).toHaveBeenCalledWith(appOutDir);
    expect(copy).toHaveBeenCalledWith(paths.web, path.join(resources, 'web'));
  });
});
