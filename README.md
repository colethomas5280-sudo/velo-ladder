# Velo Ladder

Weighted-ball velocity tracker for pitching athletes — **mound** and **pull-down**,
4 throws per ball weight (box 1 = 80% primer, not scored; boxes 1–3 = 100%),
PR / average / floor per weight, the two pull-down 5 oz sets folded into one
combined 5 oz record, dated session history, a progress chart, and "last / PR"
targets on every weight while entering.

The **coach** manages everyone. Each **athlete** logs in with their own email +
password and sees only their own tracker; they can log their own sessions.

- **Framework:** Next.js 16 (App Router)
- **Login:** email + password (no email service needed)
- **Database:** any Postgres via `DATABASE_URL` (Supabase, Vercel Postgres, Neon, …)

---

## How login works

- **Coach:** any email listed in `COACH_EMAILS`, plus the shared `COACH_PASSWORD`.
- **Athletes:** you add each one in **Manage roster** with a name, email, and a
  starting password. Give the athlete those two things (text / in person). They
  can change their password from **"Change my password"** once they're in.
- **Forgot password:** you reset it for them in the roster. No email involved.

---

## Deploy it

### 1. GitHub + Vercel

Push to GitHub, then [vercel.com](https://vercel.com) → **Add New → Project** →
import the repo → **Deploy**.

### 2. Database (Supabase)

1. [supabase.com](https://supabase.com) → **New project**, set a DB password.
2. **Connect** → **Transaction pooler** → copy the URI, replace `[YOUR-PASSWORD]`.
   Percent-encode any special characters (`!` → `%21`).

### 3. Environment variables

Vercel → **Settings → Environment Variables** (all environments checked):

| Name | Value |
|---|---|
| `DATABASE_URL` | the Supabase Transaction-pooler URI |
| `AUTH_SECRET` | run `openssl rand -base64 33` and paste it |
| `AUTH_URL` | your deployed URL, e.g. `https://velo-ladder.vercel.app` |
| `COACH_EMAILS` | your email (comma-separated for multiple coaches) |
| `COACH_PASSWORD` | the shared coach password — pick something strong |
| `SETUP_KEY` | any random string — used once in step 5 |

### 4. Redeploy

Deployments → **⋯ → Redeploy** so the variables take effect.

### 5. Create the tables — once (also after any code update that changes the schema)

Visit `https://YOUR-URL.vercel.app/api/setup?key=YOUR_SETUP_KEY&seed=1`
→ should return `{"ok":true,...}`.

### 6. Use it

Open the site → sign in with your email + `COACH_PASSWORD` → **Manage roster** to
add athletes → give each athlete their email + password.

---

## Run it locally

```bash
npm install
cp .env.example .env.local        # USE_PGLITE=1 is set — no database to install
# put a value in AUTH_SECRET and COACH_PASSWORD
npm run dev
```

Then hit `http://localhost:3000/api/setup?key=dev-setup-key&seed=1` once.
Sign in with `COACH_EMAILS` + `COACH_PASSWORD` from your `.env.local`.

- `npm run build` — production build
- `db/schema.sql` — the schema (applied automatically by `/api/setup`)

---

## Layout

```
app/
  page.tsx                     coach/athlete dashboard (gated by session)
  login/                       email + password sign-in
  api/
    auth/[...nextauth]         Auth.js (credentials provider)
    me                         { role, email } for the current user
    athletes, athletes/[id]    roster (coach) + own record (athlete)
    athletes/[id]/sessions     list / create sessions
    sessions/[id]              edit / delete a session
    setup                      one-time schema + seed (SETUP_KEY-guarded)
lib/
  velo.ts        pure tracker logic — weights, groups, PR/avg/floor, CSV
  auth.ts        Auth.js credentials provider (coach password + athlete bcrypt)
  scope.ts       coach | athlete(ids) | none, resolved from the session email
  data.ts        typed Postgres queries + password hashing
  db.ts          node-postgres (prod) / PGlite (local, USE_PGLITE=1)
  schema.ts      canonical SQL
components/       React UI (Tracker, EntryForm, RecordsPanel, ProgressChart, …)
```

Every API route checks authorization: a coach can read/write all athletes; an
athlete only their own; anyone else gets 403.

## Dependencies

`next`, `react`, `react-dom` and `next-auth` are pinned to exact versions with
no `^`. The rest carry a caret, which is fine for packages that keep semver.

**`next-auth` is pinned for a different reason and should stay that way.** It is
a pre-1.0 prerelease (`5.0.0-beta.32`), and prerelease numbers carry no
compatibility promise — `beta.33` is free to break `beta.32`. A caret would also
have spanned into a stable `5.x`:

```
^5.0.0-beta.32  accepts  beta.33 … 5.9.9   (a breaking release is inside the range)
 5.0.0-beta.32  accepts  beta.32 only
```

Deploys were never at risk, because Vercel installs from the committed
lockfile. The exposure was someone running `npm install` or `npm update`
locally and picking up a new version by accident — and this package decides
whether anyone can sign in, so a break there locks out the coach too.

Upgrading it is fine, but do it deliberately: bump the pin on its own, then
sign in as a coach *and* as an athlete before pushing. Athlete login is the
better check, since it queries the database while the coach path only compares
`COACH_PASSWORD` from the environment.
