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
  const fonts = 'node_modules/@fontsource-variable';
  copyFileSync(`${fonts}/inter/files/inter-latin-wght-normal.woff2`, 'design-out/uploads/inter.woff2');
  copyFileSync(`${fonts}/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2`, 'design-out/uploads/jetbrains-mono.woff2');
  console.log('wrote design-out/uploads/stratum.css and the fonts');
}
