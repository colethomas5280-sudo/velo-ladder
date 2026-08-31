# Velo Ladder — Handoff

Weighted-ball velocity tracker for Cole Thomas's pitching athletes (FAST Performance,
Denver). Coach manages a roster; each athlete logs in and tracks their own mound and
pull-down velocity.

---

## Status: live and in use

| | |
|---|---|
| **Live** | https://velo-ladder.vercel.app |
| **Repo** | https://github.com/colethomas5280-sudo/velo-ladder |
| **Hosting** | Vercel — org "FAST Baseball" (Hobby plan), auto-deploys on push to `main` |
| **Database** | Supabase (project ref `shrqazkodfiruilfhpwe`), Transaction pooler |
| **Coach login** | `cole@fastcolorado.com` + `COACH_PASSWORD` env var (revealable in Vercel) |

Everything below is working and verified: password login, per-athlete authorization,
the roster/spreadsheet home page, athlete profile pages, single- and multi-athlete
session entry, the 3-line progress chart, CSV export.

Onboarding is by invite link; entry is a pop-up with a 6-weight ladder of five
boxes each. Confirm the repo on GitHub is at the latest commit before starting.

---

## Outstanding — do these soon

1. **Rotate the three secrets that passed through the chat build session:**
   `AUTH_SECRET`, `SETUP_KEY`, and the **Supabase database password**. For each:
   edit it in Vercel → **Settings → Environment Variables**, then **Deployments →
   Redeploy**. For the DB password also reset it in Supabase (**Settings → Database →
   Reset database password**) — use a letters-and-numbers-only password, put the exact
   same string in Supabase and in `DATABASE_URL`, wait ~2 min for the pooler to
   propagate, then redeploy.
2. **Delete the dead `EMAIL_*` env vars** in Vercel (`EMAIL_HOST/PORT/USER/PASS/FROM`).
   The app no longer sends email — login is password-based.
3. **Re-run DB setup after any schema change:**
   `https://velo-ladder.vercel.app/api/setup?key=<SETUP_KEY>&seed=1` — idempotent,
   safe to hit anytime. Check `schemaVersion` in the response matches
   `SCHEMA_VERSION` in `lib/schema.ts`; if it doesn't, the deploy is stale.
4. **Optional cleanup:** the retired Auth.js adapter tables (`users`, `accounts`,
   `sessions`, `verification_token`) are still in the production database, orphaned and
   unused. Their foreign keys into our tables are now dropped, so they are harmless.
   Drop them by hand in the Supabase SQL editor whenever convenient.

---

## Architecture

- **Next.js 16** (App Router, Turbopack), **React 19**, TypeScript.
- **Auth.js v5 beta** — Credentials provider, JWT sessions, **no database adapter**.
  Coach = any `COACH_EMAILS` address + shared `COACH_PASSWORD`. Athlete = their
  `invite_email` + a bcrypt password they set themselves from an invite link (or one
  the coach sets manually). `lib/auth.ts`.
- **Postgres** via `pg` (node-postgres) — works with any Postgres. Local dev uses
  **PGlite** (in-process, `USE_PGLITE=1`). `lib/db.ts`.
- **Client data** via SWR against REST route handlers. No global state library.
- Charts are hand-drawn on `<canvas>` (`components/ProgressChart.tsx`).

### Routes

