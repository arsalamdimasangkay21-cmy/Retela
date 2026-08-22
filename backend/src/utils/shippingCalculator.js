export const DEFAULT_FREE_DELIVERY_MUNICIPALITIES = ["Midsayap", "Libungan", "Pigcawayan"];

function finiteNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeMunicipality(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/^(?:municipality|city)\s+of\s+/, "")
    .replace(/\s+(?:municipality|city)$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeMunicipalityList(values = []) {
  const names = Array.isArray(values) ? values : [];
  const seen = new Set();
  return names.reduce((result, value) => {
    const displayName = String(value || "").trim().replace(/\s+/g, " ");
    const key = normalizeMunicipality(displayName);
    if (!key || seen.has(key)) return result;
    seen.add(key);
    result.push(displayName);
    return result;
  }, []);
}

export function validCoordinates(latitude, longitude) {
  const lat = finiteNumber(latitude);
  const lng = finiteNumber(longitude);
  return lat !== null && lng !== null
    && lat >= -90 && lat <= 90
    && lng >= -180 && lng <= 180
    && !(Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01);
}

export function haversineDistanceKm(origin, destination) {
  if (!validCoordinates(origin?.latitude, origin?.longitude)
    || !validCoordinates(destination?.latitude, destination?.longitude)) return null;
  const toRadians = (degrees) => Number(degrees) * (Math.PI / 180);
  const earthRadiusKm = 6371.0088;
  const latitudeDelta = toRadians(destination.latitude - origin.latitude);
  const longitudeDelta = toRadians(destination.longitude - origin.longitude);
  const originLatitude = toRadians(origin.latitude);
  const destinationLatitude = toRadians(destination.latitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(originLatitude) * Math.cos(destinationLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function addressMunicipality(address, configuredMunicipalities) {
  const segments = String(address || "").split(",").map(normalizeMunicipality).filter(Boolean);
  const configured = new Set(configuredMunicipalities.map(normalizeMunicipality).filter(Boolean));
  return segments.find((segment) => configured.has(segment)) || "";
}

export function classifyShippingLocation(location = {}, policy = {}) {
  const fulfillmentMethod = String(
    policy.fulfillmentMethod ?? policy.fulfillment_method ?? "delivery"
  ).trim().toLowerCase();
  if (fulfillmentMethod === "pickup") {
    return {
      shippingFee: 0,
      shippingZone: "pickup",
      shippingRule: "pickup",
      distanceKm: null,
      reason: "Customer pickup"
    };
  }

  const freeMunicipalities = normalizeMunicipalityList(
    policy.freeMunicipalities || policy.freeDeliveryMunicipalities || DEFAULT_FREE_DELIVERY_MUNICIPALITIES
  );
  const configuredMunicipalities = new Set(freeMunicipalities.map(normalizeMunicipality));
  const explicitMunicipality = normalizeMunicipality(
    location.municipality ?? location.deliveryMunicipality ?? location.delivery_municipality ?? location.city
  );
  const municipality = explicitMunicipality || addressMunicipality(
    location.formattedAddress ?? location.formatted_address ?? location.address ?? location.delivery_address,
    freeMunicipalities
  );
  const shopMunicipality = normalizeMunicipality(policy.shopMunicipality);
  const freeRadiusKm = Math.max(0, finiteNumber(policy.freeRadiusKm ?? policy.freeDeliveryRadiusKm) ?? 15);
  const configuredOutsideFee = Math.max(0, finiteNumber(
    policy.outsideFee ?? policy.outsideAreaShippingFee ?? policy.fixedFee
  ) ?? 0);
  const outsideFee = policy.enabled === false ? 0 : configuredOutsideFee;
  const distance = haversineDistanceKm(
    { latitude: policy.shopLatitude, longitude: policy.shopLongitude },
    {
      latitude: location.latitude ?? location.deliveryLatitude ?? location.delivery_latitude,
      longitude: location.longitude ?? location.deliveryLongitude ?? location.delivery_longitude
    }
  );
  const distanceKm = distance === null ? null : Math.round(distance * 100) / 100;

  let result;
  if (municipality && configuredMunicipalities.has(municipality)) {
    result = { shippingFee: 0, shippingZone: "nearby", shippingRule: "municipality", distanceKm, reason: "Nearby delivery area" };
  } else if (distance !== null && distance <= freeRadiusKm) {
    result = { shippingFee: 0, shippingZone: "nearby", shippingRule: "radius", distanceKm, reason: "Nearby delivery area" };
  } else {
    result = {
      shippingFee: outsideFee,
      shippingZone: "outside",
      shippingRule: "outside_area",
      distanceKm,
      reason: "Outside nearby delivery area",
      shopMunicipality: shopMunicipality || null
    };
  }

  const deliveryAreaOverride = String(
    policy.deliveryAreaOverride ?? policy.delivery_area_override ?? ""
  ).trim().toLowerCase();
  if (deliveryAreaOverride === "nearby") {
    result = {
      ...result,
      shippingFee: 0,
      shippingZone: "nearby",
      shippingRule: "admin_override_nearby",
      reason: "Nearby / Free (set by admin)"
    };
  } else if (deliveryAreaOverride === "outside") {
    result = {
      ...result,
      shippingFee: outsideFee,
      shippingZone: "outside",
      shippingRule: "admin_override_outside",
      reason: "Outside delivery area (set by admin)"
    };
  }

  if (policy.couponFreeShipping && result.shippingFee > 0) {
    return {
      ...result,
      shippingFee: 0,
      shippingRule: "coupon",
      reason: "Free shipping coupon"
    };
  }
  return result;
}
