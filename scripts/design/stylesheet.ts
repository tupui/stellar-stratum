/**
 * The app's compiled stylesheet for the design canvas: `design-out/uploads/stratum.css`.
 *
 *   node scripts/design/stylesheet.ts
 *
 * Builds the app and keeps its CSS without the `@font-face` rules: the boards declare the fonts
 * themselves, from uploads. Upload the file to the canvas, put its url in `uploads.json` as
 * `stylesheet`, and write the boards again so they link it. Needed when the UI uses a class the
 * current upload does not have.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from 'vite';

export const withoutFontFaces = (css: string) => css.replace(/@font-face\{[^}]*\}/g, '');

if (import.meta.main) {
  await build({ build: { outDir: 'design-out/build', emptyOutDir: true }, logLevel: 'warn' });
  const assets = 'design-out/build/assets';
  const css = readdirSync(assets).filter((f) => f.endsWith('.css'));
  if (css.length !== 1) throw new Error(`expected one stylesheet in ${assets}, found ${css.length}`);
  mkdirSync('design-out/uploads', { recursive: true });
  writeFileSync('design-out/uploads/stratum.css', withoutFontFaces(readFileSync(`${assets}/${css[0]}`, 'utf8')));
  // the fonts the app bundles, one file per weight: upload each and name it in uploads.json `fonts`
  const fonts: Record<string, string> = {
    'chivo-400.woff2': 'node_modules/@fontsource/chivo/files/chivo-latin-400-normal.woff2',
    'chivo-600.woff2': 'node_modules/@fontsource/chivo/files/chivo-latin-600-normal.woff2',
    'chivo-mono-400.woff2': 'node_modules/@fontsource/chivo-mono/files/chivo-mono-latin-400-normal.woff2',
    'chivo-mono-500.woff2': 'node_modules/@fontsource/chivo-mono/files/chivo-mono-latin-500-normal.woff2',
    'jersey-15.woff2': 'node_modules/@fontsource/jersey-15/files/jersey-15-latin-400-normal.woff2',
  };
  for (const [name, from] of Object.entries(fonts)) copyFileSync(from, `design-out/uploads/${name}`);
  console.log('wrote design-out/uploads/stratum.css and the fonts');
}
