import { useEffect, useState } from "react";

export default function useBlockingLoader(loading, timeoutMs = 2000) {
  const [blocking, setBlocking] = useState(Boolean(loading));

  useEffect(() => {
    if (!loading) {
      setBlocking(false);
      return undefined;
    }

    setBlocking(true);
    const timer = window.setTimeout(() => setBlocking(false), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [loading, timeoutMs]);

  return loading && blocking;
}

