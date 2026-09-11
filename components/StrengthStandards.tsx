"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  BODYWEIGHT_ANCHORS,
  bodyweightStanding,
  fmtHeight,
  roundUp5,
  targetsAt,
  type BodyweightStanding,
} from "@/lib/relative";
import { liftMenu, seedLifts } from "@/lib/strength";
import { readLocal, subscribeLocal, writeLocal } from "@/lib/localStore";

/* ------------------------------------------------------------------ *
 * Strength standards, as a thing you can use
 *
 * The athlete's own page shows where he stands against these once he has
 * logged something. This is the version that needs nothing logged at all: put
 * in your height and weight and it tells you what you are aiming at, in pounds
 * you could walk up and load.
 *
 * It lives under Resources because that is where Cole wanted it while the
 * programming still lives in Velo Beam — a reference an athlete reads, not a
 * record of anything.
 *
 * Nothing here is stored on the server. Whatever gets typed stays in this
 * browser, which is the right default for a page anyone can open and poke at.
 * ------------------------------------------------------------------ */

const KEY = "velo.standards.body";

/** The menu never loads here — this page is reference, not the live roster. */
const MENU = liftMenu(seedLifts());

interface Entered {
  ft: string;
  inch: string;
  lb: string;
}

const BLANK: Entered = { ft: "", inch: "", lb: "" };

function readSaved(): Entered {
  const raw = readLocal(KEY);
  if (!raw) return BLANK;
  try {
    const v = JSON.parse(raw) as Partial<Entered>;
    return {
      ft: String(v.ft ?? ""),
      inch: String(v.inch ?? ""),
      lb: String(v.lb ?? ""),
    };
  } catch {
    return BLANK;
  }
}

const digits = (s: string) => s.replace(/[^0-9]/g, "").slice(0, 3);

