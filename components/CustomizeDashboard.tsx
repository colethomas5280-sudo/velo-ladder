"use client";

import { useEffect, useSyncExternalStore } from "react";
import { readLocal, subscribeLocal, writeLocal } from "@/lib/localStore";

export type WidgetId =
  | "snapshot"
  | "leaderboard"
  | "prs"
  | "attention"
  | "activity"
  | "resources"
  | "setbacks";

interface WidgetDef {
  id: WidgetId;
  group: string;
  name: string;
  blurb: string;
}

/** The catalogue the Customize dialog renders. Add new widgets here. */
export const WIDGETS: WidgetDef[] = [
  {
    id: "snapshot",
    group: "Overview",
    name: "Facility snapshot",
    blurb: "Athlete count, who trained this week, sessions and PRs logged",
  },
  {
    id: "leaderboard",
    group: "Velocity",
    name: "Best velos",
    blurb:
      "Leaderboard of the top velocity from each athlete on the most recent training day",
  },
  {
    id: "prs",
    group: "Velocity",
    name: "Recent PRs",
    blurb: "Personal records set in the last 7 days, and what they beat",
  },
  {
    id: "attention",
    group: "Athlete monitoring",
    name: "Needs attention",
    blurb:
      "Athletes with no session in 14+ days, and invites that haven't been accepted",
  },
  {
    id: "setbacks",
    group: "Athlete monitoring",
    name: "Setback flags",
    blurb:
      "Open soreness, CNS-readiness and pain flags across the roster, worst first",
  },
  {
    id: "resources",
    group: "Coaching",
    name: "Resources",
    blurb: "Quick links into your protocols and how-to library",
  },
  {
    id: "activity",
    group: "Athlete monitoring",
    name: "Recent activity",
    blurb: "The latest sessions logged across your roster",
  },
];

export const DEFAULT_WIDGETS: WidgetId[] = WIDGETS.map((w) => w.id);

const KEY = "veloladder:dashboard";

export function loadWidgets(): WidgetId[] {
  if (typeof window === "undefined") return DEFAULT_WIDGETS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_WIDGETS;
    const ids = JSON.parse(raw) as string[];
    // Drop anything unknown so a removed widget can't wedge the dashboard.
    return WIDGETS.filter((w) => ids.includes(w.id)).map((w) => w.id);
  } catch {
    return DEFAULT_WIDGETS;
  }
}

/**
 * Storage is the single source of truth for which widgets are on. It used to
 * be mirrored into React state as well, with both written on every toggle —
 * two copies of one fact, kept in step by hand.
 */
export function setWidgets(ids: WidgetId[]) {
  writeLocal(KEY, JSON.stringify(ids));
}

/*
 * `getSnapshot` has to return the same array until the stored value actually
 * changes; a fresh parse each call would re-render forever. Caching on the raw
 * string is what makes that true.
 */
let cachedRaw: string | null = null;
let cachedWidgets: WidgetId[] = DEFAULT_WIDGETS;

function getWidgetsSnapshot(): WidgetId[] {
  const raw = readLocal(KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedWidgets = loadWidgets();
  }
  return cachedWidgets;
}

/** The server has no saved layout, so it renders every widget. */
function getWidgetsServerSnapshot(): WidgetId[] {
  return DEFAULT_WIDGETS;
}

export function useWidgets(): WidgetId[] {
  return useSyncExternalStore(
    subscribeLocal,
    getWidgetsSnapshot,
    getWidgetsServerSnapshot,
  );
}

export default function CustomizeDashboard({
  value,
  onChange,
  onClose,
}: {
  value: WidgetId[];
  onChange: (ids: WidgetId[]) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const toggle = (id: WidgetId) => {
    const next = value.includes(id)
      ? value.filter((x) => x !== id)
      : WIDGETS.filter((w) => w.id === id || value.includes(w.id)).map(
          (w) => w.id,
        );
    onChange(next);
  };

  const groups = [...new Set(WIDGETS.map((w) => w.group))];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Customize dashboard"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">Customize dashboard</span>
          <span className="modal-sub">Your choice only affects you</span>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="customize">
          {groups.map((g) => (
            <div key={g} className="cz-group">
              <div className="eyebrow">{g}</div>
              {WIDGETS.filter((w) => w.group === g).map((w) => (
                <label key={w.id} className="cz-row">
                  <input
                    type="checkbox"
                    checked={value.includes(w.id)}
                    onChange={() => toggle(w.id)}
                  />
                  <span>
                    <b>{w.name}</b>
                    <em>{w.blurb}</em>
                  </span>
                </label>
              ))}
            </div>
          ))}
          <p className="cz-note">
            Saved in this browser, so it stays yours. More widgets show up here
            as new features land.
          </p>
        </div>
      </div>
    </div>
  );
}
