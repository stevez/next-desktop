// Electron entry: starts the app's servers on 127.0.0.1 and shows the Next.js app in a window.
// Copied into the staged app next to app.json (the project's runtime settings), servers.mjs and
// window.mjs.
import fs from 'node:fs';
import path from 'node:path';

import { app, BrowserWindow, dialog, session, shell } from 'electron';

import { LOG_NAME, startServers } from './servers.mjs';
import { isAllowedPermission, isAppUrl, loadingPage, opensExternally } from './window.mjs';

const config = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'app.json'), 'utf8'));

// Packaged: the servers sit in the app's resources folder. Unpackaged (web-terrarium start): next
// to the staged app.
const resourcesDir = app.isPackaged
  ? process.resourcesPath
  : path.join(import.meta.dirname, '..', 'resources');

let running;
// Aborted when the window closes (or the app quits), so closing the window during start-up stops
// the servers already started instead of reporting an error.
const startup = new AbortController();
let mainWindow;
let logStream;

const log = (name, text) => logStream?.write(`[${name}] ${text}`);

const openExternally = (url) => {
  if (opensExternally(url)) shell.openExternal(url);
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: config.window.width,
    height: config.window.height,
    title: config.name,
    // The packaged app already has the icon; this one shows in the taskbar under `start` too.
    ...(config.icon && { icon: path.join(import.meta.dirname, config.icon) }),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Keep the app's name as the window title, not the page's <title>.
  mainWindow.on('page-title-updated', (event) => event.preventDefault());
  // 'close', not 'closed': a page still loading fails as soon as the window starts closing.
  mainWindow.on('close', () => startup.abort());
  const { webContents } = mainWindow;
  webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, running?.url)) {
      event.preventDefault();
      openExternally(url);
    }
  });
  mainWindow.loadURL(loadingPage({ title: config.name, text: config.window.loadingText }));
};

const start = async () => {
  const logFile = path.join(app.getPath('userData'), 'servers.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  logStream = fs.createWriteStream(logFile, { flags: 'w' });
  session.defaultSession.setPermissionRequestHandler((_, permission, callback) =>
    callback(isAllowedPermission(permission)),
  );
  // Every launch starts fresh: nothing the app saved in its window last time (local storage,
  // IndexedDB, cookies, cache) carries over, so it can't go stale against servers that reset.
  await session.defaultSession.clearStorageData();
  await session.defaultSession.clearCache();
  const fail = (title, err) => {
    log(LOG_NAME, `${err.stack}\n`);
    dialog.showErrorBox(title, `${err.message}\n\n${config.errorHint} Details: ${logFile}`);
    app.quit();
  };
  createWindow();
  try {
    running = await startServers({
      config,
      resourcesDir,
      execPath: process.execPath,
      baseEnv: process.env,
      onOutput: log,
      onExit: (err) => fail(`${config.name} stopped`, err),
      signal: startup.signal,
    });
    await mainWindow.loadURL(running.url);
  } catch (err) {
    // Closed during start-up, even while the app page was loading (which then fails with
    // ERR_FAILED): not an error, and the servers are already stopped. An error box here would
    // keep the app, and its servers, running until someone dismissed it.
    if (startup.signal.aborted) return;
    fail(`${config.name} could not start`, err);
  }
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    running?.stop();
    startup.abort();
    logStream?.end();
  });
  app.whenReady().then(start);
}
