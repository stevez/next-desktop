---
title: Turn your web app into a desktop app for demos
published: true
description: Package a Next.js or Vite app, backend and database included, so business people can try a new feature without waiting for a deployment.
tags: showdev, electron, nextjs, webdev
---

*Package a Next.js or Vite app, backend and database included, so business people can try a new feature without waiting for a deployment.*

## The waiting game

A developer finishes a feature. The product owner wants to click through it before it ships: does the flow feel right, is the wording OK, is this what we meant?

Usually that means waiting for a deployment. Someone has to put the branch on a test environment, which needs a free slot, a working backend, a database with test data, sometimes a VPN. Or the developer shares their screen, and the business person watches instead of trying it themselves.

Feedback that could take five minutes takes a day.

I wanted something simpler: **send them the app**. A file they unzip and double-click on their own laptop, with the whole feature inside, backend and data included. No server, no Node, no Docker. That's [web-terrarium](https://github.com/stevez/web-terrarium).

## The idea: Electron already has everything

A web app needs two things to run: a **browser** for the UI and, for anything beyond static pages, a **Node.js server**. Electron, the framework behind VS Code and Slack, ships with both: a copy of Chromium and a copy of Node.js.

So web-terrarium doesn't rewrite your app for the desktop. It runs your **unchanged** web server inside the desktop app, on `127.0.0.1`, and points a window at it:

```text
┌─────────────────── Desktop app ───────────────────┐
│                                                   │
│   Window (Chromium) ──HTTP──► Your web server     │
│                               (Next.js, on Node)  │
│                                     │             │
│                                     ▼             │
│                               Extra servers:      │
│                               mock API, database  │
└───────────────────────────────────────────────────┘
```

Your app can't tell the difference between this and a real deployment. The same build that would go to a server runs on the business person's laptop instead.

## The example: a full-stack app with a real database

