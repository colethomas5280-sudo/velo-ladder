# Velo Ladder — Coach-Only Evaluation Reference

Task spec for Claude Code. Read this whole file first, then the two companion files:

- `velo-ladder-seed-data.json` — the benchmark data (25 ranges, 11 sources)
- `velo-ladder-evaluation-scoring-guide.md` — the coach-facing scoring guide text

## 1. Goal

Add a **coach-only** section to the Velo Ladder app containing:

- **Phase 1 (build this):** the fastball velocity benchmark ladder with confidence ratings and sources, plus the Evaluation Scoring Guide.
- **Phase 2 (optional, do not build unless Cole says yes):** a placement calculator that applies the guide's logic to a Trackman session's low / average / high fastball velocity.

Athletes and parents must never see any of it, in any form.

Background: the data was compiled from 11 published sources in Notion (Velo Ladder repository). Notion remains the source of truth for now; this app holds a snapshot. Cole is a coach, not a developer, so explain decisions in plain language and keep changes small.

## 2. Ground rules

1. **Discover before building.** Inspect the repo: stack, routing, auth, role model, database/ORM/migrations, UI library, tests, and any existing coach/admin area. Follow existing conventions. Add no dependency unless necessary, and say why.
2. **Post a short plan first** (files to add or change, schema changes, how coach-only is enforced) and wait for Cole's OK before running migrations.
3. **If the app has no notion of coach vs athlete**, do not invent an auth system silently. Stop and ask.
4. Keep changes scoped to this feature. No refactors.
5. Do not edit seed values. If a value looks wrong, flag it to Cole instead of fixing it.
6. Do not present the benchmarks as more precise than they are (see the disclosure rules in section 6).

## 3. Access control (hard requirement)

Coach-only must be enforced **on the server**, not just hidden in the UI.

- Every page, route, API endpoint, server action, and data loader that touches this data checks for the coach role server-side. Unauthenticated users get the app's normal login redirect. Athletes get 403/404 (match existing convention).
- Benchmark data must not appear in anything an athlete-facing page receives: SSR props, RSC payloads, shared client bundles, shared API responses, athlete exports, emails, PDFs, or public/shared links.
- Serve the data through coach-only server/API access. If the JSON is imported at build time, keep it in a server-only module or a coach-only chunk, never in a shared client bundle.
- Keep it out of sitemaps and search indexing, and make sure responses are not cached in a way that could serve one user's view to another (use private cache headers).
- Navigation entries render for coaches only.

Verification (automated if the repo has a test runner, otherwise a documented manual check):

1. Unauthenticated request to every new route/endpoint is blocked.
2. Athlete-role request to every new route/endpoint is blocked. List the endpoints tested.
3. Athlete-facing pages, their API responses, and the production client bundle contain none of these sentinel strings: `Elite Trajectory`, `Velocity Ranges`, `velo_ranges`, `Eisenmann`.

## 4. Data

Seed file: `velo-ladder-seed-data.json` with `meta`, `sources[]`, and `ranges[]`.

