import { describe, expect, it } from 'vitest';

import { isAllowedPermission, isAppUrl, loadingPage, opensExternally } from '../window';

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
