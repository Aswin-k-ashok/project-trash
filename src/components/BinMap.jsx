import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { DEFAULT_CENTER, DEFAULT_ZOOM } from '../config';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

const BIN_TYPE_PUBLIC = 'public';
const BIN_TYPE_PRIVATE = 'private';
const BIN_TYPE_LABELS = {
  [BIN_TYPE_PUBLIC]: 'Public',
  [BIN_TYPE_PRIVATE]: 'Private',
};

function getBinType(binType) {
  return binType === BIN_TYPE_PRIVATE ? BIN_TYPE_PRIVATE : BIN_TYPE_PUBLIC;
}

// Same limits as the database checks in supabase/schema.sql.
const MAX_TITLE_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_FEEDBACK_NAME_LENGTH = 80;
const MAX_FEEDBACK_LENGTH = 2000;

// How long a click waits to see whether it is the first half of a double-click.
const DOUBLE_CLICK_WINDOW_MS = 300;
// Close enough to see individual streets and the bins on them.
const STREET_ZOOM = 16;
// Supabase returns at most 1000 rows per request unless the project says otherwise.
const BINS_PAGE_SIZE = 1000;
// Nominatim's usage policy allows at most one request per second.
const PLACE_LOOKUP_DELAY_MS = 1000;
const SUCCESS_MESSAGE_MS = 4000;
const FEEDBACK_CLOSE_DELAY_MS = 1200;

const IS_APPLE_DEVICE = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

