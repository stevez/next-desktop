// Electron entry: starts the app's servers on 127.0.0.1 and shows the Next.js app in a window.
// Copied into the staged app next to app.json (the project's runtime settings), servers.mjs and
// window.mjs.
import fs from 'node:fs';
import path from 'node:path';

import { app, BrowserWindow, dialog, session, shell } from 'electron';

// Node ESM needs the extension at runtime.
// eslint-disable-next-line import-x/extensions
import { startServers } from './servers.mjs';
// eslint-disable-next-line import-x/extensions
import { isAllowedPermission, isAppUrl, loadingPage, opensExternally } from './window.mjs';

const config = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'app.json'), 'utf8'));

// Packaged: the servers sit in the app's resources folder. Unpackaged (next-desktop start): next
// to the staged app.
const resourcesDir = app.isPackaged
  ? process.resourcesPath
  : path.join(import.meta.dirname, '..', 'resources');

let running;
// Aborted on quit, so closing the window during start-up also stops the servers already started.
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
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
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
  const fail = (title, err) => {
    log('next-desktop', `${err.stack}\n`);
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
    // Closed during start-up: the servers are already stopped.
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
