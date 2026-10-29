// Window rules for the Electron entry (main.mjs). Copied into the packaged app.
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write']);

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const loadingPage = ({ title, text }) =>
  `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html><title>${escapeHtml(title)}</title>
  <body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#34384b">
  <p>${escapeHtml(text)}</p></body>`,
  )}`;

export const isAppUrl = (url, appUrl) =>
  Boolean(appUrl) && new URL(url).origin === new URL(appUrl).origin;

export const opensExternally = (url) => url.startsWith('https://');

export const isAllowedPermission = (permission) => ALLOWED_PERMISSIONS.has(permission);

// The About box's text: the version, the branch and commit it was built from, and when.
export const aboutDetail = (build = {}) => {
  const source = [build.branch, build.commit].filter(Boolean).join('@');
  return [
    build.version && `Version ${build.version}`,
    source && `Built from ${source}`,
    build.builtAt && `Built on ${build.builtAt.slice(0, 16).replace('T', ' ')} UTC`,
  ]
    .filter(Boolean)
    .join('\n');
};

const separator = { type: 'separator' };

// The app's menu: Electron's standard menus, so copy, paste, zoom and reload keep working (on a
// Mac, Cmd+C and Cmd+V need the Edit menu), plus About and Reset Demo Data. The menu bar is always
// shown, so people can find them.
export const menuTemplate = ({ name, isMac, onAbout, onReset }) => {
  const about = { label: `About ${name}`, click: onAbout };
  const reset = { label: 'Reset Demo Data…', click: onReset };
  const standard = [{ role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }];
  if (isMac) {
    return [
      {
        label: name,
        submenu: [
          about,
          separator,
          reset,
          separator,
          { role: 'services' },
          separator,
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          separator,
          { role: 'quit' },
        ],
      },
      ...standard,
    ];
  }
  return [
    { label: 'File', submenu: [reset, separator, { role: 'quit' }] },
    ...standard,
    { role: 'help', submenu: [about] },
  ];
};
