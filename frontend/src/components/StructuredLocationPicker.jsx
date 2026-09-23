import { useEffect, useId, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CheckCircle2, Loader2, LocateFixed, MapPin, Search, TriangleAlert } from "lucide-react";
import { OSM_ATTRIBUTION, OSM_TILE_URL, validMapCoordinate } from "../config/maps";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import {
  hasLocationCoordinates,
  isResolvedLocation,
  normalizeStructuredLocation,
  unresolvedLocation
} from "../utils/location";

const defaultMapCenter = { latitude: 7.1907, longitude: 124.5308 };
const gpsOptions = { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 };
const preferredGpsAccuracyMeters = 80;
const usableGpsAccuracyMeters = 250;
const deliveryPinIcon = L.divIcon({
  className: "retela-leaflet-pin-icon is-customer retela-structured-leaflet-pin",
  html: "<span></span><strong>Delivery Pin</strong>",
  iconSize: [92, 46],
  iconAnchor: [18, 40],
  popupAnchor: [0, -36]
});

function locationFromNominatim(item, source = "nominatim") {
  const address = item?.address || {};
  return normalizeStructuredLocation({
    formattedAddress: item?.display_name || "",
    barangay: address.suburb || address.village || address.quarter || address.neighbourhood || address.hamlet || "",
    municipality: address.city || address.municipality || address.town || address.county || "",
    province: address.province || address.state_district || "",
    region: address.region || address.state || "",
    postalCode: address.postcode || "",
    latitude: item?.lat,
    longitude: item?.lon,
    placeId: item?.place_id ? String(item.place_id) : "",
    locationSource: source
  });
}

async function searchNominatim(query, signal) {
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=ph&q=${encodeURIComponent(query)}`, { signal });
  if (!response.ok) throw new Error("Location suggestions are unavailable");
  const rows = await response.json();
  return (Array.isArray(rows) ? rows : []).map((item) => ({
    id: `osm-${item.place_id}`,
    label: item.display_name,
    provider: "nominatim",
    raw: item
  })).filter((item) => item.label);
}

async function reverseNominatim(latitude, longitude, signal) {
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&zoom=18`, { signal });
  if (!response.ok) throw new Error("Pinned address could not be resolved");
  return response.json();
}

function gpsErrorMessage(error) {
  if (error?.code === 1) return "Location permission was denied. You can still search for an address or place the pin manually on the map.";
  if (error?.code === 2) return `GPS is unavailable on this device right now.${error?.message ? ` ${error.message}` : ""} You can place the pin manually.`;
  if (error?.code === 3) return `GPS timed out before a fresh location was found.${error?.message ? ` ${error.message}` : ""} Try again or place the pin manually.`;
  return error?.message || "Current location could not be accessed. Search for an address or place the pin manually.";
}

function fallbackCoordinateAddress(latitude, longitude, source) {
  const label = source === "geolocation" ? "Current GPS location" : "Pinned location";
  return `${label} (${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)})`;
}

function gpsAccuracyMessage(accuracy) {
  const value = Number(accuracy);
  if (!Number.isFinite(value)) return "GPS accuracy was not reported. Check the pin and move it manually if needed.";
  if (value > usableGpsAccuracyMeters) return `GPS accuracy is low (${Math.round(value)} m). The pin uses the reported coordinates; drag it if needed.`;
  if (value > preferredGpsAccuracyMeters) return `GPS accuracy is about ${Math.round(value)} m. Check the pin before saving.`;
  return "";
}

function getFreshGpsPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Current location is not supported by this browser."));
      return;
    }
    const requestedAt = Date.now();
    let settled = false;
    let watchId = null;
    let bestPosition = null;
    const clear = () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
    };
    const finish = (position) => {
      if (settled) return;
      settled = true;
      clear();
      window.clearTimeout(timeoutId);
      resolve(position);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clear();
      window.clearTimeout(timeoutId);
      reject(error);
    };
    const timeoutId = window.setTimeout(() => {
      if (bestPosition) finish(bestPosition);
      else fail(Object.assign(new Error("GPS timed out before a fresh location was found."), { code: 3 }));
    }, gpsOptions.timeout);
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const timestamp = Number(position.timestamp || 0);
        const ageMs = timestamp ? Math.abs(Date.now() - timestamp) : Infinity;
        const staleBeforePress = timestamp && timestamp < requestedAt - 2000;
        if (staleBeforePress || ageMs > 30000) return;
        const accuracy = Number(position.coords?.accuracy);
        if (!bestPosition || (Number.isFinite(accuracy) && accuracy < Number(bestPosition.coords?.accuracy ?? Infinity))) {
          bestPosition = position;
        }
        if (Number.isFinite(accuracy) && accuracy <= preferredGpsAccuracyMeters) finish(position);
      },
      (error) => {
        if (bestPosition) finish(bestPosition);
        else fail(error);
      },
      gpsOptions
    );
  });
}

