const NOTIFICATION_SETTING = "prism-completion-notifications";
let registrationPromise: Promise<ServiceWorkerRegistration | null> | undefined;

export function registerPwa(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || process.env.NODE_ENV !== "production"
    || !window.isSecureContext || !("serviceWorker" in navigator)) return Promise.resolve(null);
  registrationPromise ??= navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
    registrationPromise = undefined;
    return null;
  });
  return registrationPromise;
}

export function supportsCompletionNotifications(): boolean {
  return typeof window !== "undefined" && process.env.NODE_ENV === "production" && window.isSecureContext
    && "serviceWorker" in navigator && "Notification" in window
    && "ServiceWorkerRegistration" in window && "showNotification" in ServiceWorkerRegistration.prototype;
}

export function completionNotificationsEnabled(): boolean {
  try {
    return supportsCompletionNotifications() && Notification.permission === "granted"
      && localStorage.getItem(NOTIFICATION_SETTING) === "enabled";
  } catch { return false; }
}

async function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
  const registration = await registerPwa();
  if (!registration || registration.active) return registration;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => { timeout = setTimeout(() => resolve(null), 5000); }),
    ]);
  } finally { clearTimeout(timeout); }
}

export async function setCompletionNotifications(enabled: boolean): Promise<"enabled" | "disabled" | "denied" | "unsupported" | "unavailable"> {
  try {
    if (!enabled) { localStorage.removeItem(NOTIFICATION_SETTING); return "disabled"; }
    if (!supportsCompletionNotifications()) return "unsupported";
    // Called directly from the user's button press to preserve browser permission activation.
    if (await Notification.requestPermission() !== "granted") return "denied";
    if (!await activeRegistration()) return "unavailable";
    localStorage.setItem(NOTIFICATION_SETTING, "enabled");
    return "enabled";
  } catch { return "unavailable"; }
}

// This runs only after the open page receives a completed debate; it does not run debates in the background.
export async function notifyDebateComplete(topic: string, debateId: string): Promise<boolean> {
  if (!completionNotificationsEnabled()) return false;
  try {
    const registration = await activeRegistration();
    if (!registration) return false;
    await registration.showNotification("Prism · 토론이 완료됐어요", {
      body: topic.slice(0, 140),
      icon: "/icons/icon-192.png",
      tag: `prism-debate-${debateId}`,
      data: { url: `/?debate=${encodeURIComponent(debateId)}` },
    });
    return true;
  } catch { return false; }
}
