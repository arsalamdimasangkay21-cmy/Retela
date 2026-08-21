const OSM_TILE_HOSTS = ["a", "b", "c"];

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
export const OSRM_ROUTE_ENDPOINT = "https://router.project-osrm.org/route/v1/driving";

export function osmTileUrl(zoom, x, y, version = 0) {
  const host = OSM_TILE_HOSTS[Math.abs(Number(x) + Number(y)) % OSM_TILE_HOSTS.length];
  return `https://${host}.tile.openstreetmap.org/${zoom}/${x}/${y}.png?v=${version}`;
}

export function validMapCoordinate(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    && !(Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01);
}

export function routeUrl(origin, destination) {
  return `${OSRM_ROUTE_ENDPOINT}/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?overview=full&geometries=geojson`;
}
