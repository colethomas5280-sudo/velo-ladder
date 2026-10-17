import type { TrackerId } from "./types";
import type { Draft } from "./draft";
import {
  TRACKERS,
  fmt,
  fmtDate,
  num,
  scoredBoxes,
  throwsFromDraft,
  todayISO,
} from "./velo";

/**
 * What the save confirmation tells the coach, kept out of the components so it
 * can be tested without rendering anything.
 *
 * It answers the same question the save itself answers, from the same helper:
 * `throwsFromDraft` decides whether a draft has a 100% throw, so the summary
 * can never list someone the post would skip, or skip someone it would post.
 */
export interface DraftSummary {
  tracker: TrackerId;
  /** The ISO day that will really be posted: the draft's, else today. */
  date: string;
  /** Highest value across every slot, boxes 1-4 only (box 0 is the primer). */
  best: number;
  editing: boolean;
}

/** null when the draft has no 100% throw, which is exactly when nothing posts. */
export function summarizeDraft(
  draft: Draft,
  tracker: TrackerId,
): DraftSummary | null {
  const { throws, hasHundred } = throwsFromDraft(
    draft.throws,
    TRACKERS[tracker].slots.map((s) => s.key),
  );
  if (!hasHundred) return null;
  const hundreds = Object.values(throws).flatMap((slot) =>
    scoredBoxes(slot)
      .map(num)
      .filter((v): v is number => v != null),
  );
  return {
    tracker,
    date: draft.date || todayISO(),
    best: Math.max(...hundreds),
    editing: !!draft.editingId,
  };
}

export function sessionTitle(name: string, editing: boolean): string {
  return `${editing ? "Update" : "Save"} ${name}'s session?`;
}

export function sessionLine(s: DraftSummary): string {
  return `${TRACKERS[s.tracker].label} · ${fmtDate(s.date)} · best 100% throw ${fmt(s.best)} mph`;
}

export function groupTitle(count: number): string {
  return `Save ${count} session${count === 1 ? "" : "s"}?`;
}

export function groupLine(name: string, s: DraftSummary): string {
  return `${name} · ${fmtDate(s.date)} · ${fmt(s.best)} mph`;
}
