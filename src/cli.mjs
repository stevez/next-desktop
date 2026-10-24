// web-terrarium command line. See ../README.md.
/* eslint-disable no-console -- command-line tool */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { installTools, packageApp, stageApp, startStaged } from './build.mjs';
import { resolveConfig } from './config.mjs';
import { configFile, hostTarget, parseCli, usage } from './packageConfig.mjs';

const ownVersion = () =>
  JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')).version;

export const run = async (args, { cwd = process.cwd() } = {}) => {
  const options = parseCli(args);
  if (options.command === 'help') {
    console.log(usage(ownVersion()));
    return;
  }
  if (options.command === 'version') {
    console.log(ownVersion());
    return;
  }

  const file = configFile({ cwd, config: options.config, exists: fs.existsSync });
  if (!fs.existsSync(file)) {
    throw new Error(`No config file at ${file}. Add terrarium.config.mjs (see the README) or pass --config.`);
  }
  const root = path.dirname(file);
  const { default: raw } = await import(pathToFileURL(file).href);
  const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const config = resolveConfig(raw, { root, rootPackage });

  if (options.command === 'start') {
    startStaged(config);
    return;
  }
  if (options.command === 'install-tools') {
    // NEXT_DESKTOP_REGISTRY is the name from before the rename.
    const registry = process.env.WEB_TERRARIUM_REGISTRY ?? process.env.NEXT_DESKTOP_REGISTRY;
    installTools(config, registry ? { registry } : {});
    return;
  }
  // Check the system first so an unsupported one fails before the slow web build.
  const target = options.package ? hostTarget(process.platform, process.arch) : null;
  if (options.stage) await stageApp(config);
  if (options.package) {
    await packageApp(config, target);
  } else {
    console.log('\nStaged. Run `web-terrarium start` to open it.');
  }
};
