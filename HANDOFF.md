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
                 energy, stress, mood, resting_hr, hrv, arm_status, notes,
                 created_by, created_at, updated_at)  -- UNIQUE(athlete_id, date)
setbacks(id, athlete_id, kind['soreness'|'cns'|'injury'], opened_on,
         resolved_on, resolved_by, detail, created_at)
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
with 1-5 items carrying Cole's exact anchor wording. The modal renders whatever is in
that array. **Adding section 2-5 is: append a section here + one `int` column per new
item + wire it through `toRecovery`/`upsertRecovery` and the recovery route's
validation.** Nothing in the UI needs touching.

Section 1, "How do you feel today?" — Fatigue (stored as `energy`), Sleep duration
(derived), General muscle soreness, Stress, Diet. **Every scale runs bad → good**, which
is what lets them average into one score.

**Sleep is answered once, used twice.** The athlete types real hours; the questionnaire
band (`sleepBand`: <5/5-6/6-7/7-8/8+) is derived for display, and the correlation
readout keeps the raw number so it can say "8.8h vs 5.3h". The **score** uses
`sleepToRating`, which is deliberately *not* the band: it climbs to 5.0 at 8h, holds
through 9h — Cole's target window — then eases back (10h → 4.6, 11h → 4.2). Piling on
sleep past 9h is not extra credit. Undersleeping is the steeper penalty.

Score = mean of every 1-5 field present + the sleep rating, ×20. Because it averages
only what's filled in, **old entries keep scoring off the fields they have**
(`sleepQuality`, `mood`) while new ones use the current set — so changing the
questionnaire never retroactively rewrites history. `RATING_FIELDS` therefore still
lists the retired columns on purpose.

**Resting HR and HRV are stored and charted but never scored** — personal baselines,
meaningless to average across athletes.

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
| `soreness` | athlete reports a **sore** arm. Day 1 → recovery day, day 2 → self-selected intensity, **day 3+ → full day off**. A missing check-in breaks the run. | automatically, when the arm comes back good |
| `cns` | latest session's best 5 oz lands ≥ threshold% under that athlete's own trailing 30-day average for the same tracker. Needs **3+ prior sessions**. | automatically, when velocity returns to band |
| `injury` | athlete reports **pain** (not soreness) | **never automatically** — a coach must PATCH `/api/setbacks/[id]` |

Serious injury is deliberately not modelled. That's medical, and the app should not
own a return timeline.

**The `arm_status` field (good/sore/pain) is what separates branch 1 from branch 3** —
without it there's no way to tell "sore from throwing" from "something is wrong".

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
