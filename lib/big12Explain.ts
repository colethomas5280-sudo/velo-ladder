import { BIG_12, flawByKey, type Cause, type CauseSide, type Flaw } from "./big12";
import {
  NOT_TESTED,
  PAINFUL,
  SCREEN_TESTS,
  fieldKey,
  isApplicable,
  sidesOf,
  type Field,
  type Results,
  type SubTest,
} from "./screen";
import type { Hand } from "./types";

/* ------------------------------------------------------------------ *
 * Turning a marked flaw into an explanation
 *
 * Strictness is the whole point. A rule that counted every recorded answer
 * would explain every flaw for every athlete, which looks like a working
 * feature and tells a coach nothing.
 *
 * Severity is deliberately unused. It is optional throughout the screen
 * config and unset until OnBaseU's colour mapping is supplied, so a rule
 * leaning on it would go silent on most of the sixteen tests.
 * ------------------------------------------------------------------ */

export interface Abnormal {
  testKey: string;
  testLabel: string;
  subTestLabel: string;
  findingLabel: string;
  sideLabel?: string;
  painful: boolean;
}

export interface Explanation {
  cause: Cause;
  findings: Abnormal[];
}

export interface FlawReport {
  flaw: Flaw;
  lead?: Explanation;
  rest: Explanation[];
  alsoMarked: Flaw[];
  unexplained: boolean;
}

/**
 * Whether any test a cause names is actually graded left/right.
 *
 * Belt-and-braces: `abnormalFor` already degrades a side request back to
 * "show whatever the test has" per sub-test when the request doesn't match
 * that sub-test's own side vocabulary, so a cause naming both an lr test
 * and a dominance test no longer loses the dominance one's findings. This
 * check instead keeps `sidesWanted` itself from claiming a specific leg for
 * a cause that names no lr-graded test at all — "front"/"back" isn't a
 * meaningful request when there is nothing to point it at.
 */
function anyLrGraded(cause: Cause): boolean {
  return cause.tests.some((testKey) => {
    const test = SCREEN_TESTS.find((t) => t.key === testKey);
    return !!test && test.subTests.some((sub) => sub.sides === "lr");
  });
}

/**
 * Which side keys a cause wants, or null for "whatever the test has".
 *
 * A marker is a REQUEST. Only tests graded left/right can answer it, and
 * only from a recorded hand. Dominance answers for the throwing arm and
 * cannot say which LEG is dominant, so a leg marker against a
 * dominance-graded test shows both rather than guessing.
 */
export function sidesWanted(cause: Cause, hand: Hand): string[] | null {
  if (!cause.side || !hand) return null;
  if (!anyLrGraded(cause)) return null;
  const side: CauseSide = cause.side;
  if (side === "throwing" || side === "back") return [hand];
  return [hand === "R" ? "L" : "R"];
}

function findingLabel(sub: SubTest, value: string): string {
  if (value === PAINFUL) return "Painful";
  return sub.findings.find((f) => f.key === value)?.label ?? value;
}

function isNormal(sub: SubTest, value: string): boolean {
  return sub.findings.find((f) => f.key === value)?.normal === true;
}

/** Every finding on one test that could explain something. */
export function abnormalFor(
  testKey: string,
  results: Results,
  sides: string[] | null,
): Abnormal[] {
  const test = SCREEN_TESTS.find((t) => t.key === testKey);
  if (!test) return [];
  const out: Abnormal[] = [];

  for (const sub of test.subTests) {
    // Context, not a grade. The screen config says these must never be read
    // as deviations, and Push-Off's surface question is the live example.
    if (sub.diagnostic) continue;

    const testSides = sidesOf(sub);
    let wanted: ({ key: string; label: string } | undefined)[];
    if (testSides.length === 0) {
      wanted = [undefined];
    } else if (sides) {
      /*
       * A request that doesn't match this sub-test's own side vocabulary
       * (e.g. a front/back leg marker against a dominance-graded test)
       * degrades to "show whatever the test has" rather than filtering to
       * nothing. Otherwise a cause naming both an lr test and a
       * dominance test loses the dominance one's findings whenever the
       * marker happens to be honoured by the lr test.
       */
      const filtered = testSides.filter((s) => sides.includes(s.key));
      wanted = [...(filtered.length ? filtered : testSides)];
    } else {
      wanted = [...testSides];
    }

    for (const side of wanted) {
      const key = fieldKey(test.key, sub.key, side?.key);
      const field: Field = { key, test, subTest: sub, side: side?.key };
      // A dependent sub-test whose gate answer has since changed is not a
      // live reading — the screen itself hides and discounts it, and a
      // value left sitting in `results` from before the gate changed must
      // not explain anything either. Sharing `isApplicable` with
      // `deviations()` keeps the two rules from drifting apart.
      if (!isApplicable(field, results)) continue;
      const value = results[key];
      if (!value || value === NOT_TESTED) continue;
      if (isNormal(sub, value)) continue;
      out.push({
        testKey: test.key,
        testLabel: test.label,
        subTestLabel: sub.label,
        findingLabel: findingLabel(sub, value),
        sideLabel: side?.label,
        painful: value === PAINFUL,
      });
    }
  }
  return out;
}

/**
 * A marked flaw, its explanations in Cole's rank order, and what else on the
 * same screen may be driving it.
 *
 * A test named by two causes is reported once, under the higher-ranked one.
 * Printing it twice reads as two separate problems.
 */
export function explainFlaw(
  flawKey: string,
  results: Results,
  hand: Hand,
  marked: Set<string>,
): FlawReport | null {
  const flaw = flawByKey(flawKey);
  if (!flaw) return null;

  const seen = new Set<string>();
  const found: Explanation[] = [];

  for (const cause of flaw.causes) {
    const sides = sidesWanted(cause, hand);
    const findings: Abnormal[] = [];
    for (const testKey of cause.tests) {
      if (seen.has(testKey)) continue;
      const hits = abnormalFor(testKey, results, sides);
      if (hits.length === 0) continue;
      seen.add(testKey);
      findings.push(...hits);
    }
    if (findings.length > 0) found.push({ cause, findings });
  }

  const alsoMarked = (flaw.causedBy ?? [])
    .filter((k) => marked.has(k))
    .map((k) => flawByKey(k))
    .filter((f): f is Flaw => f !== undefined);

  return {
    flaw,
    lead: found[0],
    rest: found.slice(1),
    alsoMarked,
    unexplained: found.length === 0 && alsoMarked.length === 0,
  };
}

/** Every marked flaw on a screen, in Cole's order. */
export function explainScreen(
  flaws: Record<string, boolean>,
  results: Results,
  hand: Hand,
): FlawReport[] {
  const marked = new Set(Object.keys(flaws).filter((k) => flaws[k]));
  return BIG_12.filter((f) => marked.has(f.key))
    .map((f) => explainFlaw(f.key, results, hand, marked))
    .filter((r): r is FlawReport => r !== null);
}
