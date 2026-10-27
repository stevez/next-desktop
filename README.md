# web-terrarium

Packages a Node.js web app and its local servers as a Windows or Mac desktop app (Electron): a sealed little world with the app, its servers and its mocks in one box. The desktop app runs the web server, plus any local servers you list (for example a mock backend), on `127.0.0.1`, and shows the app in a window. Users don't need Node or the repo.

It's built for demos and offline tools: the app is unsigned (ad-hoc signed on Mac) and is shared as a zip within the team.

It packages two kinds of web app:

| `app.type` | For | What runs in the desktop app |
| --- | --- | --- |
| `next` | Next.js apps | The Next.js standalone server |
| `static` | Apps whose build output is only files: React, Vue, Svelte and others built with Vite, or a plain HTML site | web-terrarium's static server, serving the build output (`dist/`) |

> **Status:** Express and other Node servers (`node`) are planned: see the [roadmap](https://github.com/stevez/web-terrarium/issues/6). web-terrarium was called next-desktop; see [Upgrading from next-desktop](#upgrading-from-next-desktop).

A walkthrough with a full-stack example (Next.js, Prisma and PostgreSQL inside the app): [Turn your web app into a desktop app for demos](https://dev.to/stevez/turn-your-web-app-into-a-desktop-app-for-demos-1oe8) on dev.to.

How it works inside (modules, build and run-time flow, security, how to extend): [docs/architecture.md](https://github.com/stevez/web-terrarium/blob/main/docs/architecture.md).

## Examples

Real apps that use web-terrarium. Each has a `terrarium.config.mjs` and a GitHub Actions workflow (`.github/workflows/desktop.yml`) that builds and smoke-tests the Windows and Mac apps on every pull request, comments the download links on it, and attaches the zips to a release on `v*` tags.

| App | What it shows |
| --- | --- |
| [msw-terrarium-example](https://github.com/stevez/msw-terrarium-example) | A Next.js todo app plus its [msw-terrarium](https://github.com/stevez/msw-terrarium) mock server as an extra server. The mock gets its port from `{port}`, and the app finds it through `{port:mock}`. |
| [restaurant-reviews-platform](https://github.com/stevez/restaurant-reviews-platform) | A full-stack Next.js app with Prisma and PostgreSQL. The database runs inside the desktop app as [PGlite](https://pglite.dev) (PostgreSQL in WebAssembly), served by an extra server with `ready: 'tcp'`, so users need no Docker or database. |
| [todo-client](https://github.com/stevez/todo-client) | A React + Vite app with no server code (`static`). Its config is just a name and an `appId`: the type is guessed from Vite, and the defaults build with `npm run build` and ship `dist/`. |

## Set up a project

1. Install web-terrarium as a devDependency. It brings the desktop tools it drives (Electron, electron-builder and esbuild) as its own dependencies, at versions it's tested with, so you don't install them yourself:

   ```sh
   npm install --save-dev web-terrarium
   ```

   Electron downloads its runtime (about 100 MB) on install, once per machine. CI jobs that don't build the desktop app can skip that with `ELECTRON_SKIP_BINARY_DOWNLOAD=1`.

2. **Next.js only:** in `next.config.js`, build standalone into the folder web-terrarium asks for. The desktop build then never mixes with the normal `.next` build:

   ```js
   const nextConfig = {
     output: 'standalone',
     distDir: process.env.WEB_TERRARIUM_DIST_DIR || '.next',
     // ...
   };
   ```

   A static app needs no change.

3. Add `terrarium.config.mjs` next to `package.json`. For a static app (Vite and the like), a name and an id are often enough:

   ```js
   export default {
     name: 'Acme Notes',
     appId: 'com.acme.notes',
     // Defaults shown; change them if your project differs.
     app: {
       type: 'static', // guessed when the project uses Vite and not Next.js
       build: 'npm run build', // run at stage time
       dir: 'dist', // the build output to ship
       spa: true, // unknown paths without a file extension get index.html (client-side routing)
     },
   };
   ```

   For a Next.js app, with a mock backend as an extra server:

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

5. Add `dist-desktop` (and for Next.js, `.next-terrarium`) to `.gitignore`. In a TypeScript Next.js project, the first desktop build adds `.next-terrarium/types/**/*.ts` to `tsconfig.json`'s `include`; commit that change.

## Commands

| Command | What it does |
| --- | --- |
| `build` (default) | `stage`, then `package`. |
| `stage` | Builds the web app with `app.buildEnv` (`next build`, or a static app's `app.build` command), stages it (the Next standalone server, or the static build output with web-terrarium's static server), bundles the extra servers and writes the Electron app into `<outDir>/stage` and `<outDir>/resources`. |
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
| `app.type` | guessed | `next` or `static`. If not set: `next` when the project depends on Next.js, `static` when it uses Vite, else `next`. |
| `app.buildEnv` | `{}` | Env for the build. `NEXT_PUBLIC_*` (Next.js) and `VITE_*` (Vite) values are baked in here. |
| `app.readyPath` | `/` | Polled until it answers 2xx. |
| **Next.js** (`type: 'next'`) | | |
| `app.distDir` | `.next-terrarium` | Must not be `.next`. |
| `app.env` | `{}` | Env for the Next server at run time. |
| **Static** (`type: 'static'`) | | |
| `app.build` | `npm run build` | Command that builds the app, run in the project folder at stage time. |
| `app.dir` | `dist` | The build output to ship. Must contain `index.html`. |
| `app.spa` | `true` | A path with no file extension that matches no file gets `index.html`, so client-side routes work on reload. Set `false` for a multi-page site. |
| `app.proxy` | `{}` | Path prefixes forwarded to another server, like Vite's dev proxy: `{ '/api': 'http://{host}:{port:mock}' }`. The app calls `/api/...` on its own origin, so there's no CORS and no port to know at build time. |
| `servers[]` | `[]` | Extra Node servers, started in order before the app server. |
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

Env values and `app.proxy` targets can use `{host}` (always `127.0.0.1`), `{port}` (the server's own port) and `{port:<name>}` (another server's port; the app server is `app`). Ports are picked free at start-up.

## What the app does at run time

1. Picks a free port for each server and for the app server.
2. Starts each server with Electron's own Node (`ELECTRON_RUN_AS_NODE=1`), in order, and waits until it's ready. Then starts the app server the same way: the Next.js server, or web-terrarium's static server for a static app.
3. Shows the app in a sandboxed window, titled with the config's `name` (not the page's `<title>`). Links to other sites open in the browser; only `https` links are opened.
4. Stops every server when the app quits.

Every launch starts fresh: before the app loads, web-terrarium clears what the app saved in its window last time (local storage, IndexedDB, cookies, cache). Apps whose servers reset on each launch (a mock, an in-memory database) can't end up with stale data in the window, and a demo always starts the same way.

The servers' output goes to `servers.log` in the user-data folder: `%APPDATA%\<name>` on Windows, `~/Library/Application Support/<name>` on Mac. Each server logs `[web-terrarium] <server> ready at <url>` once it answers.

## CI

Two ways to build the desktop app in GitHub Actions:

- **All packages on public npm:** build directly on a Windows and a Mac runner. The [examples](#examples) do this; copy their `.github/workflows/desktop.yml`, for example from [msw-terrarium-example](https://github.com/stevez/msw-terrarium-example/blob/main/.github/workflows/desktop.yml), and change `APP_NAME` and the build command. It also smoke-tests each app, comments the download links on pull requests and attaches the zips to a release on `v*` tags.
- **A private registry the Windows and Mac runners can't reach:** [`templates/desktop-app.yml`](https://github.com/stevez/web-terrarium/blob/main/templates/desktop-app.yml) stages on one runner that can reach it (Linux), then packages on Windows and Mac runners with `install-tools`. It also smoke-tests each app and attaches the zips to a release on `v*` tags. Copy it to `.github/workflows/` and fill in the `TODO`s. Because the stage is built on Linux, `install-tools` swaps in the right native binaries for sharp only; if your server needs another native module (Prisma's query engine, say), build on each system instead.

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
- **Size.** The zip is about 160 MB for a Next.js app (Electron plus the Next standalone server) and about 145 MB for a static app (mostly Electron).
- **Long paths on Windows.** Paths inside the zip can be over 150 characters (deep `node_modules`). Unzip it into a short folder, such as `Downloads` or `C:\Apps`; deep folders can hit Windows' 260-character limit.
- **No auto-update.**
- **Electron only.** Tauri isn't planned: the apps this is for need Node servers, which Tauri would have to ship separately.
