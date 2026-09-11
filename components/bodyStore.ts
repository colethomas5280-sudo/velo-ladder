import { readLocal, writeLocal } from "@/lib/localStore";

/* ------------------------------------------------------------------ *
 * The height and weight an athlete has typed in
 *
 * Shared by the standards calculator and the nutrition page so they cannot
 * disagree about the key or the shape. Two components each holding their own
 * copy of "velo.standards.body" is the exact drift this codebase keeps
 * finding, and here it would show as an athlete entering his weight on one
 * page and being asked for it again on the next.
 *
 * Browser only, and never sent anywhere. It is a measurement of a teenager's
 * body; it stays in his own browser.
 * ------------------------------------------------------------------ */

export const BODY_KEY = "velo.standards.body";

export interface EnteredBody {
  ft: string;
  inch: string;
  lb: string;
}

export const BLANK_BODY: EnteredBody = { ft: "", inch: "", lb: "" };

export function readBody(): EnteredBody {
  const raw = readLocal(BODY_KEY);
  if (!raw) return BLANK_BODY;
  try {
    const v = JSON.parse(raw) as Partial<EnteredBody>;
    return {
      ft: String(v.ft ?? ""),
      inch: String(v.inch ?? ""),
      lb: String(v.lb ?? ""),
    };
  } catch {
    return BLANK_BODY;
  }
}

/**
 * Merges rather than replaces. The nutrition page only knows the weight, and
 * writing that alone would wipe the height the standards page needs.
 */
export function writeBody(patch: Partial<EnteredBody>): void {
  writeLocal(BODY_KEY, JSON.stringify({ ...readBody(), ...patch }));
}
