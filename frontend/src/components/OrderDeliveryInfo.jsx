import { useEffect, useMemo, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { cachedGet } from "../api/client";

function finiteCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validShopCoordinate(latitude, longitude) {
  return latitude !== null && longitude !== null
    && latitude >= 4 && latitude <= 22
    && longitude >= 116 && longitude <= 127;
}

function orderDeliverySnapshot(order = {}) {
  return {
    address: String(order.delivery_address || order.location || "").trim(),
    latitude: finiteCoordinate(order.delivery_latitude),
    longitude: finiteCoordinate(order.delivery_longitude),
    landmark: String(order.delivery_landmark || "").trim(),
    notes: String(order.delivery_notes || "").trim()
  };
}

function deliveryMapUrl(snapshot) {
  if (snapshot.latitude !== null && snapshot.longitude !== null) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${snapshot.latitude},${snapshot.longitude}`)}`;
  }
  if (snapshot.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(snapshot.address)}`;
  }
  return "";
}

function normalizeShopLocation(settings = {}) {
  const general = settings.general || {};
  const address = String(general.shopAddress || settings.shopAddress || "").trim();
  const parsedLatitude = finiteCoordinate(general.shopLatitude ?? settings.shopLatitude);
  const parsedLongitude = finiteCoordinate(general.shopLongitude ?? settings.shopLongitude);
  return {
    name: general.shopName || "Tela to Pera Thrift Shop",
    address,
    latitude: validShopCoordinate(parsedLatitude, parsedLongitude) ? parsedLatitude : null,
    longitude: validShopCoordinate(parsedLatitude, parsedLongitude) ? parsedLongitude : null
  };
}

export default function OrderDeliveryInfo({ order, title = "Delivery Information", mapLabel = "View Location", routeEnabled = true }) {
  const snapshot = orderDeliverySnapshot(order);
  const mapUrl = deliveryMapUrl(snapshot);
  return (
    <section className="order-delivery-info-card">
      <div className="order-delivery-info-heading">
        <span><MapPin size={17} /></span>
        <div>
          <p>{title}</p>
          <h4>Delivery Address</h4>
        </div>
      </div>
      <div className="order-delivery-info-body">
        <div className="order-delivery-info-row is-address">
          <span>Address</span>
          <strong>{snapshot.address || "No exact delivery location was saved for this order."}</strong>
        </div>
        {snapshot.landmark ? (
          <div className="order-delivery-info-row">
            <span>Landmark</span>
            <strong>{snapshot.landmark}</strong>
          </div>
        ) : null}
        {snapshot.notes ? (
          <div className="order-delivery-info-row">
            <span>Delivery Notes</span>
            <strong>{snapshot.notes}</strong>
          </div>
        ) : null}
      </div>
      {routeEnabled ? <InlineDeliveryRoute order={order} snapshot={snapshot} /> : mapUrl ? (
        <a className="order-delivery-map-button" href={mapUrl} target="_blank" rel="noreferrer">
          <MapPin size={15} /> {mapLabel}
        </a>
      ) : null}
    </section>
  );
}

function InlineDeliveryRoute({ order, snapshot }) {
  const [settings, setSettings] = useState(null);
  const [route, setRoute] = useState(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [error, setError] = useState("");

  const shop = useMemo(() => normalizeShopLocation(settings || {}), [settings]);
  const hasShopCoordinates = shop.latitude !== null && shop.longitude !== null;
  const hasDestinationCoordinates = snapshot.latitude !== null && snapshot.longitude !== null;

  useEffect(() => {
    let active = true;
    cachedGet("/settings/public", {}, { cacheMs: 10000, retries: 1 })
      .then(({ data }) => {
        if (active) setSettings(data || {});
      })
      .catch(() => {
        if (active) setError("Could not load shop location settings.");
      })
      .finally(() => {
        if (active) setLoadingSettings(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (loadingSettings || !hasShopCoordinates || !hasDestinationCoordinates) return undefined;
    const controller = new AbortController();
    setLoadingRoute(true);
    setError("");
    fetch(
      `https://router.project-osrm.org/route/v1/driving/${shop.longitude},${shop.latitude};${snapshot.longitude},${snapshot.latitude}?overview=full&geometries=geojson`,
      { signal: controller.signal }
    )
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Route unavailable")))
      .then((data) => {
        const routeData = Array.isArray(data?.routes) ? data.routes[0] : null;
        if (!routeData) throw new Error("Route unavailable");
        setRoute({
          coordinates: (routeData.geometry?.coordinates || []).map(([longitude, latitude]) => ({ latitude, longitude })),
          distanceMeters: Number(routeData.distance || 0),
          durationSeconds: Number(routeData.duration || 0)
        });
      })
      .catch((requestError) => {
        if (requestError?.name !== "AbortError") setError("Route details are unavailable right now.");
      })
      .finally(() => {
        setLoadingRoute(false);
      });
    return () => controller.abort();
  }, [hasDestinationCoordinates, hasShopCoordinates, loadingSettings, shop.latitude, shop.longitude, snapshot.latitude, snapshot.longitude]);

  return <div className="retela-inline-route">
        <div className="retela-route-summary">
          <RouteInfoBlock label="From" value={shop.name || "Tela to Pera Thrift Shop"} detail={shop.address || "Exact RETELA shop location has not been configured yet."} />
          <RouteInfoBlock label="To" value="Customer Delivery Location" detail={snapshot.address || "No exact delivery location was saved for this order."} />
        </div>

        {snapshot.landmark ? (
          <div className="retela-route-note">
            <span>Landmark</span>
            <strong>{snapshot.landmark}</strong>
          </div>
        ) : null}

        {snapshot.notes ? (
          <div className="retela-route-note">
            <span>Delivery Notes</span>
            <strong>{snapshot.notes}</strong>
          </div>
        ) : null}

        {loadingSettings ? (
          <div className="retela-route-status"><Loader2 size={17} className="animate-spin" /> Loading shop location...</div>
        ) : !hasShopCoordinates ? (
          <div className="retela-route-status is-warning">Exact RETELA shop location has not been configured yet. Open Admin Settings, then set the exact shop location under General Settings.</div>
        ) : !hasDestinationCoordinates ? (
          <div className="retela-route-status is-warning">Exact map location is unavailable for this order. The saved delivery address is still shown above.</div>
        ) : (
          <>
            <DeliveryRouteMap shop={shop} destination={snapshot} route={route} />
            <div className="retela-route-metrics">
              <RouteMetric label="Distance" value={route ? `${(route.distanceMeters / 1000).toFixed(1)} km` : loadingRoute ? "Loading..." : "Unavailable"} />
              <RouteMetric label="Estimated travel" value={route ? `${Math.max(1, Math.round(route.durationSeconds / 60))} min` : loadingRoute ? "Loading..." : "Unavailable"} />
            </div>
            {error ? <div className="retela-route-status is-warning">{error}</div> : null}
          </>
        )}

      </div>;
}

