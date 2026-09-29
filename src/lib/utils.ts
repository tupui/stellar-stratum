import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Open a page in a new tab that cannot reach back into this one (no window.opener). */
export const openExternal = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer');
};
