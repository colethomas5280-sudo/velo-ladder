import type { TrackerId } from "@/lib/types";
import { todayISO } from "@/lib/velo";

/** In-progress session entry, kept per athlete+tracker and mirrored to localStorage. */
export interface Draft {
  date: string;
  notes: string;
  /** slot key -> 4 raw string inputs ["80%", "1", "2", "3"] */
  throws: Record<string, string[]>;
  editingId: string | null;
}

export function emptyDraft(): Draft {
  return { date: todayISO(), notes: "", throws: {}, editingId: null };
}

const key = (athleteId: string, tracker: TrackerId) =>
  `veloladder:draft:${athleteId}:${tracker}`;

export function loadDraft(athleteId: string, tracker: TrackerId): Draft {
  if (typeof window === "undefined") return emptyDraft();
  try {
    const raw = window.localStorage.getItem(key(athleteId, tracker));
    if (raw) {
      const d = JSON.parse(raw) as Draft;
      return {
        date: d.date || todayISO(),
        notes: d.notes || "",
        throws: d.throws || {},
        editingId: d.editingId ?? null,
      };
    }
  } catch {
    /* ignore */
  }
  return emptyDraft();
}

export function saveDraft(athleteId: string, tracker: TrackerId, draft: Draft) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(athleteId, tracker), JSON.stringify(draft));
  } catch {
    /* ignore */
  }
}

export function clearDraft(athleteId: string, tracker: TrackerId) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key(athleteId, tracker));
  } catch {
    /* ignore */
  }
}
