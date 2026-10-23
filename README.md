# next-desktop

Turns a Next.js app into a Windows or Mac desktop app (Electron). The desktop app runs the Next.js standalone server, plus any local servers you list (for example a mock backend), on `127.0.0.1`, and shows the app in a window. Users don't need Node or the repo.

It's built for demos and offline tools: the app is unsigned (ad-hoc signed on Mac) and is shared as a zip within the team.

How it works inside (modules, build and run-time flow, security, how to extend): [docs/architecture.md](docs/architecture.md).

## Set up a project

1. Add the tools as devDependencies: `electron`, `electron-builder`, and `esbuild` if you list extra servers.
2. In `next.config.js`, build standalone into the folder next-desktop asks for. The desktop build then never mixes with the normal `.next` build:

   ```js
   const nextConfig = {
     output: 'standalone',
     distDir: process.env.NEXT_DESKTOP_DIST_DIR || '.next',
     // ...
   };
   ```

3. Add `desktop.config.mjs` next to `package.json`:

   ```js
   export default {
     name: 'Acme Demo', // app, window and folder name
     appId: 'com.acme.demo',
     next: {
       buildEnv: { NEXT_PUBLIC_MODE: 'demo' }, // env for `next build`
       env: { API_URL: 'http://{host}:{port:mock}' }, // env for the Next server at run time
       readyPath: '/api/health', // answers 200 once the app is up
     },
     servers: [
       {
         name: 'mock',
         entry: 'mocks/server.mjs', // bundled into one file with esbuild
         copy: ['fixtures'], // folders next to the entry, copied beside the bundle
         env: { PORT: '{port}' },
         readyPath: '/health',
       },
     ],
   };
   ```

4. Add scripts to `package.json`:

   ```json
   "desktop:build": "next-desktop build",
   "desktop:stage": "next-desktop stage",
   "desktop:start": "next-desktop start"
   ```

   While the package lives inside a repo, call it by path, for example `node packages/next-desktop/bin/next-desktop.mjs build`.

## Commands

| Command | What it does |
| --- | --- |
| `build` (default) | `stage`, then `package`. |
| `stage` | Runs `next build` with `next.buildEnv`, then stages the standalone server, bundles the extra servers and writes the Electron app into `<outDir>/stage` and `<outDir>/resources`. |
| `package` | Packages the stage into a zip for this system in `<outDir>/out`. Windows builds a Windows zip, a Mac builds a Mac zip for its chip. Linux can stage but not package. |
| `start` | Opens the staged app without packaging it. |
| `install-tools` | For CI runners that can't reach your private registry: installs Electron, electron-builder and sharp from public npm with `npm ci`, at the versions and integrity hashes in `package-lock.json` (sharp must match the staged version), then swaps the stage's sharp binaries for this system's. Set `NEXT_DESKTOP_REGISTRY` to use another registry. |

Add `--config <file>` to use a config other than `./desktop.config.mjs`.

## Config

| Option | Default | Notes |
| --- | --- | --- |
| `name` | required | Product name, window title, exe or `.app` name and the user-data folder (logs). |
| `appId` | required | Reverse-DNS id, for example `com.acme.demo`. |
| `artifactName` | `name` with `-` for spaces | Zips are `<artifactName>-<version>-win.zip` and `-mac.zip`. |
| `version`, `author` | from `package.json` | |
| `description` | `name` | |
| `outDir` | `dist-desktop` | Stage and zips. Add it to `.gitignore`. |
| `next.distDir` | `.next-desktop` | Must not be `.next`. Add it to `.gitignore`. |
| `next.buildEnv` | `{}` | Env for `next build`. `NEXT_PUBLIC_*` values are baked in here. |
| `next.env` | `{}` | Env for the Next server at run time. |
| `next.readyPath` | `/` | Polled until it answers 2xx. |
| `servers[]` | `[]` | Extra Node servers, started in order before the Next server. |
| `servers[].name` | required | Letters, digits, `-` or `_`. Not `app`. |
| `servers[].entry` | required | Path from the project root. Bundled with esbuild (ESM, Node 22). |
| `servers[].copy` | `[]` | Files or folders next to the entry, copied beside the bundle. |
| `servers[].env` | `{}` | Env for that server. |
| `servers[].readyPath` | `/` | Polled until it answers 2xx. |
| `servers[].label` | `<name> server` | Used in error messages. |
| `window` | `1280` x `800` | `{ width, height, loadingText }`. |
| `errorHint` | "Close other copies…" | Shown when the app can't start. |

Env values can use `{host}` (always `127.0.0.1`), `{port}` (the server's own port) and `{port:<name>}` (another server's port; the Next server is `app`). Ports are picked free at start-up.

## What the app does at run time

1. Picks a free port for each server and for the Next server.
2. Starts each server with Electron's own Node (`ELECTRON_RUN_AS_NODE=1`), in order, and waits for its `readyPath`. Then starts the Next server the same way.
3. Shows the app in a sandboxed window. Links to other sites open in the browser; only `https` links are opened.
4. Stops every server when the app quits.

The servers' output goes to `servers.log` in the user-data folder: `%APPDATA%\<name>` on Windows, `~/Library/Application Support/<name>` on Mac. Each server logs `[next-desktop] <server> ready at <url>` once it answers.

## CI

[`templates/desktop-app.yml`](templates/desktop-app.yml) is a GitHub Actions workflow that stages on one Linux runner and packages on Windows and Mac runners. Copy it to `.github/workflows/` and fill in the `TODO`s.

## Limits

- The app is not code-signed, so Windows SmartScreen and macOS Gatekeeper may warn or block it. Sign it before sharing it outside your team.
- The zip is about 160 MB: Electron plus the Next standalone server.
- No auto-update.