| Path | What |
|---|---|
| `/` | Coach → the **dashboard** (customizable widgets). Athlete → redirected to their own profile. |
| `/athletes` | The roster/spreadsheet (coach only). |
| `/resources` | Shared protocol/how-to library. Coaches write, athletes read. |
| `/athletes/[id]` | One athlete's profile — **progress first**: name, "+ Track a new session", Mound/Pull-Down view toggle, progress chart, session history. Data entry lives only in the pop-up. |
| `/login` | Email + password. |
| `/join/[token]` | Public. An invited athlete sets their own password and is signed straight in. |
| `/api/me` | `{ role, email, athleteId }` for the signed-in user. |
| `/api/resources` | GET any signed-in user; POST coach-only. `/[id]` PATCH + DELETE (soft) coach-only. |
| `/api/dashboard` | GET — everything the dashboard widgets need, in one call (coach only). |
| `/api/athletes` | GET (scoped list), POST (coach: create). |
| `/api/athletes/overview` | GET — roster + session counts + last date (coach only). Powers the home table. |
| `/api/athletes/[id]` | GET / PATCH (name, email, hand, password, archive) / DELETE (soft). |
| `/api/athletes/[id]/sessions` | GET / POST. |
| `/api/athletes/[id]/status` | GET — today's guidance, open flags, flag history, CNS band. |
| `/api/setbacks/[id]` | PATCH marks a flag reviewed. **Coach-only** — the human checkpoint. |
| `/api/athletes/[id]/recovery` | GET / POST (upsert by date) / DELETE `?date=`. Athlete-scoped. |
| `/api/sessions/[id]` | PATCH / DELETE. |
| `/api/athletes/[id]/invite` | POST issues a single-use invite link (coach only); DELETE cancels one. |
| `/api/join/[token]` | Public. GET reveals only the invited athlete's name/email; POST spends the invite. |
| `/api/setup?key=…&seed=1` | One-time (idempotent) schema + seed. `SETUP_KEY`-guarded. |
| `/api/auth/*` | Auth.js. |

Every API route calls `getScope()` (`lib/scope.ts`) and enforces: **coach** = all
athletes; **athlete** = their own only; anyone else = 403.

### Key components

- `HomeView` → `Dashboard` — widget grid; which widgets show is per-browser in
  `localStorage["veloladder:dashboard"]`, edited via `CustomizeDashboard`. **To add a
  widget: append to `WIDGETS` in `CustomizeDashboard.tsx`, add its data to
  `lib/dashboard.ts`, and render it in `Dashboard.tsx`.** Unknown ids in a saved
  choice are dropped on load, so removing a widget can't wedge someone's dashboard.
- `Resources` (`/resources`) — grouped by category, expandable. Bodies render via
  `RichText`, a ~50-line formatter supporting `## heading`, `- bullet`, `**bold**` and
  auto-linked URLs. It builds **React nodes, never HTML**, so nothing typed can execute.
- `RosterView` → `AthletesTable` (spreadsheet: inline-edit email/hand, per-row invite
  and password reset, remove, search; check rows → **`GroupSession`** modal;
  **+ Invite athlete** → `InviteAthleteModal`, which creates the athlete and mints
  the link in one step).
- `AthleteProfile` → `Masthead` + view toggle + `ProgressChart` + `HistoryTable`
  + password box. Entry is **not** on the page — it opens in `SessionModal`.
- `SessionModal` — single-athlete entry pop-up, two steps: **pick** (Mound or
  Pull-Down cards) → **entry** (the grid, with a ← back arrow). Picking a type also
  switches what the page behind it is showing. History "Edit" opens it straight at the
  entry step with that session's type and values pre-filled.
- `GroupSession` → `GroupEntryModal` wrapping `EntryForm` — athlete tabs, per-athlete
  draft, "Save all N" / "Save one". Type is chosen with the seg control in its header
  (not the two-step picker).
- `EntryForm` — the weight lanes. Each shows five boxes (80% primer + four 100%
  throws) and, stacked beneath, **Last** over **PR** with the session date on hover;
  plus a live `max·avg·new PR` while typing. Average and floor live on the chart, not
  here. **Renders no header of its own** — both call sites are modals whose chrome
  supplies the title.
- `JoinForm` (`/join/[token]`) — invited athlete sets a password, then is signed in
  via `signIn("credentials")` and dropped on their profile.

### Data model (`lib/schema.ts`, `db/schema.sql`)

```
athletes(id, name, hand, invite_email, password_hash,
         invite_token, invite_expires, archived, created_at)
resources(id, title, category, body, link, position, archived,
          created_at, updated_at)
recovery_entries(id, athlete_id, date, sleep_hours, sleep_quality, soreness,
                 energy, stress, mood, resting_hr, hrv, arm_status,
                 arm_readiness, body_weight, sleep_duration, notes,
                 created_by, created_at, updated_at)  -- UNIQUE(athlete_id, date)
setbacks(id, athlete_id, kind['soreness'|'cns'|'injury'], opened_on,
         resolved_on, resolved_by, detail, severity, created_at)
athletes.cns_threshold_pct  -- per-athlete CNS band; null = facility default
training_sessions(id, athlete_id, type['mound'|'pulldown'], date, notes,
                  throws jsonb, created_by, created_at, updated_at)
```

