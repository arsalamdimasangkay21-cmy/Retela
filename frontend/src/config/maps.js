export const OSM_ATTRIBUTION = "&copy; OpenStreetMap contributors";
export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSRM_ROUTE_ENDPOINT = "https://router.project-osrm.org/route/v1/driving";

export function osmTileUrl(zoom, x, y) {
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}

export function validMapCoordinate(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    && !(Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01);
}

export function routeUrl(origin, destination) {
  return `${OSRM_ROUTE_ENDPOINT}/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?overview=full&geometries=geojson&steps=true`;
}
