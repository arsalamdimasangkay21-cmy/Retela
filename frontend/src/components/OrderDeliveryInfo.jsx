import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MapPin, RotateCcw } from "lucide-react";
import { api, cachedGet } from "../api/client";
import { osmTileUrl, routeUrl, validMapCoordinate } from "../config/maps";

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

export default function OrderDeliveryInfo({ order, title = "Delivery Information", mapLabel = "View Location", routeEnabled = true, onRouteMetrics }) {
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
      {routeEnabled ? <InlineDeliveryRoute order={order} snapshot={snapshot} onRouteMetrics={onRouteMetrics} /> : mapUrl ? (
        <a className="order-delivery-map-button" href={mapUrl} target="_blank" rel="noreferrer">
          <MapPin size={15} /> {mapLabel}
        </a>
      ) : null}
    </section>
  );
}

function InlineDeliveryRoute({ order, snapshot, onRouteMetrics }) {
  const [destinationSnapshot, setDestinationSnapshot] = useState(snapshot);
  const [settings, setSettings] = useState(null);
  const [route, setRoute] = useState(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [error, setError] = useState("");

  const shop = useMemo(() => normalizeShopLocation(settings || {}), [settings]);
  const hasShopCoordinates = shop.latitude !== null && shop.longitude !== null;
  const hasDestinationCoordinates = validMapCoordinate(destinationSnapshot.latitude, destinationSnapshot.longitude);

  useEffect(() => {
    setDestinationSnapshot(snapshot);
  }, [snapshot.address, snapshot.latitude, snapshot.longitude, snapshot.landmark, snapshot.notes]);

  useEffect(() => {
    if (hasDestinationCoordinates || !destinationSnapshot.address || !order?.id) return undefined;
    let active = true;
    api.post(`/orders/${order.id}/resolve-delivery-location`)
      .then(({ data }) => {
        if (!active) return;
        setDestinationSnapshot((current) => ({ ...current, latitude: finiteCoordinate(data.delivery_latitude), longitude: finiteCoordinate(data.delivery_longitude) }));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [destinationSnapshot.address, hasDestinationCoordinates, order?.id]);

  useEffect(() => {
    if (import.meta.env.DEV && hasShopCoordinates && hasDestinationCoordinates) {
      console.info("[delivery-map] shop", { latitude: shop.latitude, longitude: shop.longitude });
      console.info("[delivery-map] customer", { latitude: destinationSnapshot.latitude, longitude: destinationSnapshot.longitude });
      console.info("[route] provider", "OSRM");
    }
  }, [destinationSnapshot.latitude, destinationSnapshot.longitude, hasDestinationCoordinates, hasShopCoordinates, shop.latitude, shop.longitude]);

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
    setRoute(null);
    setLoadingRoute(true);
    setError("");
    if (import.meta.env.DEV) console.info("[route] request", { origin: { latitude: shop.latitude, longitude: shop.longitude }, destination: { latitude: destinationSnapshot.latitude, longitude: destinationSnapshot.longitude } });
    fetch(
      routeUrl(shop, destinationSnapshot),
      { signal: controller.signal }
    )
      .then((response) => {
        if (import.meta.env.DEV) console.info("[route] HTTP status", response.status);
        return response.ok ? response.json() : Promise.reject(new Error(`Route unavailable (${response.status})`));
      })
      .then((data) => {
        const routeData = Array.isArray(data?.routes) ? data.routes[0] : null;
        if (!routeData) throw new Error("Route unavailable");
        setRoute({
          coordinates: (routeData.geometry?.coordinates || []).map(([longitude, latitude]) => ({ latitude, longitude })),
          distanceMeters: Number(routeData.distance || 0),
          durationSeconds: Number(routeData.duration || 0)
        });
        if (import.meta.env.DEV) console.info("[route] response", { distanceMeters: routeData.distance, durationSeconds: routeData.duration });
      })
      .catch((requestError) => {
        if (requestError?.name !== "AbortError") {
          if (import.meta.env.DEV) console.warn("[route] error", requestError?.message);
          setError("Route details are temporarily unavailable.");
        }
      })
      .finally(() => {
        setLoadingRoute(false);
      });
    return () => controller.abort();
  }, [destinationSnapshot.latitude, destinationSnapshot.longitude, hasDestinationCoordinates, hasShopCoordinates, loadingSettings, shop.latitude, shop.longitude]);

  useEffect(() => {
    if (!route || typeof onRouteMetrics !== "function") return;
    const distanceKm = Number.isFinite(route.distanceMeters) ? Math.round((route.distanceMeters / 1000) * 10) / 10 : null;
    const durationMinutes = Number.isFinite(route.durationSeconds) ? Math.max(1, Math.round(route.durationSeconds / 60)) : null;
    onRouteMetrics({ distanceKm, durationMinutes });
  }, [onRouteMetrics, route]);

  return <div className="retela-inline-route">
        <div className="retela-route-summary">
          <RouteInfoBlock label="From" value={shop.name || "Tela to Pera Thrift Shop"} detail={shop.address || "Exact RETELA shop location has not been configured yet."} />
          <RouteInfoBlock label="To" value="Customer Delivery Location" detail={destinationSnapshot.address || "No exact delivery location was saved for this order."} />
        </div>

        {destinationSnapshot.landmark ? (
          <div className="retela-route-note">
            <span>Landmark</span>
            <strong>{destinationSnapshot.landmark}</strong>
          </div>
        ) : null}

        {destinationSnapshot.notes ? (
          <div className="retela-route-note">
            <span>Delivery Notes</span>
            <strong>{destinationSnapshot.notes}</strong>
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
            <DeliveryRouteMap shop={shop} destination={destinationSnapshot} route={route} />
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
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [tileState, setTileState] = useState("loading");
  const [tileVersion, setTileVersion] = useState(0);
  const pointerRef = useRef(new Map());
  const dragOriginRef = useRef(null);
  const pinchRef = useRef(null);
  const map = useMemo(() => buildRouteMapModel(shop, destination, route, zoomOffset), [destination, route, shop, zoomOffset]);
  const routePoints = (route?.coordinates?.length ? route.coordinates : [shop, destination]).map((point) => projectPointOnMap(point, map));
  const routeReady = Boolean(route?.coordinates?.length);
  const shopPoint = projectPointOnMap(shop, map);
  const destinationPoint = projectPointOnMap(destination, map);
  const path = routePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  function retryTiles() {
    setTileState("loading");
    setTileVersion((value) => value + 1);
  }

  function pointerDistance() {
    const points = [...pointerRef.current.values()];
    return points.length >= 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : null;
  }

  function handlePointerDown(event) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointerRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointerRef.current.size === 1) dragOriginRef.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, pan };
    if (pointerRef.current.size === 2) pinchRef.current = { distance: pointerDistance(), zoomOffset };
  }

  function handlePointerMove(event) {
    if (!pointerRef.current.has(event.pointerId)) return;
    pointerRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointerRef.current.size >= 2 && pinchRef.current) {
      const distance = pointerDistance();
      if (distance && pinchRef.current.distance) setZoomOffset(Math.max(-3, Math.min(3, pinchRef.current.zoomOffset + Math.round((distance - pinchRef.current.distance) / 90))));
      return;
    }
    if (dragOriginRef.current?.pointer === event.pointerId) {
      setPan({ x: dragOriginRef.current.pan.x + event.clientX - dragOriginRef.current.x, y: dragOriginRef.current.pan.y + event.clientY - dragOriginRef.current.y });
    }
  }

  function handlePointerUp(event) {
    pointerRef.current.delete(event.pointerId);
    if (pointerRef.current.size < 2) pinchRef.current = null;
    if (!pointerRef.current.size) dragOriginRef.current = null;
  }

  function resetRouteView() {
    setZoomOffset(0);
    setPan({ x: 0, y: 0 });
  }

  useEffect(() => {
    setPan({ x: 0, y: 0 });
    setZoomOffset(0);
  }, [destination.latitude, destination.longitude, shop.latitude, shop.longitude]);

  return (
    <div className="retela-route-map" aria-label="Delivery route map" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onWheel={(event) => { event.preventDefault(); setZoomOffset((value) => Math.max(-3, Math.min(3, value + (event.deltaY < 0 ? 1 : -1)))); }}>
      <div className="retela-map-canvas" style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0)` }}>
      {tileState !== "error" && map.tiles.map((tile) => (
        <img
          key={`${tile.tileX}-${tile.tileY}-${map.zoom}-${tileVersion}`}
          src={osmTileUrl(map.zoom, tile.tileX, tile.tileY, tileVersion)}
          alt=""
          loading="lazy"
          onLoad={() => setTileState((state) => state === "loading" ? "ready" : state)}
          onError={() => { if (import.meta.env.DEV) console.warn("[map] tile load error"); setTileState("error"); }}
          style={{
            left: `calc(50% + ${(tile.x - map.offsetX) * 256}px)`,
            top: `calc(50% + ${(tile.y - map.offsetY) * 256}px)`
          }}
        />
      ))}
      {tileState === "error" ? <div className="retela-map-status-overlay"><span>Map could not be loaded.</span><button type="button" onClick={retryTiles}>Retry</button></div> : null}
      {tileState === "loading" ? <div className="retela-map-status-overlay is-loading"><Loader2 size={16} className="animate-spin" /> Loading map...</div> : null}
      {tileState === "ready" ? <>
        {routeReady ? <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d={path} /></svg> : null}
        <RouteMarker point={shopPoint} tone="shop" label="RETELA Shop" />
        <RouteMarker point={destinationPoint} tone="customer" label="Customer Delivery Location" />
      </> : null}
      </div>
      <div className="retela-route-map-tools">
        <button type="button" onClick={() => setZoomOffset((value) => Math.min(3, value + 1))}>+</button>
        <button type="button" onClick={() => setZoomOffset((value) => Math.max(-3, value - 1))}>-</button>
        <button type="button" onClick={resetRouteView} aria-label="Reset Route View" title="Reset Route View"><RotateCcw size={14} /></button>
      </div>
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
