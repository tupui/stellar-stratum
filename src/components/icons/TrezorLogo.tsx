// Official Trezor shield mark, drawn with currentColor so it works on any theme.
export const TrezorLogo = ({ className }: { className?: string }) => (
  <svg
    viewBox="838 598 326 466"
    className={className}
    fill="currentColor"
    role="img"
    aria-label="Trezor logo"
  >
    <path d="M1110.94 709.38c0-57.48-49.89-105.2-110.62-105.2S889.7 651.9 889.7 709.38V743h-45.55v241.85h0l156.17 72.66 156.17-72.66h0V744.09h-45.55Zm-164.85 0c0-27.11 23.86-48.8 54.23-48.8s54.23 21.69 54.23 48.8V743H946.09Zm147.5 236.43-93.27 43.38-93.27-43.38V800.48h186.54Z" />
  </svg>
);
