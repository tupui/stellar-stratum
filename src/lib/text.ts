/**
 * Control, format (bidi overrides, zero-width) and line/paragraph separator characters. They
 * are invisible or reorder what is shown, so "54321" can display as "12345".
 */
const UNSAFE_CHARS = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/**
 * Text that someone else wrote (memos, home domains, data entries, contract strings), made safe
 * to read: every invisible or reordering character is replaced by a visible ⟨U+XXXX⟩ marker.
 */
export const revealUnsafeChars = (text: string): { text: string; unsafe: boolean } => {
  let unsafe = false;
  const shown = text.replace(UNSAFE_CHARS, (char) => {
    unsafe = true;
    return `⟨U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟩`;
  });
  return { text: shown, unsafe };
};

/** Strict UTF-8: null when the bytes are not valid text instead of silently replacing them. */
export const decodeUtf8 = (bytes: Uint8Array): string | null => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

export const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export const isAscii = (text: string): boolean => /^[\x20-\x7e]*$/.test(text);
