import { MapPin } from "lucide-react";

function finiteCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

export default function OrderDeliveryInfo({ order, title = "Delivery Information", mapLabel = "View Location" }) {
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
      {mapUrl ? (
        <a className="order-delivery-map-button" href={mapUrl} target="_blank" rel="noreferrer">
          <MapPin size={15} /> {mapLabel}
        </a>
      ) : null}
    </section>
  );
}
