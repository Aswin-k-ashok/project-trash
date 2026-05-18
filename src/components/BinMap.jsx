import { useEffect, useState } from 'react';
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

function getBinType(binType) {
  return binType === BIN_TYPE_PRIVATE ? BIN_TYPE_PRIVATE : BIN_TYPE_PUBLIC;
}

function createTrashBinIcon(binType) {
  return L.divIcon({
    className: 'trash-bin-marker-wrapper',
    html: `
      <div class="trash-bin-marker trash-bin-marker--${getBinType(binType)}" aria-hidden="true">
        <span class="trash-bin-marker__emoji">&#128465;</span>
      </div>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
    popupAnchor: [0, -28],
  });
}

const userLocationIcon = L.divIcon({
  className: 'user-location-marker-wrapper',
  html: '<div class="user-location-marker" aria-hidden="true"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function AddBinOnClick({ onAdd }) {
  useMapEvents({
    click(event) {
      onAdd(event.latlng);
    },
  });

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

    map.flyTo([targetLocation.lat, targetLocation.lng], DEFAULT_ZOOM, {
      duration: 1.2,
    });
  }, [map, targetLocation]);

  return null;
}

function getSupabaseErrorMessage(error, fallbackMessage) {
  if (!error) {
    return fallbackMessage;
  }

  if (error.code === 'PGRST205') {
    return "Supabase cannot find the 'bins' table. Run the SQL from supabase/schema.sql in your Supabase SQL Editor, then refresh the app.";
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

function getDeleteFailureMessage() {
  return "The bin could not be deleted from Supabase. Run the latest SQL from supabase/schema.sql in your Supabase SQL Editor to make sure the delete policy is installed, then refresh the app.";
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

function BinMap() {
  const [bins, setBins] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [mapCenter, setMapCenter] = useState(DEFAULT_CENTER);
  const [placeName, setPlaceName] = useState('Kochi, Kerala');
  const [draftBin, setDraftBin] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackForm, setFeedbackForm] = useState({
    name: '',
    feedback: '',
  });
  const [feedbackStatusMessage, setFeedbackStatusMessage] = useState('');

  useEffect(() => {
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

      const { data, error } = await supabase
        .from('bins')
        .select('*')
        .order('created_at', { ascending: false });

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
  }, []);

  useEffect(() => {
    const controller = new AbortController();

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

        if (locality && region) {
          setPlaceName(`${locality}, ${region}`);
          return;
        }

        if (result.display_name) {
          setPlaceName(result.display_name.split(',').slice(0, 2).join(', '));
          return;
        }

        setPlaceName(
          `${mapCenter.lat.toFixed(4)}, ${mapCenter.lng.toFixed(4)}`
        );
      } catch (error) {
        if (error.name === 'AbortError') {
          return;
        }

        setPlaceName(`${mapCenter.lat.toFixed(4)}, ${mapCenter.lng.toFixed(4)}`);
      }
    }

    const timeoutId = window.setTimeout(loadPlaceName, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [mapCenter]);

  function markNewBin(latlng) {
    if (!isSupabaseConfigured) {
      setErrorMessage(
        'You need to configure Supabase before adding bins from the map.'
      );
      return;
    }

    setErrorMessage('');
    setDraftBin({
      latitude: latlng.lat,
      longitude: latlng.lng,
      binType: BIN_TYPE_PUBLIC,
      title: '',
      description: '',
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
    setDraftBin(null);
  }

  function openFeedbackForm() {
    setFeedbackStatusMessage('');
    setIsFeedbackOpen(true);
  }

  function closeFeedbackForm() {
    if (isSubmittingFeedback) {
      return;
    }

    setIsFeedbackOpen(false);
    setFeedbackStatusMessage('');
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

    if (!draftBin) {
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
    setIsSaving(false);
  }

  async function handleDeleteBin(binId) {
    if (!isSupabaseConfigured) {
      setErrorMessage(
        'You need to configure Supabase before deleting bins from the map.'
      );
      return;
    }

    const shouldDelete = window.confirm(
      'Are you sure you want to delete this waste bin?'
    );

    if (!shouldDelete) {
      return;
    }

    setIsSaving(true);
    setErrorMessage('');

    const { data, error } = await supabase
      .from('bins')
      .delete()
      .eq('id', binId)
      .select('id');

    if (error) {
      setErrorMessage(
        getSupabaseErrorMessage(
          error,
          'Could not delete the bin. Please try again.'
        )
      );
      setIsSaving(false);
      return;
    }

    if (!data || data.length === 0) {
      setErrorMessage(getDeleteFailureMessage());
      setIsSaving(false);
      return;
    }

    setBins((currentBins) => currentBins.filter((bin) => bin.id !== binId));
    setIsSaving(false);
  }

  async function handleFeedbackSubmit(event) {
    event.preventDefault();

    if (!isSupabaseConfigured) {
      setFeedbackStatusMessage(
        'Supabase is not configured yet. Add your environment variables before sending feedback.'
      );
      return;
    }

    setIsSubmittingFeedback(true);
    setFeedbackStatusMessage('');

    const { error } = await supabase.from('app_feedback').insert({
      name: feedbackForm.name.trim() || null,
      feedback: feedbackForm.feedback.trim(),
    });

    if (error) {
      setFeedbackStatusMessage(getFeedbackErrorMessage(error));
      setIsSubmittingFeedback(false);
      return;
    }

    setFeedbackForm({
      name: '',
      feedback: '',
    });
    setFeedbackStatusMessage('Thanks for the feedback. It has been sent.');
    setIsSubmittingFeedback(false);

    window.setTimeout(() => {
      setIsFeedbackOpen(false);
      setFeedbackStatusMessage('');
    }, 1200);
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

  return (
    <div className="map-wrapper">
      <div className="toolbar">
        <div>
          <h2>Current Area: {placeName}</h2>
          <p>Tap the map to add a waste bin. No paperwork required.</p>
        </div>
        <div className="status-group">
          {isLoading && <span className="status">Loading bins...</span>}
          {isSaving && <span className="status">Saving new bin...</span>}
          {isLocating && <span className="status">Finding your location...</span>}
        </div>
      </div>

      {errorMessage && <p className="error-banner">{errorMessage}</p>}

      {draftBin && (
        <form className="bin-form" onSubmit={handleSaveDraftBin}>
          <div className="bin-form-header">
            <h3>Add New Bin</h3>
            <p>
              {draftBin.latitude.toFixed(5)}, {draftBin.longitude.toFixed(5)}
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
              placeholder="Example: Near bus stop"
            />
          </label>

          <label className="field">
            <span>Description</span>
            <textarea
              name="description"
              value={draftBin.description}
              onChange={handleDraftChange}
              rows="3"
              placeholder="Add any details that help identify this bin"
            />
          </label>

          <div className="form-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={handleCancelDraft}
            >
              Cancel
            </button>
            <button type="submit" className="button" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Bin'}
            </button>
          </div>
        </form>
      )}

      <div className="map-stage">
        <button
          type="button"
          className="locate-button"
          onClick={handleLocateMe}
          disabled={isLocating}
          aria-label={isLocating ? 'Locating your position' : 'Locate me'}
          title={isLocating ? 'Locating your position' : 'Locate me'}
        >
          <span className="locate-button__icon" aria-hidden="true">
            <span className="locate-button__dot"></span>
          </span>
        </button>

        <button
          type="button"
          className="feedback-trigger"
          onClick={openFeedbackForm}
        >
          Suggestion & Feedback
        </button>

        {isFeedbackOpen && (
          <div className="feedback-modal" role="dialog" aria-modal="true">
            <form className="feedback-form" onSubmit={handleFeedbackSubmit}>
              <div className="feedback-form__header">
                <h3>App Feedback</h3>
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
                  placeholder="Your name"
                />
              </label>

              <label className="field">
                <span>Feedback</span>
                <textarea
                  name="feedback"
                  value={feedbackForm.feedback}
                  onChange={handleFeedbackChange}
                  rows="4"
                  placeholder="Tell us what would make the app better"
                  required
                />
              </label>

              {feedbackStatusMessage && (
                <p className="feedback-form__status">{feedbackStatusMessage}</p>
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

        <MapContainer
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

          {userLocation && (
            <Marker
              position={[userLocation.lat, userLocation.lng]}
              icon={userLocationIcon}
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

          {bins.map((bin) => (
            <Marker
              key={bin.id}
              position={[bin.latitude, bin.longitude]}
              icon={createTrashBinIcon(bin.bin_type)}
            >
              <Popup>
                <div className="popup-content">
                  <strong>{bin.title || 'Waste bin'}</strong>
                  <p>{bin.description || 'No description added.'}</p>
                  <p className="popup-bin-type">
                    {getBinType(bin.bin_type) === BIN_TYPE_PUBLIC
                      ? 'Public bin'
                      : 'Private bin'}
                  </p>
                  <small>
                    {bin.latitude.toFixed(5)}, {bin.longitude.toFixed(5)}
                  </small>
                  <button
                    type="button"
                    className="button button-danger popup-button"
                    onClick={() => handleDeleteBin(bin.id)}
                  >
                    Delete Bin
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}

export default BinMap;
