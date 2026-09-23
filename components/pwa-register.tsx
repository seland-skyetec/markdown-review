"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let registration: ServiceWorkerRegistration | null = null;
    let disposed = false;

    const checkForUpdate = () => {
      if (document.visibilityState === "visible" && registration) {
        void registration.update();
      }
    };

    const register = async () => {
      try {
        const next = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        if (disposed) return;
        registration = next;
        await next.update();
        document.addEventListener("visibilitychange", checkForUpdate);
      } catch (error) {
        console.error("Service worker registration failed", error);
      }
    };

    void register();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", checkForUpdate);
    };
  }, []);

  return null;
}
