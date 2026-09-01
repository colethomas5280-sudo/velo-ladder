# Athlete profile — design

**Date:** 2026-08-31
**Status:** approved, ready for an implementation plan

## What this is

An intake form. A new athlete fills it in when he joins so Cole is not chasing him
for details later, and both of them can keep it current afterwards.

The reference is Driveline TRAQ's user management screen, which the facility already
uses. Fields are taken from it where they earn their place and left out where they
serve TRAQ's shape rather than this one.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Purpose | Onboarding intake, not a recruiting card | Fills once at signup, edited occasionally. It replaces paperwork and chasing. |
| Name | Split into first and last | Matches TRAQ, gives last-name sorting and clean exports. Costs a backfill that guesses at existing names. |
| Weight | Stored **and** fed by check-ins | Cole asked for it at signup. Refreshing it from check-ins stops it going stale and stops it becoming a second, quietly-wrong answer. |
| Self-editing | Everything except email, level and status | Email is his login, level stamps his records, status is a program fact. |
| Coach notes | Never sent to the athlete | Filtered server-side by role, not hidden in the UI. |
| Signup | Stays short; profile finished afterwards | A fourteen-field wall is where people abandon signup, and an unfinished profile is the recoverable failure. |
| Cross-athlete visibility | None added | The leaderboard stays the only thing one athlete sees about another. |

### Taken from TRAQ

Phone, height (inches as one integer, like their `65`), bats, HS graduation year,
college graduation year, a coach-only comment field, and **status: On-Site / Remote** —
the last of which the facility needs and the app currently cannot express at all.

### Deliberately not taken

- **Full mailing address.** Nothing in this app posts anything.
- **Sub-status** ("Lead Leg Block"). That is Driveline's programming taxonomy.
- **Role.** Coaches are resolved from `COACH_EMAILS`.
- **Organizations.** Single-facility app.
- **Biological sex.** Near-uniform at this facility, sensitive on minors, and nothing
  here would use it. Easy to add if norms or reporting ever need it.

## Data model

Schema v14. All additions nullable; existing columns keep their shape.

### The name split

`first_name` and `last_name` are added and backfilled from `name` by splitting on the
**last** space — "Martin Duff" → Martin / Duff, "Mary Jo Smith" → "Mary Jo" / Smith.

`name` stays, and stays the display string used by the roster, leaderboard, dashboard,
CSV export and invite emails — so none of that code changes. It is **only ever written
as `first + " " + last`, from a single function.** Nothing else assigns it, which is
what stops the two drifting.

A compound surname backfills wrong: "Juan de la Cruz" becomes "Juan de la" / "Cruz".
That is corrected on the roster, and is worth telling Cole about rather than letting
him find it.

### New columns on `athletes`

```
first_name, last_name   text     split from name
phone                   text
height_in               int      inches as one number
weight_lb               numeric(5,1)
weight_source           text     checkin | entered — where weight_lb came from
weight_at               date     when weight_lb was last set
bats                    text     R | L | S
positions               text     free text; mostly "P" at a pitching facility
school                  text
hs_grad_year            int
college_grad_year       int
status                  text     On-Site | Remote
guardian_name           text
guardian_phone          text
emergency_contact       text
injury_notes            text     coach and the athlete himself
coach_notes             text     coach only, never sent to the athlete
```

### Weight has one writer and two entry points

`weight_lb` is set at signup and editable by both athlete and coach. It is **also
refreshed whenever a check-in records a bodyweight**, so it is always the most recent
known figure whatever its source.

The profile shows its provenance, so the number is never ambiguous:

> **187 lb** · from check-in, Aug 30
> **185 lb** · entered at signup, Aug 12

This needs a `weight_source` (`checkin` | `entered`) and `weight_at` (date) alongside
it. The rolling average stays on the recovery card — that is the trend; this is the
current single number, and the check-in feeds it rather than competing with it.

