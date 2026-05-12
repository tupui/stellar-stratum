## Dependency Upgrade Plan

Most dependencies are already at the latest version. The following are outdated:

### Minor / patch upgrades (safe)
- `@creit-tech/stellar-wallets-kit` 2.1.0 → 2.2.0
- `@stellar/stellar-sdk` 15.0.1 → 15.1.0
- `@typescript-eslint/parser` 8.50.0 → 8.59.3
- `eslint` 10.2.1 → 10.3.0
- `tailwindcss` 4.2.4 → 4.3.0

### Major upgrade (potentially breaking)
- `react-day-picker` 9.14.0 → 10.0.0 — major bump; v10 changes the className/styling API. Project uses it in `src/components/ui/calendar.tsx` (shadcn wrapper). I'll review the v10 migration notes and adjust the wrapper if needed.

### Steps
1. Run `ncu -u` then `bun install` to update `package.json` and lockfile.
2. Verify build passes; fix any breakage from `react-day-picker` v10.
3. Smoke-test the preview (calendar/date pickers if used, wallet connect, swap).

### Notes
- `usb` override is preserved.
- No runtime API key or env changes required.