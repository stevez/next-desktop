// next-desktop command line. See ../README.md.
/* eslint-disable no-console -- command-line tool */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// eslint-disable-next-line import-x/extensions
import { installTools, packageApp, stageApp, startStaged } from './build.mjs';
// eslint-disable-next-line import-x/extensions
import { resolveConfig } from './config.mjs';
// eslint-disable-next-line import-x/extensions
import { hostTarget, parseCli } from './packageConfig.mjs';

export const run = async (args, { cwd = process.cwd() } = {}) => {
  const options = parseCli(args);
  const configFile = path.resolve(cwd, options.config);
  const root = path.dirname(configFile);
  const { default: raw } = await import(pathToFileURL(configFile).href);
  const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const config = resolveConfig(raw, { root, rootPackage });

  if (options.command === 'start') {
    startStaged(config);
    return;
  }
  if (options.command === 'install-tools') {
    installTools(config, { registry: process.env.NEXT_DESKTOP_REGISTRY });
    return;
  }
  // Check the system first so an unsupported one fails before the slow Next build.
  const target = options.package ? hostTarget(process.platform, process.arch) : null;
  if (options.stage) await stageApp(config);
  if (options.package) {
    await packageApp(config, target);
  } else {
    console.log('\nStaged. Run `next-desktop start` to open it.');
  }
};
