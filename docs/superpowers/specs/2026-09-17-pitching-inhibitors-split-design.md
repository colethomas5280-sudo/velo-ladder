# Pitching Inhibitors as its own assessment — design

**Date:** 2026-09-17
**Status:** awaiting Cole's review
**Supersedes part of:** `docs/superpowers/specs/2026-09-16-big-12-design.md`

## What this is

The Big 12 shipped riding on the movement screen record, because Cole said he
assesses both in one session. He now wants to run them independently: two cards
on the Tests page, and a chooser on an athlete's page asking which assessment he
is about to record.

That makes them two assessments, not two halves of one, and the storage has to
follow.

## Why the current shape cannot serve it

Two concrete failures, not stylistic objections:

1. **An inhibitors-only assessment would fake a movement screen.** `standing.last`
   is the latest screen row's date whatever that row holds, so a row created to
   carry twelve marks would move the athlete out of "not screened yet", read as
   "0 to work on", and start the 8-week full-screen clock from a day no physical
   test was run.
2. **Saving one would wipe the other.** `upsertScreen` writes `EXCLUDED.results`
   AND `EXCLUDED.flaws`. An inhibitors modal submitting no test results blanks
   that day's screen. This is the same wipe class already caught once in the Big
   12 build, and the fix there was to always send both halves — which stops being
   possible the moment the two are recorded separately.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Storage | Its own table, `delivery_screens` | The two are independent now. Sharing a row means every clock, count and save path has to learn the difference. |
| Timing | Now | There is little or no inhibitor data yet, so the migration copies a handful of rows. This is the cheapest this change will ever be. |
| `delivery_assessed` | Retired once the migration has read it | It existed only to separate "assessed and clean" from "nobody looked" on a shared row. A row in the new table IS the assessment; no row means nobody looked. |
| Old columns | Left in place; read ONCE by the migration, never by the app again | Dropping a column is the one destructive migration this app has never run. They cost nothing. Debt register, not a migration. |
| Cadence | 8 weeks, `RETEST_CADENCE.full` | Cole's answer. Reuses the existing constant rather than introducing a second notion of "due". |
| Explanations | Resolved against the standing screen AS OF the inhibitors date | A limitation found before the assessment explains it; one found after does not. Matches the fix already made for the report. |

## Data

```sql
CREATE TABLE IF NOT EXISTS delivery_screens (
  id          text PRIMARY KEY,
  athlete_id  text NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  date        date NOT NULL,
  flaws       jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes       text NOT NULL DEFAULT '',
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_screens_athlete_date_uidx
  ON delivery_screens(athlete_id, date);
```

The unique index is not decoration: one row per athlete per day means re-saving
a date replaces it rather than leaving two versions to disagree, and it is also
the conflict target the migration below depends on. Without it that `ON CONFLICT`
is a syntax error, not a silent no-op.

`SCHEMA_VERSION` goes to 27. Needs a `/api/setup` run.

### The migration carries existing marks across

Idempotent, and guarded so a second run does not duplicate or overwrite:

```sql
INSERT INTO delivery_screens (id, athlete_id, date, flaws, notes, created_by, created_at)
SELECT 'from-screen-' || id, athlete_id, date, flaws, '', created_by, created_at
  FROM movement_screens
 WHERE delivery_assessed = true
ON CONFLICT (athlete_id, date) DO NOTHING;
```

`DO NOTHING` on conflict, not `DO UPDATE`: once a row is in the new table it is
the record, and a re-run must never reach back to the old columns and overwrite
an edit made since.

An assessed-but-clean screen migrates to a row with `flaws = '{}'`, which in the
new shape still means "assessed, nothing found". That equivalence is the whole
reason `delivery_assessed` can retire.

## Routes

Mirroring the screen's, which already carry the authorization this needs:

- `GET /api/athletes/:id/delivery` — the athlete's own, or any for a coach.
- `POST /api/athletes/:id/delivery` — coach only.
- `DELETE /api/athletes/:id/delivery?date=` — coach only.
- `GET /api/delivery/overview` — coach only, the roster card's data.

`canSeeAthlete` is used unchanged and is not modified. Athletes read their own
inhibitors, as already decided.

## Recording

On an athlete's page, "Record a screen" opens a chooser with two buttons,
**Movement screen** and **Pitching Inhibitors**, each opening its own modal.

The inhibitors modal is the section built for the Big 12, lifted out whole: a
date, the twelve checkboxes in `BIG_12` order with their collapsible copy, and
notes. The assessed checkbox goes: saving the modal IS the assessment.

The chooser replaces a button that today opens one modal directly. An athlete
with neither assessment sees the same chooser rather than a different flow.

## The Tests page

A second card below Movement screen, same formatting: the heading, the cadence
caption, the roster rows, and a "not assessed yet" list below.

A row shows `no inhibitors` or `N inhibitors`, the date, and the 8-week clock in
the same words the screen card uses.

The delivery line added to the movement screen's rows comes back out. It was put
there when the two shared a record; with a card of its own it is saying the same
thing twice in two places, which is how two views drift into disagreeing.

## The report

The athlete page shows two sections, each with its own date.

Under each marked flaw, the explanations come from `explainScreen` unchanged,
resolved against `standingScreen` truncated to the inhibitors date rather than
the screen's. An athlete with inhibitors and no screen at all gets every flaw
reported as unexplained, which is correct and must not read as an error.

## Testing

- The migration copies an assessed screen's marks into the new table, leaves an
  unassessed one alone, and running it twice neither duplicates nor overwrites.
  Proven against a database that ALREADY HAS rows, not a fresh one.
- Recording inhibitors never writes to `movement_screens`, and recording a screen
  never writes to `delivery_screens`. This is the wipe class that has already bitten
  once; it gets a test from both directions.
- An athlete with inhibitors but no movement screen still appears under "not
  screened yet" on the screen card, and appears as assessed on the inhibitors card.
- The 8-week clock reads from the inhibitors date, not the screen's.
- A coach-only route refuses an athlete's POST and DELETE, server-side.
- Explanations resolve against the screen standing AS OF the inhibitors date: a
  limitation recorded after that date does not explain it.
- The chooser offers both, and each button opens its own modal.

## Out of scope

Dropping the old columns, a spot-check cadence for inhibitors, and any change to
the twelve flaws or their mappings.