function createTrashBinIcon(binType, { isDraft = false } = {}) {
  const draftClass = isDraft ? ' trash-bin-marker--draft' : '';

  return L.divIcon({
    className: 'trash-bin-marker-wrapper',
    html: `
      <div class="trash-bin-marker trash-bin-marker--${binType}${draftClass}" aria-hidden="true">
        <span class="trash-bin-marker__emoji">&#128465;</span>
      </div>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
    popupAnchor: [0, -28],
  });
}

// Built once and shared. react-leaflet replaces a marker's icon whenever the
// icon object changes, so a new object per render rebuilt every marker.
const BIN_ICONS = {
  [BIN_TYPE_PUBLIC]: createTrashBinIcon(BIN_TYPE_PUBLIC),
  [BIN_TYPE_PRIVATE]: createTrashBinIcon(BIN_TYPE_PRIVATE),
};

const DRAFT_BIN_ICONS = {
  [BIN_TYPE_PUBLIC]: createTrashBinIcon(BIN_TYPE_PUBLIC, { isDraft: true }),
  [BIN_TYPE_PRIVATE]: createTrashBinIcon(BIN_TYPE_PRIVATE, { isDraft: true }),
};

const userLocationIcon = L.divIcon({
  className: 'user-location-marker-wrapper',
  html: '<div class="user-location-marker" aria-hidden="true"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

// Great-circle distance in metres (haversine formula).
function getDistanceInMeters(from, to) {
  const earthRadius = 6371000;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) *
      Math.cos(toRadians(to.lat)) *
      Math.sin(deltaLng / 2) ** 2;

  return 2 * earthRadius * Math.asin(Math.sqrt(a));
}

function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  }

  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

// Opens walking directions in Google Maps, or its app on phones. It's a plain
// link, so there's no API key or cost.
function getDirectionsUrl(bin) {
  const destination = encodeURIComponent(`${bin.latitude},${bin.longitude}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=walking`;
}

// When a popup opens near an edge, Leaflet pans the map to fit it. These
// margins also keep it clear of the floating messages (top), the map buttons
// (right) and the feedback button (bottom).
const POPUP_PAN_PADDING_TOP_LEFT = [12, 96];
const POPUP_PAN_PADDING_BOTTOM_RIGHT = [64, 72];

// Place names already looked up, keyed by the map centre rounded to about 1 km.
const placeNameCache = new Map();

// Leaflet also fires `click` for a tap that only closes a popup and for both
// halves of a double-click zoom. Those should not open the add-bin form.
function AddBinOnClick({ onAdd }) {
  const pendingClickRef = useRef(null);
  const popupJustClosedRef = useRef(false);

  useEffect(() => () => window.clearTimeout(pendingClickRef.current), []);

  function cancelPendingClick() {
    window.clearTimeout(pendingClickRef.current);
    pendingClickRef.current = null;
  }

  useMapEvents({
    popupclose() {
      // A tap that closes a popup fires `popupclose` and then `click` in the
      // same event dispatch, so the flag only needs to last until the next task.
      popupJustClosedRef.current = true;
      window.setTimeout(() => {
        popupJustClosedRef.current = false;
      }, 0);
    },
    click(event) {
      if (popupJustClosedRef.current) {
        return;
      }

      if (pendingClickRef.current) {
        // Second click of a double-click: let Leaflet zoom instead.
        cancelPendingClick();
        return;
      }

      // wrap() keeps longitude within -180..180 after panning past the date line.
      const latlng = event.latlng.wrap();

      pendingClickRef.current = window.setTimeout(() => {
        pendingClickRef.current = null;
        onAdd(latlng);
      }, DOUBLE_CLICK_WINDOW_MS);
    },
    dblclick: cancelPendingClick,
  });

  return null;
}

// Leaflet only measures its container on window resize. Entering or leaving
// full screen resizes the container without one, so watch it directly.
function MapSizeWatcher() {
  const map = useMap();

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());

    return () => observer.disconnect();
  }, [map]);

  return null;
}

function MapCenterTracker({ onCenterChange }) {
  const map = useMapEvents({
    moveend() {
      const center = map.getCenter();
      onCenterChange({
        lat: center.lat,
        lng: center.lng,
      });
    },
  });

  return null;
}

function MapController({ targetLocation }) {
  const map = useMap();

  useEffect(() => {
    if (!targetLocation) {
      return;
    }

    // Zoom in to street level, but never zoom out if the user is already closer.
    map.flyTo(
      [targetLocation.lat, targetLocation.lng],
      Math.max(map.getZoom(), STREET_ZOOM),
      { duration: 1.2 }
    );
  }, [map, targetLocation]);

  return null;
}

function getMissingFunctionMessage(functionName) {
  return `Supabase cannot find the '${functionName}' function. Run the latest SQL from supabase/schema.sql in your Supabase SQL Editor, then refresh the app.`;
}

function getSupabaseErrorMessage(error, fallbackMessage) {
  if (!error) {
    return fallbackMessage;
  }

  if (error.code === 'PGRST205') {
    return "Supabase cannot find the 'bins' table. Run the SQL from supabase/schema.sql in your Supabase SQL Editor, then refresh the app.";
  }

  if (error.code === '23514') {
    return 'Some of the details were not accepted, for example text that is too long. Please check them and try again.';
  }

  const missingColumnMatch = error.message?.match(
    /Could not find the '([^']+)' column of 'bins' in the schema cache/i
  );

  if (missingColumnMatch) {
    const missingColumn = missingColumnMatch[1];

    return `Your Supabase 'bins' table is missing the '${missingColumn}' column. Run the latest SQL from supabase/schema.sql in the Supabase SQL Editor, then try again after the schema cache refreshes.`;
  }

  return error.message || fallbackMessage;
}

function getMissingBinColumn(error) {
  const missingColumnMatch = error?.message?.match(
    /Could not find the '([^']+)' column of 'bins' in the schema cache/i
  );

  return missingColumnMatch ? missingColumnMatch[1] : null;
}

function getDeleteErrorMessage(error) {
  if (error?.code === 'PGRST202') {
    return getMissingFunctionMessage('delete_bin');
  }

  return getSupabaseErrorMessage(
    error,
    'Could not delete the bin. Please try again.'
  );
}

function getEditErrorMessage(error) {
  if (error?.code === 'PGRST202') {
    return getMissingFunctionMessage('update_bin');
  }

  return getSupabaseErrorMessage(
    error,
    'Could not save your changes. Please try again.'
  );
}

function getFeedbackErrorMessage(error) {
  if (error?.code === 'PGRST205') {
    return "Supabase cannot find the 'app_feedback' table. Run the latest SQL from supabase/schema.sql in your Supabase SQL Editor, then refresh the app.";
  }

  return error?.message || 'Could not submit your feedback right now.';
}

function buildBinPayload(
  draftBin,
  {
    includeBinType = true,
    includeOptionalFields = true,
  } = {}
) {
  const payload = {
    latitude: draftBin.latitude,
    longitude: draftBin.longitude,
  };

  if (includeBinType) {
    payload.bin_type = getBinType(draftBin.binType);
  }

  if (includeOptionalFields) {
    payload.title = draftBin.title.trim() || null;
    payload.description = draftBin.description.trim() || null;
  }

  return payload;
}

// Supabase caps every response (1000 rows by default), so the table is read a
// page at a time; otherwise the oldest bins would silently go missing.
async function fetchAllBins(signal) {
  const allBins = [];

  for (;;) {
    const { data, error, count } = await supabase
      .from('bins')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id')
      .range(allBins.length, allBins.length + BINS_PAGE_SIZE - 1)
      .abortSignal(signal);

    if (error) {
      return { data: null, error };
    }

    allBins.push(...data);

    const hasEverything =
      data.length === 0 || (count !== null && allBins.length >= count);

    if (hasEverything) {
      return { data: allBins, error: null };
    }
  }
}

// Memoized so that moving the map or typing in a form doesn't re-render every
// marker and popup. Callbacks passed in must be stable.
const BinMarker = memo(function BinMarker({
  bin,
  distance,
  isDeleting,
  onEdit,
  onDelete,
  registerMarker,
}) {
  const position = useMemo(
    () => [bin.latitude, bin.longitude],
    [bin.latitude, bin.longitude]
  );
  const markerRef = useCallback(
    (marker) => registerMarker(bin.id, marker),
    [bin.id, registerMarker]
  );
  const binType = getBinType(bin.bin_type);
  const title = bin.title || 'Waste bin';

  return (
    <Marker
      ref={markerRef}
      position={position}
      icon={BIN_ICONS[binType]}
      // Leaflet gives markers role="button"; the title is their accessible name.
      title={`${title}, ${BIN_TYPE_LABELS[binType].toLowerCase()} bin`}
    >
      <Popup
        autoPanPaddingTopLeft={POPUP_PAN_PADDING_TOP_LEFT}
        autoPanPaddingBottomRight={POPUP_PAN_PADDING_BOTTOM_RIGHT}
      >
        <div className="popup-content">
          <div className="popup-content__header">
            <strong>{title}</strong>
            <span className={`popup-bin-type popup-bin-type--${binType}`}>
              {BIN_TYPE_LABELS[binType]}
            </span>
          </div>
          <p className="popup-content__description">
            {bin.description || 'No description added.'}
          </p>
          <div className="popup-content__meta">
            {distance !== null && (
              <span className="popup-content__distance">
                {formatDistance(distance)} from you
              </span>
            )}
            <span className="popup-content__label">Coordinates</span>
            <small>
              {bin.latitude.toFixed(5)}, {bin.longitude.toFixed(5)}
            </small>
          </div>
          <a
            className="button popup-button"
            href={getDirectionsUrl(bin)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Directions
          </a>
          <div className="popup-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => onEdit(bin)}
            >
              Edit
            </button>
            <button
              type="button"
              className="button button-danger"
              onClick={() => onDelete(bin.id)}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </Popup>
    </Marker>
  );
});

function BinMap() {
  const [bins, setBins] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingBinId, setDeletingBinId] = useState(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [mapCenter, setMapCenter] = useState(DEFAULT_CENTER);
  const [placeName, setPlaceName] = useState('Kochi, Kerala');
  // A bin being added, or being edited when it has an `id`.
  const [draftBin, setDraftBin] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [isNearestBinDismissed, setIsNearestBinDismissed] = useState(false);
  const [showScrollHint, setShowScrollHint] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackForm, setFeedbackForm] = useState({
    name: '',
    feedback: '',
  });
  // { tone: 'success' | 'error', text } or null
  const [feedbackStatus, setFeedbackStatus] = useState(null);

  const mapRef = useRef(null);
  const mapStageRef = useRef(null);
  const binFormRef = useRef(null);
  const markerRefs = useRef(new Map());
  const deletingBinIdRef = useRef(null);
  const focusFormOnOpenRef = useRef(false);
  const feedbackTriggerRef = useRef(null);
  const feedbackDialogRef = useRef(null);
  const feedbackCloseTimerRef = useRef(null);

  const isEditing = Boolean(draftBin?.id);
  const isDraftOpen = draftBin !== null;
  // Which bin the form is for: changes when it opens, closes or switches bins.
  const draftKey = draftBin ? draftBin.id ?? 'new' : null;

  // A new array on every render would make react-leaflet move the draft marker
  // back to the stored position, even in the middle of a drag.
  const draftLatitude = draftBin?.latitude;
  const draftLongitude = draftBin?.longitude;
  const draftPosition = useMemo(
    () =>
      draftLatitude === undefined ? null : [draftLatitude, draftLongitude],
    [draftLatitude, draftLongitude]
  );

  const draftMarkerHandlers = useMemo(
    () => ({
      dragend(event) {
        const { lat, lng } = event.target.getLatLng().wrap();

        setDraftBin((currentDraft) =>
          currentDraft
            ? { ...currentDraft, latitude: lat, longitude: lng }
            : currentDraft
        );
      },
    }),
    []
  );

  const nearestBin = useMemo(() => {
    if (!userLocation || bins.length === 0) {
      return null;
    }

    let nearest = null;

    for (const bin of bins) {
      const distance = getDistanceInMeters(userLocation, {
        lat: bin.latitude,
        lng: bin.longitude,
      });

      if (!nearest || distance < nearest.distance) {
        nearest = { bin, distance };
      }
    }

    return nearest;
  }, [userLocation, bins]);

  const registerMarker = useCallback((binId, marker) => {
    if (marker) {
      markerRefs.current.set(binId, marker);
    } else {
      markerRefs.current.delete(binId);
    }
  }, []);

  // The add/edit form floats over the bottom of the map and can hide the pin,
  // especially on a phone. Pan the map so the pin sits just above the form.
  useEffect(() => {
    const map = mapRef.current;
    const form = binFormRef.current;

    if (!draftPosition || !map || !form) {
      return;
    }

    // Measure with the current size, even if the resize watcher hasn't run yet.
    map.invalidateSize();

    const mapRect = map.getContainer().getBoundingClientRect();
    const formRect = form.getBoundingClientRect();
    const pin = map.latLngToContainerPoint(draftPosition);
    const pinX = mapRect.left + pin.x;
    const pinBottom = mapRect.top + pin.y;
    const gap = 24;

    const isUnderForm =
      pinX > formRect.left - gap &&
      pinX < formRect.right + gap &&
      pinBottom > formRect.top - gap;

    if (isUnderForm) {
      map.panBy([0, pinBottom - (formRect.top - gap)]);
    }
  }, [isFullscreen, draftPosition]);

  // When the form opens, scroll the page just enough to show all of it (on a
  // phone the map can run past the bottom of the screen). Keyboard users who
  // opened it from a button also land in its first field.
  useEffect(() => {
    const form = binFormRef.current;

    if (!draftKey || !form) {
      return;
    }

    form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    if (focusFormOnOpenRef.current) {
      focusFormOnOpenRef.current = false;
      form.querySelector('select, input, textarea')?.focus({ preventScroll: true });
    }
  }, [draftKey]);

  useEffect(() => {
    if (!successMessage) {
      return undefined;
    }

    const timeoutId = window.setTimeout(
      () => setSuccessMessage(''),
      SUCCESS_MESSAGE_MS
    );

    return () => window.clearTimeout(timeoutId);
  }, [successMessage]);

  useEffect(() => {
    // Stops paging if the component goes away, so a stale load can't
    // overwrite a newer one (React's StrictMode mounts twice in development).
    const controller = new AbortController();

    async function loadBins() {
      if (!isSupabaseConfigured) {
        setErrorMessage(
          'Supabase is not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.'
        );
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setErrorMessage('');

      const { data, error } = await fetchAllBins(controller.signal);

      if (controller.signal.aborted) {
        return;
      }

      if (error) {
        setErrorMessage(
          getSupabaseErrorMessage(
            error,
            'Could not load bins. Check your Supabase setup.'
          )
        );
        setIsLoading(false);
        return;
      }

      setBins(data);
      setIsLoading(false);
    }

    loadBins();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const cacheKey = `${mapCenter.lat.toFixed(2)},${mapCenter.lng.toFixed(2)}`;
    const cachedName = placeNameCache.get(cacheKey);

    if (cachedName) {
      setPlaceName(cachedName);
      return undefined;
    }

    const controller = new AbortController();
    const fallbackName = `${mapCenter.lat.toFixed(4)}, ${mapCenter.lng.toFixed(4)}`;

    async function loadPlaceName() {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${mapCenter.lat}&lon=${mapCenter.lng}&zoom=14&addressdetails=1`,
          {
            signal: controller.signal,
            headers: {
              Accept: 'application/json',
            },
          }
        );

        if (!response.ok) {
          throw new Error('Could not fetch place name.');
        }

        const result = await response.json();
        const address = result.address || {};
        const locality =
          address.city ||
          address.town ||
          address.village ||
          address.suburb ||
          address.county;
        const region = address.state || address.region;

        let name = fallbackName;

        if (locality && region) {
          name = `${locality}, ${region}`;
        } else if (result.display_name) {
          name = result.display_name.split(',').slice(0, 2).join(', ');
        }

        placeNameCache.set(cacheKey, name);
        setPlaceName(name);
      } catch (error) {
        if (error.name === 'AbortError') {
          return;
        }

        setPlaceName(fallbackName);
      }
    }

    // Waiting a full second after the map stops also keeps requests at least a
    // second apart, as Nominatim requires.
    const timeoutId = window.setTimeout(loadPlaceName, PLACE_LOOKUP_DELAY_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [mapCenter]);

  // A layout effect, so the body class is in place before the browser paints.
  // Without it, `backdrop-filter` on the map card would hold the fixed map
  // inside the card for a frame (see `map-fullscreen-open` in index.css).
  useLayoutEffect(() => {
    if (!isFullscreen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    // The map leaves the page flow in full screen, so the page gets shorter
    // and the browser may scroll up. Put the reader back where they were.
    const previousScrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('map-fullscreen-open');

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.classList.remove('map-fullscreen-open');
      window.scrollTo(0, previousScrollY);
    };
  }, [isFullscreen]);

  // In the page view, a plain mouse wheel scrolls the page instead of zooming
  // the map, so the map can't trap scrolling. Ctrl/⌘ + wheel and trackpad
  // pinches (which browsers send as Ctrl + wheel) still reach Leaflet and zoom.
  // Full screen has no page to scroll, so the wheel zooms there as usual.
  useEffect(() => {
    const stage = mapStageRef.current;

    if (!stage || isFullscreen) {
      return undefined;
    }

    let hideHintTimeout;

    function handleWheel(event) {
      if (event.ctrlKey || event.metaKey) {
        return;
      }

      if (!event.target.closest('.leaflet-container')) {
        return;
      }

      // Stopping it here, above the map, keeps it from Leaflet's own listener.
      // The browser still scrolls the page, since nothing prevents the default.
      event.stopPropagation();
      setShowScrollHint(true);
      window.clearTimeout(hideHintTimeout);
      hideHintTimeout = window.setTimeout(() => setShowScrollHint(false), 1500);
    }

    stage.addEventListener('wheel', handleWheel, { capture: true, passive: true });

    return () => {
      stage.removeEventListener('wheel', handleWheel, { capture: true });
      window.clearTimeout(hideHintTimeout);
      setShowScrollHint(false);
    };
  }, [isFullscreen]);

  // Feedback dialog: move focus in when it opens, and clear the auto-close
  // timer if the component goes away.
  useEffect(() => {
    if (isFeedbackOpen) {
      feedbackDialogRef.current?.querySelector('input, textarea')?.focus();
    }
  }, [isFeedbackOpen]);

  useEffect(() => () => window.clearTimeout(feedbackCloseTimerRef.current), []);

  function markNewBin(latlng) {
    if (!isSupabaseConfigured) {
      setErrorMessage(
        'You need to configure Supabase before adding bins from the map.'
      );
      return;
    }

    if (isSaving) {
      return;
    }

    setErrorMessage('');
    // Tapping again while a draft is open moves the pin and keeps what was typed.
    setDraftBin((currentDraft) => ({
      binType: BIN_TYPE_PUBLIC,
      title: '',
      description: '',
      ...currentDraft,
      latitude: latlng.lat,
      longitude: latlng.lng,
    }));
  }

  // The keyboard way to add a bin: pan the map (arrow keys work once it has
  // focus), then press this button to drop the pin in the middle.
  function placePinAtMapCenter() {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    if (!draftBin) {
      focusFormOnOpenRef.current = true;
    }

    markNewBin(map.getCenter().wrap());
  }

  const startEditingBin = useCallback((bin) => {
    mapRef.current?.closePopup();
    focusFormOnOpenRef.current = true;
    setErrorMessage('');
    setDraftBin({
      id: bin.id,
      latitude: bin.latitude,
      longitude: bin.longitude,
      binType: getBinType(bin.bin_type),
      title: bin.title ?? '',
      description: bin.description ?? '',
    });
  }, []);

  function handleDraftChange(event) {
    const { name, value } = event.target;

    setDraftBin((currentDraft) => ({
      ...currentDraft,
      [name]: value,
    }));
  }

  function handleCancelDraft() {
    if (isSaving) {
      return;
    }

    setDraftBin(null);
  }

  function openFeedbackForm() {
    window.clearTimeout(feedbackCloseTimerRef.current);
    setFeedbackStatus(null);
    setIsFeedbackOpen(true);
  }

  function closeFeedbackForm() {
    if (isSubmittingFeedback) {
      return;
    }

    window.clearTimeout(feedbackCloseTimerRef.current);
    setIsFeedbackOpen(false);
    setFeedbackStatus(null);
    feedbackTriggerRef.current?.focus();
  }

  // Escape closes the dialog, and Tab cycles within it while it is open.
  function handleFeedbackKeyDown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeFeedbackForm();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusable = [
      ...feedbackDialogRef.current.querySelectorAll(
        'button:not([disabled]), input, textarea'
      ),
    ];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleFeedbackChange(event) {
    const { name, value } = event.target;

    setFeedbackForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  }

  async function handleSaveDraftBin(event) {
    event.preventDefault();

    if (!draftBin || isSaving) {
      return;
    }

    if (draftBin.id) {
      await saveBinChanges(draftBin);
      return;
    }

    setIsSaving(true);
    setErrorMessage('');

    const { data, error } = await supabase
      .from('bins')
      .insert(buildBinPayload(draftBin))
      .select()
      .single();

    if (error) {
      const missingColumn = getMissingBinColumn(error);

      if (
        missingColumn === 'title' ||
        missingColumn === 'description' ||
        missingColumn === 'bin_type'
      ) {
        const legacyInsert = await supabase
          .from('bins')
          .insert(
            buildBinPayload(draftBin, {
              includeBinType: missingColumn !== 'bin_type',
              includeOptionalFields: false,
            })
          )
          .select()
          .single();

        if (!legacyInsert.error) {
          setBins((currentBins) => [legacyInsert.data, ...currentBins]);
          setDraftBin(null);
          setErrorMessage(
            `The bin was saved, but your Supabase table is still missing the '${missingColumn}' column. Run supabase/schema.sql so bin types, titles, and descriptions can be stored too.`
          );
          setIsSaving(false);
          return;
        }
      }

      setErrorMessage(
        getSupabaseErrorMessage(
          error,
          'Could not save the new bin. Please try again.'
        )
      );
      setIsSaving(false);
      return;
    }

    setBins((currentBins) => [data, ...currentBins]);
    setDraftBin(null);
    setSuccessMessage('Bin added. Thanks for helping!');
    setIsSaving(false);
  }

  // Edits go through a database function that changes one bin per call and
  // keeps the old version; see update_bin() in supabase/schema.sql.
  async function saveBinChanges(draft) {
    setIsSaving(true);
    setErrorMessage('');

    const { data, error } = await supabase.rpc('update_bin', {
      bin_id: draft.id,
      new_latitude: draft.latitude,
      new_longitude: draft.longitude,
      new_bin_type: getBinType(draft.binType),
      new_title: draft.title,
      new_description: draft.description,
    });

    setIsSaving(false);

    if (error) {
      setErrorMessage(getEditErrorMessage(error));
      return;
    }

    const updatedBin = data?.[0];
    setDraftBin(null);

    if (!updatedBin) {
      setBins((currentBins) => currentBins.filter((bin) => bin.id !== draft.id));
      setErrorMessage('This bin had already been removed.');
      return;
    }

    setBins((currentBins) =>
      currentBins.map((bin) => (bin.id === updatedBin.id ? updatedBin : bin))
    );
    setSuccessMessage('Changes saved.');
  }

  // Stable, so the memoized markers don't re-render. It only uses refs,
  // state setters and module-level values.
  const handleDeleteBin = useCallback(async (binId) => {
    if (!isSupabaseConfigured) {
      setErrorMessage(
        'You need to configure Supabase before deleting bins from the map.'
      );
      return;
    }

    // Ignore a second tap while a delete is already running.
    if (deletingBinIdRef.current) {
      return;
    }

    const shouldDelete = window.confirm(
      'Are you sure you want to delete this waste bin?'
    );

    if (!shouldDelete) {
      return;
    }

    // Close the popup first. In full screen an error banner would otherwise
    // land on top of it, covering its close button.
    mapRef.current?.closePopup();
    deletingBinIdRef.current = binId;
    setDeletingBinId(binId);
    setErrorMessage('');

    // Deletes go through a database function that removes one bin per call
    // and keeps a copy; see delete_bin() in supabase/schema.sql.
    const { data: wasDeleted, error } = await supabase.rpc('delete_bin', {
      bin_id: binId,
    });

    deletingBinIdRef.current = null;
    setDeletingBinId(null);

    if (error) {
      setErrorMessage(getDeleteErrorMessage(error));
      return;
    }

    setBins((currentBins) => currentBins.filter((bin) => bin.id !== binId));

    if (wasDeleted) {
      setSuccessMessage('Bin deleted.');
    } else {
      setErrorMessage('This bin had already been removed.');
    }
  }, []);

  async function handleFeedbackSubmit(event) {
    event.preventDefault();

    if (!isSupabaseConfigured) {
      setFeedbackStatus({
        tone: 'error',
        text: 'Supabase is not configured yet. Add your environment variables before sending feedback.',
      });
      return;
    }

    const feedbackText = feedbackForm.feedback.trim();

    // `required` lets text made only of spaces through; the database rejects it.
    if (!feedbackText) {
      setFeedbackStatus({
        tone: 'error',
        text: 'Please write your feedback before sending.',
      });
      return;
    }

    setIsSubmittingFeedback(true);
    setFeedbackStatus(null);

    const { error } = await supabase.from('app_feedback').insert({
      name: feedbackForm.name.trim() || null,
      feedback: feedbackText,
    });

    if (error) {
      setFeedbackStatus({ tone: 'error', text: getFeedbackErrorMessage(error) });
      setIsSubmittingFeedback(false);
      return;
    }

    setFeedbackForm({
      name: '',
      feedback: '',
    });
    setFeedbackStatus({
      tone: 'success',
      text: 'Thanks for the feedback. It has been sent.',
    });
    setIsSubmittingFeedback(false);

    feedbackCloseTimerRef.current = window.setTimeout(() => {
      setIsFeedbackOpen(false);
      setFeedbackStatus(null);
      feedbackTriggerRef.current?.focus();
    }, FEEDBACK_CLOSE_DELAY_MS);
  }

  function handleLocateMe() {
    if (!navigator.geolocation) {
      setErrorMessage('Geolocation is not supported on this device or browser.');
      return;
    }

    setIsLocating(true);
    setErrorMessage('');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        setUserLocation(nextLocation);
        setMapCenter(nextLocation);
        setIsNearestBinDismissed(false);
        setIsLocating(false);
      },
      (error) => {
        const locationErrorMessages = {
          1: 'Location permission was denied. Please allow access and try again.',
          2: 'Could not detect your location. Please try again in a moment.',
          3: 'Location request timed out. Please try again.',
        };

        setErrorMessage(
          locationErrorMessages[error.code] ||
            'Could not get your current location.'
        );
        setIsLocating(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  }

  // Fly to a bin and open its popup.
  function showBinOnMap(binId) {
    const map = mapRef.current;
    const marker = markerRefs.current.get(binId);

    if (!map || !marker) {
      return;
    }

    // The popup shows the same details and directions, and the card would
    // otherwise sit on top of it.
    setIsNearestBinDismissed(true);
    map.once('moveend', () => marker.openPopup());
    map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), STREET_ZOOM), {
      duration: 0.8,
    });
  }

  function toggleFullscreen() {
    setIsFullscreen((currentValue) => !currentValue);
  }

  const statusLabels = [
    isLoading && 'Loading bins...',
    isSaving && (isEditing ? 'Saving changes...' : 'Saving new bin...'),
    deletingBinId && 'Deleting bin...',
    isLocating && 'Finding your location...',
  ].filter(Boolean);

  const placePinLabel = isDraftOpen
    ? 'Move the pin to the map centre'
    : 'Add a bin at the map centre';

  return (
    <div className={`map-wrapper${isFullscreen ? ' map-wrapper--fullscreen' : ''}`}>
      <div className="toolbar">
        <h2>Current Area: {placeName}</h2>
        <p>Tap the map to add a waste bin. No paperwork required.</p>
      </div>

      {/* The map is rendered in exactly one place. Full screen is only a CSS
          class, so toggling it keeps the same Leaflet map and its view. */}
      <div className="map-stage" ref={mapStageRef}>
        {/* Messages float over the top of the map, so they never push it down. */}
        <div className="map-notices">
          {errorMessage && (
            <div className="notice notice--error" role="alert">
              <p>{errorMessage}</p>
              <button
                type="button"
                className="notice__close"
                onClick={() => setErrorMessage('')}
                aria-label="Dismiss message"
              >
                ×
              </button>
            </div>
          )}

          {successMessage && (
            <div className="notice notice--success" role="status">
              <p>{successMessage}</p>
              <button
                type="button"
                className="notice__close"
                onClick={() => setSuccessMessage('')}
                aria-label="Dismiss message"
              >
                ×
              </button>
            </div>
          )}

          {userLocation && !isNearestBinDismissed && !isLoading && (
            <div className="notice notice--nearest">
              {nearestBin ? (
                <div className="notice__body">
                  <span className="notice__eyebrow">
                    Nearest bin · {formatDistance(nearestBin.distance)}
                  </span>
                  <strong>{nearestBin.bin.title || 'Waste bin'}</strong>
                  <div className="notice__actions">
                    <button
                      type="button"
                      className="notice__action"
                      onClick={() => showBinOnMap(nearestBin.bin.id)}
                    >
                      Show on map
                    </button>
                    <a
                      className="notice__action"
                      href={getDirectionsUrl(nearestBin.bin)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Directions
                    </a>
                  </div>
                </div>
              ) : (
                <p>No bins on the map yet. Tap the map to add the first one.</p>
              )}
              <button
                type="button"
                className="notice__close"
                onClick={() => setIsNearestBinDismissed(true)}
                aria-label="Hide nearest bin"
              >
                ×
              </button>
            </div>
          )}

          <div className="status-group" role="status">
            {statusLabels.map((label) => (
              <span key={label} className="status">
                {label}
              </span>
            ))}
          </div>
        </div>

        <MapContainer
          ref={mapRef}
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          scrollWheelZoom
          className="leaflet-map"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <AddBinOnClick onAdd={markNewBin} />
          <MapCenterTracker onCenterChange={setMapCenter} />
          <MapController targetLocation={userLocation} />
          <MapSizeWatcher />

          {draftPosition && (
            <Marker
              position={draftPosition}
              icon={DRAFT_BIN_ICONS[getBinType(draftBin.binType)]}
              draggable
              zIndexOffset={1000}
              title="New bin location. Drag to adjust, or tap elsewhere on the map to move it."
              alt="New bin location"
              eventHandlers={draftMarkerHandlers}
            />
          )}

          {userLocation && (
            <Marker
              position={[userLocation.lat, userLocation.lng]}
              icon={userLocationIcon}
              title="Your location"
            >
              <Popup>
                <div className="popup-content">
                  <strong>Your location</strong>
                  <p>This location comes from your device GPS.</p>
                  <small>
                    {userLocation.lat.toFixed(5)}, {userLocation.lng.toFixed(5)}
                  </small>
                </div>
              </Popup>
            </Marker>
          )}

          {bins.map((bin) =>
            // While a bin is being edited, its draft pin stands in for it.
            bin.id === draftBin?.id ? null : (
              <BinMarker
                key={bin.id}
                bin={bin}
                distance={
                  userLocation
                    ? getDistanceInMeters(userLocation, {
                        lat: bin.latitude,
                        lng: bin.longitude,
                      })
                    : null
                }
                isDeleting={deletingBinId === bin.id}
                onEdit={startEditingBin}
                onDelete={handleDeleteBin}
                registerMarker={registerMarker}
              />
            )
          )}
        </MapContainer>

        <ul className="map-legend" aria-label="Map key">
          <li>
            <span className="map-legend__dot map-legend__dot--public" aria-hidden="true"></span>
            Public bin
          </li>
          <li>
            <span className="map-legend__dot map-legend__dot--private" aria-hidden="true"></span>
            Private bin
          </li>
        </ul>

        {showScrollHint && (
          <div className="map-scroll-hint" aria-hidden="true">
            Use {IS_APPLE_DEVICE ? '⌘' : 'Ctrl'} + scroll to zoom the map
          </div>
        )}

        <button
          type="button"
          className="map-control-button place-pin-button"
          onClick={placePinAtMapCenter}
          aria-label={placePinLabel}
          title={placePinLabel}
        >
          <span className="place-pin-button__icon" aria-hidden="true"></span>
        </button>

        <button
          type="button"
          className="map-control-button maximize-button"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? 'Exit full screen map' : 'Maximize map'}
          title={isFullscreen ? 'Exit full screen map' : 'Maximize map'}
        >
          <span className="maximize-button__icon" aria-hidden="true"></span>
        </button>

        <button
          type="button"
          className="map-control-button locate-button"
          onClick={handleLocateMe}
          disabled={isLocating}
          aria-label={isLocating ? 'Locating your position' : 'Find me and my nearest bin'}
          title={isLocating ? 'Locating your position' : 'Find me and my nearest bin'}
        >
          <span className="locate-button__icon" aria-hidden="true">
            <span className="locate-button__dot"></span>
          </span>
        </button>

        <button
          type="button"
          ref={feedbackTriggerRef}
          className="feedback-trigger"
          onClick={openFeedbackForm}
        >
          Suggestion & Feedback
        </button>

        {draftBin && (
          // A bottom sheet over the map, in both page and full-screen view, so
          // opening it never pushes the map out of sight.
          <form
            ref={binFormRef}
            className="bin-form"
            onSubmit={handleSaveDraftBin}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                handleCancelDraft();
              }
            }}
            aria-labelledby="bin-form-title"
          >
            <div className="bin-form-header">
              <h3 id="bin-form-title">{isEditing ? 'Edit Bin' : 'Add New Bin'}</h3>
              <p>
                {draftBin.latitude.toFixed(5)}, {draftBin.longitude.toFixed(5)} ·
                Drag the pin or tap the map to move it.
              </p>
            </div>

            <label className="field">
              <span>Bin Type</span>
              <select
                name="binType"
                value={draftBin.binType}
                onChange={handleDraftChange}
              >
                <option value={BIN_TYPE_PUBLIC}>Public</option>
                <option value={BIN_TYPE_PRIVATE}>Private</option>
              </select>
            </label>

            <label className="field">
              <span>Title</span>
              <input
                type="text"
                name="title"
                value={draftBin.title}
                onChange={handleDraftChange}
                maxLength={MAX_TITLE_LENGTH}
                placeholder="Example: Near bus stop"
              />
            </label>

            <label className="field">
              <span>Description</span>
              <textarea
                name="description"
                value={draftBin.description}
                onChange={handleDraftChange}
                maxLength={MAX_DESCRIPTION_LENGTH}
                rows="2"
                placeholder="Add any details that help identify this bin"
              />
            </label>

            <div className="form-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={handleCancelDraft}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button type="submit" className="button" disabled={isSaving}>
                {isSaving ? 'Saving...' : isEditing ? 'Save Changes' : 'Save Bin'}
              </button>
            </div>
          </form>
        )}

        {isFeedbackOpen && (
          // The backdrop catches clicks so they can't reach the map below and
          // open the add-bin form; clicking it closes the dialog instead.
          <div
            className="feedback-modal"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                closeFeedbackForm();
              }
            }}
            onKeyDown={handleFeedbackKeyDown}
          >
            <form
              ref={feedbackDialogRef}
              className="feedback-form"
              onSubmit={handleFeedbackSubmit}
              role="dialog"
              aria-modal="true"
              aria-labelledby="feedback-form-title"
            >
              <div className="feedback-form__header">
                <h3 id="feedback-form-title">App Feedback</h3>
                <button
                  type="button"
                  className="feedback-form__close"
                  onClick={closeFeedbackForm}
                  disabled={isSubmittingFeedback}
                  aria-label="Close feedback form"
                >
                  ×
                </button>
              </div>

              <p className="feedback-form__copy">
                Share a suggestion, bug, or idea for improving the app.
              </p>

              <label className="field">
                <span>Name</span>
                <input
                  type="text"
                  name="name"
                  value={feedbackForm.name}
                  onChange={handleFeedbackChange}
                  maxLength={MAX_FEEDBACK_NAME_LENGTH}
                  placeholder="Your name"
                />
              </label>

              <label className="field">
                <span>Feedback</span>
                <textarea
                  name="feedback"
                  value={feedbackForm.feedback}
                  onChange={handleFeedbackChange}
                  maxLength={MAX_FEEDBACK_LENGTH}
                  rows="4"
                  placeholder="Tell us what would make the app better"
                  required
                />
              </label>

              {feedbackStatus && (
                <p
                  className={`feedback-form__status feedback-form__status--${feedbackStatus.tone}`}
                  role={feedbackStatus.tone === 'error' ? 'alert' : 'status'}
                >
                  {feedbackStatus.text}
                </p>
              )}

              <div className="form-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={closeFeedbackForm}
                  disabled={isSubmittingFeedback}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button"
                  disabled={isSubmittingFeedback}
                >
                  {isSubmittingFeedback ? 'Sending...' : 'Send Feedback'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

export default BinMap;
