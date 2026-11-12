"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Reloads the page's data every `seconds` while the tab is visible (live standings, pending verdicts). */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
