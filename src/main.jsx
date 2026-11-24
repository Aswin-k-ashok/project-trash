import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Inter, bundled with the app: no request to a font service, and it works offline.
import '@fontsource-variable/inter';
import './index.css';

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Installability matters more than noisy errors here.
      });
    });
  } else {
    // A worker left over from an earlier session would serve cached copies of
    // Vite's dev modules, so a reload could run old code. Remove it in dev.
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations
        .filter((registration) =>
          registration.active?.scriptURL.endsWith('/sw.js')
        )
        .forEach((registration) => registration.unregister());
    });

    window.caches
      ?.keys()
      .then((cacheNames) =>
        cacheNames
          .filter((cacheName) => cacheName.startsWith('bin-there-'))
          .forEach((cacheName) => window.caches.delete(cacheName))
      );
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
