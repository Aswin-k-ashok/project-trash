import { useEffect, useState } from 'react';
import BinMap from './components/BinMap';

function isRunningInstalled() {
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true
  );
}

// Browsers without an install prompt that can still install the app by hand.
// Returns the button label and instructions, or null when there's no way.
function getManualInstallHelp() {
  const userAgent = window.navigator.userAgent || '';
  // iPadOS reports itself as a Mac, but has a touch screen.
  const isIos =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && window.navigator.maxTouchPoints > 1);
  const isSafari =
    /Safari/.test(userAgent) &&
    !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\/|OPiOS|OPR\/|Firefox/.test(userAgent);

  if (isIos && isSafari) {
    return {
      label: 'Add to Home Screen',
      steps: 'Tap the Share button in Safari, then choose “Add to Home Screen”.',
    };
  }

  if (/Macintosh/.test(userAgent) && isSafari) {
    return {
      label: 'Add to Dock',
      steps: 'In the Safari menu bar, choose File › Add to Dock.',
    };
  }

  return null;
}

function App() {
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(isRunningInstalled);
  const [isInstallHelpOpen, setIsInstallHelpOpen] = useState(false);
  const [manualInstallHelp] = useState(getManualInstallHelp);

  useEffect(() => {
    function handleBeforeInstallPrompt(event) {
      event.preventDefault();
      setDeferredInstallPrompt(event);
    }

    function handleAppInstalled() {
      setDeferredInstallPrompt(null);
      setIsInstalled(true);
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

  // Only offer the button when pressing it can do something: show the
  // browser's install prompt, or explain the manual steps.
  const canOfferInstall =
    !isInstalled && (Boolean(deferredInstallPrompt) || Boolean(manualInstallHelp));
  const installLabel = deferredInstallPrompt
    ? 'Install App'
    : manualInstallHelp?.label;

  async function handleInstallClick() {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      // A prompt can only be used once. If it was dismissed, the browser may
      // offer a new one later, and the button comes back then.
      setDeferredInstallPrompt(null);
      return;
    }

    setIsInstallHelpOpen((isOpen) => !isOpen);
  }

  return (
    <main className="app-shell">
      <div className="app-glow app-glow--one" aria-hidden="true"></div>
      <div className="app-glow app-glow--two" aria-hidden="true"></div>

      <section className="hero-panel">
        {canOfferInstall && (
          <div className="hero-install">
            <button
              type="button"
              className="hero-install-button"
              onClick={handleInstallClick}
              aria-label={installLabel}
              aria-expanded={deferredInstallPrompt ? undefined : isInstallHelpOpen}
              title={installLabel}
            >
              <span className="hero-install-button__icon" aria-hidden="true"></span>
              <span className="hero-install-button__label">{installLabel}</span>
            </button>

            {isInstallHelpOpen && !deferredInstallPrompt && (
              <div className="install-help" role="status">
                <p>{manualInstallHelp.steps}</p>
                <button
                  type="button"
                  className="install-help__close"
                  onClick={() => setIsInstallHelpOpen(false)}
                  aria-label="Close install instructions"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        )}

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

      <section className="map-section">
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
