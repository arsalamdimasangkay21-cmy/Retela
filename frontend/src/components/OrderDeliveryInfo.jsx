import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocateFixed, Loader2, MapPin, Radio, RotateCcw, Route, Square } from "lucide-react";
import { api, cachedGet, getApiErrorMessage, getStoredAuthToken } from "../api/client";
import { acquireSocket, releaseSocket } from "../api/socket";
import { validMapCoordinate } from "../config/maps";

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
let googleMapsPromise;

function loadGoogleMaps() {
  if (!GOOGLE_MAPS_API_KEY) return Promise.reject(new Error("Google Maps API key is not configured."));
  if (window.google?.maps?.DirectionsService) return Promise.resolve(window.google);
  if (googleMapsPromise) return googleMapsPromise;

  let createdScriptId = "";
  googleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById("retela-google-maps-places") || document.getElementById("retela-google-maps-delivery");
    let timeoutId;
    const onReady = () => {
      window.clearTimeout(timeoutId);
      if (window.google?.maps?.DirectionsService) resolve(window.google);
      else reject(new Error("Google Maps did not load."));
    };
    const onError = () => {
      window.clearTimeout(timeoutId);
      reject(new Error("Google Maps failed to load."));
    };

    if (existing) {
      if (window.google?.maps?.DirectionsService) {
        resolve(window.google);
        return;
      }
      existing.addEventListener("load", onReady, { once: true });
      existing.addEventListener("error", onError, { once: true });
      timeoutId = window.setTimeout(onError, 12000);
      return;
    }

    const script = document.createElement("script");
    script.id = "retela-google-maps-places";
    createdScriptId = script.id;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=places&v=weekly`;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", onReady, { once: true });
    script.addEventListener("error", onError, { once: true });
    timeoutId = window.setTimeout(onError, 12000);
    document.head.appendChild(script);
  }).catch((error) => {
    if (createdScriptId) document.getElementById(createdScriptId)?.remove();
    googleMapsPromise = undefined;
    throw error;
  });

  return googleMapsPromise;
}

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
  const isLive = value.trackingActive !== false && value.is_live !== false && value.status !== "stopped";
  return {
    order_id: Number(value.order_id ?? value.orderId ?? 0) || null,
    user_id: Number(value.user_id ?? value.userId ?? 0) || null,
    source_type: value.source_type || value.sourceType || "rider",
    latitude,
    longitude,
    heading: finiteCoordinate(value.heading),
    speed: finiteCoordinate(value.speed),
    accuracy: finiteCoordinate(value.accuracy),
    is_live: isLive,
    trackingActive: isLive,
    shared_at: value.shared_at || value.sharedAt || value.updatedAt || new Date().toISOString()
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

function routeCacheKey(origin, destination) {
  if (!origin || !destination) return "";
  return [
    Number(origin.latitude).toFixed(5),
    Number(origin.longitude).toFixed(5),
    Number(destination.latitude).toFixed(5),
    Number(destination.longitude).toFixed(5)
  ].join(":");
}

function routeAbortError() {
  const error = new Error("Route request cancelled");
  error.name = "AbortError";
  return error;
}

async function fetchDrivingRoute(origin, destination, { signal, cache } = {}) {
  const key = routeCacheKey(origin, destination);
  if (cache?.has(key)) return cache.get(key);
  const google = await loadGoogleMaps();
  if (signal?.aborted) throw routeAbortError();
  console.log("Route request:", {
    origin: { latitude: Number(origin.latitude), longitude: Number(origin.longitude) },
    destination: { latitude: Number(destination.latitude), longitude: Number(destination.longitude) }
  });
  const route = await new Promise((resolve, reject) => {
    const service = new google.maps.DirectionsService();
    const abort = () => reject(routeAbortError());
    signal?.addEventListener("abort", abort, { once: true });
    service.route({
      origin: { lat: Number(origin.latitude), lng: Number(origin.longitude) },
      destination: { lat: Number(destination.latitude), lng: Number(destination.longitude) },
      travelMode: google.maps.TravelMode.DRIVING,
      provideRouteAlternatives: false
    }, (result, status) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) return reject(routeAbortError());
      if (status !== google.maps.DirectionsStatus.OK || !result?.routes?.[0]) {
        reject(new Error(status === google.maps.DirectionsStatus.ZERO_RESULTS ? "No driving route is available for these locations." : `Google Directions failed: ${status}`));
        return;
      }
      const legs = result.routes[0].legs || [];
      const primaryLeg = legs[0] || {};
      resolve({
        provider: "google",
        directions: result,
        coordinates: (result.routes[0].overview_path || []).map((point) => ({ latitude: point.lat(), longitude: point.lng() })),
        distanceMeters: legs.reduce((sum, leg) => sum + Number(leg.distance?.value || 0), 0),
        durationSeconds: legs.reduce((sum, leg) => sum + Number(leg.duration?.value || 0), 0),
        distanceText: primaryLeg.distance?.text || "",
        durationText: primaryLeg.duration?.text || ""
      });
    });
  });
  if (cache && key) cache.set(key, route);
  return route;
}

export default function OrderDeliveryInfo({ order, title = "Delivery Information", mapLabel = "View Location", routeEnabled = true, liveRouteEnabled = false, canShareLiveLocation = false, autoStartTracking = false, routeInitiallyVisible = true, onRouteMetrics }) {
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
      {routeEnabled ? <InlineDeliveryRoute order={order} snapshot={snapshot} liveRouteEnabled={liveRouteEnabled} canShareLiveLocation={canShareLiveLocation} autoStartTracking={autoStartTracking} routeInitiallyVisible={routeInitiallyVisible} onRouteMetrics={onRouteMetrics} /> : mapUrl ? (
        <a className="order-delivery-map-button" href={mapUrl} target="_blank" rel="noreferrer">
          <MapPin size={15} /> {mapLabel}
        </a>
      ) : null}
    </section>
  );
}

function InlineDeliveryRoute({ order, snapshot, liveRouteEnabled = false, canShareLiveLocation = false, autoStartTracking = false, routeInitiallyVisible = true, onRouteMetrics }) {
  const [destinationSnapshot, setDestinationSnapshot] = useState(snapshot);
  const [settings, setSettings] = useState(null);
  const [route, setRoute] = useState(null);
  const [liveRoute, setLiveRoute] = useState(null);
  const [liveLocation, setLiveLocation] = useState(null);
  const [riderPosition, setRiderPosition] = useState(null);
  const [displayedLiveLocation, setDisplayedLiveLocation] = useState(null);
  const [trackingActive, setTrackingActive] = useState(false);
  const [routeVisible, setRouteVisible] = useState(Boolean(routeInitiallyVisible));
  const [routeRequested, setRouteRequested] = useState(true);
  const [followRider, setFollowRider] = useState(!canShareLiveLocation);
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
  const routeCacheRef = useRef(new Map());
  const liveRouteRefreshRef = useRef({ point: null, at: 0 });
  const autoStartedRef = useRef(null);

  const shop = useMemo(() => normalizeShopLocation(settings || {}), [settings]);
  const hasShopCoordinates = shop.latitude !== null && shop.longitude !== null;
  const hasDestinationCoordinates = validMapCoordinate(destinationSnapshot.latitude, destinationSnapshot.longitude);
  const terminalOrder = ["completed", "cancelled", "payment_failed", "rejected"].includes(String(order?.status || "").toLowerCase());
  const orderStatus = String(order?.status || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const deliveryStatus = String(order?.delivery_status || order?.deliveryStatus || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const outForDelivery = orderStatus === "ready" || orderStatus === "out_for_delivery" || deliveryStatus === "out_for_delivery";
  const liveRouteUsable = liveRouteEnabled && outForDelivery && !terminalOrder && hasDestinationCoordinates;

  useEffect(() => {
    currentOrderIdRef.current = Number(order?.id || 0) || null;
  }, [order?.id]);

  useEffect(() => {
    setRouteVisible(Boolean(routeInitiallyVisible));
    setRouteRequested(true);
    setLiveRoute(null);
    setLiveLocation(null);
    setRiderPosition(null);
    setDisplayedLiveLocation(null);
    liveRouteRefreshRef.current = { point: null, at: 0 };
  }, [order?.id, routeInitiallyVisible]);

  useEffect(() => {
    trackingActiveRef.current = trackingActive;
  }, [trackingActive]);

  const applyLiveLocation = useCallback((payload) => {
    const payloadOrderId = Number(payload?.order_id ?? payload?.orderId ?? 0);
    if (payloadOrderId && payloadOrderId !== Number(order?.id || 0)) return;
    if (payload?.trackingActive === false || payload?.is_live === false || payload?.status === "stopped") {
      setLiveLocation(null);
      setRiderPosition(null);
      setLiveRoute(null);
      setDisplayedLiveLocation(null);
      return;
    }
    const next = normalizeLiveLocation(payload);
    if (!next || Number(next.order_id) !== Number(order?.id || 0)) return;
    if (next.source_type !== "rider") return;
    if (!next.is_live) {
      setLiveLocation(null);
      setRiderPosition(null);
      setLiveRoute(null);
      return;
    }
    const markerPosition = {
      lat: next.latitude,
      lng: next.longitude,
      heading: next.heading,
      shared_at: next.shared_at
    };
    console.log("Receiving rider location:", next.latitude, next.longitude);
    console.log("MAP RIDER POSITION:", markerPosition);
    setRiderPosition(markerPosition);
    setLiveLocation(next);
    setLocating(false);
  }, [order?.id]);

  const fetchLatestLiveLocation = useCallback(() => {
    if (!liveRouteEnabled || !order?.id) return Promise.resolve(null);
    return api.get(`/live-locations/orders/${order.id}`)
      .then(({ data }) => {
        const payload = (data?.locations || []).find((location) => location?.source_type === "rider") || null;
        if (!payload) return null;
        applyLiveLocation(payload);
        return payload;
      })
      .catch(() => null);
  }, [applyLiveLocation, liveRouteEnabled, order?.id]);

  const leaveLiveSocket = useCallback(() => {
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
  }, []);

  const joinLiveSocket = useCallback(() => {
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
  }, [applyLiveLocation, leaveLiveSocket, order?.id]);

  useEffect(() => {
    if (!liveRouteEnabled || !order?.id) return undefined;
    joinLiveSocket();
    fetchLatestLiveLocation();
    const intervalId = window.setInterval(fetchLatestLiveLocation, 5000);
    return () => {
      window.clearInterval(intervalId);
      leaveLiveSocket();
    };
  }, [fetchLatestLiveLocation, joinLiveSocket, leaveLiveSocket, liveRouteEnabled, order?.id]);

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
      console.info("[route] provider", GOOGLE_MAPS_API_KEY ? "Google Directions" : "Google Maps key missing");
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
    if (!routeRequested || loadingSettings || !hasShopCoordinates || !hasDestinationCoordinates) return undefined;
    const controller = new AbortController();
    setLoadingRoute(true);
    setError("");
    if (import.meta.env.DEV) console.info("[route] request", { origin: { latitude: shop.latitude, longitude: shop.longitude }, destination: { latitude: destinationSnapshot.latitude, longitude: destinationSnapshot.longitude } });
    fetchDrivingRoute(shop, destinationSnapshot, { signal: controller.signal, cache: routeCacheRef.current })
      .then((routeData) => {
        setRoute(routeData);
        if (import.meta.env.DEV) console.info("[route] response", { distanceMeters: routeData.distanceMeters, durationSeconds: routeData.durationSeconds });
      })
      .catch((requestError) => {
        if (requestError?.name !== "AbortError") {
          if (import.meta.env.DEV) console.warn("[route] error", requestError?.message);
          setError(requestError?.message || "Route details are temporarily unavailable.");
        }
      })
      .finally(() => {
        setLoadingRoute(false);
      });
    return () => controller.abort();
  }, [destinationSnapshot.latitude, destinationSnapshot.longitude, hasDestinationCoordinates, hasShopCoordinates, loadingSettings, routeRequested, shop.latitude, shop.longitude]);

  useEffect(() => {
    const metricsRoute = liveRoute || route;
    if (!metricsRoute || typeof onRouteMetrics !== "function") return;
    const distanceKm = Number.isFinite(metricsRoute.distanceMeters) ? Math.round((metricsRoute.distanceMeters / 1000) * 10) / 10 : null;
    const durationMinutes = Number.isFinite(metricsRoute.durationSeconds) ? Math.max(1, Math.round(metricsRoute.durationSeconds / 60)) : null;
    onRouteMetrics({ distanceKm, durationMinutes });
  }, [liveRoute, onRouteMetrics, route]);

  useEffect(() => {
    const routeOrigin = riderPosition && validMapCoordinate(riderPosition.lat, riderPosition.lng)
      ? { latitude: riderPosition.lat, longitude: riderPosition.lng, heading: riderPosition.heading, shared_at: riderPosition.shared_at }
      : liveLocation;
    if (!routeVisible || !liveRouteUsable || !routeOrigin) return undefined;
    const now = Date.now();
    liveRouteRefreshRef.current = { point: routeOrigin, at: now };
    const requestId = routeRequestRef.current + 1;
    routeRequestRef.current = requestId;
    const controller = new AbortController();
    fetchDrivingRoute(routeOrigin, destinationSnapshot, { signal: controller.signal, cache: routeCacheRef.current })
      .then((routeData) => {
        if (requestId !== routeRequestRef.current) return;
        setLiveRoute(routeData);
        setLiveError("");
      })
      .catch((requestError) => {
        if (requestError?.name !== "AbortError") setLiveError(requestError?.message || "Live road route is temporarily unavailable.");
      });
    return () => controller.abort();
  }, [destinationSnapshot, liveLocation, liveRoute, liveRouteUsable, riderPosition, routeVisible]);

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
    console.log("Current rider location:", point.latitude, point.longitude);
    const now = Date.now();
    const previous = lastPublishedRef.current.point;
    lastPublishedRef.current = { point, at: now };
    const heading = point.heading ?? bearingBetween(previous, point) ?? headingRef.current;
    const payload = {
      latitude: point.latitude,
      longitude: point.longitude,
      timestamp: new Date().toISOString()
    };
    const nextRiderPosition = {
      lat: point.latitude,
      lng: point.longitude,
      heading,
      shared_at: payload.timestamp
    };
    console.log("MAP RIDER POSITION:", nextRiderPosition);
    setRiderPosition(nextRiderPosition);
    applyLiveLocation({ ...payload, heading, speed: point.speed, accuracy: point.accuracy, order_id: Number(order.id), user_id: 0, source_type: "rider", is_live: true, shared_at: new Date().toISOString() });
    api.post(`/live-locations/orders/${order.id}`, {
      ...payload,
      source_type: "rider",
      heading,
      speed: point.speed,
      accuracy: point.accuracy
    }).catch((requestError) => {
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
    trackingActiveRef.current = true;
    setTrackingActive(true);
    setLocating(true);
    joinLiveSocket();
    console.log("GPS started");
    watchIdRef.current = navigator.geolocation.watchPosition(
      publishPosition,
      (geoError) => {
        console.error("GPS Error:", geoError);
        setLocating(false);
        const messages = {
          1: "Location permission is required for delivery tracking.",
          2: "Live location is unavailable on this device.",
          3: "Live location timed out. Try again when GPS is ready."
        };
        setLiveError(messages[geoError?.code] || "Could not read live location.");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
  }

  useEffect(() => {
    const orderId = Number(order?.id || 0);
    if (!autoStartTracking || !canShareLiveLocation || !liveRouteUsable || trackingActive || locating || !orderId) return;
    if (autoStartedRef.current === orderId) return;
    autoStartedRef.current = orderId;
    startLiveTracking();
  }, [autoStartTracking, canShareLiveLocation, liveRouteUsable, locating, order?.id, trackingActive]);

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

  function toggleRouteVisibility() {
    setLiveError("");
    if (routeVisible) {
      setRouteVisible(false);
      return;
    }
    setRouteVisible(true);
    setRouteRequested(true);
  }

  const activeRoute = routeVisible ? (liveRoute || (liveRouteEnabled ? null : route)) : null;
  const showLiveLocation = liveRouteEnabled ? displayedLiveLocation : null;
  const updatedText = displayedLiveLocation ? formatUpdatedAgo(displayedLiveLocation.shared_at) : "Waiting for live location";
  const routeButtonLabel = loadingRoute && routeVisible ? "Loading Route..." : routeVisible ? "Hide Route" : "Show Routes";
  const distanceValue = activeRoute
    ? activeRoute.distanceText || (Number.isFinite(activeRoute.distanceMeters) ? `${(activeRoute.distanceMeters / 1000).toFixed(1)} km` : "Unavailable")
    : loadingRoute || locating ? "Loading..." : "Unavailable";
  const durationValue = activeRoute
    ? activeRoute.durationText || (Number.isFinite(activeRoute.durationSeconds) ? `${Math.max(1, Math.round(activeRoute.durationSeconds / 60))} min` : "Unavailable")
    : loadingRoute || locating ? "Loading..." : "Unavailable";

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
              riderPosition={riderPosition}
              followRider={followRider}
            />
            <div className="retela-route-metrics">
              <RouteMetric label="Distance" value={distanceValue} />
              <RouteMetric label="Estimated travel" value={durationValue} />
            </div>
            {liveRouteEnabled ? (
              <div className="retela-live-route-panel">
                <div>
                  <p>{canShareLiveLocation ? "Route Controls" : "Delivery Tracking"}</p>
                  <strong>{displayedLiveLocation ? "Rider location available" : routeVisible ? "Road route ready" : "Map ready"}</strong>
                  <span>{displayedLiveLocation ? `Live - Updated ${updatedText}` : "Rider location temporarily unavailable."}</span>
                </div>
                <div className="retela-live-route-actions">
                  <button type="button" onClick={toggleRouteVisibility} disabled={loadingRoute && routeVisible}>
                    {loadingRoute && routeVisible ? <Loader2 size={15} className="animate-spin" /> : <Route size={15} />}
                    {routeButtonLabel}
                  </button>
                  {displayedLiveLocation ? (
                    <button type="button" onClick={() => setFollowRider((value) => !value)}>
                      <LocateFixed size={14} /> {followRider ? "Following Rider" : "Follow Rider"}
                    </button>
                  ) : null}
                  {canShareLiveLocation ? !trackingActive ? (
                    <button type="button" onClick={startLiveTracking} disabled={locating || !liveRouteUsable}>
                      {locating ? <Loader2 size={15} className="animate-spin" /> : <Radio size={15} />}
                      {locating ? "Locating..." : "Start Live Tracking"}
                    </button>
                  ) : (
                    <>
                      <span className="retela-live-route-badge"><Radio size={14} /> {displayedLiveLocation ? "Live Tracking" : "Loading/Locating..."}</span>
                      <button type="button" onClick={() => stopLiveTracking()}><Square size={14} /> Stop Live</button>
                    </>
                  ) : null}
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

function DeliveryRouteMap({ shop, destination, route, riderPosition = null, followRider = false }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const directionsRendererRef = useRef(null);
  const routePolylineRef = useRef(null);
  const shopMarkerRef = useRef(null);
  const customerMarkerRef = useRef(null);
  const riderMarkerRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const lastBoundsRef = useRef(null);
  const [mapState, setMapState] = useState("loading");
  const [mapError, setMapError] = useState("");

  const fitMap = useCallback((includeRider = false) => {
    const google = window.google;
    const map = mapRef.current;
    if (!google?.maps || !map) return;
    const bounds = new google.maps.LatLngBounds();
    bounds.extend({ lat: Number(shop.latitude), lng: Number(shop.longitude) });
    bounds.extend({ lat: Number(destination.latitude), lng: Number(destination.longitude) });
    if (includeRider && riderPosition) bounds.extend({ lat: Number(riderPosition.lat), lng: Number(riderPosition.lng) });
    route?.directions?.routes?.[0]?.overview_path?.forEach((point) => bounds.extend(point));
    route?.coordinates?.forEach((point) => bounds.extend({ lat: Number(point.latitude), lng: Number(point.longitude) }));
    lastBoundsRef.current = bounds;
    map.fitBounds(bounds, { top: 64, right: 48, bottom: 58, left: 48 });
    window.setTimeout(() => {
      if (map.getZoom() > 17) map.setZoom(17);
      if (map.getZoom() < 10) map.setZoom(10);
    }, 60);
  }, [destination.latitude, destination.longitude, riderPosition, route, shop.latitude, shop.longitude]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    let active = true;
    loadGoogleMaps()
      .then((google) => {
        if (!active || !node) return;
        const center = { lat: Number(shop.latitude), lng: Number(shop.longitude) };
        const map = new google.maps.Map(node, {
          center,
          zoom: 14,
          clickableIcons: false,
          fullscreenControl: false,
          mapTypeControl: false,
          streetViewControl: false,
          rotateControl: false,
          scaleControl: true,
          zoomControl: false,
          gestureHandling: "greedy",
          backgroundColor: "#dfeee5",
          styles: [
            { featureType: "poi.business", stylers: [{ visibility: "simplified" }] },
            { featureType: "transit", stylers: [{ visibility: "off" }] }
          ]
        });
        mapRef.current = map;
        directionsRendererRef.current = new google.maps.DirectionsRenderer({
          map,
          suppressMarkers: true,
          preserveViewport: true,
          polylineOptions: {
            strokeColor: "#2563eb",
            strokeOpacity: 0.92,
            strokeWeight: 5
          }
        });
        shopMarkerRef.current = createDeliveryMarker(google, map, shop, "shop");
        customerMarkerRef.current = createDeliveryMarker(google, map, destination, "customer");
        setMapState("ready");
        window.setTimeout(() => fitMap(Boolean(riderPosition)), 120);
      })
      .catch((error) => {
        if (!active) return;
        setMapError(error?.message || "Google Maps could not be loaded.");
        setMapState("error");
      });

    return () => {
      active = false;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      directionsRendererRef.current?.setMap(null);
      routePolylineRef.current?.setMap(null);
      shopMarkerRef.current?.setMap(null);
      customerMarkerRef.current?.setMap(null);
      riderMarkerRef.current?.setMap(null);
      directionsRendererRef.current = null;
      routePolylineRef.current = null;
      shopMarkerRef.current = null;
      customerMarkerRef.current = null;
      riderMarkerRef.current = null;
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    const map = mapRef.current;
    if (!node || !map || typeof window.ResizeObserver === "undefined") return undefined;
    const observer = new window.ResizeObserver(() => {
      window.google?.maps?.event?.trigger(map, "resize");
      if (lastBoundsRef.current) map.fitBounds(lastBoundsRef.current, { top: 64, right: 48, bottom: 58, left: 48 });
    });
    observer.observe(node);
    resizeObserverRef.current = observer;
    return () => observer.disconnect();
  }, [mapState]);

  useEffect(() => {
    const google = window.google;
    if (!google?.maps || !mapRef.current) return;
    shopMarkerRef.current?.setPosition({ lat: Number(shop.latitude), lng: Number(shop.longitude) });
    customerMarkerRef.current?.setPosition({ lat: Number(destination.latitude), lng: Number(destination.longitude) });
    fitMap(false);
  }, [destination.latitude, destination.longitude, shop.latitude, shop.longitude]);

  useEffect(() => {
    const google = window.google;
    const renderer = directionsRendererRef.current;
    const map = mapRef.current;
    if (!renderer || !google?.maps || !map) return;
    routePolylineRef.current?.setMap(null);
    routePolylineRef.current = null;
    if (route?.directions) {
      renderer.setMap(map);
      renderer.setDirections(route.directions);
      window.setTimeout(() => fitMap(Boolean(riderPosition)), 80);
    } else if (route?.coordinates?.length) {
      renderer.setMap(null);
      routePolylineRef.current = new google.maps.Polyline({
        map,
        path: route.coordinates.map((point) => ({ lat: Number(point.latitude), lng: Number(point.longitude) })),
        geodesic: true,
        strokeColor: "#2563eb",
        strokeOpacity: 0.92,
        strokeWeight: 5
      });
      window.setTimeout(() => fitMap(Boolean(riderPosition)), 80);
    } else {
      renderer.setMap(null);
      renderer.setMap(map);
      fitMap(Boolean(riderPosition));
    }
  }, [route]);

  useEffect(() => {
    const google = window.google;
    const map = mapRef.current;
    if (!google?.maps || !map) return;
    if (!riderPosition) {
      riderMarkerRef.current?.setMap(null);
      riderMarkerRef.current = null;
      return;
    }
    console.log("MAP RIDER POSITION:", riderPosition);
    const position = { lat: Number(riderPosition.lat), lng: Number(riderPosition.lng) };
    if (!riderMarkerRef.current) {
      riderMarkerRef.current = createDeliveryMarker(google, map, { latitude: riderPosition.lat, longitude: riderPosition.lng, heading: riderPosition.heading }, "rider");
    }
    riderMarkerRef.current.setPosition(position);
    riderMarkerRef.current.setIcon(deliveryMarkerIcon(google, "rider", riderPosition.heading));
    if (followRider) {
      map.panTo(position);
      if (Number(map.getZoom() || 0) < 16) map.setZoom(16);
    }
  }, [followRider, riderPosition]);

  function zoomBy(delta) {
    const map = mapRef.current;
    if (!map) return;
    map.setZoom(Math.max(3, Math.min(20, Number(map.getZoom() || 14) + delta)));
  }

  return (
    <div className="retela-route-map-shell" onWheel={(event) => event.stopPropagation()} onTouchMove={(event) => event.stopPropagation()}>
      <div ref={containerRef} className="retela-route-map" aria-label="Delivery route map" />
      {mapState === "loading" ? <div className="retela-map-status-overlay is-loading"><Loader2 size={16} className="animate-spin" /> Loading Google Map...</div> : null}
      {mapState === "error" ? <div className="retela-map-status-overlay"><span>{mapError}</span></div> : null}
      <div className="retela-route-map-tools">
        <button type="button" onClick={() => zoomBy(1)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(-1)} aria-label="Zoom out">-</button>
        <button type="button" onClick={() => fitMap(Boolean(riderPosition))} aria-label="Recenter Map" title="Recenter Map"><LocateFixed size={14} /></button>
        <button type="button" onClick={() => fitMap(true)} aria-label="Reset Route View" title="Reset Route View"><RotateCcw size={14} /></button>
      </div>
    </div>
  );
}

function createDeliveryMarker(google, map, point, type) {
  return new google.maps.Marker({
    map,
    position: { lat: Number(point.latitude), lng: Number(point.longitude) },
    title: type === "shop" ? "RETELA Shop" : type === "customer" ? "Customer Delivery Location" : "Rider",
    label: type === "rider" ? null : {
      text: type === "shop" ? "Shop" : "Customer",
      color: type === "shop" ? "#ffffff" : "#123526",
      fontSize: "11px",
      fontWeight: "800"
    },
    icon: deliveryMarkerIcon(google, type, point.heading),
    optimized: true
  });
}

function deliveryMarkerIcon(google, type, heading = 0) {
  if (type === "rider") {
    return {
      path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
      rotation: Number(heading || 0),
      scale: 5.4,
      fillColor: "#2563eb",
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeWeight: 2,
      anchor: new google.maps.Point(0, 2)
    };
  }
  const color = type === "shop" ? "#0b8f59" : "#2563eb";
  return {
    path: "M12 2C7.6 2 4 5.6 4 10c0 5.4 8 12 8 12s8-6.6 8-12c0-4.4-3.6-8-8-8zm0 11.2A3.2 3.2 0 1 1 12 6.8a3.2 3.2 0 0 1 0 6.4z",
    fillColor: color,
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 2,
    scale: 1.55,
    labelOrigin: new google.maps.Point(12, -4),
    anchor: new google.maps.Point(12, 22)
  };
}
