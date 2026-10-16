import type { TrackerId } from "@/lib/types";
import { todayISO } from "@/lib/velo";

/** In-progress session entry, kept per athlete+tracker and mirrored to localStorage. */
export interface Draft {
  date: string;
  notes: string;
  /** slot key -> raw string inputs, one per box: ["80%", "1", "2", "3", "4"] */
  throws: Record<string, string[]>;
  editingId: string | null;
}

export function emptyDraft(): Draft {
  return { date: todayISO(), notes: "", throws: {}, editingId: null };
}

const key = (athleteId: string, tracker: TrackerId) =>
  `veloladder:draft:${athleteId}:${tracker}`;

/** True when any box holds something, even a 0. Blank and whitespace do not count. */
function hasNumbers(throws: Draft["throws"]): boolean {
  return Object.values(throws).some((boxes) =>
    boxes.some((v) => String(v ?? "").trim() !== ""),
  );
}

/**
 * Restore the unfinished entry for this athlete and tracker.
 *
 * A draft comes back with the date it was saved under, which made a new
 * session open on a past day: pressing Save with nothing entered leaves an
 * empty draft behind, and it sat in the browser dating every later session
 * (the coach saw September 16 and October 5 on October 16). So an entry with
 * no numbers in it always starts on today. One WITH numbers keeps its date,
 * so unsaved numbers are never silently saved under the wrong day, and so does
 * an entry editing an existing session, whose date belongs to that session.
 */
export function loadDraft(athleteId: string, tracker: TrackerId): Draft {
  if (typeof window === "undefined") return emptyDraft();
  try {
    const raw = window.localStorage.getItem(key(athleteId, tracker));
    if (raw) {
      const d = JSON.parse(raw) as Draft;
      const throws = d.throws || {};
      const editingId = d.editingId ?? null;
      const keepsOwnDate = editingId !== null || hasNumbers(throws);
      return {
        date: keepsOwnDate ? d.date || todayISO() : todayISO(),
        notes: d.notes || "",
        throws,
        editingId,
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
