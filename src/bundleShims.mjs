// Injected into every bundled server by esbuild (see esbuildOptions in stage.mjs). Bundled
// CommonJS dependencies often read __dirname or __filename, which ES modules don't have. esbuild
// fills in only the references that nothing else declares, so a server's own __dirname is kept.
// The bundle is one file, so import.meta.url here is the bundle itself.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);
