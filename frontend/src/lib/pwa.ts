import { registerSW } from "virtual:pwa-register";

export const PWA_NEED_REFRESH = "pwa:need-refresh";
export const PWA_OFFLINE_READY = "pwa:offline-ready";

let update: ((reloadPage?: boolean) => Promise<void>) | undefined;

export function applyPwaUpdate() {
  return update?.(true);
}

export function initPwa() {
  if (typeof window === "undefined") return;
  update = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new Event(PWA_NEED_REFRESH));
    },
    onOfflineReady() {
      window.dispatchEvent(new Event(PWA_OFFLINE_READY));
    }
  });
}
