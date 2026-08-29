import { useEffect, useState } from "react";
import { RETELA_LOGO_URL } from "../config/branding";

function retryUrl(url, attempt) {
  const separator = String(url).includes("?") ? "&" : "?";
  return `${url}${separator}logo_retry=${Date.now()}_${attempt}`;
}

/**
 * Renders a logo without ever treating a browser blob/local path as the
 * persisted source. Failed saved URLs are retried before a neutral fallback
 * is rendered, avoiding a broken-image icon while preserving the saved URL.
 */
export default function LogoImage({ src, alt = "RETELA logo", onError, ...props }) {
  const source = src || RETELA_LOGO_URL;
  const [displaySource, setDisplaySource] = useState(source);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setDisplaySource(source);
    setAttempt(0);
    setFailed(false);
  }, [source]);

  function handleError(event) {
    onError?.(event);
    if (attempt < 2) {
      const nextAttempt = attempt + 1;
      setAttempt(nextAttempt);
      setDisplaySource(retryUrl(source, nextAttempt));
      return;
    }
    setFailed(true);
  }

  if (failed) {
    return (
      <span
        {...props}
        role="img"
        aria-label={alt}
        className={`${props.className || ""} inline-flex items-center justify-center bg-emerald-50 font-black tracking-[0.08em] text-emerald-700`}
      >
        RETELA
      </span>
    );
  }

  return <img {...props} src={displaySource} alt={alt} onError={handleError} />;
}