export default function StructuredLocationPicker({
  value,
  onChange,
  error = "",
  compact = false,
  label = "Search location",
  placeholder = "Search street, barangay, municipality...",
  allowCurrentLocation = true,
  onBlur
}) {
  const inputId = useId();
  const normalized = useMemo(() => normalizeStructuredLocation(value), [value]);
  const [query, setQuery] = useState(normalized.formattedAddress);
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [attemptedSearch, setAttemptedSearch] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchAbortRef = useRef(null);
  const reverseAbortRef = useRef(null);
  const gpsRequestRef = useRef(0);

  useEffect(() => {
    if (normalized.formattedAddress !== query && isResolvedLocation(normalized)) {
      setQuery(normalized.formattedAddress);
    }
  }, [normalized, query]);

  useEffect(() => {
    const text = query.trim();
    if (resolving) {
      setSuggestions([]);
      setSearching(false);
      return undefined;
    }
    if (text.length < 3 || (isResolvedLocation(normalized) && text === normalized.formattedAddress)) {
      setSuggestions([]);
      setSearching(false);
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      setSearching(true);
      setSearchError("");
      setAttemptedSearch(true);
      try {
        const rows = await searchNominatim(text, controller.signal);
        if (!controller.signal.aborted) setSuggestions(rows);
      } catch (requestError) {
        if (requestError?.name !== "AbortError") {
          setSuggestions([]);
          setSearchError("Location suggestions could not be loaded. Use the manual address option below.");
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [normalized, query, resolving]);

  useEffect(() => () => {
    searchAbortRef.current?.abort();
    reverseAbortRef.current?.abort();
  }, []);

  function changeQuery(nextQuery) {
    setQuery(nextQuery);
    setSuggestions([]);
    setAttemptedSearch(false);
    setSearchError("");
    onChange(unresolvedLocation(normalized, nextQuery));
  }

  async function selectSuggestion(suggestion) {
    setResolving(true);
    setSearchError("");
    try {
      const next = locationFromNominatim(suggestion.raw);
      setQuery(next.formattedAddress);
      setSuggestions([]);
      onChange(next);
    } catch {
      setSearchError("That location could not be resolved. Please choose another suggestion.");
    } finally {
      setResolving(false);
    }
  }

  function applyCoordinateLocation({ latitude, longitude, source, accuracy = null, address = "" }) {
    const nextLatitude = Number(latitude);
    const nextLongitude = Number(longitude);
    if (!validMapCoordinate(nextLatitude, nextLongitude)) {
      setSearchError("That map position is not valid. Please choose another pin location.");
      return null;
    }
    const formattedAddress = address || fallbackCoordinateAddress(nextLatitude, nextLongitude, source);
    const next = normalizeStructuredLocation({
      formattedAddress,
      latitude: nextLatitude,
      longitude: nextLongitude,
      accuracy,
      placeId: "",
      locationSource: source
    });
    setQuery(formattedAddress);
    setSuggestions([]);
    onChange(next);
    return next;
  }

  async function resolveCoordinates(latitude, longitude, source, options = {}) {
    const nextLatitude = Number(latitude);
    const nextLongitude = Number(longitude);
    if (!validMapCoordinate(nextLatitude, nextLongitude)) {
      setSearchError("That map position is not valid. Please choose another pin location.");
      return null;
    }
    reverseAbortRef.current?.abort();
    const controller = new AbortController();
    reverseAbortRef.current = controller;
    setResolving(true);
    if (!options.keepWarning) setSearchError("");
    const baseLocation = options.commitFirst
      ? applyCoordinateLocation({
        latitude: nextLatitude,
        longitude: nextLongitude,
        source,
        accuracy: options.accuracy,
        address: options.address
      })
      : null;
    try {
      const item = await reverseNominatim(nextLatitude, nextLongitude, controller.signal);
      const reverseLocation = locationFromNominatim({ ...item, lat: nextLatitude, lon: nextLongitude }, source);
      const next = normalizeStructuredLocation({
        ...reverseLocation,
        latitude: nextLatitude,
        longitude: nextLongitude,
        accuracy: options.accuracy ?? baseLocation?.accuracy ?? null,
        locationSource: source
      });
      setQuery(next.formattedAddress);
      setSuggestions([]);
      onChange(next);
      return next;
    } catch (requestError) {
      if (requestError?.name === "AbortError") return baseLocation;
      const next = baseLocation || applyCoordinateLocation({
        latitude: nextLatitude,
        longitude: nextLongitude,
        source,
        accuracy: options.accuracy
      });
      if (!options.keepWarning) setSearchError("The pin was saved, but its street address could not be resolved.");
      return next;
    } finally {
      if (!controller.signal.aborted) setResolving(false);
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setSearchError("Current location is not supported by this browser.");
      return;
    }
    const requestId = gpsRequestRef.current + 1;
    gpsRequestRef.current = requestId;
    reverseAbortRef.current?.abort();
    setResolving(true);
    setSearchError("");
    setQuery("Finding your current GPS location...");
    setSuggestions([]);
    getFreshGpsPosition()
      .then((position) => {
        if (requestId !== gpsRequestRef.current) return;
        const latitude = Number(position.coords.latitude);
        const longitude = Number(position.coords.longitude);
        const accuracy = Number.isFinite(Number(position.coords.accuracy)) ? Number(position.coords.accuracy) : null;
        const warning = gpsAccuracyMessage(accuracy);
        if (warning) setSearchError(warning);
        void resolveCoordinates(latitude, longitude, "geolocation", {
          accuracy,
          address: fallbackCoordinateAddress(latitude, longitude, "geolocation"),
          commitFirst: true,
          keepWarning: Boolean(warning)
        });
      })
      .catch((geoError) => {
        if (requestId !== gpsRequestRef.current) return;
        setResolving(false);
        setSearchError(gpsErrorMessage(geoError));
        setQuery(normalized.formattedAddress || "");
      });
  }

  function useManualAddress() {
    const formattedAddress = query.trim();
    if (!formattedAddress) return;
    const next = normalizeStructuredLocation({ formattedAddress, locationSource: "manual" });
    setSuggestions([]);
    setSearchError("");
    onChange(next);
  }

  const showManualFallback = query.trim().length >= 3 && !searching && (Boolean(searchError) || (attemptedSearch && !suggestions.length));
  const details = [normalized.barangay, normalized.municipality, normalized.province, normalized.region, normalized.postalCode].filter(Boolean);
  const accuracy = Number(normalized.accuracy);
  const accuracyText = Number.isFinite(accuracy) ? `GPS accuracy: ${Math.round(accuracy)} m` : "";

  return (
    <div className={`retela-structured-location ${compact ? "is-compact" : ""}`}>
      <label className="retela-structured-location-label" htmlFor={inputId}>
        <span>{label}</span>
        <span className={`retela-structured-location-input ${error ? "is-invalid" : ""}`}>
          <Search size={17} />
          <input
            id={inputId}
            value={query}
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={Boolean(suggestions.length)}
            placeholder={placeholder}
            onChange={(event) => changeQuery(event.target.value)}
            onBlur={onBlur}
          />
          {searching || resolving ? <Loader2 size={16} className="animate-spin" /> : isResolvedLocation(normalized) ? <CheckCircle2 size={17} /> : null}
        </span>
      </label>

      {suggestions.length ? (
        <div className="retela-structured-location-results" role="listbox" aria-label="Location suggestions">
          {suggestions.map((suggestion) => (
            <button type="button" key={`${suggestion.provider}-${suggestion.id}`} onClick={() => void selectSuggestion(suggestion)}>
              <MapPin size={15} />
              <span>{suggestion.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      {allowCurrentLocation ? (
        <button type="button" className="retela-structured-location-current" onClick={useCurrentLocation} disabled={resolving}>
          {resolving ? <Loader2 size={16} className="animate-spin" /> : <LocateFixed size={16} />}
          Use My Current Location
        </button>
      ) : null}

      {searchError ? <p className="retela-structured-location-notice is-warning"><TriangleAlert size={14} /> {searchError}</p> : null}
      {error ? <p className="retela-structured-location-error">{error}</p> : null}

      {showManualFallback ? (
        <button type="button" className="retela-structured-location-manual" onClick={useManualAddress}>
          Use this as a manual address
        </button>
      ) : null}

      {isResolvedLocation(normalized) ? (
        <div className="retela-structured-location-selection">
          <strong>{normalized.formattedAddress}</strong>
          {details.length ? <span>{details.join(" | ")}</span> : null}
          {accuracyText ? <span>{accuracyText}</span> : null}
          {!hasLocationCoordinates(normalized) ? <span className="is-warning">Manual address saved. Map coordinates are unavailable.</span> : null}
        </div>
      ) : null}

      <StructuredLocationMap
        location={normalized}
        resolving={resolving}
        onSelect={(latitude, longitude) => void resolveCoordinates(latitude, longitude, "map")}
      />
    </div>
  );
}

function StructuredLocationMap({ location, resolving, onSelect }) {
  const hasCoordinates = hasLocationCoordinates(location);
  const latitude = hasCoordinates ? Number(location.latitude) : defaultMapCenter.latitude;
  const longitude = hasCoordinates ? Number(location.longitude) : defaultMapCenter.longitude;
  const center = useMemo(() => [latitude, longitude], [latitude, longitude]);

  return (
    <div className="retela-structured-map-wrap">
      <div className="retela-structured-map" aria-label="Delivery location map">
        <MapContainer center={center} zoom={hasCoordinates ? 17 : 14} className="retela-structured-leaflet-map" zoomControl scrollWheelZoom>
          <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_TILE_URL} />
          {hasCoordinates ? (
            <Marker
              position={center}
              icon={deliveryPinIcon}
              draggable
              eventHandlers={{
                dragend: (event) => {
                  const marker = event.target;
                  const next = marker.getLatLng();
                  onSelect(next.lat, next.lng);
                }
              }}
            />
          ) : null}
          <StructuredLocationMapController
            center={center}
            hasCoordinates={hasCoordinates}
            onSelect={onSelect}
          />
        </MapContainer>
        {resolving ? <span className="retela-delivery-map-status"><Loader2 size={14} className="animate-spin" /> Resolving address</span> : null}
      </div>
      <p>{hasCoordinates ? "Drag the pin or tap the map to fine-tune the delivery point." : "Search, use GPS, or tap the map to place the delivery pin manually."}</p>
    </div>
  );
}

function StructuredLocationMapController({ center, hasCoordinates, onSelect }) {
  const map = useMap();
  useMapEvents({
    click(event) {
      onSelect(event.latlng.lat, event.latlng.lng);
    }
  });

  useEffect(() => {
    window.setTimeout(() => map.invalidateSize(), 80);
  }, [map]);

  useEffect(() => {
    if (!hasCoordinates) return;
    map.flyTo(center, Math.max(Number(map.getZoom() || 16), 16), { animate: true, duration: 0.5 });
  }, [center, hasCoordinates, map]);

  return null;
}
