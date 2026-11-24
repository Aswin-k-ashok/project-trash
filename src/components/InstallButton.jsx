import { useEffect, useState } from 'react';
import { CloseIcon, DownloadIcon } from './icons';

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

// An icon button in the top bar. It only shows when pressing it can do
// something: open the browser's install prompt, or explain Safari's steps.
function InstallButton() {
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

  const canOfferInstall =
    !isInstalled && (Boolean(deferredInstallPrompt) || Boolean(manualInstallHelp));

  if (!canOfferInstall) {
    return null;
  }

  const installLabel = deferredInstallPrompt
    ? 'Install app'
    : manualInstallHelp.label;

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
    <div className="install">
      <button
        type="button"
        className="icon-button install__button"
        onClick={handleInstallClick}
        aria-label={installLabel}
        aria-expanded={deferredInstallPrompt ? undefined : isInstallHelpOpen}
        title={installLabel}
      >
        <DownloadIcon />
      </button>

      {isInstallHelpOpen && !deferredInstallPrompt && (
        <div className="install-help" role="status">
          <p>{manualInstallHelp.steps}</p>
          <button
            type="button"
            className="icon-button icon-button--round install-help__close"
            onClick={() => setIsInstallHelpOpen(false)}
            aria-label="Close install instructions"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

export default InstallButton;
