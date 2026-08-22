const resolvedLocationSources = new Set(["google", "nominatim", "geolocation", "map", "manual", "saved"]);

export function finiteLocationCoordinate(value) {
  if (value === "" || value === null || value === undefined) return null;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
}

export function normalizeStructuredLocation(value = {}) {
  const formattedAddress = String(
    value.formattedAddress
      ?? value.formatted_address
      ?? value.address
      ?? value.delivery_address
      ?? value.location
      ?? ""
  ).trim();

  return {
    address: formattedAddress,
    formattedAddress,
    barangay: String(value.barangay ?? value.delivery_barangay ?? "").trim(),
    municipality: String(value.municipality ?? value.delivery_municipality ?? value.city ?? "").trim(),
    province: String(value.province ?? value.delivery_province ?? "").trim(),
    region: String(value.region ?? value.delivery_region ?? "").trim(),
    postalCode: String(value.postalCode ?? value.postal_code ?? value.delivery_postal_code ?? "").trim(),
    latitude: finiteLocationCoordinate(value.latitude ?? value.delivery_latitude),
    longitude: finiteLocationCoordinate(value.longitude ?? value.delivery_longitude),
    placeId: String(value.placeId ?? value.place_id ?? value.delivery_place_id ?? "").trim(),
    locationSource: String(value.locationSource ?? value.location_source ?? value.delivery_location_source ?? "").trim().toLowerCase(),
    landmark: String(value.landmark ?? value.delivery_landmark ?? "").trim(),
    notes: String(value.notes ?? value.delivery_notes ?? "").trim()
  };
}

export function hasLocationCoordinates(value) {
  const location = normalizeStructuredLocation(value);
  return location.latitude !== null && location.longitude !== null;
}

export function isResolvedLocation(value) {
  const location = normalizeStructuredLocation(value);
  return Boolean(location.formattedAddress && resolvedLocationSources.has(location.locationSource));
}

export function unresolvedLocation(value, address) {
  const current = normalizeStructuredLocation(value);
  return {
    ...current,
    address,
    formattedAddress: address,
    barangay: "",
    municipality: "",
    province: "",
    region: "",
    postalCode: "",
    latitude: null,
    longitude: null,
    placeId: "",
    locationSource: ""
  };
}

export function locationFromProfile(profile = {}) {
  const location = normalizeStructuredLocation(profile);
  if (!location.locationSource && location.formattedAddress) {
    location.locationSource = hasLocationCoordinates(location) ? "saved" : "manual";
  }
  return location;
}

export function profileFieldsFromLocation(value) {
  const location = normalizeStructuredLocation(value);
  return {
    location: location.formattedAddress,
    formatted_address: location.formattedAddress,
    delivery_barangay: location.barangay || null,
    delivery_municipality: location.municipality || null,
    delivery_province: location.province || null,
    delivery_region: location.region || null,
    delivery_postal_code: location.postalCode || null,
    delivery_place_id: location.placeId || null,
    delivery_latitude: location.latitude,
    delivery_longitude: location.longitude,
    delivery_location_source: location.locationSource || null
  };
}

export function registrationFieldsFromLocation(value) {
  const location = normalizeStructuredLocation(value);
  return {
    location: location.formattedAddress,
    formattedAddress: location.formattedAddress,
    barangay: location.barangay,
    municipality: location.municipality,
    province: location.province,
    region: location.region,
    postalCode: location.postalCode,
    latitude: location.latitude,
    longitude: location.longitude,
    placeId: location.placeId,
    locationSource: location.locationSource
  };
}

export function locationValidationMessage(value) {
  const location = normalizeStructuredLocation(value);
  if (!location.formattedAddress) return "Location is required.";
  if (!isResolvedLocation(location)) return "Please select a location from the suggestions.";
  return "";
}

export function formatDistanceKm(value) {
  const distance = Number(value);
  if (!Number.isFinite(distance) || distance < 0) return "";
  return `${distance.toFixed(1)} km`;
}