export default function StrengthStandards() {
  /*
   * useSyncExternalStore rather than useState + useEffect: localStorage does
   * not exist during server rendering, and a server snapshot is what keeps
   * the hydrating render honest instead of correcting itself a frame later.
   */
  const saved = useSyncExternalStore(
    subscribeLocal,
    () => readLocal(KEY) ?? "",
    () => "",
  );
  const initial = useMemo(() => (saved ? readSaved() : BLANK), [saved]);
  const [draft, setDraft] = useState<Entered>(initial);
  const [touched, setTouched] = useState(false);
  const v = touched ? draft : initial;

  const set = (patch: Partial<Entered>) => {
    const next = { ...v, ...patch };
    setTouched(true);
    setDraft(next);
    writeLocal(KEY, JSON.stringify(next));
  };

  const heightIn = Number(v.ft) * 12 + Number(v.inch || 0);
  const weightLb = Number(v.lb);
  const standing =
    v.ft && v.lb ? bodyweightStanding(heightIn, weightLb) : null;
  const targets = useMemo(
    () => (weightLb > 0 ? targetsAt(weightLb) : []),
    [weightLb],
  );

  return (
    <div className="sr-page">
      <div className="tests-head">
        <Link href="/resources" className="back-link">
          ← Resources
        </Link>
        <div className="eyebrow">Reference</div>
        <h2>Strength standards</h2>
        <p className="sr-lede">
          Put in your height and weight and this works out what you are aiming
          at — what to carry, and what to eventually put on the bar. Nothing is
          saved anywhere but this browser.
        </p>
      </div>

      <section className="card pad">
        <div className="ss-inputs">
          <label className="field">
            <span>Height</span>
            <span className="ss-height">
              <input
                className="tin"
                inputMode="numeric"
                aria-label="Height, feet"
                placeholder="6"
                value={v.ft}
                onChange={(e) => set({ ft: digits(e.target.value) })}
              />
              <em>ft</em>
              <input
                className="tin"
                inputMode="numeric"
                aria-label="Height, inches"
                placeholder="1"
                value={v.inch}
                onChange={(e) => set({ inch: digits(e.target.value) })}
              />
              <em>in</em>
            </span>
          </label>
          <label className="field">
            <span>Bodyweight</span>
            <span className="ss-height">
              <input
                className="tin"
                inputMode="numeric"
                aria-label="Bodyweight in pounds"
                placeholder="180"
                value={v.lb}
                onChange={(e) => set({ lb: digits(e.target.value) })}
              />
              <em>lb</em>
            </span>
          </label>
        </div>

        {!standing && (
          <p className="widget-empty">
            Fill both in and the numbers below become yours.
          </p>
        )}

        {standing && <Bodyweight s={standing} />}
      </section>

      {targets.length > 0 && (
        <section className="card pad">
          <div className="eyebrow">What to put on the bar</div>
          <p className="cz-note ss-basis">
            At {Math.round(weightLb)} lb. These move with you — put weight on and
            the targets go up with it, which is the point of a ratio.
          </p>
          <ul className="ss-targets">
            {targets.map((t) => (
              <li key={t.liftKey}>
                <span className="ss-lift">{MENU.name(t.liftKey)}</span>
                <span className="ss-amount">
                  {t.unit === "reps"
                    ? `${t.amount} reps`
                    : `${roundUp5(t.amount)} lb`}
                </span>
                <span className="ss-basis">
                  {t.ratio != null
                    ? `${t.ratio}× bodyweight`
                    : "strict, neutral grip, from a dead hang"}
                  {t.then && ` · then +${roundUp5(t.then.added)} lb ${t.then.note}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Bodyweight as a scale with its anchors named, never as a verdict.
 *
 * Cole's call, and it matches how the rest of the app treats an athlete's
 * weight: the recovery card refuses to score it at all, precisely so nothing
 * here reads as a judgement on a teenager's body. Saying what 2.5× and 2.8×
 * ARE lets him place himself without being told he is wrong.
 */
function Bodyweight({ s }: { s: BodyweightStanding }) {
  /*
   * The scale spans the range these anchors live in, not 0 to 2.8. Running it
   * from zero pushed every tick into the right-hand fifth of the bar and left
   * an athlete unable to see the difference between 2.5x and 2.7x — which is
   * the entire thing the bar exists to show. It is a position indicator with
   * every tick labelled, not a magnitude, so a floor above zero misleads
   * nobody. Both ends sit clear of the anchors so nobody is pinned to an edge.
   */
  const from = BODYWEIGHT_ANCHORS[0].per - 0.5;
  const to = BODYWEIGHT_ANCHORS[BODYWEIGHT_ANCHORS.length - 1].per + 0.2;
  const place = (per: number) =>
    Math.max(0, Math.min(100, ((per - from) / (to - from)) * 100));
  const pos = place(s.per);

  return (
    <div className="ss-body">
      <div className="ss-you">
        <b>
          {Math.round(s.weightLb)} lb at {fmtHeight(s.heightIn)}
        </b>
        <span className="ss-per">{s.per.toFixed(2)} lb per inch</span>
      </div>

      <div className="ss-scale">
        <span className="ss-marker" style={{ left: `${pos}%` }} />
        {s.marks.map((m) => (
          <span
            key={m.anchor.label}
            className="ss-tick"
            style={{ left: `${place(m.anchor.per)}%` }}
          />
        ))}
      </div>

      <ul className="ss-anchors">
        {s.marks.map((m) => (
          <li
            key={m.anchor.label}
            className={s.reached === m.anchor ? "ss-anchor ss-anchor-at" : "ss-anchor"}
          >
            <span className="ss-anchor-lb">{m.lb} lb</span>
            <span className="ss-anchor-name">{m.anchor.label}</span>
            <span className="ss-basis">{m.anchor.note}</span>
          </li>
        ))}
      </ul>

      <p className="ss-verdict">
        {s.next
          ? `${Math.round(s.next.toGo)} lb from ${s.next.anchor.label.toLowerCase()} for your height.`
          : "You're at or above every mark on this scale for your height."}
      </p>
    </div>
  );
}
