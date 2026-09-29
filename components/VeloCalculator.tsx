"use client";

import { useRef, useState } from "react";
import type { VeloRange, VeloSource } from "@/lib/veloTypes";
import type { Hand, PlacementFlag, PlacementResult } from "@/lib/veloPlacement";
import { api, ApiError } from "@/lib/fetcher";
import { ratingPill } from "./VeloSources";

/* ------------------------------------------------------------------ *
 * Placing a session against the ladder
 *
 * Mounted inside VeloLadderBody, which only renders after the coach role
 * check and which already holds the rows and sources it fetched from the
 * gated routes. So the rows come in as props.
 *
 * The placing itself does NOT happen here. It happens on the server, at
 * POST /api/velo/evaluate, and this file only sends three radar numbers and
 * a row slug and renders what comes back. That is deliberate: the
 * classifier and its coaching wording (the disclosures, the labels) live in
 * lib/veloPlacement.ts, and the coach's rule is that none of that wording
 * may be in code the browser downloads. Every import of it below is
 * `import type`, which is erased at compile time, and lib/clientSafe.test.ts
 * fails the build if a value import of it ever appears in a client file.
 *
 * The placement always sits next to its confidence rating and its
 * disclosures, because a placement without them reads as more certain than
 * the row behind it.
 *
 * Nothing is saved. There is no athlete on this form.
 * ------------------------------------------------------------------ */

/** What each flag says, in the coach's terms. No thresholds are quoted: the
 * numbers live with the classifier on the server, and a copy here could only
 * drift from it. */
const FLAG_TEXT: Record<PlacementFlag, string> = {
  PROJECTABILITY_GAP:
    "Projectability gap: High is well above Average. Could be untapped ceiling, or inconsistent effort or mechanics.",
  FATIGUE_OR_CONSISTENCY:
    "Fatigue or consistency: Low is well below Average. Read it as fatigue or conditioning across the outing, not a talent signal.",
  PEAK_ABOVE_BAND: "Peak above the band: High is above the top of the band used.",
};

/** A row nobody has sourced a band for yet. Display logic only: it decides
 * what the level list greys out, not where anyone is placed. */
function hasNoBand(r: VeloRange): boolean {
  const pair = (lo: number | null, hi: number | null) => lo != null && hi != null;
  return !(
    pair(r.combinedLow, r.combinedHigh) ||
    pair(r.rhpLow, r.rhpHigh) ||
    pair(r.lhpLow, r.lhpHigh)
  );
}

/** evaluate names the three inputs floor, sitting and peak. The form calls
 * them Low, Average and High, so its refusals are shown in the form's words. */
function inFormWords(message: string): string {
  return message
    .replace(/\bfloor\b/g, "Low")
    .replace(/\bsitting\b/g, "Average")
    .replace(/\bpeak\b/g, "High");
}

interface Outcome {
  range: VeloRange;
  hand: Hand | null;
  low: number;
  avg: number;
  high: number;
  result: PlacementResult;
}

function bandName(kind: "RHP" | "LHP" | "Combined"): string {
  return kind === "Combined" ? "Combined band" : kind;
}

function bandText(o: Outcome): string {
  const b = o.result.band;
  if (!b) return "No usable band on this row";
  return `${bandName(b.kind)} ${b.low}-${b.high} mph, midpoint ${b.midpoint}`;
}

function sourcesOf(o: Outcome, sourcesBySlug: Map<string, VeloSource>): VeloSource[] {
  return o.range.sourceSlugs
    .map((slug) => sourcesBySlug.get(slug))
    .filter((s): s is VeloSource => s != null);
}

