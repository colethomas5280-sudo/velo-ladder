"use client";

import { useState } from "react";
import type { VeloRange, VeloSource } from "@/lib/veloTypes";
import {
  bandFor,
  evaluate,
  type Hand,
  type PlacementFlag,
  type PlacementResult,
} from "@/lib/veloPlacement";
import { FATIGUE_GAP_FLAG_MPH, PEAK_GAP_FLAG_MPH } from "@/lib/veloConfig";
import { ratingPill } from "./VeloSources";

/* ------------------------------------------------------------------ *
 * Placing a session against the ladder
 *
 * Mounted inside VeloLadderBody, which only renders after the coach role
 * check and which already holds the rows and sources it fetched from the
 * gated routes. So this takes them as props and fetches nothing: there is no
 * second data path, and nothing here is reachable by anyone the page itself
 * is not.
 *
 * All of the deciding happens in lib/veloPlacement.ts. This file collects
 * three radar numbers, hands them to evaluate, and shows everything that
 * comes back: the placement always sits next to its confidence rating and
 * its disclosures, because a placement without them reads as more certain
 * than the row behind it.
 *
 * Nothing is saved. There is no athlete on this form.
 * ------------------------------------------------------------------ */

/** What each flag says, in the coach's terms. The thresholds come from the
 * same config the classifier reads, so the wording cannot drift from them. */
const FLAG_TEXT: Record<PlacementFlag, string> = {
  PROJECTABILITY_GAP: `Projectability gap: High is ${PEAK_GAP_FLAG_MPH} or more mph above Average. Could be untapped ceiling, or inconsistent effort or mechanics.`,
  FATIGUE_OR_CONSISTENCY: `Fatigue or consistency: Low is ${FATIGUE_GAP_FLAG_MPH} or more mph below Average. Read it as fatigue or conditioning across the outing, not a talent signal.`,
  PEAK_ABOVE_BAND: "Peak above the band: High is above the top of the band used.",
};

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
    lines.push(`Elite trajectory reference: ${range.eliteTrajectoryRef} mph`);
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
            <dt>Elite trajectory reference</dt>
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

  const primaryGroups = groups
    .map((g) => ({ category: g.category, rows: g.rows.filter((r) => r.rowType === "primary") }))
    .filter((g) => g.rows.length > 0);
  const range = primaryGroups.flatMap((g) => g.rows).find((r) => r.slug === slug) ?? null;

  /* A result belongs to the numbers that produced it, so any edit retires it. */
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setOutcome(null);
    setErr(null);
  };

  function run() {
    setOutcome(null);
    if (!range) {
      setErr("Choose a level first.");
      return;
    }
    if (!low.trim() || !avg.trim() || !high.trim()) {
      setErr("Enter Low, Average and High from the session.");
      return;
    }
    const res = evaluate({
      range,
      hand: hand ?? undefined,
      floor: Number(low),
      sitting: Number(avg),
      peak: Number(high),
    });
    if (!res.ok) {
      setErr(inFormWords(res.error));
      return;
    }
    setErr(null);
    setOutcome({ range, hand, low: Number(low), avg: Number(avg), high: Number(high), result: res });
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
                    const empty = bandFor(r, "R") == null && bandFor(r, "L") == null;
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
          <button type="button" className="btn primary" onClick={run}>
            Evaluate
          </button>
        </div>
      </section>

      {outcome && <ResultCard outcome={outcome} sourcesBySlug={sourcesBySlug} />}
    </>
  );
}
