import { api, cachedGet, clearGetCache } from "./client";

const endpoints = {
  brands: "/brands",
  categories: "/categories",
  types: "/types",
  sizes: "/sizes",
  conditions: "/conditions"
};

export async function fetchApparelOptions() {
  const [brands, categories, types, sizes, conditions] = await Promise.all([
    cachedGet(endpoints.brands, {}, { cacheMs: 10000, retries: 1 }),
    cachedGet(endpoints.categories, {}, { cacheMs: 10000, retries: 1 }),
    cachedGet(endpoints.types, {}, { cacheMs: 10000, retries: 1 }),
    cachedGet(endpoints.sizes, {}, { cacheMs: 10000, retries: 1 }),
    cachedGet(endpoints.conditions, {}, { cacheMs: 10000, retries: 1 })
  ]);

  return {
    brands: brands.data || [],
    categories: categories.data || [],
    types: types.data || [],
    sizes: sizes.data || [],
    conditions: conditions.data || []
  };
}

export async function createApparelOption(kind, name) {
  if (!endpoints[kind]) throw new Error("Invalid apparel option type.");
  const response = await api.post(endpoints[kind], { name });
  clearGetCache(endpoints[kind]);
  return response.data;
}