## Access

Three tiers, not two.

| Fields | Athlete | Coach |
|---|---|---|
| first/last name, phone, height, weight, bats, positions, school, grad years, guardian name and phone, emergency contact, injury notes, throwing hand | view + edit | view + edit |
| email, level, status | **view only** | view + edit |
| `coach_notes` | **never in the response** | view + edit |

`coach_notes` must be stripped **server-side by role**, not hidden in the UI. A field
merely hidden in markup is found in about ninety seconds.

**No new cross-athlete visibility.** The leaderboard's name / band / hand / velocity
remains the only thing one athlete sees about another. `canSeeAthlete` does not change.

## The page

One component, two entry points, so the coach view is never the neglected one:

- **Athlete:** "My profile" in the nav, at `/profile`.
- **Coach:** the same component as a section of `/athletes/[id]`, which is already the
  page a coach opens.

### Signup

The invite screen keeps only what it takes to create an account — password, level,
birth date. On success the athlete lands on their profile with "Finish setting up your
profile."

### Roster completeness

Rows for athletes with gaps carry a quiet marker — "3 missing", not a progress bar.
Chasing detail is the job this feature exists to remove, so the roster should show who
still needs a nudge without opening anyone.

**Counted as required**, because these are the ones Cole actually chases and the ones
other features consume: `first_name`, `last_name`, `phone`, `birth_date`, `level`,
`height_in`, `weight_lb`, `school`, and — for anyone under 18 by their birth date —
`guardian_name` and `guardian_phone`.

**Not counted**, because they are genuinely optional: positions, grad years, bats,
emergency contact, injury notes, coach notes, status. An athlete with none of those is
not incomplete, and counting them would leave every row permanently marked, which is
the same as marking none of them.

## API

**One route, not two.** `PATCH /api/athletes/[id]` already branches coach-versus-athlete;
the athlete branch grows from "hand and password" to the editable list above. A second
route would be a second place for that authorization decision to drift.

`GET /api/athletes/[id]` gains a role filter for the same reason.

Validation: `height_in` 30–90, `weight_lb` 50–500, grad years 1900–2100, `bats` one of
R/L/S, `status` one of the two values. Free-text fields are length-capped.

**Three states, not two.** Every field distinguishes *absent*, *set* and *explicitly
cleared*, and an invalid value is none of them:

| Request contains | Result |
|---|---|
| the field absent | unchanged |
| a valid value | set |
| an explicit `null` | cleared — a deliberate act |
| an invalid value | **400, nothing written** |

### Fixing the birth-date wart

This also repairs an existing defect, carried over from the leaderboard review where it
was parked rather than fixed. Today `PATCH /api/athletes/[id]` maps an invalid birth
date to `null` and `updateAthlete` writes it, so a coach fat-fingering a date **clears
the stored value** — and because age bands derive from birth date, that athlete quietly
drops off the 12U/14U boards until someone notices the blank cell and retypes it.

Under the table above, a malformed date is refused with a 400 and the stored value
stands. Clearing a birth date stays possible, but only by sending an explicit `null` —
which is a thing you meant to do rather than a thing that happened to you.

`level` gets the same treatment, for the same reason: it stamps records, and losing it
to a typo is worse than being told the entry was wrong.

## Testing

`visibleProfile(athlete, scope)` is a pure function that strips fields by role, unit
tested directly:

- `coach_notes` never survives an athlete's request
- a coach sees every field
- an athlete sees his own email, level and status but cannot edit them
- the name splitter: two-part names, single names, compound surnames, extra whitespace
- `name` always equals `first + " " + last` after any write path
- weight provenance: a check-in overwrites an entered value and flips the source

Route behaviour is verified against the local database, as in previous work.

## Out of scope

- Profile photos
- Any export of profile data
- Editing profile fields in bulk from the roster
- Parent/guardian logins
- Any use of profile data on the leaderboard
