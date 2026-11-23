/**
 * Capture the app's screens for the design canvas, on TESTNET only.
 *
 *   node scripts/design/capture.ts                 every screen
 *   node scripts/design/capture.ts sign dash-balances   only these flows or boards
 *   node scripts/design/capture.ts --shots         and a screenshot of each, in design-out/shots/
 *
 * Starts the app with Vite, opens it in Chromium with every mainnet host blocked, funds throwaway
 * accounts with friendbot, and walks the flows of `screens.ts`. Each screen is saved, cleaned, as
 * `design-out/screens/<board>.html` with its height in `design-out/screens/heights.json`. Then
 * `boards.ts` turns them into artboards.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'vite';
import { FLOWS, type Ctx } from './screens.ts';
import { guardMainnet, setupAccounts } from './testnet.ts';

const OUT = 'design-out/screens';

/** Runs in the page: the rendered body as markup a board can hold. */
const cleanBody = () => {
  const live = document.body;
  live.querySelectorAll('input').forEach((i) => {
    if (i.type === 'checkbox' || i.type === 'radio') i.toggleAttribute('checked', i.checked);
    else i.setAttribute('value', i.value);
  });
  live.querySelectorAll('textarea').forEach((t) => (t.textContent = t.value));
  const root = live.cloneNode(true) as HTMLElement;
  // The pre-React loader of index.html: its styles are inline there, not in the stylesheet
  root.querySelector('#app-loader')?.remove();
  root.querySelectorAll('script,style,link,noscript,iframe,template,canvas,.sr-only').forEach((n) => n.remove());
  root.querySelectorAll('[role="tabpanel"][data-state="inactive"],[style*="display: none"]').forEach((n) => n.remove());
  root.querySelectorAll('[role="region"][aria-label^="Notifications"]').forEach((n) => {
    if (!n.querySelector('li')) n.remove();
  });
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((c) => c.parentNode?.removeChild(c));
  const keep = new Set(['class', 'style', 'href', 'src', 'alt', 'type', 'placeholder', 'value', 'aria-label', 'title', 'disabled', 'checked', 'for', 'name', 'target', 'rel', 'readonly', 'rows', 'role', 'aria-selected', 'aria-checked', 'aria-expanded', 'data-state', 'data-orientation', 'data-side']);
  root.querySelectorAll('*').forEach((el) => {
    const svg = el.namespaceURI === 'http://www.w3.org/2000/svg';
    for (const a of [...el.attributes]) {
      const drop = svg ? a.name === 'id' || a.name.startsWith('data-') : !keep.has(a.name);
      if (drop) el.removeAttribute(a.name);
    }
    if (el.tagName === 'A' && el.getAttribute('href')?.startsWith('/')) el.setAttribute('href', '#');
  });
  return {
    html: root.innerHTML.replace(/\n\s*\n/g, '\n').trim(),
    height: Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)),
  };
};

const args = process.argv.slice(2);
/** `--shots`: also save a full-page screenshot of each screen, in `design-out/shots/`. */
const shots = args.includes('--shots');
const only = args.filter((a) => a !== '--shots');
const flows = only.length
  ? FLOWS.filter((f) => only.includes(f.name) || f.boards.some((b) => only.includes(b.name)))
  : FLOWS;
const wanted = (board: string, flow: string) => !only.length || only.includes(board) || only.includes(flow);
if (!flows.length) throw new Error(`no flow or board named ${only.join(', ')}`);

mkdirSync(OUT, { recursive: true });
if (shots) mkdirSync('design-out/shots', { recursive: true });
const heightsFile = `${OUT}/heights.json`;
const heights: Record<string, number> = existsSync(heightsFile) ? JSON.parse(readFileSync(heightsFile, 'utf8')) : {};

const server = await createServer({ server: { port: 5191, strictPort: false, forwardConsole: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls!.local[0].replace(/\/$/, '');
// A fake camera, so the QR scanner shows its scanning state instead of a camera error.
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const failed: string[] = [];
const blocked = new Set<string>();

try {
  const accounts = await setupAccounts();
  for (const flow of flows) {
    const context = await browser.newContext({
      viewport: flow.phone ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      permissions: ['clipboard-read', 'clipboard-write', 'camera'],
    });
    (await guardMainnet(context)).forEach((h) => blocked.add(h));
    const page = await context.newPage();
    const shot: Ctx['shot'] = async (name, ready) => {
      try {
        await ready();
        // The splash of index.html stays at least 1.5 s, then fades
        await page.waitForFunction(() => {
          const loader = document.getElementById('app-loader');
          return !loader || getComputedStyle(loader).visibility === 'hidden';
        }, null, { timeout: 15_000 });
        if (!wanted(name, flow.name)) return;
        await page.waitForTimeout(600);
        const { html, height } = await page.evaluate(cleanBody);
        writeFileSync(`${OUT}/${name}.html`, html);
        if (shots) await page.screenshot({ path: `design-out/shots/${name}.png`, fullPage: true });
        heights[name] = height;
        console.log(`captured ${name} (${height} px)`);
      } catch (error) {
        failed.push(name);
        console.error(`FAILED ${name}: ${(error as Error).message.split('\n')[0]}`);
      }
    };
    try {
      await flow.run({ page, base, accounts, shot });
    } catch (error) {
      failed.push(flow.name);
      console.error(`FAILED flow ${flow.name}: ${(error as Error).message.split('\n')[0]}`);
    }
    await context.close();
  }
} finally {
  writeFileSync(heightsFile, JSON.stringify(heights, null, 1) + '\n');
  await browser.close();
  await server.close();
}

if (blocked.size) console.log(`mainnet requests aborted: ${[...blocked].join(', ')}`);
if (failed.length) {
  console.error(`not captured: ${failed.join(', ')}`);
  process.exit(1);
}
