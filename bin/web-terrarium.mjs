#!/usr/bin/env node
import { run } from '../src/cli.mjs';

try {
  await run(process.argv.slice(2));
} catch (err) {
  // Config and usage mistakes are explained in the message; set DEBUG=web-terrarium for the stack.
  console.error(process.env.DEBUG?.includes('web-terrarium') ? err : `web-terrarium: ${err.message}`);
  process.exitCode = 1;
}
