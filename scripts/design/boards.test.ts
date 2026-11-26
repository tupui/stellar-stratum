import { describe, expect, it } from 'vitest';
import { artboard, inlineImages, resolveImages, size, updateIndex, type CanvasIndex, type Uploads } from './boards.ts';
import { BOARDS, PAGES } from './screens.ts';
import { withoutFontFaces } from './stylesheet.ts';

const uploads: Uploads = {
  stylesheet: '/_blob/css',
  fonts: { chivo400: '/_blob/c4', chivo600: '/_blob/c6', mono400: '/_blob/m4', mono500: '/_blob/m5', jersey: '/_blob/j' },
  images: { '/xlm-logo.png': '/_blob/xlm' },
  data: {},
};
const png = `data:image/png;base64,${Buffer.from('a png').toString('base64')}`;
const board = (name: string) => BOARDS.find((b) => b.name === name)!;

describe('screens', () => {
  it('names each board once, on a page of the canvas', () => {
    const names = BOARDS.map((b) => b.name);
    expect(new Set(names).size).toBe(names.length);
    const pages = new Set(PAGES.map((p) => p.id));
    BOARDS.forEach((b) => expect(pages.has(b.page)).toBe(true));
    names.forEach((n) => expect(n).toMatch(/^[a-z0-9][a-z0-9-]*$/));
  });
});

describe('images', () => {
  it('points inline images at their uploads, by hash', () => {
    const [img] = inlineImages(`<img src="${png}">`);
    const html = resolveImages(`<img src="${png}"><img src="/xlm-logo.png">`, { ...uploads, data: { [img.key]: '/_blob/qr' } });
    expect(html).toBe('<img src="/_blob/qr"><img src="/_blob/xlm">');
  });

  it('refuses an image without an upload', () => {
    expect(() => resolveImages(`<img src="${png}">`, uploads)).toThrow(/not uploaded/);
    expect(() => resolveImages('<img src="/ledger-logo.png">', uploads)).toThrow(/no upload/);
  });

  it('refuses text a board would read as a template hole', () => {
    expect(() => resolveImages('<p>{{ x }}</p>', uploads)).toThrow(/template hole/);
  });
});

describe('artboard', () => {
  it('links the uploads and sizes the board', () => {
    const html = artboard(board('dash-balances'), '<p>Balances</p>', 961, uploads);
    expect(html).toContain('<script src="./support.js"></script>');
    expect(html).toContain('<link rel="stylesheet" href="/_blob/css">');
    expect(html).toContain('url(/_blob/c4)');
    expect(html).toContain('style="min-height: 961px"');
    expect(html).toContain('"$preview":{"width":1280,"height":961}');
  });

  it('clips a dialog to one viewport and draws a phone board narrow', () => {
    expect(size(board('share-sent'), 2700)).toEqual({ w: 1280, h: 900 });
    expect(size(board('airgap-loaded-phone'), 1900)).toEqual({ w: 390, h: 1900 });
    expect(artboard(board('share-sent'), '', 900, uploads)).toContain('height: 900px; overflow: hidden');
  });
});

describe('index', () => {
  const index: CanvasIndex = {
    v: 3,
    title: 'Stratum design',
    boards: {
      'Main.dc.html': { x: 0, y: 0, w: 1280, h: 1000, title: 'Main', page: 'map' },
      'dash-balances.dc.html': { x: 500, y: 40, w: 1280, h: 800, title: 'Old', page: 'dashboard', expand: 'fill', radius: 8 },
      'dash-activity.dc.html': { x: 1360, y: 0, w: 1280, h: 1700, title: 'Activity', page: 'dashboard', expand: 'fill' },
    },
    order: ['Main.dc.html', 'dash-balances.dc.html', 'dash-activity.dc.html'],
    notes: { readme: { x: 0, y: 0, text: 'kept' } },
  };

  it('keeps where a board was placed and what else the index holds', () => {
    const next = updateIndex(index, [{ board: board('dash-balances'), h: 961 }]);
    expect(next.boards['dash-balances.dc.html']).toEqual({ x: 500, y: 40, w: 1280, h: 961, title: 'Balances', page: 'dashboard', expand: 'fill', radius: 8 });
    expect(next.notes).toEqual(index.notes);
    expect(next.order).toEqual(index.order);
  });

  it('puts a new board at the end of its page row', () => {
    const next = updateIndex(index, [{ board: board('dash-multisig'), h: 961 }]);
    expect(next.boards['dash-multisig.dc.html']).toMatchObject({ x: 2720, y: 0, w: 1280, h: 961, page: 'dashboard' });
    expect(next.order.at(-1)).toBe('dash-multisig.dc.html');
  });
});

describe('stylesheet', () => {
  it('drops the font faces only', () => {
    expect(withoutFontFaces('@font-face{font-family:x;src:url(a.woff2)}.a{color:red}')).toBe('.a{color:red}');
  });
});
