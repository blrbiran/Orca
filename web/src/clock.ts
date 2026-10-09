import { useEffect, useState } from "react";

/** The wall clock, re-read every `periodMs`, so "N minutes ago" and "no progress for N min" move while nothing else does. */
export function useClock(periodMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(timer);
  }, [periodMs]);
  return now;
}
