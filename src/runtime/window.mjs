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