`throws` shape: `{ "p1": [primer, t1, t2, t3, t4], ... }` — index 0 is the **80% primer
(never scored)**; indices 1..4 are the 100% throws that feed every stat. `null` = blank.
**Sessions logged before the 4th box exist as length-4 arrays**, so every read walks the
array it is given rather than assuming a length, and validation accepts 4 or 5.

### Tracker config (`lib/velo.ts` → `TRACKERS`)

Both trackers run the same ladder: **5, 6, 7, 5, 4, 3 oz**.

- **Mound:** slots `m5,m6,m7,m5b,m4,m3`. `m5b` was added later, so mound sessions
  logged before that have no `m5b` key and still read correctly.
- **Pull-Down:** slots `p1,p2,p3,p4,p5,p6`.
- On both, the **two 5 oz sets fold into ONE combined 5 oz record** (Cole's explicit
  call) — one PR / avg / floor / chart line / history column. The expanded history
  detail still shows each set separately.
- Velocities display via `fmt()`: at most one decimal, no trailing `.0` (94.9, 87,
  84.3). Entry boxes cap typing at one decimal so stored always equals displayed.

---

## Wellness questionnaire & scoring (`lib/recovery.ts`)

The check-in is **defined as data** in `WELLNESS_SECTIONS` — a list of sections, each
carrying Cole's exact anchor wording. The modal renders whatever is in that array.
**Adding a section is: append it here + one column per new item + wire it through
`toRecovery`/`upsertRecovery` and the recovery route's validation.** Nothing in the UI
needs touching.

Items are a discriminated union on `kind`. `"rated"` renders a dropdown carrying the
full anchor text and feeds the score; `"numeric"` renders a typed input with a unit and
**never** feeds the score.

- **Section 1 — "How do you feel today?"**: Fatigue (stored as `energy`), Sleep
  duration, Sleep quality, General muscle soreness, Stress, Diet. All 1-5.
- **Section 3 — "Bodyweight"**: one numeric field, lb. Not scored — see below.
- **Section 2 — "Arm readiness"**: one question, **1-5** — 1 pain limiting movement,
  2 pain/soreness not limiting, 3 no pain very sore, 4 no pain a little sore, 5 no pain
  no soreness. Replaced the old three-button good/sore/pain question above the form.

**Every scale runs bad → good**, which is what lets them average into one score.

**Scales keep their native length.** Arm readiness shipped as 1-4 and widened to 1-5
before it ever reached production, so no stored value needed remapping. Had it not,
`normalizeRating(v, max)` maps any scale onto the shared 1-5 range at scoring time only
— the raw column always holds what the athlete actually picked. Sections 3-5 can use
whatever length their question wants.

### Sleep bands are pitched at athletes, not general adults

`SLEEP_BAND_ANCHORS` runs **<6 / 6-7 / 7-8 / 8-9 / 9+ hours**. Cole reset these in
Aug 2026 against athlete sleep research: 7-8h clears the general-adult guideline but is
the *bottom* of the useful range for someone throwing at max intent, 6-7h is the
habitual-deficit zone most players actually live in, and the top of the scale opens at
the 9h window sleep-extension studies push toward — open-ended, so an athlete who slept
eleven hours has somewhere honest to put it.

**Every band moved up one rung, so a 4 now means what a 5 used to.** The stored column
is still a 1-5 int, so this needed no migration — but it does mean the same night scores
about 3 points lower than it did, and any entry logged before the change is on the old
scale. There were only a handful of test rows in production when it changed, which is
why the values weren't remapped.

### Sleep is a band, not a number

The check-in used to open with a "Hours slept" box, and the band was derived from it.
Cole's call: **athletes don't know how long they slept.** Asking for a number invents
precision a seventeen-year-old doesn't have, so the band is now the answer — picked
straight from the dropdown, stored in its own `sleep_duration` column.

`sleepHours` is legacy. Entries logged before the box came out keep their typed number
and keep scoring through `sleepToRating` — the curve that peaks across Cole's 8-9h target
window — so **no historical score moved**. That path is guarded on `sleep_duration` being
absent, so an old entry that gets edited picks up a band without scoring sleep twice.

