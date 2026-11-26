/**
 * Turn captured screens into artboards of the design canvas.
 *
 *   node scripts/design/boards.ts [--index canvas.json] [board ...]
 *
 * Reads `design-out/screens/` (from `capture.ts`) and writes `design-out/canvas/project/<board>.dc.html`.
 * The stylesheet, fonts and images are uploads on the canvas, named in `uploads.json`. An image
 * drawn inline (a QR code, a wallet icon) is saved to `design-out/uploads/` and must be uploaded,
 * and its url added under `data`, before its board can be written.
 *
 * With `--index`, the canvas's current `project/canvas.json` is updated for the boards written:
 * size, title and page change, a board keeps where the owner placed it, a new one goes at the end
 * of its page's row. Everything else in the index is kept.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { BOARDS, type Board } from './screens.ts';

export type Uploads = {
  stylesheet: string;
  /** The bundled fonts: Chivo 400 and 600, Chivo Mono 400 and 500, Jersey 15. */
  fonts: { chivo400: string; chivo600: string; mono400: string; mono500: string; jersey: string };
  /** Images the app serves by path, by that path. */
  images: Record<string, string>;
  /** Images drawn inline as data: URIs, by the first 10 hex characters of their SHA-1. */
  data: Record<string, string>;
};

export type BoardEntry = { x: number; y: number; w: number; h: number; title: string; page: string; expand?: 'fill' };
export type CanvasIndex = { boards: Record<string, BoardEntry & Record<string, unknown>>; order: string[]; [key: string]: unknown };

const DESKTOP = 1280;
const PHONE = 390;
const VIEWPORT = 900;
const GAP = 80;

export const size = (board: Board, captured: number) => ({
  w: board.phone ? PHONE : DESKTOP,
  h: board.dialog ? VIEWPORT : captured,
});

const DATA_URI = /data:image\/(png|svg\+xml);base64,([A-Za-z0-9+/=]+)/g;

/** The inline images of a screen, keyed as in `Uploads.data`. */
export const inlineImages = (html: string) =>
  [...html.matchAll(DATA_URI)].map(([uri, type, b64]) => {
    const bytes = Buffer.from(b64, 'base64');
    return { uri, bytes, key: createHash('sha1').update(bytes).digest('hex').slice(0, 10), ext: type === 'png' ? 'png' : 'svg' };
  });

