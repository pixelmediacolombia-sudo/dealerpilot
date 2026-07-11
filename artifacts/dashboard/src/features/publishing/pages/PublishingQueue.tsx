// This route is kept for deep links/bookmarks; it opens the unified
// Marketplace AI workspace with the Publishing (Queue) tab selected.
import { useEffect } from "react";
import { useLocation } from "wouter";

export function PublishingQueue() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation("/listings?tab=publishing");
  }, [setLocation]);

  return null;
}