Suggested tables (adapt to the stack's ORM and naming):

| Table | Columns |
|---|---|
| `velo_sources` | slug (unique), title, author, data_type, quality (High/Medium/Low/Unverified), published_date (nullable), limitations_summary, notion_url |
| `velo_ranges` | slug (unique), level, category, row_type, display_order, rhp_low, rhp_high, lhp_low, lhp_high, combined_low, combined_high, elite_trajectory_ref, confidence (nullable), notes, last_updated (nullable), notion_url |
| `velo_range_sources` | range_slug, source_slug (join) |

All velocity columns are nullable numeric (mph, fastball only).

**Seed script:** idempotent upsert by `slug`, reading the JSON. Re-running with a newer JSON updates rows in place. Do not delete rows missing from the file unless a `--prune` flag is passed. Show `meta.snapshot_date` in the UI as "Data snapshot".

**How to read a row:**

- **Band selection:** if the row has hand-specific bands (RHP/LHP), use the pitcher's hand. Otherwise use the Combined band. Most Youth/HS rows are Combined only.
- **`elite_trajectory_ref`:** exists only for 13U-18U. It is an aspirational reference (historical teenage velocity of pitchers who reached MLB, n=25, skews toward tall early-maturing pitchers). It is not a typical range.
- **`row_type`:**
  - `primary` — a real tier; can be classified against.
  - `anchor` — one row (Rapsodo measured average). Point value (low equals high). Context only.
  - `secondary` — the three Go Big tiers. A parallel taxonomy spanning several divisions. Context only.
- **No data yet:** rows with no band and null confidence (Independent Pro and the three MiLB rows). Render "No data yet". Never render 0 or a blank.

## 5. Phase 1 — coach-only reference (build this)

Add to the coach navigation:

1. **Velo Ladder** page
   - Table grouped by category (Youth, High School, College, Independent/Pro, MiLB/MLB), in `display_order`.
   - Columns: Level, band (show RHP and LHP when present, else Combined), Elite Ref (13U-18U only), Confidence badge, source count.
   - Row detail (expand or drawer): notes, and each source with its quality badge and Notion link.
   - Legend explaining Confidence levels. Banner: "Coach-only. Benchmarks are directional; check the Confidence rating before relying on a placement."
   - Visually mark `anchor` and `secondary` rows as reference-only.
2. **Sources** tab or page: all 11 sources with quality, data type, published date, and limitations summary.
3. **Evaluation Scoring Guide** page: render `velo-ladder-evaluation-scoring-guide.md` in the app's normal markdown/table styling. Keep the file as a content asset so Cole can update the text without touching code.

## 6. Phase 2 — placement calculator (optional)

Cole chose a manual, reference-page workflow over an automated tool. In your plan, mention Phase 2 as an option and **build it only if Cole says yes.** The spec is here so it can be switched on without another round trip.

**UI:** level select (primary rows only, empty rows disabled with "No data yet"), hand toggle (R/L), three inputs (session Low, Average, High fastball mph), an Evaluate button, a result card, and a "Copy write-up" button. Do not save athlete data unless Cole asks. Manual entry only; no Trackman file import.

**Logic:** a pure function in its own module with unit tests, no UI or database calls inside it. All constants live in one config file.

| Constant | Default | Basis |
|---|---|---|
| `OUTLIER_BUFFER_MPH` | 3 | From the scoring guide |
| `PEAK_GAP_FLAG_MPH` | 4 | Matches the guide's worked example |
| `NOTABLY_BEHIND_BUFFER_MPH` | 5 | **Proposed, not in the guide. Confirm with Cole.** |
| `FATIGUE_GAP_FLAG_MPH` | 6 | **Proposed, not in the guide. Confirm with Cole.** Set so neither worked example in the guide trips it. |

**Validation:** all three inputs numeric; `floor <= sitting <= peak`; each between 30 and 110 mph. Hand is required when the selected row has hand-specific bands. Reject `anchor` and `secondary` rows.

**Band:** RHP band if hand is R and RHP bounds exist; LHP band if hand is L and LHP bounds exist; else Combined; else return `NO_DATA` and do not guess. If the pitcher's hand is given but the row only has Combined, use Combined and add the note "Sources for this row do not split by hand."

**Classification order (first match wins), using sitting (average) velocity:**

1. Row has `elite_trajectory_ref` and `sitting >= elite_trajectory_ref` → `OUTLIER_ELITE_TRAJECTORY`
2. Row has no `elite_trajectory_ref` and `sitting >= band.high + OUTLIER_BUFFER_MPH` → `OUTLIER_ABOVE_RANGE`
3. `sitting > band.high` → `ABOVE_AVERAGE`
4. `sitting >= band.low` → `AVERAGE_UPPER_HALF` if `sitting >= midpoint`, else `AVERAGE_LOWER_HALF` (midpoint = (low + high) / 2)
5. `sitting <= band.low - NOTABLY_BEHIND_BUFFER_MPH` → `NOTABLY_BEHIND`
6. otherwise → `BELOW_AVERAGE`

Never use the word "outlier" for the low side.

**Narrative flags (informational; never change the classification):**

- `PROJECTABILITY_GAP` if `peak - sitting >= PEAK_GAP_FLAG_MPH`
- `FATIGUE_OR_CONSISTENCY` if `sitting - floor >= FATIGUE_GAP_FLAG_MPH`
- `PEAK_ABOVE_BAND` if `peak > band.high`

**Output must always include:** row level and category, band used (RHP/LHP/Combined with low, high, midpoint), classification and coach-facing label, the row's Confidence and its source list with quality ratings, `elite_trajectory_ref` when present, the narrative flags, and these disclosures:

- Always: "Row confidence: {confidence}. This placement is only as certain as that rating." and "Percentile-based outlier claims are only defensible for 13U and 18U (Eisenmann data). Elsewhere, 'outlier' is a judgment call against a typical-range band, not a statistical claim."
- On `OUTLIER_ABOVE_RANGE`: add "The outlier line here is High + {buffer} mph, an adjustable judgment call."
- On `OUTLIER_ELITE_TRAJECTORY`: add "The elite reference reflects the teenage velocity of pitchers who reached MLB; that sample skews toward tall, early-maturing pitchers."
- On `NOTABLY_BEHIND` or `BELOW_AVERAGE`: add "Sitting below the range is common with late development and is not a red flag by itself."

**Unit tests (pin these):**

| # | Input | Expected |
|---|---|---|
| 1 | 16U, floor 74 / avg 79 / peak 83 | `AVERAGE_UPPER_HALF`, Combined 69-85, Medium, flag `PROJECTABILITY_GAP` only, no outlier |
| 2 | JUCO, R, 84 / 88 / 91 | `AVERAGE_UPPER_HALF`, RHP 82-90, flag `PEAK_ABOVE_BAND` only, no outlier |
| 3 | 16U, 85 / 89 / 92 | `OUTLIER_ELITE_TRAJECTORY` (avg equals the 89 ref) |
| 4 | JUCO, R, avg 91 / avg 93 | `ABOVE_AVERAGE` / `OUTLIER_ABOVE_RANGE` |
| 5 | 16U, avg 68 / 65 / 64 | `BELOW_AVERAGE` / `BELOW_AVERAGE` / `NOTABLY_BEHIND` |
| 6 | D1 Power 4, avg 92, hand L vs hand R | L: `AVERAGE_UPPER_HALF` (LHP 88-94, midpoint 91); R: `AVERAGE_LOWER_HALF` (RHP 90-97, midpoint 93.5) |
| 7 | MiLB AAA | `NO_DATA`, no classification |
| 8 | 16U, hand L | uses Combined band plus the "no hand split" note |
| 9 | D1 Power 4, no hand | validation error |
| 10 | Rapsodo anchor row or a Go Big row | rejected as not classifiable |
| 11 | peak below avg | validation error |
| 12 | 13U, avg 73 | see open item 4; pin whatever Cole decides |

## 7. Definition of done

- [ ] Plan posted and approved before any migration
- [ ] Schema, seed script, and Phase 1 pages built; seed is idempotent
- [ ] Row counts after seeding: 25 ranges, 11 sources; 4 rows show "No data yet"
- [ ] Spot-check three rows against the JSON (13U, JUCO, NCAA D1 — Power 4)
- [ ] Access-control checks from section 3 pass and are documented
- [ ] Snapshot date visible in the UI
- [ ] Short summary for Cole: what was added, where it lives, how to re-seed, how to update the guide text

## 8. Open items to confirm with Cole

1. Where the coach role is defined, if the app has no existing coach/athlete distinction.
2. Whether to build Phase 2.
3. The two proposed constants (`NOTABLY_BEHIND_BUFFER_MPH`, `FATIGUE_GAP_FLAG_MPH`).
4. **13U edge case:** the 13U Elite Trajectory Ref (72) sits *below* the 13U band's High (75). Under the order above, a 13-year-old sitting 73 is flagged `OUTLIER_ELITE_TRAJECTORY` even though he is inside the band. The scoring guide's wording implies the elite check governs, so that is the default, but Cole should confirm. The alternative is to cap the elite check at the band's High.
5. How Cole wants to refresh data: re-export JSON from Notion by hand (default), or a Notion API sync later.

## 9. Out of scope

Trackman file import; saving evaluations to athlete profiles; pitch types other than fastball; Notion API sync; any athlete-facing view; sourcing pro-level data.