/** Point the screen's images at their uploads. Throws on an image not uploaded yet. */
export const resolveImages = (html: string, uploads: Uploads) => {
  let out = html;
  for (const img of inlineImages(html)) {
    const url = uploads.data[img.key];
    if (!url) throw new Error(`image ${img.key}.${img.ext} is not uploaded`);
    out = out.replace(img.uri, url);
  }
  for (const [path, url] of Object.entries(uploads.images)) {
    out = out.replaceAll(`src="${path}"`, `src="${url}"`).replaceAll(`srcset="${path}"`, `srcset="${url}"`);
  }
  const local = out.match(/src(?:set)?="\/(?!_blob\/)[^"]*"/);
  if (local) throw new Error(`image ${local[0]} has no upload in uploads.json`);
  if (out.includes('{{') || out.includes('}}')) throw new Error('the screen holds {{ or }}, which a board reads as a template hole');
  return out;
};

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The whole `.dc.html` of a board. */
export const artboard = (board: Board, body: string, h: number, uploads: Uploads) => {
  const { w } = size(board, h);
  const box = board.dialog ? `height: ${h}px; overflow: hidden; position: relative` : `min-height: ${h}px`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Stratum · ${escapeText(board.title)}</title>
<script src="./support.js"></script>
<link rel="stylesheet" href="${uploads.stylesheet}">
</head>
<body>
<x-dc>
<helmet>
<style>
@font-face{font-family:'Chivo';font-style:normal;font-display:swap;font-weight:400;src:url(${uploads.fonts.chivo400}) format('woff2')}
@font-face{font-family:'Chivo';font-style:normal;font-display:swap;font-weight:600;src:url(${uploads.fonts.chivo600}) format('woff2')}
@font-face{font-family:'Chivo Mono';font-style:normal;font-display:swap;font-weight:400;src:url(${uploads.fonts.mono400}) format('woff2')}
@font-face{font-family:'Chivo Mono';font-style:normal;font-display:swap;font-weight:500;src:url(${uploads.fonts.mono500}) format('woff2')}
@font-face{font-family:'Jersey 15';font-style:normal;font-display:swap;font-weight:400;src:url(${uploads.fonts.jersey}) format('woff2')}
body{margin:0}
</style>
</helmet>
<div class="bg-background text-foreground font-sans" style="${box}">
${body}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${w},"height":${h}}}'>
class Component extends DCLogic {
renderVals() {
return {};
}
}
</script>
</body>
</html>
`;
};

/** Update the index for these boards: sizes and titles, existing positions kept, new boards at the end of their row. */
export const updateIndex = (index: CanvasIndex, written: { board: Board; h: number }[]) => {
  const next: CanvasIndex = { ...index, boards: { ...index.boards }, order: [...index.order] };
  for (const { board, h } of written) {
    const key = `${board.name}.dc.html`;
    const { w } = size(board, h);
    const current = next.boards[key];
    const fields: Partial<BoardEntry> = { w, h, title: board.title, page: board.page };
    if (current) {
      const { expand: _drop, ...rest } = current;
      next.boards[key] = { ...rest, ...fields, ...(board.phone ? {} : { expand: 'fill' }) } as CanvasIndex['boards'][string];
      continue;
    }
    const row = Object.values(next.boards).filter((b) => b.page === board.page && b.y === 0);
    const x = row.reduce((end, b) => Math.max(end, b.x + b.w + GAP), 0);
    next.boards[key] = { x, y: 0, w, h, title: board.title, page: board.page, ...(board.phone ? {} : { expand: 'fill' as const }) };
    next.order.push(key);
  }
  return next;
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--index');
  const indexPath = at >= 0 ? args.splice(at, 2)[1] : undefined;
  const uploads: Uploads = JSON.parse(readFileSync(new URL('./uploads.json', import.meta.url), 'utf8'));
  const heights: Record<string, number> = JSON.parse(readFileSync('design-out/screens/heights.json', 'utf8'));
  const boards = BOARDS.filter((b) => (args.length ? args.includes(b.name) : existsSync(`design-out/screens/${b.name}.html`)));
  mkdirSync('design-out/canvas/project', { recursive: true });
  mkdirSync('design-out/uploads', { recursive: true });

  const written: { board: Board; h: number }[] = [];
  const toUpload = new Set<string>();
  for (const board of boards) {
    const html = readFileSync(`design-out/screens/${board.name}.html`, 'utf8');
    for (const img of inlineImages(html)) {
      if (uploads.data[img.key]) continue;
      writeFileSync(`design-out/uploads/${img.key}.${img.ext}`, img.bytes);
      toUpload.add(`design-out/uploads/${img.key}.${img.ext}`);
    }
    try {
      const h = size(board, heights[board.name]).h;
      writeFileSync(`design-out/canvas/project/${board.name}.dc.html`, artboard(board, resolveImages(html, uploads), h, uploads));
      written.push({ board, h });
    } catch (error) {
      console.error(`${board.name}: ${(error as Error).message}`);
    }
  }
  console.log(`wrote ${written.length} boards to design-out/canvas/project/`);
  if (indexPath) {
    const index = updateIndex(JSON.parse(readFileSync(indexPath, 'utf8')), written);
    writeFileSync('design-out/canvas/project/canvas.json', JSON.stringify(index, null, 1) + '\n');
    console.log('wrote design-out/canvas/project/canvas.json');
  }
  if (toUpload.size) {
    console.error(`upload to the canvas, add each url to "data" in scripts/design/uploads.json under its file name, run again:\n  ${[...toUpload].join('\n  ')}`);
    process.exit(1);
  }
}
