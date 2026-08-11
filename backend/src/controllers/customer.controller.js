import { query } from "../config/db.js";
import { asyncHandler } from "../utils/errors.js";
import { availableProductWhere, ensureProductInventoryColumns } from "../utils/productInventory.js";
import { productImageSelect, productImageUrlForRow } from "../utils/productImages.js";

function productImages(product) {
  return [product.image_url].map((image) => String(image || "").trim()).filter(Boolean);
}

export const getFeaturedApparel = asyncHandler(async (req, res) => {
  await ensureProductInventoryColumns();
  const rows = await query(
    `SELECT id, name, brand, category, size, \`condition\`, price, stock, description, image_url, ${productImageSelect("products")}, created_at
     FROM products
     WHERE ${availableProductWhere()}
     ORDER BY created_at DESC, id DESC
     LIMIT 12`
  );

  res.json(rows.map((product) => {
    const imageUrl = productImageUrlForRow(product);
    return ({
    id: product.id,
    name: product.name,
    brand: product.brand || "Other",
    category: product.category || "T-Shirts",
    size: product.size || "Free Size",
    condition: product.condition || "Good",
    price: Number(product.price || 0),
    stock: Number(product.stock || 0),
    status: "Available",
    description: product.description || "",
    image_url: imageUrl || "",
    imageUrl,
    images: productImages({ ...product, image_url: imageUrl })
  });
  }));
});
