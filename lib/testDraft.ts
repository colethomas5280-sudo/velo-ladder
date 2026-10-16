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
 * Only real answers count: a non-empty string (a screen reading) or `true` (a
 * delivery flaw). Everything else in storage is dropped on load, so the forms
 * can trust the type, and a draft whose answers all drop is no draft.
 *
 * Saving a draft with no answers REMOVES the stored draft rather than writing
 * an empty one. So a form must restore before it saves: if it saved its empty
 * initial state on mount it would clobber a draft that was waiting to be
 * restored.
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

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The real answers in `data`; an empty object when there are none. */
function answersOf(data: unknown): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  if (!data || typeof data !== "object" || Array.isArray(data)) return out;
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if ((typeof v === "string" && v !== "") || v === true) out[k] = v;
  }
  return out;
}

export function loadTestDraft(type: TestType, athleteId: string): TestDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(type, athleteId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<TestDraft> | null;
    if (!d || typeof d !== "object") return null;
    const data = answersOf(d.data);
    if (Object.keys(data).length === 0) return null;
    return {
      date: typeof d.date === "string" && DATE.test(d.date) ? d.date : todayISO(),
      notes: typeof d.notes === "string" ? d.notes : "",
      data,
    };
  } catch {
    return null;
  }
}

export function saveTestDraft(type: TestType, athleteId: string, draft: TestDraft): void {
  if (typeof window === "undefined") return;
  const data = answersOf(draft.data);
  if (Object.keys(data).length === 0) {
    clearTestDraft(type, athleteId);
    return;
  }
  try {
    window.localStorage.setItem(key(type, athleteId), JSON.stringify({ ...draft, data }));
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
