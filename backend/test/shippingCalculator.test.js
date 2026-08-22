import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyShippingLocation,
  haversineDistanceKm,
  normalizeMunicipality
} from "../src/utils/shippingCalculator.js";

const policy = {
  shopMunicipality: "Midsayap",
  shopLatitude: 7.1907,
  shopLongitude: 124.5308,
  freeDeliveryMunicipalities: ["Midsayap", "Libungan", "Pigcawayan"],
  freeDeliveryRadiusKm: 15,
  outsideAreaShippingFee: 89,
  enabled: true
};

test("municipality normalization is exact and case insensitive", () => {
  assert.equal(normalizeMunicipality(" Municipality of MIDSAYAP "), "midsayap");
  assert.equal(normalizeMunicipality("Midsayap City"), "midsayap");
  assert.notEqual(normalizeMunicipality("Midsayap Heights"), "midsayap");
});

for (const municipality of ["Midsayap", "Libungan", "Pigcawayan"]) {
  test(`${municipality} is free through the configured municipality list`, () => {
    const quote = classifyShippingLocation({ municipality }, policy);
    assert.equal(quote.shippingFee, 0);
    assert.equal(quote.shippingZone, "nearby");
    assert.equal(quote.shippingRule, "municipality");
  });
}

for (const location of [
  { name: "Sadaan", municipality: "Sadaan", latitude: 7.42, longitude: 124.35 },
  { name: "Quezon City", municipality: "Quezon City", latitude: 14.676, longitude: 121.0437 },
  { name: "Cebu City", municipality: "Cebu City", latitude: 10.3157, longitude: 123.8854 }
]) {
  test(`${location.name} uses the outside-area fee`, () => {
    const quote = classifyShippingLocation(location, policy);
    assert.equal(quote.shippingFee, 89);
    assert.equal(quote.shippingZone, "outside");
    assert.equal(quote.shippingRule, "outside_area");
  });
}

test("coordinates inside the free radius are free", () => {
  const location = { municipality: "Unlisted", latitude: 7.22, longitude: 124.54 };
  const quote = classifyShippingLocation(location, policy);
  assert.ok(quote.distanceKm > 0 && quote.distanceKm < 15);
  assert.equal(quote.shippingFee, 0);
  assert.equal(quote.shippingRule, "radius");
});

test("Haversine returns a finite distance for valid coordinate pairs", () => {
  const distance = haversineDistanceKm(
    { latitude: policy.shopLatitude, longitude: policy.shopLongitude },
    { latitude: 14.676, longitude: 121.0437 }
  );
  assert.ok(Number.isFinite(distance));
  assert.ok(distance > 800);
});

test("unknown delivery locations never default to nearby", () => {
  const quote = classifyShippingLocation({}, policy);
  assert.equal(quote.shippingFee, 89);
  assert.equal(quote.shippingZone, "outside");
});

test("free-shipping coupons preserve the outside zone", () => {
  const quote = classifyShippingLocation(
    { municipality: "Quezon City", latitude: 14.676, longitude: 121.0437 },
    { ...policy, couponFreeShipping: true }
  );
  assert.equal(quote.shippingFee, 0);
  assert.equal(quote.shippingZone, "outside");
  assert.equal(quote.shippingRule, "coupon");
});

test("pickup never incurs shipping", () => {
  const quote = classifyShippingLocation({}, { ...policy, fulfillmentMethod: "pickup" });
  assert.equal(quote.shippingFee, 0);
  assert.equal(quote.shippingZone, "pickup");
  assert.equal(quote.shippingRule, "pickup");
});

test("admin nearby override wins over an automatic outside classification", () => {
  const quote = classifyShippingLocation(
    { municipality: "Quezon City", latitude: 14.676, longitude: 121.0437 },
    { ...policy, deliveryAreaOverride: "nearby" }
  );
  assert.equal(quote.shippingFee, 0);
  assert.equal(quote.shippingZone, "nearby");
  assert.equal(quote.shippingRule, "admin_override_nearby");
});

test("admin outside override wins over an automatic nearby classification", () => {
  const quote = classifyShippingLocation(
    { municipality: "Midsayap", latitude: 7.1907, longitude: 124.5308 },
    { ...policy, deliveryAreaOverride: "outside" }
  );
  assert.equal(quote.shippingFee, 89);
  assert.equal(quote.shippingZone, "outside");
  assert.equal(quote.shippingRule, "admin_override_outside");
});

test("a cleared override falls back to automatic location classification", () => {
  const quote = classifyShippingLocation(
    { municipality: "Midsayap" },
    { ...policy, deliveryAreaOverride: null }
  );
  assert.equal(quote.shippingFee, 0);
  assert.equal(quote.shippingZone, "nearby");
  assert.equal(quote.shippingRule, "municipality");
});
