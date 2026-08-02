const baseUrl = String(process.env.RETELA_API_URL || process.env.API_BASE_URL || "http://localhost:5000").replace(/\/+$/, "");
const adminUsername = process.env.RETELA_ADMIN_USERNAME || "";
const adminPassword = process.env.RETELA_ADMIN_PASSWORD || "";
const runMutationChecks = String(process.env.RETELA_RUN_MUTATION_CHECKS || "").toLowerCase() === "true";

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} failed with ${response.status}: ${body?.message || response.statusText}`);
  }
  return body?.data ?? body;
}

async function optionalAdminLogin() {
  if (!adminUsername || !adminPassword) return null;
  const data = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: adminUsername, password: adminPassword })
  });
  return data.token;
}

async function run() {
  const checks = [];
  async function check(name, fn) {
    await fn();
    checks.push({ name, ok: true });
    console.log(`ok - ${name}`);
  }

  await check("health", () => request("/api/health"));
  await check("public settings", () => request("/api/settings/public"));
  await check("public reviews", () => request("/api/reviews"));

  const token = await optionalAdminLogin();
  if (!token) {
    console.log("skip - authenticated checks require RETELA_ADMIN_USERNAME and RETELA_ADMIN_PASSWORD");
    return checks;
  }

  await check("login", async () => {});
  await check("current user", () => request("/api/users/me", { token }));
  await check("products", () => request("/api/products", { token }));
  await check("product inventory", () => request("/api/products/inventory", { token }));
  await check("categories", () => request("/api/categories", { token }));
  await check("cart", () => request("/api/cart", { token }));
  await check("shipping settings", () => request("/api/settings/shipping", { token }));
  await check("orders", () => request("/api/orders", { token }));
  await check("admin authorization", () => request("/api/users", { token }));

  if (!runMutationChecks) {
    console.log("skip - product mutation checks require RETELA_RUN_MUTATION_CHECKS=true");
    return checks;
  }

  const unique = Date.now();
  const created = await request("/api/products", {
    method: "POST",
    token,
    body: JSON.stringify({
      name: `Retela Test Product ${unique}`,
      brand: "Other",
      category: "T-Shirts",
      gender: "Other",
      size: "Free Size",
      color: "Other",
      price: 99,
      stock: 1,
      condition: "Good",
      description: "Temporary production-readiness test product"
    })
  });
  const productId = Number(created.id || created.product_id || created.product?.id);
  if (!Number.isInteger(productId) || productId <= 0) throw new Error("Product create did not return a valid id");
  console.log(`ok - product create (${productId})`);

  await request(`/api/products/${productId}`, {
    method: "PUT",
    token,
    body: JSON.stringify({
      name: `Retela Test Product ${unique} Updated`,
      brand: "Other",
      category: "T-Shirts",
      gender: "Other",
      size: "Free Size",
      color: "Other",
      price: 109,
      stock: 2,
      condition: "Good",
      description: "Updated temporary production-readiness test product"
    })
  });
  console.log("ok - product update");

  await request(`/api/products/${productId}`, { method: "DELETE", token });
  console.log("ok - product archive/delete");

  return checks;
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
