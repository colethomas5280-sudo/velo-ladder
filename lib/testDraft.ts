import { todayISO } from "@/lib/velo";

/*
 * Unsaved test answers, per athlete and per test type, mirrored to
 * localStorage so a reload or a locked phone mid-test loses nothing.
 *
 * A draft exists ONLY while it has answers. That is deliberate: lib/draft.ts
 * (velocity) kept empty drafts around, and an empty leftover dated every later
 * session wrongly. Here an empty entry is simply not stored, so a test with no
 * answers always opens on today. One WITH answers keeps the date it was
 * started under, so nothing is saved under the wrong day by accident.
 *
 * `data` is the screen's `results` or the delivery's `flaws`.
 */

export type TestType = "screen" | "delivery";

export interface TestDraft {
  date: string;
  notes: string;
  data: Record<string, string | boolean>;
}

const key = (type: TestType, athleteId: string) =>
  `veloladder:testdraft:${type}:${athleteId}`;

function hasAnswers(data: unknown): data is Record<string, string | boolean> {
  return !!data && typeof data === "object" && Object.keys(data as object).length > 0;
}

export function loadTestDraft(type: TestType, athleteId: string): TestDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(type, athleteId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<TestDraft> | null;
    if (!d || !hasAnswers(d.data)) return null;
    return {
      date: typeof d.date === "string" && d.date ? d.date : todayISO(),
      notes: typeof d.notes === "string" ? d.notes : "",
      data: d.data,
    };
  } catch {
    return null;
  }
}

export function saveTestDraft(type: TestType, athleteId: string, draft: TestDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(type, athleteId), JSON.stringify(draft));
  } catch {
    /* storage full or blocked: the form still works, it just cannot be restored */
  }
}

export function clearTestDraft(type: TestType, athleteId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key(type, athleteId));
  } catch {
    /* ignore */
  }
}

export function hasTestDraft(type: TestType, athleteId: string): boolean {
  return loadTestDraft(type, athleteId) !== null;
}
