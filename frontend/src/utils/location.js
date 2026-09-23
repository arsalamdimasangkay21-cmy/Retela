const resolvedLocationSources = new Set(["google", "nominatim", "geolocation", "map", "manual", "saved"]);

function locationSource(value) {
  if (value === null || value === undefined) return {};
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return {};
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
        if (typeof parsed === "string") return { address: parsed };
        if (parsed === null) return {};
      } catch {
        return { address: text };
      }
    }
    return { address: text };
  }
  return typeof value === "object" && !Array.isArray(value) ? value : {};
}

function addressComponentValue(value, types = []) {
  const components = Array.isArray(value?.address_components) ? value.address_components : [];
  const component = components.find((item) => types.some((type) => Array.isArray(item?.types) && item.types.includes(type)));
  return component?.long_name ?? component?.short_name ?? component?.name ?? "";
}

function firstNonEmptyText(...values) {
  for (const value of values) {
    if (value === null || value === undefined || typeof value === "object") continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

export function finiteLocationCoordinate(value) {
  if (value === "" || value === null || value === undefined) return null;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
}

export function normalizeStructuredLocation(value = {}) {
  const source = locationSource(value);
  const nestedAddress = source.address && typeof source.address === "object" && !Array.isArray(source.address) ? source.address : locationSource(source.address);
  const nestedLocation = source.location && typeof source.location === "object" && !Array.isArray(source.location) ? source.location : locationSource(source.location);
  const nestedDeliveryAddress = source.delivery_address && typeof source.delivery_address === "object" && !Array.isArray(source.delivery_address) ? source.delivery_address : locationSource(source.delivery_address);
  const formattedAddress = firstNonEmptyText(
    source.formattedAddress,
    source.formatted_address,
    nestedAddress.formattedAddress,
    nestedAddress.formatted_address,
    nestedAddress.address,
    nestedDeliveryAddress.formattedAddress,
    nestedDeliveryAddress.formatted_address,
    nestedDeliveryAddress.address,
    nestedLocation.formattedAddress,
    nestedLocation.formatted_address,
    nestedLocation.address
  );

  return {
    address: formattedAddress,
    formattedAddress,
    barangay: firstNonEmptyText(source.barangay, source.delivery_barangay, nestedAddress.barangay, nestedDeliveryAddress.barangay, nestedLocation.barangay, addressComponentValue(source, ["sublocality", "sublocality_level_1"]), addressComponentValue(nestedAddress, ["sublocality", "sublocality_level_1"]), addressComponentValue(nestedDeliveryAddress, ["sublocality", "sublocality_level_1"]), addressComponentValue(nestedLocation, ["sublocality", "sublocality_level_1"])),
    municipality: firstNonEmptyText(source.municipality, source.delivery_municipality, source.city, source.locality, nestedAddress.municipality, nestedAddress.city, nestedAddress.locality, nestedDeliveryAddress.municipality, nestedDeliveryAddress.city, nestedDeliveryAddress.locality, nestedLocation.municipality, nestedLocation.city, nestedLocation.locality, addressComponentValue(source, ["administrative_area_level_2", "locality"]), addressComponentValue(nestedAddress, ["administrative_area_level_2", "locality"]), addressComponentValue(nestedDeliveryAddress, ["administrative_area_level_2", "locality"]), addressComponentValue(nestedLocation, ["administrative_area_level_2", "locality"])),
    province: firstNonEmptyText(source.province, source.delivery_province, nestedAddress.province, nestedDeliveryAddress.province, nestedLocation.province, addressComponentValue(source, ["administrative_area_level_1"]), addressComponentValue(nestedAddress, ["administrative_area_level_1"]), addressComponentValue(nestedDeliveryAddress, ["administrative_area_level_1"]), addressComponentValue(nestedLocation, ["administrative_area_level_1"])),
    region: firstNonEmptyText(source.region, source.delivery_region, nestedAddress.region, nestedDeliveryAddress.region, nestedLocation.region),
    postalCode: firstNonEmptyText(source.postalCode, source.postal_code, source.delivery_postal_code, nestedAddress.postalCode, nestedAddress.postal_code, nestedDeliveryAddress.postalCode, nestedDeliveryAddress.postal_code, nestedLocation.postalCode, nestedLocation.postal_code, addressComponentValue(source, ["postal_code"]), addressComponentValue(nestedAddress, ["postal_code"]), addressComponentValue(nestedDeliveryAddress, ["postal_code"]), addressComponentValue(nestedLocation, ["postal_code"])),
    latitude: finiteLocationCoordinate(source.latitude ?? source.delivery_latitude ?? nestedAddress.latitude ?? nestedDeliveryAddress.latitude ?? nestedLocation.latitude ?? source.geometry?.location?.lat),
    longitude: finiteLocationCoordinate(source.longitude ?? source.delivery_longitude ?? nestedAddress.longitude ?? nestedDeliveryAddress.longitude ?? nestedLocation.longitude ?? source.geometry?.location?.lng),
    placeId: firstNonEmptyText(source.placeId, source.place_id, source.delivery_place_id, nestedAddress.placeId, nestedAddress.place_id, nestedDeliveryAddress.placeId, nestedDeliveryAddress.place_id, nestedLocation.placeId, nestedLocation.place_id),
    locationSource: firstNonEmptyText(source.locationSource, source.location_source, source.delivery_location_source, nestedAddress.locationSource, nestedAddress.location_source, nestedDeliveryAddress.locationSource, nestedDeliveryAddress.location_source, nestedLocation.locationSource, nestedLocation.location_source).toLowerCase(),
    landmark: firstNonEmptyText(source.landmark, source.delivery_landmark, nestedAddress.landmark, nestedDeliveryAddress.landmark, nestedLocation.landmark),
    notes: firstNonEmptyText(source.notes, source.delivery_notes, nestedAddress.notes, nestedDeliveryAddress.notes, nestedLocation.notes)
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
