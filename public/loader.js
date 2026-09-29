// Loading screen shown until React renders. Kept out of index.html so the Content Security
// Policy does not need to allow inline scripts.
// Smart loading system that adapts to actual load time
let animationComplete = false;
let reactReady = false;
let preloadComplete = false;

// Preload critical resources during animation
function preloadResources() {
  const preloadPromises = [];

  // Preload critical fonts
  if (document.fonts && document.fonts.load) {
    preloadPromises.push(document.fonts.load("16px 'Inter Variable'"));
    preloadPromises.push(document.fonts.load("600 20px 'Inter Variable'"));
  }

  // Preload any critical images that might be used
  const criticalImages = [
    new URL('ledger-logo.png', document.currentScript.src).href,
    new URL('xlm-logo.png', document.currentScript.src).href
  ];

  criticalImages.forEach(src => {
    const img = new Image();
    img.src = src;
    const promise = new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve; // Don't fail if image doesn't exist
    });
    preloadPromises.push(promise);
  });

  // Complete preload after all resources or timeout
  Promise.allSettled(preloadPromises).then(() => {
    preloadComplete = true;
  });

  // Fallback timeout for preload
  setTimeout(() => {
    preloadComplete = true;
  }, 1000);
}

function setupNetworkAnimation() {
  const container = document.querySelector('.node-network');
  if (!container) return;
  const center = container.querySelector('.node.center');
  const nodes = Array.from(container.querySelectorAll('.node:not(.center)'));
  const connections = Array.from(container.querySelectorAll('.connection'));
  if (!center || nodes.length !== connections.length) return;

  const getCenter = (el) => {
    const cr = container.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - cr.left, y: r.top + r.height / 2 - cr.top };
  };

  // Keep updating connection geometry throughout the whole sequence
  let keepUpdating = true;
  // Allow extra time for center neon scale so lines stay attached
  setTimeout(() => { keepUpdating = false; }, 2200);

  const updateConnections = () => {
    const c = getCenter(center);
    nodes.forEach((node, i) => {
      const conn = connections[i];
      if (!conn) return;
      const n = getCenter(node);
      const dx = n.x - c.x;
      const dy = n.y - c.y;
      const dist = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      conn.style.left = `${c.x}px`;
      conn.style.top = `${c.y}px`;
      conn.style.transform = `rotate(${angle}deg)`;
      conn.style.width = `${dist}px`;
    });
    if (keepUpdating) requestAnimationFrame(updateConnections);
  };
  requestAnimationFrame(updateConnections);

  // 1.5s total animation - perfectly timed
  let idx = 0;
  const connectNext = () => {
    if (idx >= nodes.length) {
      // Check if we need to extend animation
      if (!reactReady) {
        // Extend with subtle pulse while waiting
        container.classList.add('neon-yellow');
        // Keep checking every 500ms
        const checkReady = () => {
          if (reactReady && preloadComplete) {
            animationComplete = true;
          } else {
            setTimeout(checkReady, 200);
          }
        };
        setTimeout(checkReady, 100);
      } else {
        animationComplete = true;
        container.classList.add('neon-yellow');
      }
      return;
    }
    const node = nodes[idx];
    const conn = connections[idx];
    // Freeze node at its current absolute px position
    const cr = container.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    node.style.left = `${r.left - cr.left}px`;
    node.style.top = `${r.top - cr.top}px`;
    node.style.transform = 'translate(0, 0)';
    node.classList.add('connected');
    conn.classList.add('active');
    idx += 1;
    setTimeout(connectNext, 130); // 9 * 130ms = 1170ms
  };

  // Start timing: 200ms + 1170ms + 130ms = 1500ms (1.5s)
  setTimeout(connectNext, 200);
}

// Start preloading and animation immediately
preloadResources();
setupNetworkAnimation();

// Handle hiding loader with smart timing
document.addEventListener('DOMContentLoaded', function() {
  const root = document.getElementById('root');
  const loader = document.getElementById('app-loader');

  const tryHide = () => {
    if (root && root.children.length > 0) {
      reactReady = true;

      // Only hide when both animation and preload are complete
      const finalHide = () => {
        if (animationComplete && preloadComplete) {
          document.body.classList.add('app-loaded');
          if (loader) {
            loader.classList.add('hidden');
            loader.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
            loader.style.opacity = '0';
            loader.style.transform = 'translateZ(0) scale(1.02)';
            // Keep loader in DOM but invisible and non-interactive
            setTimeout(() => {
              loader.style.visibility = 'hidden';
            }, 600);
          }
          return true;
        }
        return false;
      };

      if (!finalHide()) {
        // Check every 100ms until ready
        const checkInterval = setInterval(() => {
          if (finalHide()) {
            clearInterval(checkInterval);
          }
        }, 100);
      }
      return true;
    }
    return false;
  };

  if (!tryHide()) {
    const observer = new MutationObserver(() => {
      if (tryHide()) observer.disconnect();
    });
    if (root) observer.observe(root, { childList: true, subtree: true });
  }

  // Absolute fallback - never get stuck
  setTimeout(() => {
    reactReady = true;
    animationComplete = true;
    preloadComplete = true;
    document.body.classList.add('app-loaded');
    if (loader) {
      loader.classList.add('hidden');
      loader.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out';
      loader.style.opacity = '0';
      loader.style.transform = 'translateZ(0) scale(1.02)';
      setTimeout(() => {
        loader.style.visibility = 'hidden';
      }, 400);
    }
  }, 8000); // 8s absolute maximum
});
