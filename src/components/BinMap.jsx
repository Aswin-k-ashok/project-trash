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
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { DEFAULT_CENTER, DEFAULT_ZOOM } from '../config';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import InstallButton from './InstallButton';
import {
  BinIcon,
  CloseIcon,
  DirectionsIcon,
  LocateIcon,
  MessageIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  binIconMarkup,
} from './icons';

const BIN_TYPE_PUBLIC = 'public';
const BIN_TYPE_PRIVATE = 'private';
const BIN_TYPES = [BIN_TYPE_PUBLIC, BIN_TYPE_PRIVATE];
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

// From this width the sheet sits in a side panel instead of along the bottom.
// Keep in step with the 900px breakpoint in index.css.
const WIDE_LAYOUT_QUERY = '(min-width: 900px)';
// Space kept between a bin or pin and the panel or sheet that covers the map.
const OVERLAY_GAP = 24;

const MARKER_SIZES = { default: 30, selected: 40, draft: 36 };

function createBinIcon(binType, variant) {
  const size = MARKER_SIZES[variant];
  const variantClass = variant === 'default' ? '' : ` bin-marker--${variant}`;

  return L.divIcon({
    className: 'bin-marker-wrapper',
    html: `<div class="bin-marker bin-marker--${binType}${variantClass}" aria-hidden="true">${binIconMarkup(
      variant === 'default' ? 14 : 17
    )}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// Built once and shared. react-leaflet replaces a marker's icon whenever the
// icon object changes, so a new object per render rebuilt every marker.
const BIN_ICONS = Object.fromEntries(
  Object.keys(MARKER_SIZES).map((variant) => [
    variant,
    {
      [BIN_TYPE_PUBLIC]: createBinIcon(BIN_TYPE_PUBLIC, variant),
      [BIN_TYPE_PRIVATE]: createBinIcon(BIN_TYPE_PRIVATE, variant),
    },
  ])
);

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

// Pan the map, if needed, so a point isn't hidden by the floating UI.
// Wide screens: move it right of the side panel. Phones: keep it in the strip
// between the top bar and the map buttons that sit on top of the sheet.
function keepPointInView(map, latlng, { isWideLayout, panel, topbar, sheet, floating }) {
  const mapRect = map.getContainer().getBoundingClientRect();
  const point = map.latLngToContainerPoint(latlng);
  const x = mapRect.left + point.x;
  const y = mapRect.top + point.y;

  if (isWideLayout) {
    const box = panel.getBoundingClientRect();
    const isCovered =
      x > box.left - OVERLAY_GAP &&
      x < box.right + OVERLAY_GAP &&
      y > box.top - OVERLAY_GAP &&
      y < box.bottom + OVERLAY_GAP;

    if (isCovered) {
      map.panBy([x - (box.right + OVERLAY_GAP), 0]);
    }

    return;
  }

  const top = topbar.getBoundingClientRect().bottom + OVERLAY_GAP;
  const bottom =
    Math.min(
      sheet.getBoundingClientRect().top,
      ...floating.map((element) => element.getBoundingClientRect().top)
    ) - OVERLAY_GAP;

  if (y > bottom) {
    map.panBy([0, y - bottom]);
  } else if (y < top) {
    map.panBy([0, y - top]);
  }
}

// Place names already looked up, keyed by the map centre rounded to about 1 km.
const placeNameCache = new Map();

// Leaflet fires `click` for both halves of a double-click zoom, so a tap waits
// briefly to make sure it isn't the start of one.
function MapTapHandler({ onTap }) {
  const pendingTapRef = useRef(null);

  useEffect(() => () => window.clearTimeout(pendingTapRef.current), []);

  function cancelPendingTap() {
    window.clearTimeout(pendingTapRef.current);
    pendingTapRef.current = null;
  }

  useMapEvents({
    click(event) {
      if (pendingTapRef.current) {
        // Second click of a double-click: let Leaflet zoom instead.
        cancelPendingTap();
        return;
      }

      // wrap() keeps longitude within -180..180 after panning past the date line.
      const latlng = event.latlng.wrap();

      pendingTapRef.current = window.setTimeout(() => {
        pendingTapRef.current = null;
        onTap(latlng);
      }, DOUBLE_CLICK_WINDOW_MS);
    },
    dblclick: cancelPendingTap,
  });

  return null;
}

// Leaflet only measures its container on window resize; this also catches
// other changes to the container's size.
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
// marker. Callbacks passed in must be stable.
const BinMarker = memo(function BinMarker({
  bin,
  isSelected,
  onSelect,
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
  const eventHandlers = useMemo(
    () => ({
      click: () => onSelect(bin.id),
      // Leaflet makes markers focusable buttons but only opens them from the
      // keyboard when they have a popup. These open the sheet instead, so
      // handle Enter and Space here.
      keypress(event) {
        const { key } = event.originalEvent;

        if (key === 'Enter' || key === ' ') {
          event.originalEvent.preventDefault();
          onSelect(bin.id);
        }
      },
    }),
    [bin.id, onSelect]
  );
  const binType = getBinType(bin.bin_type);
  const title = bin.title || 'Waste bin';

  return (
    <Marker
      ref={markerRef}
      position={position}
      icon={BIN_ICONS[isSelected ? 'selected' : 'default'][binType]}
      zIndexOffset={isSelected ? 500 : 0}
      // Leaflet gives markers role="button"; the title is their accessible name.
      title={`${title}, ${BIN_TYPE_LABELS[binType].toLowerCase()} bin`}
      eventHandlers={eventHandlers}
    />
  );
});

function BinMap() {
  const [bins, setBins] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingBinId, setDeletingBinId] = useState(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [mapCenter, setMapCenter] = useState(DEFAULT_CENTER);
  const [placeName, setPlaceName] = useState('Kochi, Kerala');
  // A bin being added, or being edited when it has an `id`.
  const [draftBin, setDraftBin] = useState(null);
  // The bin whose details are open in the sheet.
  const [selectedBinId, setSelectedBinId] = useState(null);
  // The bin whose delete is waiting for a second, confirming tap.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [isNearestBinDismissed, setIsNearestBinDismissed] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackForm, setFeedbackForm] = useState({
    name: '',
    feedback: '',
  });
  // { tone: 'success' | 'error', text } or null
  const [feedbackStatus, setFeedbackStatus] = useState(null);

  const mapRef = useRef(null);
  const appRef = useRef(null);
  const panelRef = useRef(null);
  const topbarRef = useRef(null);
  const sheetRef = useRef(null);
  const dockRef = useRef(null);
  const legendRef = useRef(null);
  const sheetHeadingRef = useRef(null);
  const binFormRef = useRef(null);
  const confirmKeepRef = useRef(null);
  const deleteButtonRef = useRef(null);
  const markerRefs = useRef(new Map());
  const deletingBinIdRef = useRef(null);
  const isDraftOpenRef = useRef(false);
  const focusFormOnOpenRef = useRef(false);
  const focusSheetOnSelectRef = useRef(false);
  const focusMarkerOnCloseRef = useRef(null);
  const focusDeleteOnCancelRef = useRef(false);
  const feedbackTriggerRef = useRef(null);
  const feedbackDialogRef = useRef(null);
  const feedbackCloseTimerRef = useRef(null);

  const isEditing = Boolean(draftBin?.id);
  const isDraftOpen = draftBin !== null;
  isDraftOpenRef.current = isDraftOpen;
  // Which bin the form is for: changes when it opens, closes or switches bins.
  const draftKey = draftBin ? draftBin.id ?? 'new' : null;

  const selectedBin = useMemo(
    () => bins.find((bin) => bin.id === selectedBinId) ?? null,
    [bins, selectedBinId]
  );
  const isConfirmingDelete =
    selectedBin !== null && confirmingDeleteId === selectedBin.id;

  // A new array on every render would make react-leaflet move the draft marker
  // back to the stored position, even in the middle of a drag.
  const draftLatitude = draftBin?.latitude;
  const draftLongitude = draftBin?.longitude;
  const draftPosition = useMemo(
    () =>
      draftLatitude === undefined ? null : [draftLatitude, draftLongitude],
    [draftLatitude, draftLongitude]
  );

  const selectedLatitude = selectedBin?.latitude;
  const selectedLongitude = selectedBin?.longitude;
  const selectedPosition = useMemo(
    () =>
      selectedLatitude === undefined
        ? null
        : [selectedLatitude, selectedLongitude],
    [selectedLatitude, selectedLongitude]
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

  // What the sheet shows, most important first.
  let sheetMode = 'home';

  if (draftBin) {
    sheetMode = 'form';
  } else if (selectedBin) {
    sheetMode = 'bin';
  } else if (userLocation && !isNearestBinDismissed && !isLoading) {
    sheetMode = 'nearest';
  }

  const sheetKey =
    sheetMode === 'form'
      ? `form:${draftKey}`
      : sheetMode === 'bin'
        ? `bin:${selectedBin.id}`
        : sheetMode;

  const registerMarker = useCallback((binId, marker) => {
    if (marker) {
      markerRefs.current.set(binId, marker);
    } else {
      markerRefs.current.delete(binId);
    }
  }, []);

  // Stable, so the memoized markers don't re-render. It only uses refs and
  // state setters.
  const selectBin = useCallback((binId) => {
    // While adding or editing, the form keeps the sheet.
    if (isDraftOpenRef.current) {
      return;
    }

    focusSheetOnSelectRef.current = true;
    setConfirmingDeleteId(null);
    setSelectedBinId(binId);
  }, []);

  // On a phone the sheet covers the bottom of the map. Publish its height so
  // the map buttons and the map's attribution sit just above it. Measured
  // after every render, before paint, so they never lag a frame behind (and
  // the pan below sees their new place); the observer catches other changes,
  // such as a resized text box.
  useLayoutEffect(() => {
    appRef.current?.style.setProperty(
      '--sheet-height',
      `${sheetRef.current?.offsetHeight ?? 0}px`
    );
  });

  useEffect(() => {
    const sheet = sheetRef.current;
    const app = appRef.current;

    if (!sheet || !app || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      app.style.setProperty('--sheet-height', `${sheet.offsetHeight}px`);
    });
    observer.observe(sheet);

    return () => observer.disconnect();
  }, []);

  // Keep the pin being placed, or the selected bin, in view: pan the map if
  // the floating UI is covering it.
  const focusPosition = draftPosition ?? selectedPosition;

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !focusPosition) {
      return;
    }

    keepPointInView(map, focusPosition, {
      isWideLayout: window.matchMedia?.(WIDE_LAYOUT_QUERY)?.matches,
      panel: panelRef.current,
      topbar: topbarRef.current,
      sheet: sheetRef.current,
      floating: [dockRef.current, legendRef.current].filter(Boolean),
    });
  }, [focusPosition, sheetKey]);

  // Keyboard users who opened the form from a button land in its first field.
  // A tap on the map doesn't move focus, so phones don't pop up the keyboard.
  useEffect(() => {
    if (!draftKey || !focusFormOnOpenRef.current) {
      return;
    }

    focusFormOnOpenRef.current = false;
    const form = binFormRef.current;
    const firstField =
      form?.querySelector('input[name="binType"]:checked') ??
      form?.querySelector('input, textarea');

    firstField?.focus({ preventScroll: true });
  }, [draftKey]);

  // Opening a bin moves focus to its details; closing them puts focus back on
  // its marker, so keyboard and screen reader users don't lose their place.
  useEffect(() => {
    if (selectedBinId && focusSheetOnSelectRef.current) {
      focusSheetOnSelectRef.current = false;
      sheetHeadingRef.current?.focus({ preventScroll: true });
      return;
    }

    if (!selectedBinId && focusMarkerOnCloseRef.current) {
      const marker = markerRefs.current.get(focusMarkerOnCloseRef.current);
      focusMarkerOnCloseRef.current = null;
      marker?.getElement()?.focus({ preventScroll: true });
    }
  }, [selectedBinId]);

  useEffect(() => {
    if (confirmingDeleteId) {
      confirmKeepRef.current?.focus({ preventScroll: true });
      return;
    }

    if (focusDeleteOnCancelRef.current) {
      focusDeleteOnCancelRef.current = false;
      deleteButtonRef.current?.focus({ preventScroll: true });
    }
  }, [confirmingDeleteId]);

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
    setSelectedBinId(null);
    setConfirmingDeleteId(null);
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

  // A tap on an empty part of the map. Like tapping outside a sheet in other
  // map apps, it first closes whatever the sheet shows; otherwise it adds a bin.
  function handleMapTap(latlng) {
    if (draftBin) {
      markNewBin(latlng);
    } else if (selectedBin) {
      closeSelectedBin({ restoreFocus: false });
    } else if (sheetMode === 'nearest') {
      setIsNearestBinDismissed(true);
    } else {
      markNewBin(latlng);
    }
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

  function closeSelectedBin({ restoreFocus = true } = {}) {
    if (restoreFocus) {
      focusMarkerOnCloseRef.current = selectedBinId;
    }

    setSelectedBinId(null);
    setConfirmingDeleteId(null);
  }

  function cancelDelete() {
    focusDeleteOnCancelRef.current = true;
    setConfirmingDeleteId(null);
  }

  function startEditingBin(bin) {
    setSelectedBinId(null);
    setConfirmingDeleteId(null);
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
  }

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

    // Cancelling an edit goes back to that bin's details.
    if (draftBin?.id) {
      focusSheetOnSelectRef.current = true;
      setSelectedBinId(draftBin.id);
    }

    setDraftBin(null);
  }

  // Escape closes whatever the sheet shows, one step at a time.
  function handleSheetKeyDown(event) {
    if (event.key !== 'Escape') {
      return;
    }

    if (sheetMode === 'form') {
      handleCancelDraft();
    } else if (sheetMode === 'bin') {
      if (isConfirmingDelete) {
        cancelDelete();
      } else {
        closeSelectedBin();
      }
    } else if (sheetMode === 'nearest') {
      setIsNearestBinDismissed(true);
    }
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

  // After a save, the sheet shows the bin that was saved.
  function showSavedBin(binId) {
    focusSheetOnSelectRef.current = true;
    setSelectedBinId(binId);
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
    showSavedBin(data.id);
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
    showSavedBin(updatedBin.id);
    setSuccessMessage('Changes saved.');
  }

  async function deleteBin(binId) {
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
    setConfirmingDeleteId(null);

    if (error) {
      setErrorMessage(getDeleteErrorMessage(error));
      return;
    }

    setSelectedBinId((currentId) => (currentId === binId ? null : currentId));
    setBins((currentBins) => currentBins.filter((bin) => bin.id !== binId));

    if (wasDeleted) {
      setSuccessMessage('Bin deleted.');
    } else {
      setErrorMessage('This bin had already been removed.');
    }
  }

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
        setSelectedBinId(null);
        setConfirmingDeleteId(null);
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

  // Fly to a bin, then open its details.
  function showBinOnMap(binId) {
    const map = mapRef.current;
    const marker = markerRefs.current.get(binId);

    if (!map || !marker) {
      return;
    }

    setIsNearestBinDismissed(true);
    // Selecting only after the flight, so the sheet's pan can't cut it short.
    map.once('moveend', () => selectBin(binId));
    map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), STREET_ZOOM), {
      duration: 0.8,
    });
  }

  const statusLabels = [
    isLoading && 'Loading bins…',
    isSaving && (isEditing ? 'Saving changes…' : 'Saving new bin…'),
    deletingBinId && 'Deleting bin…',
    isLocating && 'Finding your location…',
  ].filter(Boolean);

  const sheetLabels = {
    home: 'Find a bin',
    nearest: 'Nearest bin',
    bin: 'Bin details',
    form: isEditing ? 'Edit bin' : 'Add a bin',
  };

  function renderHomeSheet() {
    return (
      <>
        <div className="sheet__intro">
          <h2 className="sheet__title" ref={sheetHeadingRef} tabIndex={-1}>
            Find the nearest bin
          </h2>
          <p className="sheet__text">
            Tap the map to add one. No paperwork required.
          </p>
        </div>
        <button
          type="button"
          className="button button--primary button--block"
          onClick={handleLocateMe}
          disabled={isLocating}
        >
          <LocateIcon size={18} />
          {isLocating ? 'Finding you…' : 'Find nearest bin'}
        </button>
      </>
    );
  }

  function renderNearestSheet() {
    return (
      <>
        <div className="sheet__header">
          <div className="sheet__heading">
            {nearestBin && (
              <p className="sheet__eyebrow">
                Nearest bin · {formatDistance(nearestBin.distance)}
              </p>
            )}
            <h2 className="sheet__title" ref={sheetHeadingRef} tabIndex={-1}>
              {nearestBin
                ? nearestBin.bin.title || 'Waste bin'
                : 'No bins on the map yet'}
            </h2>
          </div>
          <button
            type="button"
            className="icon-button icon-button--round"
            onClick={() => setIsNearestBinDismissed(true)}
            aria-label="Hide nearest bin"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {nearestBin ? (
          <div className="sheet__actions">
            <a
              className="button button--primary sheet__grow"
              href={getDirectionsUrl(nearestBin.bin)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <DirectionsIcon size={18} />
              Directions
            </a>
            <button
              type="button"
              className="button button--secondary sheet__grow"
              onClick={() => showBinOnMap(nearestBin.bin.id)}
            >
              Show on map
            </button>
          </div>
        ) : (
          <p className="sheet__text">Tap the map to add the first one.</p>
        )}
      </>
    );
  }

  function renderBinSheet(bin) {
    const binType = getBinType(bin.bin_type);
    const distance = userLocation
      ? getDistanceInMeters(userLocation, { lat: bin.latitude, lng: bin.longitude })
      : null;
    const isDeleting = deletingBinId === bin.id;

    return (
      <>
        <div className="sheet__header">
          <h2 className="sheet__title" ref={sheetHeadingRef} tabIndex={-1}>
            {bin.title || 'Waste bin'}
          </h2>
          <button
            type="button"
            className="icon-button icon-button--round"
            onClick={() => closeSelectedBin()}
            aria-label="Close bin details"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="sheet__meta">
          <span className={`chip chip--${binType}`}>
            {BIN_TYPE_LABELS[binType]}
          </span>
          {distance !== null && (
            <span className="sheet__distance">{formatDistance(distance)} away</span>
          )}
        </div>

        <p className={`sheet__text${bin.description ? '' : ' sheet__text--muted'}`}>
          {bin.description || 'No description added.'}
        </p>

        {isConfirmingDelete ? (
          <div className="sheet__confirm" role="group" aria-labelledby="delete-confirm-text">
            <p id="delete-confirm-text" className="sheet__confirm-text">
              Delete this bin from the map?
            </p>
            <div className="sheet__actions">
              <button
                type="button"
                ref={confirmKeepRef}
                className="button button--secondary sheet__grow"
                onClick={cancelDelete}
                disabled={isDeleting}
              >
                Keep it
              </button>
              <button
                type="button"
                className="button button--danger sheet__grow"
                onClick={() => deleteBin(bin.id)}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        ) : (
          <div className="sheet__actions">
            <a
              className="button button--primary sheet__grow"
              href={getDirectionsUrl(bin)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <DirectionsIcon size={18} />
              Directions
            </a>
            <button
              type="button"
              className="icon-button icon-button--tile"
              onClick={() => startEditingBin(bin)}
              aria-label="Edit bin"
              title="Edit bin"
            >
              <PencilIcon />
            </button>
            <button
              type="button"
              ref={deleteButtonRef}
              className="icon-button icon-button--tile icon-button--danger"
              onClick={() => setConfirmingDeleteId(bin.id)}
              aria-label="Delete bin"
              title="Delete bin"
            >
              <TrashIcon />
            </button>
          </div>
        )}

        <p className="sheet__coords">
          {bin.latitude.toFixed(5)}, {bin.longitude.toFixed(5)}
        </p>
      </>
    );
  }

  function renderFormSheet() {
    return (
      <form
        ref={binFormRef}
        className="bin-form"
        onSubmit={handleSaveDraftBin}
        aria-labelledby="bin-form-title"
      >
        <div className="sheet__heading">
          <h2 id="bin-form-title" className="sheet__title">
            {isEditing ? 'Edit bin' : 'Add a bin'}
          </h2>
          <p className="sheet__hint">Drag the pin or tap the map to move it.</p>
        </div>

        <fieldset className="segmented">
          <legend className="field__label">Type</legend>
          <div className="segmented__options">
            {BIN_TYPES.map((type) => (
              <label key={type} className="segmented__option">
                <input
                  type="radio"
                  name="binType"
                  value={type}
                  checked={draftBin.binType === type}
                  onChange={handleDraftChange}
                />
                <span className="segmented__label">
                  <span className={`dot dot--${type}`} aria-hidden="true"></span>
                  {BIN_TYPE_LABELS[type]}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span className="field__label">Title</span>
          <input
            type="text"
            name="title"
            value={draftBin.title}
            onChange={handleDraftChange}
            maxLength={MAX_TITLE_LENGTH}
            placeholder="Example: Near the bus stop"
          />
        </label>

        <label className="field">
          <span className="field__label">Description</span>
          <textarea
            name="description"
            value={draftBin.description}
            onChange={handleDraftChange}
            maxLength={MAX_DESCRIPTION_LENGTH}
            rows="2"
            placeholder="Anything that helps people find it"
          />
        </label>

        <div className="form-actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={handleCancelDraft}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={isSaving}>
            {isSaving ? 'Saving…' : isEditing ? 'Save changes' : 'Save bin'}
          </button>
        </div>
      </form>
    );
  }

  function renderSheetContent() {
    switch (sheetMode) {
      case 'form':
        return renderFormSheet();
      case 'bin':
        return renderBinSheet(selectedBin);
      case 'nearest':
        return renderNearestSheet();
      default:
        return renderHomeSheet();
    }
  }

  const placePinLabel = isDraftOpen
    ? 'Move pin to the map centre'
    : 'Add bin at the map centre';

  return (
    <div className="map-app" ref={appRef}>
      <MapContainer
        ref={mapRef}
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        zoomControl={false}
        className="map-app__map"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapTapHandler onTap={handleMapTap} />
        <MapCenterTracker onCenterChange={setMapCenter} />
        <MapController targetLocation={userLocation} />
        <MapSizeWatcher />

        {draftPosition && (
          <Marker
            position={draftPosition}
            icon={BIN_ICONS.draft[getBinType(draftBin.binType)]}
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
            keyboard={false}
            interactive={false}
          />
        )}

        {bins.map((bin) =>
          // While a bin is being edited, its draft pin stands in for it.
          bin.id === draftBin?.id ? null : (
            <BinMarker
              key={bin.id}
              bin={bin}
              isSelected={bin.id === selectedBinId}
              onSelect={selectBin}
              registerMarker={registerMarker}
            />
          )
        )}
      </MapContainer>

      {/* Everything that floats over the map. On a phone the top bar is at the
          top and the sheet along the bottom; on wide screens both stack in a
          panel on the left. */}
      <div className="map-ui">
        <div className="map-panel" ref={panelRef}>
          <header className="topbar" ref={topbarRef}>
            <span className="topbar__logo" aria-hidden="true">
              <BinIcon size={18} strokeWidth={2.25} />
            </span>
            <div className="topbar__text">
              <h1 className="topbar__title">Bin there</h1>
              <p className="topbar__place">{placeName}</p>
            </div>
            <div className="topbar__actions">
              <InstallButton />
              <button
                type="button"
                ref={feedbackTriggerRef}
                className="icon-button"
                onClick={openFeedbackForm}
                aria-label="Send feedback"
                title="Send feedback"
              >
                <MessageIcon />
              </button>
            </div>
          </header>

          <div className="notices">
            {errorMessage && (
              <div className="notice notice--error" role="alert">
                <p>{errorMessage}</p>
                <button
                  type="button"
                  className="notice__close"
                  onClick={() => setErrorMessage('')}
                  aria-label="Dismiss message"
                >
                  <CloseIcon size={16} />
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
                  <CloseIcon size={16} />
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

          <section
            className="sheet"
            ref={sheetRef}
            aria-label={sheetLabels[sheetMode]}
            onKeyDown={handleSheetKeyDown}
          >
            {/* Keyed, so each new view fades in. */}
            <div className="sheet__content" key={sheetKey}>
              {renderSheetContent()}
            </div>
          </section>
        </div>

        <div className="map-zoom" role="group" aria-label="Zoom">
          <button
            type="button"
            className="map-zoom__button"
            onClick={() => mapRef.current?.zoomIn()}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <PlusIcon size={18} />
          </button>
          <button
            type="button"
            className="map-zoom__button"
            onClick={() => mapRef.current?.zoomOut()}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <MinusIcon size={18} />
          </button>
        </div>

        <ul className="map-legend" aria-label="Map key" ref={legendRef}>
          <li>
            <span className="dot dot--public" aria-hidden="true"></span>
            Public
          </li>
          <li>
            <span className="dot dot--private" aria-hidden="true"></span>
            Private
          </li>
        </ul>

        <div className="map-dock" ref={dockRef}>
          <button
            type="button"
            className="map-button"
            onClick={handleLocateMe}
            disabled={isLocating}
            aria-label={isLocating ? 'Locating your position' : 'Find me and my nearest bin'}
            title={isLocating ? 'Locating your position' : 'Find me and my nearest bin'}
          >
            <LocateIcon size={22} />
          </button>
          <button
            type="button"
            className="button button--primary add-bin-button"
            onClick={placePinAtMapCenter}
            aria-label={placePinLabel}
            title={placePinLabel}
          >
            <PlusIcon size={18} strokeWidth={2.25} />
            <span className="add-bin-button__label">
              {isDraftOpen ? 'Move pin' : 'Add bin'}
            </span>
          </button>
        </div>
      </div>

      {isFeedbackOpen && (
        // The backdrop catches clicks so they can't reach the map below and
        // open the add-bin form; clicking it closes the dialog instead.
        <div
          className="modal"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeFeedbackForm();
            }
          }}
          onKeyDown={handleFeedbackKeyDown}
        >
          <form
            ref={feedbackDialogRef}
            className="modal__dialog"
            onSubmit={handleFeedbackSubmit}
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-form-title"
          >
            <div className="sheet__header">
              <div className="sheet__heading">
                <h2 id="feedback-form-title" className="sheet__title">
                  Send feedback
                </h2>
                <p className="sheet__hint">
                  Share a suggestion, bug or idea for the app.
                </p>
              </div>
              <button
                type="button"
                className="icon-button icon-button--round"
                onClick={closeFeedbackForm}
                disabled={isSubmittingFeedback}
                aria-label="Close feedback form"
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <label className="field">
              <span className="field__label">
                Name <span className="field__optional">(optional)</span>
              </span>
              <input
                type="text"
                name="name"
                value={feedbackForm.name}
                onChange={handleFeedbackChange}
                maxLength={MAX_FEEDBACK_NAME_LENGTH}
                placeholder="Your name"
                autoComplete="name"
              />
            </label>

            <label className="field">
              <span className="field__label">Feedback</span>
              <textarea
                name="feedback"
                value={feedbackForm.feedback}
                onChange={handleFeedbackChange}
                maxLength={MAX_FEEDBACK_LENGTH}
                rows="4"
                placeholder="What would make the app better?"
                required
              />
            </label>

            {feedbackStatus && (
              <p
                className={`form-status form-status--${feedbackStatus.tone}`}
                role={feedbackStatus.tone === 'error' ? 'alert' : 'status'}
              >
                {feedbackStatus.text}
              </p>
            )}

            <div className="form-actions">
              <button
                type="button"
                className="button button--secondary"
                onClick={closeFeedbackForm}
                disabled={isSubmittingFeedback}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button button--primary"
                disabled={isSubmittingFeedback}
              >
                {isSubmittingFeedback ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default BinMap;
