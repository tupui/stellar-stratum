// The loading screen leaves the moment the app renders. Kept out of index.html so the Content Security
// Policy does not need to allow inline scripts. The screen itself only shows after 300 ms (index.html), so
// a fast load never sees it, and nothing waits for its animation to finish.
(function () {
  const hide = () => {
    const loader = document.getElementById('app-loader');
    if (loader) loader.classList.add('hidden');
    document.body.classList.add('app-loaded');
  };
  const start = () => {
    const root = document.getElementById('root');
    if (!root) return hide();
    if (root.children.length > 0) return hide();
    const observer = new MutationObserver(() => {
      if (root.children.length > 0) {
        observer.disconnect();
        hide();
      }
    });
    observer.observe(root, { childList: true });
    // never get stuck behind the loader
    setTimeout(hide, 8000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
