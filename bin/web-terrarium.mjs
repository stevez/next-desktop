#!/usr/bin/env node
// eslint-disable-next-line import-x/extensions
import { run } from '../src/cli.mjs';

await run(process.argv.slice(2));