function RouteInfoBlock({ label, value, detail }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </div>
  );
}

function RouteMetric({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DeliveryRouteMap({ shop, destination, route }) {
  const [zoomOffset, setZoomOffset] = useState(0);
  const map = useMemo(() => buildRouteMapModel(shop, destination, route, zoomOffset), [destination, route, shop, zoomOffset]);
  const routePoints = (route?.coordinates?.length ? route.coordinates : [shop, destination]).map((point) => projectPointOnMap(point, map));
  const shopPoint = projectPointOnMap(shop, map);
  const destinationPoint = projectPointOnMap(destination, map);
  const path = routePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");

  return (
    <div className="retela-route-map" aria-label="Delivery route map">
      {map.tiles.map((tile) => (
        <img
          key={`${tile.tileX}-${tile.tileY}-${map.zoom}`}
          src={`https://tile.openstreetmap.org/${map.zoom}/${tile.tileX}/${tile.tileY}.png`}
          alt=""
          loading="lazy"
          style={{
            left: `calc(50% + ${(tile.x - map.offsetX) * 256}px)`,
            top: `calc(50% + ${(tile.y - map.offsetY) * 256}px)`
          }}
        />
      ))}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d={path} />
      </svg>
      <RouteMarker point={shopPoint} tone="shop" label="RETELA Shop" />
      <RouteMarker point={destinationPoint} tone="customer" label="Customer Delivery Location" />
      <div className="retela-route-map-tools">
        <button type="button" onClick={() => setZoomOffset((value) => Math.min(3, value + 1))}>+</button>
        <button type="button" onClick={() => setZoomOffset((value) => Math.max(-3, value - 1))}>-</button>
      </div>
    </div>
  );
}

export function MeetingLocationMap({ customer, meeting, onSelect }) {
  const [zoomOffset, setZoomOffset] = useState(0);
  const [route, setRoute] = useState(null);
  const [routeState, setRouteState] = useState("idle");
  const hasCustomer = customer?.latitude != null && customer?.longitude != null;
  const hasMeeting = meeting?.latitude != null && meeting?.longitude != null;
  const map = useMemo(() => buildRouteMapModel(customer, meeting || customer, route, zoomOffset), [customer, meeting, route, zoomOffset]);
  const routePoints = (route?.coordinates?.length ? route.coordinates : hasMeeting ? [customer, meeting] : [customer]).map((point) => projectPointOnMap(point, map));
  const path = routePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");

  useEffect(() => {
    if (!hasCustomer || !hasMeeting) {
      setRoute(null);
      setRouteState("idle");
      return undefined;
    }
    const controller = new AbortController();
    setRouteState("loading");
    fetch(`https://router.project-osrm.org/route/v1/driving/${customer.longitude},${customer.latitude};${meeting.longitude},${meeting.latitude}?overview=full&geometries=geojson`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Route unavailable")))
      .then((data) => {
        const routeData = Array.isArray(data?.routes) ? data.routes[0] : null;
        if (!routeData) throw new Error("Route unavailable");
        setRoute({ coordinates: (routeData.geometry?.coordinates || []).map(([longitude, latitude]) => ({ latitude, longitude })), distanceMeters: Number(routeData.distance || 0), durationSeconds: Number(routeData.duration || 0) });
        setRouteState("ready");
      })
      .catch((error) => {
        if (error?.name !== "AbortError") setRouteState("error");
      });
    return () => controller.abort();
  }, [customer?.latitude, customer?.longitude, hasCustomer, hasMeeting, meeting?.latitude, meeting?.longitude]);

  function selectFromMap(event) {
    if (!onSelect || !hasCustomer) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    const point = tileToCoordinates(map.center.x + (x - 50) / 100, map.center.y + (y - 50) / 100, map.zoom);
    onSelect(point);
  }

  return (
    <div className="retela-route-map retela-meetup-map" onClick={selectFromMap} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} aria-label={onSelect ? "Select meetup location on map" : "Customer to meetup route map"}>
      {map.tiles.map((tile) => <img key={`${tile.tileX}-${tile.tileY}-${map.zoom}`} src={`https://tile.openstreetmap.org/${map.zoom}/${tile.tileX}/${tile.tileY}.png`} alt="" loading="lazy" style={{ left: `calc(50% + ${(tile.x - map.offsetX) * 256}px)`, top: `calc(50% + ${(tile.y - map.offsetY) * 256}px)` }} />)}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d={path} /></svg>
      {hasCustomer ? <RouteMarker point={projectPointOnMap(customer, map)} tone="customer" label="Customer Location" /> : null}
      {hasMeeting ? <RouteMarker point={projectPointOnMap(meeting, map)} tone="meeting" label="Meeting Place" /> : null}
      <div className="retela-route-map-tools" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => setZoomOffset((value) => Math.min(3, value + 1))}>+</button>
        <button type="button" onClick={() => setZoomOffset((value) => Math.max(-3, value - 1))}>-</button>
      </div>
      {onSelect ? <span className="retela-meetup-map-hint">Tap the map to select a meeting point</span> : null}
      {hasMeeting && routeState === "error" ? <span className="retela-route-map-error">Unable to load route map.</span> : null}
    </div>
  );
}

function RouteMarker({ point, tone, label }) {
  return (
    <span className={`retela-route-marker is-${tone}`} style={{ left: `${point.x}%`, top: `${point.y}%` }}>
      <MapPin size={22} />
      <strong>{label}</strong>
    </span>
  );
}

function buildRouteMapModel(shop, destination, route, zoomOffset) {
  const points = [
    shop,
    destination,
    ...(route?.coordinates || [])
  ].filter((point) => finiteCoordinate(point.latitude) !== null && finiteCoordinate(point.longitude) !== null);
  const lats = points.map((point) => point.latitude);
  const lngs = points.map((point) => point.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;
  const span = Math.max(maxLat - minLat, maxLng - minLng, 0.01);
  const baseZoom = span < 0.02 ? 14 : span < 0.06 ? 13 : span < 0.14 ? 12 : span < 0.35 ? 11 : 10;
  const zoom = Math.max(8, Math.min(17, baseZoom + zoomOffset));
  const center = projectToTile(centerLat, centerLng, zoom);
  const tileX = Math.floor(center.x);
  const tileY = Math.floor(center.y);
  const tiles = [];
  for (let y = -2; y <= 2; y += 1) {
    for (let x = -2; x <= 2; x += 1) {
      tiles.push({ x, y, tileX: tileX + x, tileY: tileY + y });
    }
  }
  return {
    center,
    zoom,
    offsetX: center.x - tileX,
    offsetY: center.y - tileY,
    tiles
  };
}

function projectToTile(latitude, longitude, zoom) {
  const safeLatitude = Math.max(-85.0511, Math.min(85.0511, Number(latitude) || 0));
  const safeLongitude = Math.max(-180, Math.min(180, Number(longitude) || 0));
  const latRad = (safeLatitude * Math.PI) / 180;
  const scale = 2 ** zoom;
  return {
    x: ((safeLongitude + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale
  };
}

function projectPointOnMap(point, map) {
  const tile = projectToTile(point.latitude, point.longitude, map.zoom);
  return {
    x: 50 + (tile.x - map.center.x) * 100,
    y: 50 + (tile.y - map.center.y) * 100
  };
}

function tileToCoordinates(x, y, zoom) {
  const scale = 2 ** zoom;
  const longitude = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const latitude = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { latitude, longitude };
}
