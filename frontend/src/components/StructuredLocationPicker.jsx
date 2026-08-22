import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, LocateFixed, MapPin, Search, TriangleAlert } from "lucide-react";
import { osmTileUrl } from "../config/maps";
import {
  hasLocationCoordinates,
  isResolvedLocation,
  normalizeStructuredLocation,
  unresolvedLocation
} from "../utils/location";

const defaultMapCenter = { latitude: 7.1907, longitude: 124.5308 };
let googlePlacesPromise;

function loadGooglePlaces(apiKey) {
  if (!apiKey) return Promise.reject(new Error("Google Maps key is not configured"));
  if (window.google?.maps?.places) return Promise.resolve(window.google);
  if (googlePlacesPromise) return googlePlacesPromise;

  googlePlacesPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById("retela-google-maps-places");
    let timeoutId;
    const onReady = () => {
      window.clearTimeout(timeoutId);
      if (window.google?.maps?.places) resolve(window.google);
      else reject(new Error("Google Places did not load"));
    };
    const onError = () => {
      window.clearTimeout(timeoutId);
      reject(new Error("Google Places failed to load"));
    };

    if (existing) {
      if (window.google?.maps && !window.google.maps.places) {
        reject(new Error("Google Places is unavailable"));
        return;
      }
      existing.addEventListener("load", onReady, { once: true });
      existing.addEventListener("error", onError, { once: true });
      timeoutId = window.setTimeout(onError, 12000);
      return;
    }

    const script = document.createElement("script");
    script.id = "retela-google-maps-places";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&v=weekly`;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", onReady, { once: true });
    script.addEventListener("error", onError, { once: true });
    timeoutId = window.setTimeout(onError, 12000);
    document.head.appendChild(script);
  }).catch((error) => {
    document.getElementById("retela-google-maps-places")?.remove();
    googlePlacesPromise = undefined;
    throw error;
  });

  return googlePlacesPromise;
}

function componentValue(components, ...types) {
  for (const type of types) {
    const component = components.find((item) => item.types?.includes(type));
    if (component?.long_name) return component.long_name;
  }
  return "";
}

function locationFromGooglePlace(place) {
  const components = Array.isArray(place?.address_components) ? place.address_components : [];
  const latitude = place?.geometry?.location?.lat?.();
  const longitude = place?.geometry?.location?.lng?.();
  const formattedAddress = String(place?.formatted_address || place?.name || "").trim();
  return normalizeStructuredLocation({
    formattedAddress,
    barangay: componentValue(components, "sublocality_level_1", "sublocality", "neighborhood", "administrative_area_level_4"),
    municipality: componentValue(components, "locality", "postal_town", "administrative_area_level_3", "administrative_area_level_2"),
    province: componentValue(components, "administrative_area_level_2"),
    region: componentValue(components, "administrative_area_level_1"),
    postalCode: componentValue(components, "postal_code"),
    latitude,
    longitude,
    placeId: place?.place_id || "",
    locationSource: "google"
  });
}

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

function googlePredictions(query) {
  return new Promise((resolve, reject) => {
    const service = new window.google.maps.places.AutocompleteService();
    service.getPlacePredictions({ input: query, componentRestrictions: { country: "ph" } }, (rows, status) => {
      const statuses = window.google.maps.places.PlacesServiceStatus;
      if (status === statuses.ZERO_RESULTS) return resolve([]);
      if (status !== statuses.OK) return reject(new Error("Google location suggestions are unavailable"));
      resolve((rows || []).map((item) => ({
        id: item.place_id,
        label: item.description,
        provider: "google",
        raw: item
      })));
    });
  });
}

function googlePlaceDetails(placeId) {
  return new Promise((resolve, reject) => {
    const service = new window.google.maps.places.PlacesService(document.createElement("div"));
    service.getDetails({
      placeId,
      fields: ["place_id", "formatted_address", "name", "geometry", "address_components"]
    }, (place, status) => {
      const statuses = window.google.maps.places.PlacesServiceStatus;
      if (status !== statuses.OK || !place) return reject(new Error("Location details could not be loaded"));
      resolve(place);
    });
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
  const [provider, setProvider] = useState("loading");
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [attemptedSearch, setAttemptedSearch] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [providerNotice, setProviderNotice] = useState("");
  const searchAbortRef = useRef(null);
  const reverseAbortRef = useRef(null);
  const mapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";

  useEffect(() => {
    let active = true;
    if (!mapsKey) {
      setProvider("nominatim");
      return undefined;
    }
    loadGooglePlaces(mapsKey)
      .then(() => {
        if (active) setProvider("google");
      })
      .catch(() => {
        if (!active) return;
        setProvider("nominatim");
        setProviderNotice("Google location suggestions are unavailable. Alternative suggestions are active.");
      });
    return () => {
      active = false;
    };
  }, [mapsKey]);

  useEffect(() => {
    if (normalized.formattedAddress !== query && isResolvedLocation(normalized)) {
      setQuery(normalized.formattedAddress);
    }
  }, [normalized, query]);

  useEffect(() => {
    const text = query.trim();
    if (provider === "loading" || text.length < 3 || (isResolvedLocation(normalized) && text === normalized.formattedAddress)) {
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
        let rows;
        if (provider === "google") {
          try {
            rows = await googlePredictions(text);
          } catch {
            setProvider("nominatim");
            setProviderNotice("Google location suggestions are unavailable. Alternative suggestions are active.");
            rows = await searchNominatim(text, controller.signal);
          }
        } else {
          rows = await searchNominatim(text, controller.signal);
        }
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
  }, [normalized, provider, query]);

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
      const next = suggestion.provider === "google"
        ? locationFromGooglePlace(await googlePlaceDetails(suggestion.id))
        : locationFromNominatim(suggestion.raw);
      setQuery(next.formattedAddress);
      setSuggestions([]);
      onChange(next);
    } catch {
      setSearchError("That location could not be resolved. Please choose another suggestion.");
    } finally {
      setResolving(false);
    }
  }

  async function resolveCoordinates(latitude, longitude, source) {
    reverseAbortRef.current?.abort();
    const controller = new AbortController();
    reverseAbortRef.current = controller;
    setResolving(true);
    setSearchError("");
    try {
      const item = await reverseNominatim(latitude, longitude, controller.signal);
      const next = locationFromNominatim({ ...item, lat: latitude, lon: longitude }, source);
      setQuery(next.formattedAddress);
      setSuggestions([]);
      onChange(next);
    } catch (requestError) {
      if (requestError?.name === "AbortError") return;
      const fallbackAddress = normalized.formattedAddress || `Pinned location (${latitude.toFixed(6)}, ${longitude.toFixed(6)})`;
      const next = normalizeStructuredLocation({
        ...normalized,
        formattedAddress: fallbackAddress,
        latitude,
        longitude,
        placeId: "",
        locationSource: source
      });
      setQuery(fallbackAddress);
      onChange(next);
      setSearchError("The pin was saved, but its street address could not be resolved.");
    } finally {
      if (!controller.signal.aborted) setResolving(false);
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setSearchError("Current location is not supported by this browser.");
      return;
    }
    setResolving(true);
    navigator.geolocation.getCurrentPosition(
      (position) => void resolveCoordinates(Number(position.coords.latitude), Number(position.coords.longitude), "geolocation"),
      () => {
        setResolving(false);
        setSearchError("Current location could not be accessed. Search for an address or use the manual fallback.");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
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
          {searching || resolving || provider === "loading" ? <Loader2 size={16} className="animate-spin" /> : isResolvedLocation(normalized) ? <CheckCircle2 size={17} /> : null}
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

      {providerNotice ? <p className="retela-structured-location-notice"><TriangleAlert size={14} /> {providerNotice}</p> : null}
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
          {!hasLocationCoordinates(normalized) ? <span className="is-warning">Manual address saved. Map coordinates are unavailable.</span> : null}
        </div>
      ) : null}

      {hasLocationCoordinates(normalized) ? (
        <StructuredLocationMap
          location={normalized}
          compact={compact}
          resolving={resolving}
          onSelect={(latitude, longitude) => void resolveCoordinates(latitude, longitude, "map")}
        />
      ) : null}
    </div>
  );
}

function StructuredLocationMap({ location, compact, resolving, onSelect }) {
  const [zoom, setZoom] = useState(compact ? 15 : 16);
  const [tileState, setTileState] = useState("loading");
  const [tileVersion, setTileVersion] = useState(0);
  const latitude = location.latitude ?? defaultMapCenter.latitude;
  const longitude = location.longitude ?? defaultMapCenter.longitude;
  const center = projectToTile(latitude, longitude, zoom);
  const tileX = Math.floor(center.x);
  const tileY = Math.floor(center.y);
  const offsetX = center.x - tileX;
  const offsetY = center.y - tileY;
  const tiles = [];
  for (let y = -1; y <= 1; y += 1) {
    for (let x = -1; x <= 1; x += 1) tiles.push({ x, y, tileX: tileX + x, tileY: tileY + y });
  }

  useEffect(() => {
    setTileState("loading");
  }, [latitude, longitude, zoom]);

  function handleMapClick(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - rect.left - rect.width / 2) / 256;
    const dy = (event.clientY - rect.top - rect.height / 2) / 256;
    const next = unprojectFromTile(center.x + dx, center.y + dy, zoom);
    onSelect(next.latitude, next.longitude);
  }

  return (
    <div className="retela-structured-map-wrap">
      <div className="retela-structured-map" onClick={handleMapClick} role="button" tabIndex={0} aria-label="Tap map to move location pin">
        {tileState !== "error" && tiles.map((tile) => (
          <img
            key={`${tile.tileX}-${tile.tileY}-${zoom}-${tileVersion}`}
            src={osmTileUrl(zoom, tile.tileX, tile.tileY, tileVersion)}
            alt=""
            loading="lazy"
            onLoad={() => setTileState((state) => state === "loading" ? "ready" : state)}
            onError={() => setTileState("error")}
            style={{
              left: `calc(50% + ${(tile.x - offsetX) * 256}px)`,
              top: `calc(50% + ${(tile.y - offsetY) * 256}px)`
            }}
          />
        ))}
        {tileState === "error" ? (
          <div className="retela-map-status-overlay">
            <span>Map could not be loaded.</span>
            <button type="button" onClick={(event) => { event.stopPropagation(); setTileState("loading"); setTileVersion((version) => version + 1); }}>Retry</button>
          </div>
        ) : null}
        {tileState === "loading" ? <div className="retela-map-status-overlay is-loading"><Loader2 size={16} className="animate-spin" /> Loading map...</div> : null}
        {tileState === "ready" ? <span className="retela-delivery-map-pin"><MapPin size={compact ? 25 : 30} /></span> : null}
        <div className="retela-delivery-map-tools">
          <button type="button" aria-label="Zoom in" onClick={(event) => { event.stopPropagation(); setZoom((value) => Math.min(18, value + 1)); }}>+</button>
          <button type="button" aria-label="Zoom out" onClick={(event) => { event.stopPropagation(); setZoom((value) => Math.max(12, value - 1)); }}>-</button>
        </div>
        {resolving ? <span className="retela-delivery-map-status"><Loader2 size={14} className="animate-spin" /> Resolving address</span> : null}
      </div>
      <p>Tap the map to fine-tune the delivery pin.</p>
    </div>
  );
}

function projectToTile(latitude, longitude, zoom) {
  const clampedLatitude = Math.max(-85, Math.min(85, latitude));
  const latRad = (clampedLatitude * Math.PI) / 180;
  const scale = 2 ** zoom;
  return {
    x: ((longitude + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale
  };
}

function unprojectFromTile(x, y, zoom) {
  const scale = 2 ** zoom;
  return {
    longitude: (x / scale) * 360 - 180,
    latitude: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale))) * 180) / Math.PI
  };
}
