import { cachedGet } from "./client";

export function fetchFeaturedApparel(options = {}) {
  return cachedGet("/customer/featured-apparel", {}, { cacheMs: 10000, retries: 1, ...options });
}
