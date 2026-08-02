import { useEffect, useMemo, useState } from "react";
import { logProductImageDebug, resolveProductImageUrl } from "../utils/productImage";

export default function ProductImage({ product, src, alt, className = "", placeholderClassName = "" }) {
  const [failed, setFailed] = useState(false);
  const source = product ?? src;
  const imageUrl = useMemo(() => resolveProductImageUrl(source), [source]);

  useEffect(() => {
    setFailed(false);
    logProductImageDebug(product || { image_url: src }, imageUrl);
  }, [imageUrl, product, src]);

  if (!imageUrl || failed) {
    return (
      <div className={`${className} ${placeholderClassName} grid place-items-center bg-slate-100 text-center text-[11px] font-bold text-slate-400`}>
        No image
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      className={className}
      alt={alt || product?.name || "Apparel image"}
      onError={() => setFailed(true)}
    />
  );
}