`entryBand(e)` is the one way to read sleep: the band if there is one, else `sleepBand()`
of the typed hours. A typed 7.5 genuinely *is* the "7-8 hours" band, so nothing is lost
converting. Everything downstream — the feed line, the correlation readout — goes through
it, which is why the insight now reads "9+ hours of sleep vs 6-7 hours" rather than
quoting decimal hours nobody actually measured.

Each item is a **dropdown carrying the full anchor text** ("3 — So-so quality, over or
under ate a bit") rather than 1-5 buttons — the anchors are sentences, and a bare "3"
tells an athlete nothing.

**Sleep quality is a separate question from both duration and fatigue**, and it is not
redundant with either: eight hours that were broken five times reads as duration 5,
quality 2, fatigue 2. Without it there is no way to tell an athlete who is tired because
he didn't really sleep from one who is tired because training beat him up — different
problems, different fixes. It is a live question again after being retired in the
questionnaire rebuild; moving an item between `RETIRED_FIELDS` and `WELLNESS_SECTIONS`
is score-neutral by construction, since both paths contribute the raw 1-5.

Note this makes **2 of the 7 scored components sleep** (duration + quality). That is a
deliberate weighting, not an oversight — sleep is the biggest recovery lever a teenager
has. Collapsing them into one averaged component is a small change to `recoveryScore`
if it ever reads too heavy.

Score = mean of every answered item (normalised to 1-5) + the sleep rating, ×20.
`recoveryScore` walks `ANSWERED_ITEMS` — derived from `WELLNESS_SECTIONS` — so a new
section starts counting the moment it is added, with no second list to update. Because
it averages only what's filled in, **old entries keep scoring off the fields they have**
while new ones use the current set, so changing the questionnaire never retroactively
rewrites history. `RETIRED_FIELDS` (`sleepQuality`, `mood`) exists for exactly that:
questions no longer asked, still scored on the entries that have them.

**Resting HR, HRV and bodyweight are stored but never scored** — personal baselines,
meaningless to average across athletes. For bodyweight there is a second reason: there
is no good or bad number to score, and grading a teenager's weight is not something this
app should do. `recoveryScore` reads `ANSWERED_ITEMS`, which filters to `kind: "rated"`,
so a numeric item cannot reach the score even by accident.

### Bodyweight is reported as a trend, not a number (`weightTrend`)

A single morning weigh-in is mostly noise — hydration, food and timing move it two or
three pounds day to day. So the headline is the **rolling 7-day mean**, with the
week-over-week move beside it (`avg7 − prev7`). A week needs `MIN_WEIGH_INS` (3) before
its average is claimed; below that the card shows the raw number and says how many
weigh-ins it has.

`acute` is today against that same week's mean. Past ±2 lb the card explains that a
same-day swing is fluid and food rather than muscle. That copy is the point of the
feature as much as the number is: an athlete watching a single morning reading bounce
three pounds will otherwise read it as having gained or lost three pounds.

`buildInsight` pairs each throwing day with that day's check-in and compares the top
third of days by velocity against the bottom third. Needs **6+ paired days**, and only
makes a claim when the gap clears a threshold (5 score points or 0.5h sleep). It says
"association, not proof" in the UI, because that's what it is.

The progress chart overlays recovery on **its own 0-100 scale**, unlabelled — the point
is shape against velocity, not shared units.

## Setback logic (`lib/setback.ts`)

Three branches off Cole's protocol. Pure functions — `evaluate`, `guidance`,
`sorenessRun`, `cnsCheck` — so the rules can be reasoned about without a database.

| Branch | Trigger | Clears |
|---|---|---|
| `soreness` | arm readiness **3 or 4**, graded — see below. A missing check-in breaks the run. | automatically, when the arm comes back clear |
| `cns` | latest session's best 5 oz lands ≥ threshold% under that athlete's own trailing 30-day average for the same tracker. Needs **3+ prior sessions**. | automatically, when velocity returns to band |
| `injury` | arm readiness **1 or 2** — any pain at all. | **never automatically** — a coach must PATCH `/api/setbacks/[id]` |

Serious injury is deliberately not modelled. That's medical, and the app should not
own a return timeline.

**Arm readiness is what separates branch 1 from branch 3** — without it there's no way
to tell "sore from throwing" from "something is wrong". Every branch reads it through
`armState()`, which returns `clear | sore-light | sore-heavy | pain | pain-limiting` and
**falls back to the retired `arm_status` column**. Legacy `"sore"` maps to `sore-heavy`,
because that is the prescription those entries were actually given — reading them as
merely a little sore would retroactively hand out more work than the athlete did.
Nothing else in the codebase touches either column directly.

### Soreness is graded, and the grades prescribe different days

Cole's call: **a little sore is not a reason to sit down.** Most athletes reporting it
simply have no reference for what post-throwing soreness feels like, so it buys a
**hybrid day** — plyos and catch play, no ladder — rather than a shutdown. Very sore
follows his original progression.

| Today | Day 1 | Day 2 | Escalates |
|---|---|---|---|
| **4** a little sore | hybrid day | hybrid day | **day 4** → recovery day |
| **3** very sore | recovery day | their call on intensity | **day 3** → full day off |
| **2** pain, not limiting | recovery day + injury flag | — | — |
| **1** pain, limiting | stop throwing | — | — |

Tunable as `LIGHT_ESCALATE_DAY` (4) and `HEAVY_ESCALATE_DAY` (3).

The run counts consecutive days of **either** severity; **today's** answer picks the
prescription. So very sore → very sore → a little sore is day 3 of a run, but earns a
hybrid day, because the arm is settling.

**Guidance severity lives on the flag, not on today's check-in.** `setbacks.severity`
records how bad an episode got at its worst and only ever escalates. An athlete who
reported pain limiting movement keeps reading "Stop throwing" until a coach clears the
flag, however good he says he feels two days later — feeling better is not the same as
having been looked at, and letting a milder answer soften the message would reward
exactly the under-reporting this question depends on not happening. This is the same
rule the soreness branch uses for `hadHeavy`; the injury branch originally missed it and
read `armState(latestEntry)` instead. Flags opened before the column existed are
backfilled from their `detail` line by the schema script, and any that don't match fall
back to the old reading.

**Level 2 is pain, and pain always reaches the coach.** The prescription is only a
recovery day, but it still opens an injury flag that never auto-clears — the guidance
holds at `caution` / "Recovery day" even on a later day the athlete reports a clean arm,
until a coach clears the flag. Softening what the athlete does is not the same as
softening what the coach is told.

**A little sore does not flag on its own** — it is the normal state of a kid in a
throwing program, and flagging it would bury the real ones. It surfaces only once it
escalates, **or if any day in the run was very sore**. That second condition is load-
bearing: without it, easing from 3 to 4 would make an open flag vanish, quietly
rewarding under-reporting on the one question that has to stay honest.

Flags are reconciled by `reconcileSetbacks(athleteId)` in `lib/data.ts`, called after
any session or check-in write. No cron: the inputs only change on those writes. An open
flag's `detail` is refreshed each pass, so a soreness flag opened on day 1 reads
"3 days running" by day 3.

CNS threshold: `CNS_DEFAULT_PCT` (5) unless `athletes.cns_threshold_pct` is set —
tunable per athlete from the guidance card. The athlete-facing explainer copy lives in
`EXPLAINER` in the same file, beside the logic it describes.

## Local development

Node is installed via **nvm** (`~/.nvm`, Node v24). If `node` isn't found, run:
`export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"` (or `. ~/.nvm/nvm.sh`).

```bash
cd ~/velo-ladder
npm install
cp .env.example .env.local          # USE_PGLITE=1 is set — no external DB needed
#   set AUTH_SECRET and COACH_PASSWORD in .env.local
npm run dev
# then hit once:  http://localhost:3000/api/setup?key=dev-setup-key&seed=1
# sign in with COACH_EMAILS + COACH_PASSWORD from .env.local
```

`npm run build` for a production build. The local DB file is `./.pglite-data/`
(gitignored) — `rm -rf .pglite-data` to reset.

### Production env vars (Vercel → Settings → Environment Variables)

| Name | Notes |
|---|---|
| `DATABASE_URL` | Supabase **Transaction pooler** URI, port 6543, password URL-encoded |
| `AUTH_SECRET` | random 40+ chars (`openssl rand -base64 33`) |
| `AUTH_URL` | `https://velo-ladder.vercel.app` |
| `COACH_EMAILS` | `cole@fastcolorado.com` (comma-separated for multiple coaches) |
| `COACH_PASSWORD` | shared coach password |
| `SETUP_KEY` | random string, used for `/api/setup` |

---

## Gotchas learned (read before next session)

- **`CREATE TABLE IF NOT EXISTS` is not a migration.** It silently does nothing when
  the table exists, so changing `lib/schema.ts` does **not** change a database that
  was already set up. This bit hard: the magic-link schema had
  `created_by text REFERENCES users(id)`, the password rewrite dropped the `users`
  table from the file, and production kept the constraint — so *every* session insert
  failed with `23503 ... is not present in table "users"` while looking like a broken
  Save button. Any column/constraint change needs an explicit `ALTER ... IF EXISTS`
  statement added to `SCHEMA_SQL`, and `SCHEMA_VERSION` bumped.
- **Never write a migration that matches objects by name alone.** Supabase has its own
  managed `auth.users`; a cleanup loop keyed on `relname = 'users'` tried to alter
  `auth.identities` and failed with `must be owner of table identities`. Scope
  migrations to `nspname = 'public'` *and* an explicit list of our own tables, and wrap
  each DDL in a `BEGIN ... EXCEPTION WHEN OTHERS` so one failure can't abort setup.
- **`/api/setup` returns `schemaVersion`** — if it's missing from the response you are
  hitting a stale deployment, not a real failure. Errors name the failing statement
  (`statement 6/6 failed [...]`).
- **`execScript` splits on top-level `;` only** (`splitStatements` in `lib/db.ts`),
  respecting `$tag$ ... $tag$`, so `DO` blocks survive. Don't go back to `script.split(";")`.
- **Never let a save failure be a toast.** Errors from saving render inside the modal
  and persist (`form-error`); a 2.6 s toast behind a modal is invisible and makes a
  server error look like a dead button.

- **PGlite does not work inside React Server Components** — throws
  `The "path" argument must be of type string … Received an instance of URL`.
  All database access goes through **route handlers only**; pages call `auth()`
  (session/JWT, no DB) and everything else is client-fetched. Keep this pattern even
  though real Postgres in RSC would technically work.
- **Vercel env var changes require a redeploy** to take effect.
- **Supabase password resets** propagate to the pooler after ~2 min; the password in
  `DATABASE_URL` must exactly match what was set in Supabase. Letters+numbers only
  avoids URL-encoding pain.
- **Email login was abandoned** — Google Workspace (`fastcolorado.com`, which Cole
  doesn't administer) blocks app passwords, and Resend needs a domain Cole can't add
  DNS to. Password auth replaced it entirely.
- **`next-auth` is on a beta** (`5.0.0-beta.32`). Credentials + JWT, no adapter.
- **In-progress entry is saved to `localStorage`** keyed
  `veloladder:draft:<athleteId>:<tracker>` — this is what makes tab-switching in the
  group modal lossless across reloads.

---

## Onboarding an athlete

Click **+ Invite athlete** (top right of the roster), enter a name and login email,
and it creates the athlete and copies their invite link in one step. For someone
already on the roster, **Copy invite link** in their Access column does the same. They set their own password and land on
their profile. Links are single-use and expire after `INVITE_TTL_DAYS` (14).
Re-issuing revokes the previous link, which is how you fix one sent to the wrong
person. The raw token is returned only from the POST that mints it and never
appears in any athlete listing.

Coaches are still env-based: add the address to `COACH_EMAILS` (comma-separated)
and redeploy; they sign in with the shared `COACH_PASSWORD`. If coaches ever need
individual passwords, that wants a `coaches` table rather than an env var.

## Next steps / open questions

Cole plans to **"add a whole bunch of other things" to the athlete profile page** —
scope undefined. Likely candidates, none confirmed:

- More views/metrics on the profile (the old TRAQ system had org / team / level /
  status columns on its athlete list, and a "Meaning: max 👁" per-weight metric
  toggle — Cole declined the toggle earlier; revisit if asked).
- Filters / columns on the Athletes roster table.
- `training_sessions.created_by` is recorded but never shown — could surface "logged
  by coach vs. self".
- No pull-down vs. mound cross-comparison view yet.
- No date-range filtering on the progress chart or history.
- Per-weight PR/Avg/Floor cards were deliberately **removed from the profile page**
  (Cole's call — chart + history only). They still appear inside the entry lanes while
  logging. Revisit if athletes ask for exact numbers at a glance.

**Resolved:** the 3-line chart (best = amber, average = blue, floor = green) reads
clearly in light theme on both desktop and mobile — verified.
