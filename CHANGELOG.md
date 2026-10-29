# Changelog

## 0.3.0

### Added

- An app menu with **About** (the version, git branch and commit, and build time, recorded by `stage`) and **Reset Demo Data** (restarts the app with its original data). About has a **Copy** button, since the text of a message box can't be selected on Windows. The standard Edit, View and Window menus stay.

### Changed

- The menu bar is always shown on Windows (it was hidden until Alt was pressed), so About and Reset Demo Data are easy to find.

## 0.2.0

### Added

- Static apps (`app.type: 'static'`): React, Vue, Svelte and other apps built with Vite, or any site whose build output is only files. `stage` runs `app.build` (default `npm run build`) and ships `app.dir` (default `dist`). In the desktop app, a static server built into web-terrarium serves it:
  - correct file types; hashed files cached for good, `index.html` checked on every load;
  - single-page apps: paths with no file extension that match no file get `index.html` (`app.spa`, default on);
  - `app.proxy` forwards path prefixes to another server, like Vite's dev proxy, e.g. `{ '/api': 'http://{host}:{port:mock}' }`;
  - refuses paths that would leave the build output.
- `app.type` is guessed when it's not set: `next` for projects that depend on Next.js, `static` for Vite projects.

### Changed

- Every launch starts fresh: the app's window storage (local storage, IndexedDB, cookies, cache) is cleared at start-up. Before, it was only out of reach because the port changed, and it piled up on disk.
- CI template (`templates/desktop-app.yml`):
  - smoke-tests each packaged app: launches it, waits for `app ready` in `servers.log`, loads the page, quits;
  - uploads zips as they are (`upload-artifact@v7` with `archive: false`), so a download is the app's zip, not a zip inside a zip;
  - attaches the zips to a GitHub Release on `v*` tags;
  - documents that `install-tools` swaps native binaries for sharp only.
- README: an Examples section with three real apps (two Next.js, one static), and a simpler per-system CI workflow for projects whose packages are all on public npm.

## 0.1.0

First release as web-terrarium (formerly next-desktop). Packages Next.js apps; other app types follow (see the [roadmap](https://github.com/stevez/web-terrarium/issues/6)).

### Changed

- Renamed to web-terrarium. The `next-desktop` command still works.
- Electron, electron-builder and esbuild are web-terrarium's own dependencies, not peer dependencies, so a project installs only `web-terrarium`. Next.js stays an optional peer dependency.
- `install-tools` installs web-terrarium (with its tools) and sharp from the lockfile, and `npx web-terrarium package` runs that copy. The CI template is updated.
- The config file is `terrarium.config.mjs`. `desktop.config.mjs` is still read when it's the only one.
- The web app is set with `app: { type: 'next', ... }`. `next: { ... }` still works.
- `next.config.js` reads `WEB_TERRARIUM_DIST_DIR`. `NEXT_DESKTOP_DIST_DIR` is still set.
- `install-tools` reads `WEB_TERRARIUM_REGISTRY`. `NEXT_DESKTOP_REGISTRY` still works.
- The default build folder is `.next-terrarium` (was `.next-desktop`).
- `servers.log` lines from web-terrarium itself start with `[web-terrarium]` (was `[next-desktop]`).
- Errors print one line, without the stack. Set `DEBUG=web-terrarium` for the stack.

### Added

- `startTimeoutMs`: how long to wait for each server at start-up (default 60 s).
- `servers[].ready: 'tcp'`: a server is ready once its port takes a connection, for servers that don't speak HTTP, such as an embedded database (PGlite with pglite-socket, say).
- `icon`: the app's icon. If not set, the web app's own icon is used (`app/icon.png`, then `favicon.ico`).
- `help` / `--help` / `-h` and `version` / `--version` / `-v`.

### Fixed

- `stage` refuses an `outDir` that is the project folder or one above it. It deletes `outDir` first, so before this a bad `outDir` would delete the project.
- Bundled servers give CommonJS dependencies `__dirname` and `__filename`, not just `require`. A server that declares its own `require` or `__dirname` still builds.
- Building on Windows ARM stops with a clear error instead of making an app whose native modules don't load.
- Works when Next puts `server.js` deeper inside `standalone/`. That happens in a monorepo, or when Next finds a lockfile in a parent folder. Before, `stage` failed with "No standalone server".
- The window keeps the app's name as its title, instead of the page's `<title>`.
- Closing the window while the app page is still loading quits quietly. Before, it showed a "could not start" error (ERR_FAILED), and the app and its servers kept running until the error was dismissed.
