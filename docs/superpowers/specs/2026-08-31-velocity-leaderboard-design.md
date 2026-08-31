# Velocity leaderboard — design

**Date:** 2026-08-31
**Status:** approved, ready for an implementation plan

## What this is

A facility record board for throwing velocity, broken out by level. Coaches and
athletes both read it. It answers "what is the hardest anyone has thrown here, and what
is the hardest anyone at my level has thrown here."

Today the app has no cross-athlete view of any kind. Every authorization path is built
on *an athlete sees only themselves*, and the leaderboard is the first deliberate
exception to that.

## Decisions

Each of these was settled with Cole rather than assumed. The rationale matters more than
the choice, because it is what a later change has to argue against.

| Decision | Choice | Why |
|---|---|---|
| Who sees it | Everyone, real names | It is a record board, like the one on a gym wall. It lists top marks only, so nobody sees themselves ranked last — a kid who is not on it simply is not on it yet. |
| Grouping | Level, not graduating class | Matches how the facility actually splits its programs. |
| Levels | Youth, High School, College, Pro | Driveline's split, which the program already follows. |
| Youth subdivision | 12U and 14U, by age | "Youth" spans roughly 8–14, so a single Youth record would always belong to the oldest kid in the building. A ten-year-old needs something reachable. |
| Aging up | A record keeps the band it was set at | A 14U record set at 14 stays a 14U record forever. Anything else empties the youth boards as kids grow. |
| What is ranked | Every weight, filterable | Reuses the Mound/Pull-Down toggle and 5/6/7/4/3 chips from the Progress chart rather than shipping ten separate lists. |
| Computation | On read, from existing helpers | See below. |

## Why compute on read

The board calls the same `sBestG` and `TRACKERS[...].groups` that an athlete's own page
uses. Those functions encode two facility-specific rules — **box 0 is the 80% primer and
never scores**, and **the two 5 oz sets fold into one record** — and reusing them means
the board can never disagree with an athlete's own PR tile. A disagreement between those
two numbers would be unresolvable from the outside: neither would be obviously right.

The alternative, a `records` table maintained on write, buys read speed and costs a
second copy of the truth that can drift. This codebase spent a week in Aug 2026 on
exactly that failure mode. At facility scale — ~50 athletes throwing twice a week is
about 5,000 small rows a year — the query is tens of milliseconds. If volume ever makes
this worth revisiting, a materialized table fits behind the same interface.

## Data model

Schema v13. Three nullable additions; nothing existing changes shape.

```
athletes.birth_date     date    -- coach-visible only, never leaves the server for the board
athletes.level          text    -- current level: Youth | High School | College | Pro
training_sessions.level text    -- the level stamped at save time
```

`LEVELS` — the four stored values — lives as a config constant beside `TRACKERS` and
`WELLNESS_SECTIONS`, so changing the list later is an edit, not a migration. Note that
**12U and 14U are not levels**: they are bands derived at read time and are never stored
in either column.

All three are nullable because the existing roster has none of them. An athlete missing
both still counts toward the **facility** board — nothing disappears because the roster
is half filled in.

### How a throw finds its board

Resolved per session, in order:

1. **A stamped level wins.** `High School`, `College`, `Pro` map straight to that board,
   permanently, whatever happens to the athlete afterwards.
2. **`Youth` subdivides by age**, computed from `birth_date` against the **session
   date** — not today's date. Bands are exclusive: **12U is age ≤ 12, 14U is 13–14**,
   matching how teams split rather than the literal "and under". A Youth session with no
   birth date falls through to the facility board.
3. **Anything else is facility-only.**

Two properties fall out of this that are worth stating plainly:

- **Age needs no stamping and no backfill.** Because age is recomputed from the session
  date on every read, entering an athlete's birth date retroactively makes his whole
  history correct at once.
- **The stamped level is an override.** A 13-year-old training with the high schoolers
  gets set to `High School` and that beats his age band.

Age is measured **on the day of the throw**, not against a season cutoff. A kid who
turns 13 in June therefore has 12U records in April and 14U records in July. For a
record board that is the honest reading — it reflects what he could do at that age. A
fixed cutoff (May 1, say) is a one-line change if the programs are ever organised that
way instead.

### Backfilling the stamp

Existing sessions carry no level. The first time an athlete's level is set — by the
athlete at signup or by a coach on the roster — stamp it onto that athlete's **unstamped**
sessions only. Already-stamped sessions are never rewritten, so moving a kid from Youth
to High School leaves his old marks where they were and only new sessions get the new
level.

This cannot know that a kid was Youth eighteen months ago and High School since; a
first-time backfill puts his whole history at whatever level is set that day. Correcting
individual sessions is out of scope until someone needs it.

## Collecting level and birth date

- **At signup.** The invite screen, where an athlete already sets a password, gains a
  level picker and a birth date field. The athlete declares his own level.
- **On the roster.** Coaches can set or correct both for any athlete, including ones who
  signed up before this existed. Coach edits win over athlete self-declaration.

## API

One new route.

```
GET /api/leaderboard?tracker=mound|pulldown&oz=5|6|7|4|3
```

Both parameters are optional and default to `mound` and `5` — the pair already treated
as the headline number everywhere else in the app. An unrecognised value is a 400 rather
than a silent fallback, so a broken link fails loudly instead of showing the wrong board.

Returns, per board (facility first, then each level with any entries):

```
{ rank, name, band, hand, velocity, date, isYou }
```

**One row per athlete — their single best 100% throw** for that tracker and weight, not
one row per session. Without this, one athlete having a big day takes four of the top
five slots.

Facility board returns the top 10; level boards the top 5. Boards with no entries are
omitted rather than rendered empty.

`isYou` is computed on the server so the response never carries athlete IDs.

### Authorization

`canSeeAthlete` is **not** touched. The rule that an athlete may only open his own
athlete page stays exactly as strict as it is today; this is a separate, deliberately
narrow window.

- `coach` and `athlete` roles may read it. `none` gets 403, unauthenticated 401.
- The response carries name, band, hand, velocity and date. It never carries athlete
  IDs, session contents, recovery or wellness data, invite emails, or birth dates.
- **Birth date never leaves the server for this board.** It is used only to derive a band.
- **Archived athletes keep their records.** A departing athlete should not wipe a
  facility record he set. Deleting an athlete outright still removes them.

## UI

A page at `/leaderboard`, in the nav for coaches and athletes.

- Tracker toggle and weight chips at the top, matching the Progress chart's existing
  controls.
- Facility board, then a board per level.
- Row: rank, name, band, hand, velocity, date set.
- The signed-in athlete's row is highlighted. **If he is outside the top N, his standing
  shows beneath the board** — "You're 14th — 88.2" — so the page means something to
  everyone reading it, not only the top five.

## Testing

Ranking and band resolution go in pure functions in `lib/leaderboard.ts`, tested
directly:

- an athlete's best survives across multiple sessions, and only their best appears
- the combined 5 oz rule produces the same number as that athlete's own PR tile
- box 0 (the 80% primer) never places on the board
- a throw made at 12 stays 12U after the athlete's 13th birthday
- a stamped level beats an age band
- an athlete with no level and no birth date reaches the facility board and no other
- an archived athlete's record still ranks
- route: `none` role gets 403; the payload carries no IDs or birth dates

## Out of scope

- Editing the level on individual historical sessions
- Season-cutoff age bands
- Any record for anything other than velocity
- Notifying an athlete when their record is broken
