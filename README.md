# Velo Ladder

Weighted-ball velocity tracker for pitching athletes — **mound** and **pull-down**,
4 throws per ball weight (box 1 = 80% primer, not scored; boxes 1–3 = 100%),
PR / average / floor per weight, the two pull-down 5 oz sets folded into one
combined 5 oz record, dated session history, a progress chart, and "last / PR"
targets on every weight while entering.

Coach sees and manages every athlete. Each athlete signs in with their own email
and sees only their own tracker, and can log their own sessions.

- **Framework:** Next.js 16 (App Router)
- **Auth:** email magic-link (Auth.js) over your Gmail
- **Database:** any Postgres via `DATABASE_URL` (Supabase, Vercel Postgres, Neon, …)

---

## Deploy it (one-time setup, ~15 minutes)

### 1. GitHub

Create a free account at [github.com](https://github.com). Push this project to a
new repo called `velo-ladder` (I can do this for you).

### 2. Vercel

1. Sign up at [vercel.com](https://vercel.com) **with GitHub**.
2. **Add New → Project**, import `velo-ladder`, click **Deploy**. The first build
   will succeed but the app won't work yet — finish the steps below.

### 3. Database (Supabase)

1. Sign up at [supabase.com](https://supabase.com) → **New project**.
2. Set a **database password** (save it somewhere) → **Create new project**, wait ~2 min.
3. Click **Connect** (top of the project) → **Transaction pooler** tab → copy the URI.
   It looks like `postgresql://postgres.abc:[YOUR-PASSWORD]@aws-...pooler.supabase.com:6543/postgres`.
4. Replace `[YOUR-PASSWORD]` with the password from step 2. That full string is your
   `DATABASE_URL` (you'll paste it into Vercel in step 5).

### 4. Gmail app password

Google Account → **Security** → **2-Step Verification** (turn it on if it isn't) →
**App passwords** → create one for "Mail". Copy the 16-character code.

### 5. Environment variables

Vercel project → **Settings → Environment Variables**. Add these (Production):

| Name | Value |
|---|---|
| `DATABASE_URL` | the Supabase Transaction-pooler URI from step 3 (with the real password) |
| `AUTH_SECRET` | run `npx auth secret` in a terminal and paste the value (or any 40+ random characters) |
| `AUTH_URL` | your deployed URL, e.g. `https://velo-ladder.vercel.app` |
| `EMAIL_HOST` | `smtp.gmail.com` |
| `EMAIL_PORT` | `587` |
| `EMAIL_USER` | your Gmail address |
| `EMAIL_PASS` | the 16-character app password from step 4 |
| `EMAIL_FROM` | `Velo Ladder <your@gmail.com>` |
| `COACH_EMAILS` | your email (comma-separated if more than one coach) |
| `SETUP_KEY` | any random string — used once in step 7 |

Then **Deployments → Redeploy** so the new variables take effect.

### 6. Create the database tables — once

Visit this URL in your browser (replace both parts):

```
https://YOUR-URL.vercel.app/api/setup?key=YOUR_SETUP_KEY&seed=1
```

You should see `{"ok":true,"schema":"applied","seed":true}`. That creates every
table and imports the one real pull-down session already logged.

### 7. Use it

1. Open your site → enter your email → click the link Gmail sends you.
2. You land on the **coach dashboard**.
3. **Manage roster** → add each athlete with their **name and email**.
4. Send every athlete the site URL. They sign in with the email you entered and
   see only their own tracker.

Optional later: a custom domain (Vercel → **Domains**).

---

## Run it locally (for development)

```bash
npm install
cp .env.example .env.local        # USE_PGLITE=1 is already set — no database to install
npx auth secret                   # paste the value into .env.local as AUTH_SECRET
npm run dev
```

Open http://localhost:3000, then initialise the local test database once:

```
http://localhost:3000/api/setup?key=change-me-to-something-random&seed=1
```

With no `EMAIL_USER` set, sign-in links are **printed to the terminal** instead of
emailed — copy the link from the `npm run dev` output to sign in.

- `npm run build` — production build
- `db/schema.sql` — the database schema (applied automatically by `/api/setup`)

---

## How it's put together

```
app/
  page.tsx                     coach/athlete dashboard (gated by session)
  login/                       email sign-in
  api/
    auth/[...nextauth]         Auth.js
    me                         { role, email } for the current user
    athletes, athletes/[id]    roster (coach) + own record (athlete)
    athletes/[id]/sessions     list / create sessions
    sessions/[id]              edit / delete a session
    setup                      one-time schema + seed (SETUP_KEY-guarded)
lib/
  velo.ts        pure tracker logic — weights, groups, PR/avg/floor, CSV
  auth.ts        Auth.js config (magic link over SMTP)
  scope.ts       coach | athlete(ids) | none — and athlete auto-claim by email
  data.ts        typed Postgres queries
  db.ts          Neon driver (prod) / PGlite (local, USE_PGLITE=1)
  schema.ts      canonical SQL
components/       React UI (Tracker, EntryForm, RecordsPanel, ProgressChart, …)
```

Authorization is enforced in every API route: a coach can read/write all
athletes; an athlete can only read/write their own; anyone else gets 403.
