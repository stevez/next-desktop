# web-terrarium

Packages a Node.js web app and its local servers as a Windows or Mac desktop app (Electron): a sealed little world with the app, its servers and its mocks in one box. The desktop app runs the web server, plus any local servers you list (for example a mock backend), on `127.0.0.1`, and shows the app in a window. Users don't need Node or the repo.

It's built for demos and offline tools: the app is unsigned (ad-hoc signed on Mac) and is shared as a zip within the team.

> **Status:** today web-terrarium packages **Next.js** apps. Vite and other static apps, and Express and other Node servers, are planned: see the [roadmap](https://github.com/stevez/web-terrarium/issues/6). It was called next-desktop; see [Upgrading from next-desktop](#upgrading-from-next-desktop).

How it works inside (modules, build and run-time flow, security, how to extend): [docs/architecture.md](https://github.com/stevez/web-terrarium/blob/main/docs/architecture.md).

## Set up a project

1. Install web-terrarium as a devDependency. It brings the desktop tools it drives (Electron, electron-builder and esbuild) as its own dependencies, at versions it's tested with, so you don't install them yourself:

   ```sh
   npm install --save-dev web-terrarium
   ```

   Electron downloads its runtime (about 100 MB) on install, once per machine. CI jobs that don't build the desktop app can skip that with `ELECTRON_SKIP_BINARY_DOWNLOAD=1`.

2. In `next.config.js`, build standalone into the folder web-terrarium asks for. The desktop build then never mixes with the normal `.next` build:

   ```js
   const nextConfig = {
     output: 'standalone',
     distDir: process.env.WEB_TERRARIUM_DIST_DIR || '.next',
     // ...
   };
   ```

3. Add `terrarium.config.mjs` next to `package.json`:

   ```js
   export default {
     name: 'Acme Demo', // app, window and folder name
     appId: 'com.acme.demo',
     app: {
       type: 'next',
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
   "desktop:build": "web-terrarium build",
   "desktop:stage": "web-terrarium stage",
   "desktop:start": "web-terrarium start"
   ```

5. Add `.next-terrarium` and `dist-desktop` to `.gitignore`. In a TypeScript project, the first desktop build adds `.next-terrarium/types/**/*.ts` to `tsconfig.json`'s `include`; commit that change.

## Commands

| Command | What it does |
| --- | --- |
| `build` (default) | `stage`, then `package`. |
| `stage` | Runs `next build` with `app.buildEnv`, then stages the standalone server, bundles the extra servers and writes the Electron app into `<outDir>/stage` and `<outDir>/resources`. |
| `package` | Packages the stage into a zip for this system in `<outDir>/out`. Windows builds a Windows zip, a Mac builds a Mac zip for its chip. Linux can stage but not package. |
| `start` | Opens the staged app without packaging it. |
| `install-tools` | For CI runners that can't reach your private registry: installs web-terrarium (with its Electron, electron-builder and esbuild) and sharp from public npm with `npm ci`, at the versions and integrity hashes in `package-lock.json` (sharp must match the staged version), then swaps the stage's sharp binaries for this system's. `npx web-terrarium package` then runs that installed copy. Set `WEB_TERRARIUM_REGISTRY` to use another registry. |
| `help`, `--help`, `-h` | Shows the commands and options. |
| `version`, `--version`, `-v` | Shows the version. |

Add `--config <file>` to use a config other than `./terrarium.config.mjs`. Errors print one line; set `DEBUG=web-terrarium` to see the stack.

## Config

| Option | Default | Notes |
| --- | --- | --- |
| `name` | required | Product name, window title, exe or `.app` name and the user-data folder (logs). |
| `appId` | required | Reverse-DNS id, for example `com.acme.demo`. |
| `artifactName` | `name` with `-` for spaces | Zips are `<artifactName>-<version>-win.zip` and `-mac.zip`. |
| `version`, `author` | from `package.json` | |
| `description` | `name` | |
| `outDir` | `dist-desktop` | Stage and zips. Deleted at the start of each `stage`, so it must be a folder inside the project, never the project itself. |
| `icon` | the web app's icon | A PNG (512 x 512 or larger works everywhere), `.ico` (Windows only) or `.icns` (Mac only). If not set, web-terrarium uses the first it finds of `src/app/icon.png`, `app/icon.png`, `public/icon.png`, then `favicon.ico` in `src/app/`, `app/` or `public/`. A Mac app can't use an `.ico`, so it keeps Electron's icon then. |
| `app.type` | `next` | The kind of web app. Only `next` today. |
| `app.distDir` | `.next-terrarium` | Must not be `.next`. |
| `app.buildEnv` | `{}` | Env for `next build`. `NEXT_PUBLIC_*` values are baked in here. |
| `app.env` | `{}` | Env for the Next server at run time. |
| `app.readyPath` | `/` | Polled until it answers 2xx. |
| `servers[]` | `[]` | Extra Node servers, started in order before the Next server. |
| `servers[].name` | required | Letters, digits, `-` or `_`. Not `app`. |
| `servers[].entry` | required | Path from the project root. Bundled with esbuild (ESM, Node 22); bundled CommonJS packages still get `require`, `__dirname` and `__filename`. |
| `servers[].copy` | `[]` | Files or folders next to the entry, copied beside the bundle. |
| `servers[].env` | `{}` | Env for that server. |
| `servers[].ready` | `http` | How to tell the server is up: `http` polls `readyPath` until it answers 2xx; `tcp` waits until the port takes a connection, for servers that don't speak HTTP, such as a database. |
| `servers[].readyPath` | `/` | Polled until it answers 2xx (with `ready: 'http'`). |
| `servers[].label` | `<name> server` | Used in error messages. |
| `startTimeoutMs` | `60000` | How long to wait for each server's `readyPath` at start-up. |
| `window` | `1280` x `800` | `{ width, height, loadingText }`. |
| `errorHint` | "Close other copies…" | Shown when the app can't start. |

Env values can use `{host}` (always `127.0.0.1`), `{port}` (the server's own port) and `{port:<name>}` (another server's port; the Next server is `app`). Ports are picked free at start-up.

## What the app does at run time

1. Picks a free port for each server and for the Next server.
2. Starts each server with Electron's own Node (`ELECTRON_RUN_AS_NODE=1`), in order, and waits for its `readyPath`. Then starts the Next server the same way.
3. Shows the app in a sandboxed window, titled with the config's `name` (not the page's `<title>`). Links to other sites open in the browser; only `https` links are opened.
4. Stops every server when the app quits.

The servers' output goes to `servers.log` in the user-data folder: `%APPDATA%\<name>` on Windows, `~/Library/Application Support/<name>` on Mac. Each server logs `[web-terrarium] <server> ready at <url>` once it answers.

## CI

[`templates/desktop-app.yml`](https://github.com/stevez/web-terrarium/blob/main/templates/desktop-app.yml) is a GitHub Actions workflow that stages on one Linux runner and packages on Windows and Mac runners. Copy it to `.github/workflows/` and fill in the `TODO`s.

## Upgrading from next-desktop

Old projects keep working, so you can move over one step at a time:

| next-desktop | web-terrarium | Old name still works? |
| --- | --- | --- |
| `next-desktop` command | `web-terrarium` | Yes |
| `desktop.config.mjs` | `terrarium.config.mjs` | Yes, when `terrarium.config.mjs` isn't there |
| `next: { ... }` | `app: { type: 'next', ... }` | Yes |
| `NEXT_DESKTOP_DIST_DIR` in `next.config.js` | `WEB_TERRARIUM_DIST_DIR` | Yes, both are set |
| `NEXT_DESKTOP_REGISTRY` | `WEB_TERRARIUM_REGISTRY` | Yes |
| `next.distDir` default `.next-desktop` | `.next-terrarium` | Set `distDir: '.next-desktop'` to keep the old folder |
| `[next-desktop]` lines in `servers.log` | `[web-terrarium]` | No: update smoke tests that match on it |

## Limits

- **Node.js only.** Every server, including mock backends, runs on Electron's built-in Node.js. Python, Go, Java and other backends aren't supported.
- **Windows x64 only.** Windows builds are x64, and building on a Windows ARM machine stops with an error. The x64 app may run on ARM PCs through Windows' emulation, but that's untested.
- **Not code-signed**, so Windows SmartScreen and macOS Gatekeeper may warn or block it. Sign it before sharing it outside your team.
- **Size.** The zip is about 160 MB: Electron plus the Next standalone server.
- **Long paths on Windows.** Paths inside the zip can be over 150 characters (deep `node_modules`). Unzip it into a short folder, such as `Downloads` or `C:\Apps`; deep folders can hit Windows' 260-character limit.
- **No auto-update.**
- **Electron only.** Tauri isn't planned: the apps this is for need Node servers, which Tauri would have to ship separately.
