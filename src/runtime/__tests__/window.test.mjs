import { describe, expect, it } from 'vitest';

import {
  aboutDetail,
  isAllowedPermission,
  isAppUrl,
  loadingPage,
  menuTemplate,
  opensExternally,
} from '../window';

describe('loadingPage', () => {
  it('is a data URL with the title and the loading text, HTML-escaped', () => {
    const url = loadingPage({ title: 'A & B', text: 'Starting <A>…' });

    expect(url.startsWith('data:text/html;charset=utf-8,')).toBe(true);
    const html = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));
    expect(html).toContain('<title>A &amp; B</title>');
    expect(html).toContain('<p>Starting &lt;A&gt;…</p>');
  });
});

describe('isAppUrl', () => {
  it('accepts pages of the app only', () => {
    expect(isAppUrl('http://127.0.0.1:4002/kci', 'http://127.0.0.1:4002/')).toBe(true);
    expect(isAppUrl('http://127.0.0.1:4001/', 'http://127.0.0.1:4002/')).toBe(false);
    expect(isAppUrl('https://example.com/', 'http://127.0.0.1:4002/')).toBe(false);
  });

  it('accepts nothing before the app has started', () => {
    expect(isAppUrl('http://127.0.0.1:4002/', undefined)).toBe(false);
  });
});

describe('opensExternally', () => {
  it('opens https links only', () => {
    expect(opensExternally('https://example.com/')).toBe(true);
    expect(opensExternally('http://example.com/')).toBe(false);
    expect(opensExternally('file:///C:/Windows')).toBe(false);
  });
});

describe('isAllowedPermission', () => {
  it('allows copying to the clipboard only', () => {
    expect(isAllowedPermission('clipboard-sanitized-write')).toBe(true);
    expect(isAllowedPermission('media')).toBe(false);
  });
});

describe('aboutDetail', () => {
  it('shows the version, the branch and commit, and the build time in UTC', () => {
    const build = {
      version: '1.2.3',
      branch: 'main',
      commit: '2a40250',
      builtAt: '2026-10-27T14:03:59.123Z',
    };

    expect(aboutDetail(build)).toBe(
      'Version 1.2.3\nBuilt from main@2a40250\nBuilt on 2026-10-27 14:03 UTC',
    );
  });

  it('leaves out what the build did not know', () => {
    expect(aboutDetail({ version: '1.2.3', commit: '2a40250' })).toBe(
      'Version 1.2.3\nBuilt from 2a40250',
    );
    expect(aboutDetail()).toBe('');
  });
});

describe('menuTemplate', () => {
  const onAbout = () => {};
  const onReset = () => {};

  it('keeps the standard Edit, View and Window menus', () => {
    [true, false].forEach((isMac) => {
      const roles = menuTemplate({ name: 'Acme', isMac, onAbout, onReset }).map((m) => m.role);

      expect(roles).toEqual(expect.arrayContaining(['editMenu', 'viewMenu', 'windowMenu']));
    });
  });

  it('puts About and Reset Demo Data in the app menu on a Mac', () => {
    const [appMenu] = menuTemplate({ name: 'Acme', isMac: true, onAbout, onReset });

    expect(appMenu.label).toBe('Acme');
    expect(appMenu.submenu[0]).toEqual({ label: 'About Acme', click: onAbout });
    expect(appMenu.submenu).toContainEqual({ label: 'Reset Demo Data…', click: onReset });
    expect(appMenu.submenu.at(-1)).toEqual({ role: 'quit' });
  });

  it('puts Reset Demo Data in File and About in Help on Windows', () => {
    const menu = menuTemplate({ name: 'Acme', isMac: false, onAbout, onReset });

    expect(menu[0]).toEqual({
      label: 'File',
      submenu: [
        { label: 'Reset Demo Data…', click: onReset },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
    expect(menu.at(-1)).toEqual({
      role: 'help',
      submenu: [{ label: 'About Acme', click: onAbout }],
    });
  });
});
