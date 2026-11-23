/**
 * Plain words for the protocol's names, so the UI never shows `set_options`,
 * `pathPaymentStrictSend` or `ed25519_public_key` as they come from Horizon or the SDK.
 */

/** `set_options` or `setOptions` → `Set options`. */
export const operationLabel = (type: string): string => {
  const words = type
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : type;
};

const SIGNER_TYPES: Record<string, string> = {
  ed25519_public_key: 'Ed25519 key',
  sha256_hash: 'Hash(x)',
  preauth_tx: 'Pre-authorized transaction',
  ed25519_signed_payload: 'Signed payload',
};

/** Horizon's signer type → what it is. */
export const signerTypeLabel = (type: string): string => SIGNER_TYPES[type] ?? operationLabel(type);
