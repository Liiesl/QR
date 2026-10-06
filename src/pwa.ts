// Plain SW registration (no virtual:pwa-register).
// Astro does not inject the vite-plugin-pwa register script, and
// virtual:pwa-register pulls workbox-window into the SSR bundle (Rolldown
// failure on Astro 7 + Vite 8). Manual registration of /sw.js is equivalent
// for registerType: autoUpdate (skipWaiting + clientsClaim are set in sw.js).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // SW registration is best-effort (e.g. insecure context).
    });
  });
}
