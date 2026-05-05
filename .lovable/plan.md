## Goal

Tighten the codebase before release: remove all unused files, components, and npm dependencies; simplify the wallet-kit module that exists only to dodge a build failure; confirm a clean production build.

## Audit findings (read-only)

### Unused source files (zero importers in `src/`)
- `src/components/ui/enhanced-skeleton.tsx`
- `src/lib/enhanced-cache.ts`
- `src/lib/orderbook-pricing.ts`
- `src/lib/empty-module.ts` — superseded by the `usb` `overrides` in `package.json`
- `src/lib/walletConfig.ts` — only feeds the dead Trezor/WalletConnect branch in `walletKit.ts` (configs are hardcoded empty)

### Unused shadcn/ui components (24 files, 0 importers each)
accordion, alert-dialog, aspect-ratio, avatar, breadcrumb, carousel, chart, command, context-menu, drawer, dropdown-menu, enhanced-skeleton, form, hover-card, input-otp, menubar, navigation-menu, pagination, progress, radio-group, resizable, scroll-area, sidebar, table

### Unused npm dependencies (no `src/` imports)
Confirmed zero usage:
- `lovable-tagger` (componentTagger plugin already commented out in `vite.config.ts`)
- `@creit.tech/sorobandomains-sdk` (project uses its own `src/lib/soroban-domains.ts`)
- `react-is`

Used **only** by unused UI components above (safe to drop together with those files):
- `embla-carousel-react` (carousel) · `react-resizable-panels` (resizable) · `cmdk` (command) · `input-otp` · `react-day-picker` (calendar — but `calendar.tsx` IS used; **keep** `react-day-picker`) · `vaul` (drawer) · `recharts` (chart) · `qrcode.react` (only ui/sidebar — confirm; app uses `qrcode` + `jsqr`)
- Radix packages tied to unused UI files: `@radix-ui/react-accordion`, `react-alert-dialog`, `react-aspect-ratio`, `react-avatar`, `react-context-menu`, `react-dropdown-menu`, `react-hover-card`, `react-menubar`, `react-navigation-menu`, `react-progress`, `react-radio-group`, `react-scroll-area`

Verify before drop (each step preceded by a final `rg`):
- `react-day-picker` is needed (calendar.tsx is used).
- `recharts` only appears in unused `ui/chart.tsx` — drop with chart.

### `src/lib/walletKit.ts` simplification

Current file uses variable-based dynamic imports + `@vite-ignore` to dodge bundler analysis of optional Trezor / WalletConnect modules — but `walletConfig.ts` hardcodes empty values so those branches are dead. Replace with:

```ts
import { StellarWalletsKit } from '@creit-tech/stellar-wallets-kit/sdk';
import { defaultModules } from '@creit-tech/stellar-wallets-kit/modules/utils';
import { LedgerModule } from '@creit-tech/stellar-wallets-kit/modules/ledger';

StellarWalletsKit.init({ modules: [...defaultModules(), new LedgerModule()] });
export { StellarWalletsKit };
```

This eliminates the hack and the original Trezor build failure root cause.

### `vite.config.ts` cleanup
- Remove `usb` alias and delete `src/lib/empty-module.ts` (overrides handle it).
- Remove commented-out `componentTagger` plugin line, the `mode` arg, and `.filter(Boolean)`.
- Remove `@trezor/*` and `…/modules/trezor` entries from `optimizeDeps.exclude`.
- Keep `manualChunks` but drop now-irrelevant chunks (e.g. `charts` for recharts).

### Other
- Delete committed `tsconfig.app.tsbuildinfo` and `tsconfig.node.tsbuildinfo` build artifacts; ensure `.gitignore` covers them.

## Plan

1. Delete dead source files (5 lib/component files listed above).
2. Delete the 24 unused shadcn UI files.
3. Rewrite `src/lib/walletKit.ts` to the 4-line version.
4. Clean `vite.config.ts` (alias, plugin comment, optimizeDeps, manualChunks).
5. Prune `package.json` deps confirmed unused (each re-checked with `rg` immediately before removal):
   - `lovable-tagger`, `@creit.tech/sorobandomains-sdk`, `react-is`
   - `embla-carousel-react`, `react-resizable-panels`, `cmdk`, `input-otp`, `vaul`, `recharts`, `qrcode.react`
   - 12 unused `@radix-ui/*` packages listed above
6. Remove committed `tsconfig.*.tsbuildinfo` files.
7. Run `bun install` then `bun run build`; fix any fallout.
8. Smoke check: landing renders, Freighter connect works, sign flow loads, console silent.

## Out of scope

- No feature changes, no styling changes, no major version bumps beyond what's already current.
- Keep wallet set as `defaultModules()` + Ledger.
