import { api } from "./client";

export function fetchFeaturedApparel() {
  return api.get("/customer/featured-apparel");
}
