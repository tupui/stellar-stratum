// @trezor/connect-plugin-stellar 9.2.6 imports an undeclared private path.
// Re-export the same symbol through @trezor/utils' supported public entrypoint.
export { BigNumber } from '@trezor/utils/lib/bigNumber';