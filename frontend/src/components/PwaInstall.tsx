import { useEffect, useState } from "react";
import { Download, RefreshCw, WifiOff, X } from "lucide-react";
import { applyPwaUpdate, PWA_NEED_REFRESH, PWA_OFFLINE_READY } from "@/lib/pwa";
import { Button } from "@/components/ui";

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export function PwaInstall() {
  const [promptEvent, setPromptEvent] = useState<PromptEvent | null>(null);
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  const [needRefresh, setNeedRefresh] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(() => {
    try {
      return sessionStorage.getItem("infatoz_pwa_install") === "hide";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as PromptEvent);
    };
    const onInstalled = () => setPromptEvent(null);
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    const onRefresh = () => setNeedRefresh(true);
    const onReady = () => setNeedRefresh(false);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    window.addEventListener(PWA_NEED_REFRESH, onRefresh);
    window.addEventListener(PWA_OFFLINE_READY, onReady);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      window.removeEventListener(PWA_NEED_REFRESH, onRefresh);
      window.removeEventListener(PWA_OFFLINE_READY, onReady);
    };
  }, []);

  const showInstall = Boolean(promptEvent) && !isStandalone() && !installDismissed;

  if (!offline && !needRefresh && !showInstall) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-3 pt-[max(0.5rem,env(safe-area-inset-top))] sm:justify-end sm:px-4">
      <div className="pointer-events-auto mt-14 flex w-full max-w-md flex-col gap-2 sm:mt-3">
        {offline && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-950 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/80 dark:text-amber-100">
            <WifiOff size={16} className="shrink-0" />
            <span className="flex-1">You’re offline. Live data will refresh when the connection returns.</span>
          </div>
        )}
        {needRefresh && (
          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[13px] shadow-sm">
            <RefreshCw size={16} className="shrink-0 text-accent" />
            <span className="flex-1">A new version of Infy PrintOS is ready.</span>
            <Button
              size="sm"
              onClick={() => {
                void applyPwaUpdate();
              }}
            >
              Reload
            </Button>
          </div>
        )}
        {showInstall && (
          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[13px] shadow-sm">
            <Download size={16} className="shrink-0 text-accent" />
            <span className="flex-1">Install Infy PrintOS on this device for full-screen POS and orders.</span>
            <Button
              size="sm"
              onClick={async () => {
                await promptEvent?.prompt();
                setPromptEvent(null);
              }}
            >
              Install
            </Button>
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-paper hover:text-ink"
              aria-label="Dismiss install"
              onClick={() => {
                try {
                  sessionStorage.setItem("infatoz_pwa_install", "hide");
                } catch {
                  /* ignore */
                }
                setInstallDismissed(true);
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