/** The plain-text version of the result card, for pasting into a note. */
function writeUp(o: Outcome, sourcesBySlug: Map<string, VeloSource>): string {
  const { range, result } = o;
  const sources = sourcesOf(o, sourcesBySlug);
  const lines = [
    "Fastball velocity placement",
    `Level: ${range.level} (${range.category})`,
    `Session: Low ${o.low}, Average ${o.avg}, High ${o.high} mph${o.hand ? `, ${o.hand}HP` : ""}`,
    `Band used: ${bandText(o)}`,
    `Placement: ${result.label}`,
    `Confidence: ${result.confidence ?? "No rating"}`,
  ];
  if (range.eliteTrajectoryRef != null) {
    lines.push(`Elite ref: ${range.eliteTrajectoryRef} mph`);
  }
  if (sources.length > 0) {
    lines.push("Sources:", ...sources.map((s) => `- ${s.title} (${s.quality})`));
  }
  if (result.flags.length > 0) {
    lines.push("Flags:", ...result.flags.map((f) => `- ${FLAG_TEXT[f]}`));
  }
  if (result.notes.length > 0) {
    lines.push("Notes:", ...result.notes.map((n) => `- ${n}`));
  }
  lines.push("Read this with these caveats:", ...result.disclosures.map((d) => `- ${d}`));
  return lines.join("\n");
}

