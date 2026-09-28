# Velo benchmarks — decisions addendum

**Date:** 2026-09-28
**Applies to:** `2026-09-28-velo-benchmarks-spec.md`, which is the binding spec.
This file answers its section 8 open items. Where the two disagree, this file wins.

## 1. Where the coach role is defined — ANSWERED BY THE REPO

No need to ask and nothing to invent. `lib/scope.ts` resolves a signed-in user to
`coach`, `athlete` or `none` from `COACH_EMAILS`, and every route already gates on
`scope.role === "coach"` server-side. `canSeeAthlete` is the standing rule for
cross-athlete visibility and is NEVER modified.

## 2. Phase 2 — YES, BUILD IT

Cole: both phases. The reference tables alone do not gauge an athlete against his
peers, which is what he asked for.

## 3. The two proposed constants — CONFIRMED AS PROPOSED

| Constant | Value |
|---|---|
| `OUTLIER_BUFFER_MPH` | 3 (from the guide) |
| `PEAK_GAP_FLAG_MPH` | 4 (from the guide's worked example) |
| `NOTABLY_BEHIND_BUFFER_MPH` | **5** |
| `FATIGUE_GAP_FLAG_MPH` | **6** |

## 4. The 13U edge case — CAP THE ELITE CHECK AT THE BAND'S HIGH

13U's Elite Trajectory Ref (72) sits below its own band's high (75), so the spec's
ordering would call a 13-year-old sitting 73 an outlier while he is inside his
normal range. Cole chose to cap it.

**Implemented as: the elite check requires BOTH `sitting >= elite_trajectory_ref`
AND `sitting > band.high`.** An athlete inside his band is never called elite,
whatever the ref says.

Not `sitting >= max(ref, band.high)`: that would fire at exactly the band's high,
which is still inside the range. The point of the cap is that being at the top of
normal is not elite.

This changes two of the spec's pinned tests:

- Test 3 (16U, 85/89/92) is UNCHANGED: `89 >= 89` and `89 > 85`, still
  `OUTLIER_ELITE_TRAJECTORY`.
- Test 12 (13U, avg 73) resolves to `AVERAGE_UPPER_HALF`: 73 is inside 55-75 and
  not above 75, and the band's midpoint is 65.

Add a test pinning 13U at 76 as `OUTLIER_ELITE_TRAJECTORY`, so the cap is a cap and
not a removal.

## 5. Data refresh — HAND RE-EXPORT, THE SPEC'S DEFAULT

Notion stays the source of truth. The seed is idempotent upsert by slug, re-run by
hand from a newer JSON. No Notion API sync. Out of scope, unchanged.

## Two decisions the spec left to the implementer

**Where the data lives.** Every config in this app today (`lib/big12.ts`,
`lib/relative.ts`, `SCREEN_TESTS`) reaches the browser by being imported into a
client component. For this data that is exactly what section 3 forbids, so it
breaks the house pattern deliberately: database tables, coach-only routes, and
nothing importing the seed JSON into anything client-side. `lib/clientSafe.test.ts`
already walks every client component for imports of server-only modules and is the
mechanism section 3's sentinel check extends.

**Markdown rendering.** The app has no markdown renderer and no UI dependencies
beyond React and SWR. The scoring guide stays a content asset per the spec, rendered
by a small hand-rolled renderer covering the subset it uses: headings, bold, tables,
unordered lists, paragraphs. Reason for not adding `react-markdown` and `remark-gfm`:
the spec says add no dependency unless necessary, two packages to render one static
document is not necessary, and a renderer that only handles what this file contains
cannot silently mis-render something it was never given.
