export function productImageUrlForRow(row = {}) {
  const productId = Number(row.id || row.product_id);
  const hasImage = row.has_image === true || row.has_image === 1 || row.has_image === "1";
  if (hasImage && Number.isInteger(productId) && productId > 0) {
    return `/api/products/${productId}/image`;
  }
  return row.image_url || row.imageUrl || null;
}

export function productImageSelect(alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return `CASE WHEN ${prefix}image_data IS NOT NULL THEN 1 ELSE 0 END AS has_image`;
}

export function productImageExpression(alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return `CASE WHEN ${prefix}image_data IS NOT NULL THEN CONCAT('/api/products/', ${prefix}id, '/image') ELSE ${prefix}image_url END`;
}
