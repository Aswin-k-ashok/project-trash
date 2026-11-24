import { useEffect, useState } from 'react';
import { MaximizeIcon, MinimizeIcon } from './icons';

// Safari on iPad and older Macs only has the webkit-prefixed names.
function getFullscreenElement() {
  return document.fullscreenElement ?? document.webkitFullscreenElement ?? null;
}

function canGoFullscreen() {
  const root = document.documentElement;
  const isEnabled = document.fullscreenEnabled ?? document.webkitFullscreenEnabled;

  return Boolean(isEnabled && (root.requestFullscreen || root.webkitRequestFullscreen));
}

// Hides the browser's address bar and buttons, so the map gets the whole
// screen. iPhone browsers don't allow this for web pages, so the button only
// shows where it works; there, installing the app comes closest.
function FullscreenButton() {
  const [isSupported] = useState(canGoFullscreen);
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(getFullscreenElement()));

  useEffect(() => {
    // Also catches leaving full screen with Esc or the phone's back gesture.
    function handleChange() {
      setIsFullscreen(Boolean(getFullscreenElement()));
    }

    document.addEventListener('fullscreenchange', handleChange);
    document.addEventListener('webkitfullscreenchange', handleChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleChange);
      document.removeEventListener('webkitfullscreenchange', handleChange);
    };
  }, []);

  if (!isSupported) {
    return null;
  }

  async function handleClick() {
    try {
      if (getFullscreenElement()) {
        const exit = document.exitFullscreen ?? document.webkitExitFullscreen;
        await exit.call(document);
      } else {
        const root = document.documentElement;
        const enter = root.requestFullscreen ?? root.webkitRequestFullscreen;
        // navigationUI: 'hide' asks Android to hide its navigation bar too.
        await enter.call(root, { navigationUI: 'hide' });
      }
    } catch {
      // The browser said no (for example, a policy blocks it). Nothing to undo.
    }
  }

  const label = isFullscreen ? 'Exit full screen' : 'Full screen';

  return (
    <button
      type="button"
      className="icon-button"
      onClick={handleClick}
      aria-label={label}
      title={label}
    >
      {isFullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
    </button>
  );
}

export default FullscreenButton;
