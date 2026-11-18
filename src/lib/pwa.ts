import { Capacitor } from "@capacitor/core";

export async function registerOfflineApp() {
  if (!("serviceWorker" in navigator) || Capacitor.isNativePlatform()) return;

  if (
    !import.meta.env.PROD ||
    window.self !== window.top ||
    new URLSearchParams(window.location.search).get("sw") === "off"
  ) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      if (registration.active?.scriptURL.endsWith("/sw.js")) {
        await registration.unregister();
      }
    }
    return;
  }

  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch {
    console.warn("GILNET offline installation is unavailable; online use can continue.");
  }
}