function ResultCard({
  outcome,
  sourcesBySlug,
}: {
  outcome: Outcome;
  sourcesBySlug: Map<string, VeloSource>;
}) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const { range, result } = outcome;
  const sources = sourcesOf(outcome, sourcesBySlug);

  async function copyWriteUp() {
    try {
      await navigator.clipboard.writeText(writeUp(outcome, sourcesBySlug));
      setCopy("copied");
    } catch {
      /* clipboard blocked */
      setCopy("failed");
    }
  }

  return (
    <section className="card pad tests-card vc-result" role="region" aria-label="Placement result">
      <div className="sec-h">
        <h3>{range.level}</h3>
        <span className="sub">{range.category}</span>
      </div>

      <p className="vc-label">{result.label}</p>

      <dl className="vc-facts">
        <dt>Band used</dt>
        <dd>{bandText(outcome)}</dd>
        <dt>Confidence</dt>
        <dd>{result.confidence ? ratingPill(result.confidence) : "No rating"}</dd>
        <dt>Sources</dt>
        <dd>
          {sources.length > 0 ? (
            <ul className="vc-list">
              {sources.map((s) => (
                <li key={s.slug}>
                  {ratingPill(s.quality)} {s.title}
                </li>
              ))}
            </ul>
          ) : (
            "No sources logged yet."
          )}
        </dd>
        {range.eliteTrajectoryRef != null && (
          <>
            <dt>Elite ref</dt>
            <dd>{range.eliteTrajectoryRef} mph</dd>
          </>
        )}
      </dl>

      {result.flags.length > 0 && (
        <ul className="vc-list vc-flags">
          {result.flags.map((f) => (
            <li key={f}>{FLAG_TEXT[f]}</li>
          ))}
        </ul>
      )}

      {result.notes.length > 0 && (
        <ul className="vc-list">
          {result.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <div className="vc-disc">
        <div className="eyebrow">Read this with</div>
        <ul className="vc-list">
          {result.disclosures.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </div>

      <div className="vc-actions">
        <button type="button" className="btn" onClick={copyWriteUp}>
          Copy write-up
        </button>
        {copy === "copied" && <span className="sub">Copied</span>}
      </div>
      {copy === "failed" && (
        <>
          <p className="form-error" role="alert">
            Couldn&rsquo;t copy from this browser. The write-up is below to copy by hand.
          </p>
          <textarea
            className="vc-fallback"
            readOnly
            aria-label="Write-up"
            value={writeUp(outcome, sourcesBySlug)}
            onFocus={(e) => e.currentTarget.select()}
          />
        </>
      )}
    </section>
  );
}

export default function VeloCalculator({
  groups,
  sourcesBySlug,
}: {
  groups: { category: string; rows: VeloRange[] }[];
  sourcesBySlug: Map<string, VeloSource>;
}) {
  const [slug, setSlug] = useState("");
  const [hand, setHand] = useState<Hand | null>(null);
  const [low, setLow] = useState("");
  const [avg, setAvg] = useState("");
  const [high, setHigh] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Bumped by every run and every edit, so a slow answer can tell it is stale. */
  const latest = useRef(0);

  const primaryGroups = groups
    .map((g) => ({ category: g.category, rows: g.rows.filter((r) => r.rowType === "primary") }))
    .filter((g) => g.rows.length > 0);
  // Only rows with a band can be chosen, so a row with none cannot be
  // evaluated however the form got into that state.
  const range =
    primaryGroups
      .flatMap((g) => g.rows)
      .find((r) => r.slug === slug && !hasNoBand(r)) ?? null;

  /* A result belongs to the numbers that produced it, so any edit retires it. */
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    latest.current++;
    set(v);
    setOutcome(null);
    setErr(null);
    setBusy(false);
  };

  async function run() {
    const ticket = ++latest.current;
    setOutcome(null);
    if (!range) {
      setErr("Choose a level first.");
      return;
    }
    if (!low.trim() || !avg.trim() || !high.trim()) {
      setErr("Enter Low, Average and High from the session.");
      return;
    }
    const sent = { range, hand, low: Number(low), avg: Number(avg), high: Number(high) };
    setBusy(true);
    setErr(null);
    try {
      const result = await api<PlacementResult>("/api/velo/evaluate", "POST", {
        slug: range.slug,
        hand,
        floor: sent.low,
        sitting: sent.avg,
        peak: sent.high,
      });
      // The form moved on while this was in flight: that answer is about
      // numbers no longer on screen.
      if (ticket !== latest.current) return;
      setOutcome({ ...sent, result });
    } catch (e) {
      if (ticket !== latest.current) return;
      setErr(
        e instanceof ApiError
          ? inFormWords(e.message)
          : "Couldn't place that session. Check your connection.",
      );
    } finally {
      if (ticket === latest.current) setBusy(false);
    }
  }

  return (
    <>
      <section className="card pad tests-card">
        <div className="sec-h">
          <h3>Place a session</h3>
          <span className="sub">Radar readings in mph. Nothing is saved.</span>
        </div>

        <div className="vc-form">
          <label className="field">
            <span>Level</span>
            <select value={slug} onChange={(e) => edit(setSlug)(e.target.value)}>
              <option value="">Choose a level</option>
              {primaryGroups.map((g) => (
                <optgroup key={g.category} label={g.category}>
                  {g.rows.map((r) => {
                    const empty = hasNoBand(r);
                    return (
                      <option key={r.slug} value={r.slug} disabled={empty}>
                        {empty ? `${r.level} (No data yet)` : r.level}
                      </option>
                    );
                  })}
                </optgroup>
              ))}
            </select>
          </label>

          <div className="field">
            <span>Throwing hand</span>
            <div className="seg" role="group" aria-label="Throwing hand">
              {(["R", "L"] as const).map((h) => (
                <button
                  key={h}
                  type="button"
                  aria-label={`${h} throwing hand`}
                  aria-pressed={hand === h}
                  onClick={() => edit(setHand)(hand === h ? null : h)}
                >
                  {h}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span>Low</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={low}
              onChange={(e) => edit(setLow)(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Average</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={avg}
              onChange={(e) => edit(setAvg)(e.target.value)}
            />
          </label>
          <label className="field">
            <span>High</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={high}
              onChange={(e) => edit(setHigh)(e.target.value)}
            />
          </label>
        </div>

        {err != null && (
          <p className="form-error" role="alert">
            {err}
          </p>
        )}

        <div className="vc-actions">
          <button type="button" className="btn primary" disabled={busy} onClick={run}>
            {busy ? "Placing\u2026" : "Evaluate"}
          </button>
        </div>
      </section>

      {outcome && <ResultCard outcome={outcome} sourcesBySlug={sourcesBySlug} />}
    </>
  );
}
