import { useEffect, useMemo, useState } from 'react';
import BinMap from './components/BinMap';

function App() {
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null);
  const [installMessage, setInstallMessage] = useState('');

  useEffect(() => {
    function handleBeforeInstallPrompt(event) {
      event.preventDefault();
      setDeferredInstallPrompt(event);
    }

    function handleAppInstalled() {
      setDeferredInstallPrompt(null);
      setInstallMessage('Installed');
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt
      );
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const isIosInstallHint = useMemo(() => {
    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    const userAgent = window.navigator.userAgent || '';
    const isIosDevice = /iPad|iPhone|iPod/.test(userAgent);
    const isSafari = /Safari/.test(userAgent) && !/CriOS|FxiOS/.test(userAgent);

    return isIosDevice && isSafari && !isStandalone;
  }, []);

  const installLabel = deferredInstallPrompt
    ? 'Install App'
    : isIosInstallHint
      ? 'Add to Home Screen'
      : installMessage || 'Install App';

  async function handleInstallClick() {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;

      if (outcome !== 'accepted') {
        setInstallMessage('Install Later');
      }

      setDeferredInstallPrompt(null);
      return;
    }

    if (isIosInstallHint) {
      setInstallMessage('Use Safari Share > Add to Home Screen');
    }
  }

  return (
    <main className="app-shell">
      <div className="app-glow app-glow--one" aria-hidden="true"></div>
      <div className="app-glow app-glow--two" aria-hidden="true"></div>

      <section className="hero-panel">
        <button
          type="button"
          className="hero-install-button"
          onClick={handleInstallClick}
          aria-label={installLabel}
          title={installLabel}
        >
          <span className="hero-install-button__icon" aria-hidden="true"></span>
          <span className="hero-install-button__label">{installLabel}</span>
        </button>

        <div className="hero-copy-block">
          <div className="hero-topline">
            <p className="eyebrow">Waste Bin Locator</p>
          </div>
          <h1>Find the nearest bin without breaking your stride.</h1>
          {/* <p className="hero-copy">
            A softer, cleaner map experience for locating bins, adding new ones,
            and sharing quick feedback as the app grows.
          </p> */}
        </div>

        {/* <div className="hero-metrics" aria-label="App highlights">
          <article className="metric-card">
            <span className="metric-card__label">Map-first</span>
            <strong>Fast local bin spotting</strong>
          </article>
          <article className="metric-card">
            <span className="metric-card__label">Community-led</span>
            <strong>Add public and private bins</strong>
          </article>
          <article className="metric-card">
            <span className="metric-card__label">Feedback-ready</span>
            <strong>Suggest improvements in-app</strong>
          </article>
        </div> */}
      </section>

      <section className="map-scroll-stage">
        <div className="map-card map-card--overlay">
          <div className="map-card__header">
            <div>
              <p className="map-card__eyebrow">Live Map</p>
              <h2>Bin discovery, reporting, and community feedback</h2>
            </div>
            <p className="map-card__summary">
              Explore nearby bins, add a new one in seconds, and keep the map
              improving over time.
            </p>
          </div>
          <BinMap />
        </div>
      </section>
    </main>
  );
}

export default App;
