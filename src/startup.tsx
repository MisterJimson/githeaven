import { useEffect } from "react";
import { call, native } from "./api";
import { countEvent, registerGauge } from "./performance";

type Phase = "frontend" | "repository" | "welcome";
const requested = new Set<Phase>();
const measurements: Record<string, number | boolean> = {};

export function markStartup(phase: Phase) {
  if (
    !native ||
    requested.has(phase) ||
    (phase !== "frontend" &&
      (requested.has("repository") || requested.has("welcome")))
  )
    return;
  requested.add(phase);
  if (phase !== "frontend")
    measurements.ready_in_foreground = document.hasFocus() && !document.hidden;
  void call<Record<string, number>>("startup_milestone", { phase })
    .then((milestones) => {
      for (const name of [
        "setup",
        "frontend",
        "repository_discovery",
        "repository_snapshot",
        "repository_watch",
        "repository",
        "welcome",
      ]) {
        const duration = milestones[name];
        if (Number.isFinite(duration) && duration >= 0)
          measurements[`native_entry_to_${name}_ms`] = duration;
      }
      registerGauge("startup", () => ({ ...measurements }));
    })
    .catch(() => countEvent("startup.measurement-failed"));
}

// Place inside the resolved Suspense boundary: repository state alone can be
// ready before the actual workspace bundle and controls have mounted.
export function StartupReady({ phase }: { phase: "repository" | "welcome" }) {
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => markStartup(phase));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [phase]);
  return null;
}
