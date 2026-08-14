import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, ShoppingCart, X } from "lucide-react";
import ProductImage from "./ProductImage";

function productImages(product) {
  const images = Array.isArray(product?.images) ? product.images : [];
  const values = [
    ...images,
    product?.image_url,
    product?.imageUrl,
    product?.first_product_image,
    product?.product_image
  ];
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export default function ProductQuickView({
  product,
  isOpen,
  onClose,
  mode = "customer",
  onAddToCart,
  onBuyNow
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [touchStart, setTouchStart] = useState(null);
  const images = useMemo(() => productImages(product), [product]);
  const hasMultipleImages = images.length > 1;
  const isCustomer = mode === "customer";
  const stock = Number(product?.stock || 0);
  const outOfStock = stock <= 0;

  useEffect(() => {
    if (!isOpen) return undefined;
    setActiveIndex(0);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose?.();
      if (event.key === "ArrowRight" && hasMultipleImages) setActiveIndex((value) => (value + 1) % images.length);
      if (event.key === "ArrowLeft" && hasMultipleImages) setActiveIndex((value) => (value - 1 + images.length) % images.length);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [hasMultipleImages, images.length, isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !hasMultipleImages) return undefined;
    const interval = window.setInterval(() => {
      setActiveIndex((value) => (value + 1) % images.length);
    }, 3000);
    return () => window.clearInterval(interval);
  }, [hasMultipleImages, images.length, isOpen]);

  if (!isOpen || !product) return null;

  function previousImage() {
    if (!hasMultipleImages) return;
    setActiveIndex((value) => (value - 1 + images.length) % images.length);
  }

  function nextImage() {
    if (!hasMultipleImages) return;
    setActiveIndex((value) => (value + 1) % images.length);
  }

  function handleTouchEnd(event) {
    if (touchStart === null || !hasMultipleImages) return;
    const delta = event.changedTouches?.[0]?.clientX - touchStart;
    setTouchStart(null);
    if (Math.abs(delta) < 35) return;
    if (delta < 0) nextImage();
    else previousImage();
  }

  function runAction(callback) {
    if (!callback || outOfStock) return;
    callback(product);
  }

  return createPortal(
    <div className="product-quick-view-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`product-quick-view-sheet ${isCustomer ? "is-customer" : "is-admin"}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${product.name || "Product"} quick preview`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="product-quick-view-header">
          <span>{hasMultipleImages ? `${activeIndex + 1} / ${images.length}` : "Preview"}</span>
          <button type="button" onClick={onClose} aria-label="Close product preview">
            <X size={18} />
          </button>
        </header>

        <div
          className="product-quick-view-image-stage"
          onTouchStart={(event) => setTouchStart(event.touches?.[0]?.clientX ?? null)}
          onTouchEnd={handleTouchEnd}
        >
          {hasMultipleImages ? (
            <button type="button" className="product-quick-view-nav is-prev" onClick={previousImage} aria-label="Previous image">
              <ChevronLeft size={18} />
            </button>
          ) : null}
          <ProductImage
            product={!images[activeIndex] ? product : undefined}
            src={images[activeIndex]}
            className="product-quick-view-image"
            placeholderClassName="product-quick-view-image-placeholder"
            alt={product.name || "Product preview"}
          />
          {hasMultipleImages ? (
            <button type="button" className="product-quick-view-nav is-next" onClick={nextImage} aria-label="Next image">
              <ChevronRight size={18} />
            </button>
          ) : null}
        </div>

        {hasMultipleImages ? (
          <div className="product-quick-view-dots" aria-hidden="true">
            {images.map((image, index) => (
              <button
                type="button"
                key={`${image}-${index}`}
                className={index === activeIndex ? "is-active" : ""}
                onClick={() => setActiveIndex(index)}
                tabIndex={-1}
              />
            ))}
          </div>
        ) : null}

        {isCustomer ? (
          <footer className="product-quick-view-actions">
            <button type="button" disabled={outOfStock} className="product-quick-view-buy" onClick={() => runAction(onBuyNow)}>
              {outOfStock ? "Out of stock" : "Buy Now"}
            </button>
            <button type="button" disabled={outOfStock} className="product-quick-view-add" onClick={() => runAction(onAddToCart)}>
              <ShoppingCart size={16} /> {outOfStock ? "Out of stock" : "Add to Cart"}
            </button>
          </footer>
        ) : null}
      </section>
    </div>,
    document.body
  );
}
