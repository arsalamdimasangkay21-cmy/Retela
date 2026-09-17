import { useEffect, useMemo, useRef, useState } from "react";
import { LocateFixed, Loader2, MapPin, Navigation, Radio, RotateCcw, Route, Square } from "lucide-react";
import { api, cachedGet, getApiErrorMessage, getStoredAuthToken } from "../api/client";
import { acquireSocket, releaseSocket } from "../api/socket";
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
    address: String(order.delivery_address || "").trim(),
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

function normalizeLiveLocation(value = {}) {
  const latitude = finiteCoordinate(value.latitude);
  const longitude = finiteCoordinate(value.longitude);
  if (!validMapCoordinate(latitude, longitude)) return null;
  return {
    order_id: Number(value.order_id ?? value.orderId ?? 0) || null,
    user_id: Number(value.user_id ?? value.userId ?? 0) || null,
    source_type: value.source_type || value.sourceType || "rider",
    latitude,
    longitude,
    heading: finiteCoordinate(value.heading),
    speed: finiteCoordinate(value.speed),
    accuracy: finiteCoordinate(value.accuracy),
    is_live: value.is_live !== false && value.status !== "stopped",
    shared_at: value.shared_at || value.sharedAt || new Date().toISOString()
  };
}

function bearingBetween(start, end) {
  if (!start || !end || !validMapCoordinate(start.latitude, start.longitude) || !validMapCoordinate(end.latitude, end.longitude)) return null;
  const lat1 = start.latitude * Math.PI / 180;
  const lat2 = end.latitude * Math.PI / 180;
  const deltaLng = (end.longitude - start.longitude) * Math.PI / 180;
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function distanceMetersBetween(start, end) {
  if (!start || !end) return 0;
  const radius = 6371000;
  const dLat = (end.latitude - start.latitude) * Math.PI / 180;
  const dLng = (end.longitude - start.longitude) * Math.PI / 180;
  const lat1 = start.latitude * Math.PI / 180;
  const lat2 = end.latitude * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function smoothHeading(previous, next) {
  if (next === null || next === undefined || !Number.isFinite(Number(next))) return previous ?? 0;
  if (previous === null || previous === undefined || !Number.isFinite(Number(previous))) return Number(next);
  const delta = ((((Number(next) - Number(previous)) % 360) + 540) % 360) - 180;
  return (Number(previous) + delta * 0.35 + 360) % 360;
}

function formatUpdatedAgo(value) {
  const timestamp = new Date(value || 0).getTime();
  if (!timestamp) return "Waiting";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} min ago`;
}

export default function OrderDeliveryInfo({ order, title = "Delivery Information", mapLabel = "View Location", routeEnabled = true, liveRouteEnabled = false, onRouteMetrics }) {
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
      {routeEnabled ? <InlineDeliveryRoute order={order} snapshot={snapshot} liveRouteEnabled={liveRouteEnabled} onRouteMetrics={onRouteMetrics} /> : mapUrl ? (
        <a className="order-delivery-map-button" href={mapUrl} target="_blank" rel="noreferrer">
          <MapPin size={15} /> {mapLabel}
        </a>
      ) : null}
    </section>
  );
}

function InlineDeliveryRoute({ order, snapshot, liveRouteEnabled = false, onRouteMetrics }) {
  const [destinationSnapshot, setDestinationSnapshot] = useState(snapshot);
  const [settings, setSettings] = useState(null);
  const [route, setRoute] = useState(null);
  const [liveRoute, setLiveRoute] = useState(null);
  const [liveLocation, setLiveLocation] = useState(null);
  const [displayedLiveLocation, setDisplayedLiveLocation] = useState(null);
  const [trackingActive, setTrackingActive] = useState(false);
  const [locating, setLocating] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [error, setError] = useState("");
  const [liveError, setLiveError] = useState("");
  const watchIdRef = useRef(null);
  const socketRef = useRef(null);
  const socketHandlersRef = useRef(null);
  const joinedOrderIdRef = useRef(null);
  const currentOrderIdRef = useRef(null);
  const trackingActiveRef = useRef(false);
  const lastPublishedRef = useRef({ point: null, at: 0 });
  const headingRef = useRef(0);
  const animationRef = useRef(null);
  const routeRequestRef = useRef(0);

  const shop = useMemo(() => normalizeShopLocation(settings || {}), [settings]);
  const hasShopCoordinates = shop.latitude !== null && shop.longitude !== null;
  const hasDestinationCoordinates = validMapCoordinate(destinationSnapshot.latitude, destinationSnapshot.longitude);
  const terminalOrder = ["completed", "cancelled", "payment_failed", "rejected"].includes(String(order?.status || "").toLowerCase());
  const liveRouteUsable = liveRouteEnabled && !terminalOrder && hasDestinationCoordinates;

  useEffect(() => {
    currentOrderIdRef.current = Number(order?.id || 0) || null;
  }, [order?.id]);

  useEffect(() => {
    trackingActiveRef.current = trackingActive;
  }, [trackingActive]);

  useEffect(() => {
    setDestinationSnapshot(snapshot);
  }, [snapshot.address, snapshot.latitude, snapshot.longitude, snapshot.landmark, snapshot.notes]);

  useEffect(() => () => {
    stopLiveTracking({ notifyServer: false });
  }, []);

  useEffect(() => {
    if (!terminalOrder) return;
    stopLiveTracking();
  }, [terminalOrder, order?.id]);

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

  useEffect(() => {
    if (!trackingActive || !liveRouteUsable || !liveLocation) return undefined;
    const requestId = routeRequestRef.current + 1;
    routeRequestRef.current = requestId;
    const controller = new AbortController();
    fetch(routeUrl(liveLocation, destinationSnapshot), { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`Live route unavailable (${response.status})`)))
      .then((data) => {
        if (requestId !== routeRequestRef.current) return;
        const routeData = Array.isArray(data?.routes) ? data.routes[0] : null;
        if (!routeData) throw new Error("Live route unavailable");
        setLiveRoute({
          coordinates: (routeData.geometry?.coordinates || []).map(([longitude, latitude]) => ({ latitude, longitude })),
          distanceMeters: Number(routeData.distance || 0),
          durationSeconds: Number(routeData.duration || 0)
        });
        setLiveError("");
      })
      .catch((requestError) => {
        if (requestError?.name !== "AbortError") setLiveError("Live road route is temporarily unavailable.");
      });
    return () => controller.abort();
  }, [destinationSnapshot.latitude, destinationSnapshot.longitude, liveLocation, liveRouteUsable, trackingActive]);

  useEffect(() => {
    if (!liveLocation) return;
    const previous = displayedLiveLocation || liveLocation;
    const measuredDistance = distanceMetersBetween(previous, liveLocation);
    const gpsHeading = Number.isFinite(Number(liveLocation.heading)) ? Number(liveLocation.heading) : null;
    const calculatedHeading = measuredDistance >= 3 ? bearingBetween(previous, liveLocation) : null;
    headingRef.current = smoothHeading(headingRef.current, gpsHeading ?? calculatedHeading);
    const next = { ...liveLocation, heading: headingRef.current };
    if (!displayedLiveLocation || measuredDistance < 1) {
      setDisplayedLiveLocation(next);
      return;
    }
    if (animationRef.current) window.cancelAnimationFrame(animationRef.current);
    const startedAt = performance.now();
    const duration = 900;
    function animate(now) {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - ((1 - progress) ** 3);
      setDisplayedLiveLocation({
        ...next,
        latitude: previous.latitude + (next.latitude - previous.latitude) * eased,
        longitude: previous.longitude + (next.longitude - previous.longitude) * eased,
        heading: smoothHeading(previous.heading, next.heading)
      });
      if (progress < 1) animationRef.current = window.requestAnimationFrame(animate);
    }
    animationRef.current = window.requestAnimationFrame(animate);
    return () => {
      if (animationRef.current) window.cancelAnimationFrame(animationRef.current);
    };
  }, [liveLocation]);

  function applyLiveLocation(payload) {
    const next = normalizeLiveLocation(payload);
    if (!next || Number(next.order_id) !== Number(order?.id || 0)) return;
    if (next.source_type !== "rider") return;
    if (!next.is_live) {
      setLiveLocation(null);
      setLiveRoute(null);
      return;
    }
    setLiveLocation(next);
    setLocating(false);
  }

  function joinLiveSocket() {
    const token = getStoredAuthToken();
    const socket = acquireSocket(token);
    const orderId = Number(order?.id || 0);
    if (!socket || !orderId) return null;
    leaveLiveSocket();
    const updateHandler = (payload) => applyLiveLocation(payload);
    const stoppedHandler = (payload) => applyLiveLocation(payload);
    socket.emit("order-live:join", orderId);
    socket.on("live-location:update", updateHandler);
    socket.on("live-location:stopped", stoppedHandler);
    socketRef.current = socket;
    socketHandlersRef.current = { updateHandler, stoppedHandler };
    joinedOrderIdRef.current = orderId;
    currentOrderIdRef.current = orderId;
    return socket;
  }

  function leaveLiveSocket() {
    const socket = socketRef.current;
    if (!socket) return;
    if (socketHandlersRef.current) {
      socket.off("live-location:update", socketHandlersRef.current.updateHandler);
      socket.off("live-location:stopped", socketHandlersRef.current.stoppedHandler);
    }
    if (joinedOrderIdRef.current) socket.emit("order-live:leave", joinedOrderIdRef.current);
    releaseSocket(socket);
    socketRef.current = null;
    socketHandlersRef.current = null;
    joinedOrderIdRef.current = null;
  }

  function publishPosition(position) {
    const coords = position.coords || {};
    const point = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      heading: Number.isFinite(coords.heading) ? coords.heading : null,
      speed: Number.isFinite(coords.speed) ? coords.speed : null,
      accuracy: Number.isFinite(coords.accuracy) ? coords.accuracy : null
    };
    if (!validMapCoordinate(point.latitude, point.longitude)) return;
    const now = Date.now();
    const previous = lastPublishedRef.current.point;
    if (previous && now - lastPublishedRef.current.at < 3500 && distanceMetersBetween(previous, point) < 8) return;
    lastPublishedRef.current = { point, at: now };
    const heading = point.heading ?? bearingBetween(previous, point) ?? headingRef.current;
    const payload = {
      source_type: "rider",
      latitude: point.latitude,
      longitude: point.longitude,
      heading,
      speed: point.speed,
      accuracy: point.accuracy
    };
    applyLiveLocation({ ...payload, order_id: Number(order.id), user_id: 0, is_live: true, shared_at: new Date().toISOString() });
    api.post(`/live-locations/orders/${order.id}`, payload).catch((requestError) => {
      setLiveError(getApiErrorMessage(requestError, "Could not publish live location."));
    });
  }

  async function startLiveTracking() {
    if (!order?.id || locating || trackingActive) return;
    setLiveError("");
    if (!liveRouteUsable) {
      setLiveError(hasDestinationCoordinates ? "Live route tracking is unavailable for this order status." : "Coordinates unavailable. Live routing needs a saved delivery pin.");
      return;
    }
    if (!navigator.geolocation) {
      setLiveError("Location sharing is not supported in this browser.");
      return;
    }
    setTrackingActive(true);
    setLocating(true);
    joinLiveSocket();
    api.get(`/live-locations/orders/${order.id}`)
      .then(({ data }) => {
        const rows = Array.isArray(data?.locations) ? data.locations : [];
        const rider = rows.find((row) => row.source_type === "rider");
        if (rider) applyLiveLocation(rider);
      })
      .catch(() => {});
    watchIdRef.current = navigator.geolocation.watchPosition(
      publishPosition,
      (geoError) => {
        setLocating(false);
        const messages = {
          1: "Location permission denied. Allow location access to share the rider live route.",
          2: "Live location is unavailable on this device.",
          3: "Live location timed out. Try again when GPS is ready."
        };
        setLiveError(messages[geoError?.code] || "Could not read live location.");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }

  function stopLiveTracking({ notifyServer = true } = {}) {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    const orderId = joinedOrderIdRef.current || currentOrderIdRef.current;
    if (notifyServer && orderId && trackingActiveRef.current) {
      api.delete(`/live-locations/orders/${orderId}?source_type=rider`).catch(() => {});
    }
    leaveLiveSocket();
    trackingActiveRef.current = false;
    setTrackingActive(false);
    setLocating(false);
    setLiveRoute(null);
    setLiveLocation(null);
    setDisplayedLiveLocation(null);
    lastPublishedRef.current = { point: null, at: 0 };
  }

  const activeRoute = trackingActive && liveRoute ? liveRoute : route;
  const updatedText = displayedLiveLocation ? formatUpdatedAgo(displayedLiveLocation.shared_at) : "Waiting for live location";

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
            <DeliveryRouteMap
              shop={shop}
              destination={destinationSnapshot}
              route={activeRoute}
              liveLocation={trackingActive ? displayedLiveLocation : null}
            />
            <div className="retela-route-metrics">
              <RouteMetric label="Distance" value={activeRoute ? `${(activeRoute.distanceMeters / 1000).toFixed(1)} km` : loadingRoute || locating ? "Loading..." : "Unavailable"} />
              <RouteMetric label="Estimated travel" value={activeRoute ? `${Math.max(1, Math.round(activeRoute.durationSeconds / 60))} min` : loadingRoute || locating ? "Loading..." : "Unavailable"} />
            </div>
            {liveRouteEnabled ? (
              <div className="retela-live-route-panel">
                <div>
                  <p>Live Route</p>
                  <strong>{trackingActive ? "Rider -> Customer" : "Saved route available"}</strong>
                  <span>{trackingActive ? `${displayedLiveLocation ? "Live" : "Waiting"} - Updated ${updatedText}` : "Live location unavailable - showing saved delivery location."}</span>
                </div>
                <div className="retela-live-route-actions">
                  {!trackingActive ? (
                    <button type="button" onClick={startLiveTracking} disabled={locating || !liveRouteUsable}>
                      {locating ? <Loader2 size={15} className="animate-spin" /> : <Route size={15} />}
                      {locating ? "Loading/Locating..." : "Show Routes"}
                    </button>
                  ) : (
                    <>
                      <span className="retela-live-route-badge"><Radio size={14} /> {displayedLiveLocation ? "Live Tracking" : "Loading/Locating..."}</span>
                      <button type="button" onClick={() => stopLiveTracking()}><Square size={14} /> Stop Route</button>
                    </>
                  )}
                </div>
              </div>
            ) : null}
            {error ? <div className="retela-route-status is-warning">{error}</div> : null}
            {liveError ? <div className="retela-route-status is-warning">{liveError}</div> : null}
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

function DeliveryRouteMap({ shop, destination, route, liveLocation = null }) {
  const [zoomOffset, setZoomOffset] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [tileState, setTileState] = useState("loading");
  const [tileVersion, setTileVersion] = useState(0);
  const pointerRef = useRef(new Map());
  const dragOriginRef = useRef(null);
  const pinchRef = useRef(null);
  const map = useMemo(() => buildRouteMapModel(shop, destination, route, zoomOffset, liveLocation), [destination, liveLocation, route, shop, zoomOffset]);
  const routePoints = (route?.coordinates?.length ? route.coordinates : [shop, destination]).map((point) => projectPointOnMap(point, map));
  const routeReady = Boolean(route?.coordinates?.length);
  const shopPoint = projectPointOnMap(shop, map);
  const destinationPoint = projectPointOnMap(destination, map);
  const riderPoint = liveLocation ? projectPointOnMap(liveLocation, map) : null;
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
        {riderPoint ? <RiderRouteMarker point={riderPoint} heading={liveLocation.heading} /> : null}
      </> : null}
      </div>
      <div className="retela-route-map-tools">
        <button type="button" onClick={() => setZoomOffset((value) => Math.min(3, value + 1))}>+</button>
        <button type="button" onClick={() => setZoomOffset((value) => Math.max(-3, value - 1))}>-</button>
        {liveLocation ? <button type="button" onClick={resetRouteView} aria-label="Fit Route" title="Fit Route"><LocateFixed size={14} /></button> : null}
        <button type="button" onClick={resetRouteView} aria-label="Reset Route View" title="Reset Route View"><RotateCcw size={14} /></button>
      </div>
    </div>
  );
}

function RiderRouteMarker({ point, heading }) {
  return (
    <span className="retela-route-rider-marker" style={{ left: `${point.x}%`, top: `${point.y}%` }}>
      <Navigation size={23} style={{ transform: `rotate(${Number(heading || 0)}deg)` }} />
      <strong>Rider</strong>
    </span>
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

function buildRouteMapModel(shop, destination, route, zoomOffset, liveLocation = null) {
  const points = [
    shop,
    destination,
    liveLocation,
    ...(route?.coordinates || [])
  ].filter((point) => point && finiteCoordinate(point.latitude) !== null && finiteCoordinate(point.longitude) !== null);
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
