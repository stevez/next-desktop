# Changelog

## 0.1.0

First release as web-terrarium (formerly next-desktop). Packages Next.js apps; other app types follow (see the [roadmap](https://github.com/stevez/web-terrarium/issues/6)).

### Changed

- Renamed to web-terrarium. The `next-desktop` command still works.
- The config file is `terrarium.config.mjs`. `desktop.config.mjs` is still read when it's the only one.
- The web app is set with `app: { type: 'next', ... }`. `next: { ... }` still works.
- `next.config.js` reads `WEB_TERRARIUM_DIST_DIR`. `NEXT_DESKTOP_DIST_DIR` is still set.
- `install-tools` reads `WEB_TERRARIUM_REGISTRY`. `NEXT_DESKTOP_REGISTRY` still works.
- The default build folder is `.next-terrarium` (was `.next-desktop`).
- `servers.log` lines from web-terrarium itself start with `[web-terrarium]` (was `[next-desktop]`).
- Errors print one line, without the stack. Set `DEBUG=web-terrarium` for the stack.

### Added

- `startTimeoutMs`: how long to wait for each server at start-up (default 60 s).
- `help` / `--help` / `-h` and `version` / `--version` / `-v`.

### Fixed

- `stage` refuses an `outDir` that is the project folder or one above it. It deletes `outDir` first, so before this a bad `outDir` would delete the project.
- Bundled servers give CommonJS dependencies `__dirname` and `__filename`, not just `require`. A server that declares its own `require` or `__dirname` still builds.
- Building on Windows ARM stops with a clear error instead of making an app whose native modules don't load.
