"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { RecoveryEntry } from "@/lib/types";
import {
  ANSWERED_ITEMS,
  WELLNESS_SECTIONS,
  recoveryScore,
  scoreBand,
  type RatedItem,
} from "@/lib/recovery";
import { CNS_DEFAULT_PCT } from "@/lib/setback";
import { EMPTY } from "@/lib/velo";

/* ------------------------------------------------------------------ *
 * What the recovery score is
 *
 * Athletes see a number out of 100 every morning and have never been told
 * what it is made of. This is that page: the questions, how they combine, and
 * — the part that matters most — what the number does NOT do.
 *
 * It is a sandbox, not a record. Move the answers, watch the score move,
 * nothing is saved. The arithmetic is the real `recoveryScore`, so the page
 * cannot drift from the thing it is explaining.
 * ------------------------------------------------------------------ */

const MIDDLE = 3;

/** Every scored question, in the order the check-in asks them. */
const QUESTIONS: RatedItem[] = ANSWERED_ITEMS;

type Answers = Record<string, number>;

const allMiddle = (): Answers =>
  Object.fromEntries(QUESTIONS.map((q) => [q.key, MIDDLE]));

const BAND_COPY: Record<ReturnType<typeof scoreBand>, string> = {
  high: "You put yourself near the top on most of it.",
  mid: "A normal day. Some stuff good, some not.",
  low: "You answered low on most of it.",
};

export default function RecoveryGuide() {
  const [answers, setAnswers] = useState<Answers>(allMiddle);

  const score = useMemo(
    () => recoveryScore(answers as unknown as RecoveryEntry),
    [answers],
  );
  const band = score == null ? null : scoreBand(score);

  return (
    <div className="sr-page">
      <div className="tests-head">
        <Link href="/resources" className="back-link">
          ← Resources
        </Link>
        <div className="eyebrow">Reference</div>
        <h2>What your recovery score means</h2>
        <p className="sr-lede">
          The number on your check-in is just the average of the questions you
          answered, scaled to 100. Move the answers below and watch it change.
          Nothing here gets saved, and this is not your real check-in.
        </p>
      </div>

      <section className="card pad">
        <div className="rg-top">
          <div className={`ci-score big ${band ?? ""}`}>
            <span className="n">{score ?? EMPTY}</span>
            <span className="l">Score</span>
          </div>
          <div className="rg-band">
            <b>{band ? BAND_COPY[band] : ""}</b>
            <span className="cz-note">
              {/*
                * Stated because it is the thing athletes assume otherwise:
                * sleep does not count for more than diet. It is a plain mean
                * of whatever you filled in.
                */}
              Every question counts the same. Skip one and it just is not part
              of the average, so a half-finished check-in still scores.
            </span>
            <button className="btn sm ghost" onClick={() => setAnswers(allMiddle())}>
              Reset
            </button>
          </div>
        </div>

        {WELLNESS_SECTIONS.map((section) => {
          const rated = section.items.filter(
            (i): i is RatedItem => i.kind === "rated",
          );
          if (!rated.length) return null;
          return (
            <div className="wl-section" key={section.id}>
              <div className="eyebrow">{section.title}</div>
              {rated.map((item) => (
                <div className="ci-row wl-row" key={item.key}>
                  <div className="ci-label">
                    <b>{item.label}</b>
                    {item.help && <span className="wl-help">{item.help}</span>}
                  </div>
                  <select
                    className="wl-select"
                    aria-label={item.label}
                    value={answers[item.key] ?? MIDDLE}
                    onChange={(e) =>
                      setAnswers((p) => ({
                        ...p,
                        [item.key]: Number(e.target.value),
                      }))
                    }
                  >
                    {item.anchors.map((a, i) => (
                      <option key={i} value={i + 1}>
                        {i + 1} · {a}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          );
        })}
      </section>

      <section className="card pad">
        <div className="eyebrow">What the score does not do</div>
        <p className="rg-p">
          <b>It does not decide anything.</b> Nothing gets flagged, cancelled
          or changed because your score is low. It is there to watch over time.
          One rough morning is just a rough morning. Two weeks of them is worth
          talking about.
        </p>
        <p className="rg-p">Two things do carry consequences, and neither is the score:</p>
        <ul className="rg-list">
          <li>
            <b>The arm question.</b> Saying you are in pain, not just sore,
            raises a flag on its own, whatever the rest of the check-in says.
            Answer that one straight or it is useless.
          </li>
          <li>
            <b>Your velo against your own recent average.</b> If a max-effort
            session comes in more than {CNS_DEFAULT_PCT}% below your own 30-day
            average, that raises a flag too. It is measured against you, never
            against anyone else.
          </li>
        </ul>
      </section>

      <section className="card pad">
        <div className="eyebrow">Tracked, but never scored</div>
        <p className="rg-p">
          Bodyweight, resting heart rate and HRV all get recorded and charted,
          and none of them touch the score. That is on purpose. They only mean
          anything against your own baseline. One guy&rsquo;s resting heart
          rate of 48 and another guy&rsquo;s 62 can say exactly the same thing
          about their own bodies and nothing at all about each other, so mixing
          them into one number would give you a figure that means nothing. And
          there is no good or bad bodyweight to score.
        </p>
        <p className="rg-p">
          Log them anyway. Each one is only useful as <em>your own</em> trend,
          which is how the tracker shows them.
        </p>
      </section>
    </div>
  );
}
