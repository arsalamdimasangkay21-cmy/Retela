import assert from "node:assert/strict";
import test from "node:test";
import { isCustomerSafeNotificationPayload } from "../src/utils/notificationVisibility.js";

const customerId = 42;

test("customer-safe notifications include products, promos, own order/payment, and own returns", () => {
  assert.equal(isCustomerSafeNotificationPayload({
    type: "new_product",
    title: "New Item Available",
    body: "New arrival: SHADNE T-Shirt is now available.",
    user_id: customerId
  }, customerId), true);

  assert.equal(isCustomerSafeNotificationPayload({
    type: "broadcast",
    title: "Weekend Sale",
    body: "Weekend Sale starts tomorrow. 20% OFF selected apparel.",
    user_id: customerId,
    broadcast: { broadcast_type: "promo_sale", sale_enabled: true }
  }, customerId), true);

  assert.equal(isCustomerSafeNotificationPayload({
    type: "broadcast",
    title: "Holiday Sales",
    body: "Selected apparel has a limited-time discount.",
    user_id: customerId,
    broadcast: { broadcast_type: "holiday_promo", sale_enabled: true }
  }, customerId), true);

  assert.equal(isCustomerSafeNotificationPayload({
    type: "order",
    title: "Order update",
    body: "Your order is now processing.",
    user_id: customerId
  }, customerId), true);

  assert.equal(isCustomerSafeNotificationPayload({
    type: "payment",
    title: "Payment confirmed",
    body: "Payment for Order #15 was confirmed.",
    user_id: customerId
  }, customerId), true);

  assert.equal(isCustomerSafeNotificationPayload({
    type: "refund",
    title: "Return request update",
    body: "Your return request is now approved.",
    user_id: customerId
  }, customerId), true);
});

test("customer notifications block sales, inventory, analytics, and other customers", () => {
  assert.equal(isCustomerSafeNotificationPayload({
    type: "order",
    title: "New Sale",
    body: "5 DIOR Essential T-Shirts sold in the last hour.",
    user_id: customerId
  }, customerId), false);

  assert.equal(isCustomerSafeNotificationPayload({
    type: "inventory",
    title: "Low stock alert",
    body: "DIOR Essential T-Shirt is now at 2 stock.",
    user_id: null
  }, customerId), false);

  assert.equal(isCustomerSafeNotificationPayload({
    type: "system",
    title: "Revenue update",
    body: "Dashboard analytics revenue changed.",
    user_id: null
  }, customerId), false);

  assert.equal(isCustomerSafeNotificationPayload({
    type: "order",
    title: "Order update",
    body: "Your order is now shipped.",
    user_id: 99
  }, customerId), false);

  assert.equal(isCustomerSafeNotificationPayload({
    type: "broadcast",
    title: "Restock management warning",
    body: "Internal shop inventory needs restock.",
    user_id: customerId,
    broadcast: { broadcast_type: "restock_alert" }
  }, customerId), false);
});
