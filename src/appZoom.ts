import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { native } from "./api";

const key = "githeaven.app-zoom";
export function useAppZoom() {
  useEffect(() => {
    const stored = Number(localStorage.getItem(key) ?? 1);
    let zoom = Number.isFinite(stored) ? Math.max(0.7, Math.min(2, stored)) : 1;
    let pending = Promise.resolve();
    const apply = () => {
      const next = zoom;
      pending = pending
        .then(async () => {
          if (native) await getCurrentWebview().setZoom(next);
          else document.documentElement.style.zoom = String(next);
          localStorage.setItem(key, String(next));
        })
        .catch((error) => console.error("Unable to change app zoom", error));
    };
    apply();
    const handler = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        !(event.metaKey || event.ctrlKey)
      )
        return;
      const delta =
        event.key === "+" || event.key === "="
          ? 0.1
          : event.key === "-"
            ? -0.1
            : 0;
      if (!delta && event.key !== "0") return;
      event.preventDefault();
      zoom =
        event.key === "0"
          ? 1
          : Math.max(0.7, Math.min(2, Math.round((zoom + delta) * 10) / 10));
      apply();
    };
    // Viewer capture handlers consume their own zoom before this bubbles up.
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