To show what that means in practice, take [restaurant-reviews-platform](https://github.com/stevez/restaurant-reviews-platform): a Next.js app where owners list restaurants and reviewers rate them. It uses Prisma with **PostgreSQL**, logins, and server actions. Normally, trying it means running Docker for the database, applying migrations and seeding data.

Packaging it took three steps:

**1. Install web-terrarium** as a dev dependency. It brings Electron and the packaging tools with it:

```sh
npm install --save-dev web-terrarium
```

**2. Build Next.js as a standalone server** for the desktop build only, one condition in `next.config.ts`:

```ts
if (process.env.WEB_TERRARIUM_DIST_DIR) {
  return { ...nextConfig, output: 'standalone', distDir: process.env.WEB_TERRARIUM_DIST_DIR };
}
```

**3. Describe the app** in `terrarium.config.mjs`:

```js
export default {
  name: 'Restaurant Reviews',
  appId: 'com.stevez.restaurant-reviews',
  app: {
    type: 'next',
    env: {
      DATABASE_URL: 'postgresql://postgres:postgres@{host}:{port:db}/postgres?sslmode=disable&connection_limit=1',
      JWT_SECRET: 'restaurant-reviews-desktop-demo',
    },
  },
  servers: [
    {
      name: 'db',
      entry: 'desktop/db-server.mjs',
      copy: ['generated'],
      env: { DB_PORT: '{port}', DB_HOST: '{host}' },
      ready: 'tcp',
    },
  ],
};
```

The `app` is the Next.js server. `servers` lists anything else the app needs at run time; here, the database (more on that below). `{port:db}` is a placeholder: ports are only picked when the app starts, and web-terrarium fills in the database's port before starting Next.js.

Then `npm run desktop:build` (the database step below, then `web-terrarium build`) produces `Restaurant-Reviews-1.0.0-win.zip` on Windows, or the `-mac.zip` on a Mac.

## Inside the app: PostgreSQL without Docker

The database was the hard part. A desktop app can't ask the user to install PostgreSQL, and web-terrarium only runs Node.js servers.

The answer is [PGlite](https://pglite.dev): **real PostgreSQL compiled to WebAssembly**, running in Node.js. Together with `pglite-socket`, which speaks the Postgres wire protocol, Prisma connects to it exactly as it would to a normal database. The app's code doesn't change at all.

It works in two steps:

- **At build time,** a small script copies the Prisma migrations and runs the app's existing `prisma/seed.js` against a temporary PGlite, then saves the result as `seed.sql`.
- **At run time,** `desktop/db-server.mjs`, about 40 lines, starts PGlite in memory, applies the migrations and the seed data, and listens on `127.0.0.1`:

```js
const db = await PGlite.create({ /* WebAssembly files shipped next to the server */ });
for (const file of migrations) await db.exec(readText('migrations', file));
await db.exec(readText('seed.sql'));

const server = new PGLiteSocketServer({ db, host: process.env.DB_HOST, port: Number(process.env.DB_PORT) });
await server.start();
```

A database doesn't answer HTTP requests, so `ready: 'tcp'` tells web-terrarium the database is ready once its port takes connections.

## What happens when you double-click

1. **The window opens right away** with a "Starting…" page.
2. **Free ports are picked** on `127.0.0.1` for the database and the web server, and the placeholders are filled in.
3. **The database starts first**, using the Node.js inside Electron. web-terrarium waits until it's ready.
4. **Then the Next.js server starts**, and once it answers, the window loads the app.
5. **When the window closes,** every server stops.

**Every launch starts fresh:** the database is created from the seed data again, and anything the app saved in its window last time (local storage, cookies) is cleared. Every demo starts from the same state, and nobody sees what the previous person typed.

If something fails, the user gets a clear error, and every server's output is in a log file (`servers.log`) for the developer.

## What `build` does

`web-terrarium build` runs two steps, which you can also run separately:

- **`stage`** builds the web app (`next build`) and copies its standalone server, then bundles each extra server into one file with esbuild, and writes the Electron app around them.
- **`package`** turns the stage into a zip for the current system with electron-builder: a Windows app on Windows, a Mac app on a Mac.

They're separate so that a CI pipeline can build the web app once and package it on Windows and Mac runners. And `web-terrarium start` opens the staged app without packaging it, for a quick check.

**It's not only for Next.js.** A Vite app (React, Vue, Svelte…) is even simpler: its build output is just files, and web-terrarium serves them with a small built-in server. For a Vite project, the whole config can be a name and an id.

## Is it safe to hand out?

The app runs a web page and real Node.js servers on someone's laptop, so the defaults are strict:

- **Nothing is reachable from the network.** Every server listens on `127.0.0.1` only.
- **The page has no access to Node.js or the file system.** The window is sandboxed, like a normal browser tab.
- **Links to other sites open in the real browser,** never inside the app window.
- **No local secrets are shipped.** `.env` files are removed from the build, and build-time settings stay out of the package. Only the run-time settings you list in the config go in, so keep real credentials out of it; the restaurant demo's `JWT_SECRET` only signs logins on that one laptop.

## Why these choices

- **Run the unchanged server, not a static export.** API routes, server actions and server rendering keep working, and the demo matches what will be deployed.
- **A real `http://127.0.0.1` address, not `file://`.** Routing, `fetch('/api/…')`, cookies and the browser's security rules behave exactly like on a server.
- **Electron, not Tauri.** Tauri apps are much smaller, but use the system's webview and have no Node.js. These apps need Node.js servers, and shipping Node separately would cancel most of the size advantage.

## Sharing it

The result is a zip, so you can share it any way you like: Teams, Slack, a shared drive. You can also automate it: the example repos have a GitHub Actions workflow that builds the Windows and Mac apps on every pull request, checks that they start, and comments the download links on the pull request.

## Good to know

- **The apps are unsigned,** which is fine within a team, with one extra click the first time. On Windows, SmartScreen asks: "More info" → "Run anyway". On a Mac, open the app once, then System Settings → Privacy & Security → "Open Anyway". Sign them before sharing outside your team.
- **It's for demos and offline tools, not production.** The zips are 110–175 MB, mostly Electron.
- **Node.js only:** servers run on the Node.js inside Electron, so Python or Java backends aren't supported. PGlite shows how far that still goes.

## Try it

```sh
npm install --save-dev web-terrarium
npx web-terrarium build
```

The [README](https://github.com/stevez/web-terrarium#readme) covers setup for Next.js and Vite apps. Besides the restaurant app, there are two smaller examples: [a Vite app](https://github.com/stevez/todo-client) whose config is two lines, and [a Next.js app with a mock backend](https://github.com/stevez/msw-terrarium-example).

How does your team get feedback on work in progress? I'd love to hear whether a "just send them the app" approach would help.
