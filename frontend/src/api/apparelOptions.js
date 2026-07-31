import { api } from "./client";

const endpoints = {
  brands: "/brands",
  categories: "/categories",
  types: "/types",
  sizes: "/sizes",
  conditions: "/conditions"
};

export async function fetchApparelOptions() {
  const [brands, categories, types, sizes, conditions] = await Promise.all([
    api.get(endpoints.brands),
    api.get(endpoints.categories),
    api.get(endpoints.types),
    api.get(endpoints.sizes),
    api.get(endpoints.conditions)
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
  return response.data;
}
