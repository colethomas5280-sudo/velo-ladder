"use client";

import Link from "next/link";
import {
  PAINFUL,
  SCREEN_GROUPS,
  SCREEN_TESTS,
  screenFields,
  sidesOf,
  subTestFindings,
  type Finding,
  type ScreenTest,
  type SubTest,
} from "@/lib/screen";

/* ------------------------------------------------------------------ *
 * The whole sheet, on one page
 *
 * Rendered from `lib/screen.ts` rather than written alongside it, so it
 * cannot drift from what the app actually does. The page it replaces was
 * hand-written, went stale the moment the config moved, and had to be retired
 * rather than corrected.
 *
 * Built for reviewing rather than for running a screen: every answer with the
 * colour it carries, so a wrong grade is visible by reading instead of by
 * tapping through sixteen tests in the form.
 * ------------------------------------------------------------------ */

/** What this answer does — a colour, an alert, or a question it opens. */
function verdict(test: ScreenTest, sub: SubTest, finding: Finding) {
  if (finding.alert) return { cls: "alert", text: "Flags the test" };
  if (finding.severity)
    return { cls: finding.severity, text: finding.severity.toUpperCase() };

  const opens = test.subTests.filter(
    (x) => x.dependsOn?.subTest === sub.key && x.dependsOn.findings.includes(finding.key),
  );
  if (opens.length)
    return { cls: "gate", text: `opens “${opens.map((o) => o.label).join("”, “")}”` };
  return { cls: "none", text: sub.diagnostic ? "context only" : "—" };
}

export default function ScreenReference() {
  const fields = screenFields();
  const findings = SCREEN_TESTS.flatMap((t) =>
    t.subTests.flatMap((s) => subTestFindings(s)),
  );
  const count = (sev: string) => findings.filter((f) => f.severity === sev).length;

  return (
    <>
      <div className="tests-head">
        <Link href="/tests" className="back-link">
          ← Tests
        </Link>
        <div className="eyebrow">Reference</div>
        <h2>The movement screen</h2>
      </div>

      <section className="card pad">
        <p className="sr-lede">
          Every test, every question and every answer, with the colour it
          carries. Generated from the app&rsquo;s own configuration, so what
          you read here is what the form records. There is no second copy to
          fall out of step.
        </p>
        <div className="sr-tally">
          <span>
            <b>{SCREEN_TESTS.length}</b> tests
          </span>
          <span>
            <b>{SCREEN_TESTS.reduce((n, t) => n + t.subTests.length, 0)}</b> questions
          </span>
          <span>
            <b>{fields.length}</b> readings on a full screen
          </span>
          <span className="green">
            <b>{count("green")}</b> green
          </span>
          <span className="yellow">
            <b>{count("yellow")}</b> yellow
          </span>
          <span className="red">
            <b>{count("red")}</b> red
          </span>
        </div>
      </section>

      {SCREEN_GROUPS.map((group) => {
        const tests = SCREEN_TESTS.filter((t) => t.group === group.id);
        if (!tests.length) return null;
        return (
          <section className="sr-group" key={group.id}>
            <h3>{group.title}</h3>
            {tests.map((test) => (
              <TestCard key={test.key} test={test} />
            ))}
          </section>
        );
      })}
    </>
  );
}

function TestCard({ test }: { test: ScreenTest }) {
  const graded = test.subTests.flatMap((s) => s.findings).filter((f) => f.severity);
  const noYellow = graded.length > 0 && !graded.some((f) => f.severity === "yellow");

  return (
    <article className="card pad sr-test">
      <div className="sr-test-head">
        <h4>{test.label}</h4>
        {/*
          * Two tests pass or fail with nothing in between, by decision. Said
          * out loud here because an absence is the one thing a reader can't
          * tell apart from an oversight.
          */}
        {noYellow && <span className="pill">no yellow, pass or fail</span>}
      </div>

      {test.video && (
        <a
          className="ms-video"
          href={test.video}
          target="_blank"
          rel="noopener noreferrer"
        >
          ▶ Watch {test.label}
        </a>
      )}

      {test.subTests.map((sub) => {
        const sides = sidesOf(sub);
        const parent = sub.dependsOn
          ? test.subTests.find((x) => x.key === sub.dependsOn!.subTest)
          : null;
        const opensOn = sub.dependsOn
          ? parent?.findings
              .filter((f) => sub.dependsOn!.findings.includes(f.key))
              .map((f) => f.label)
              .join(" or ")
          : null;

        return (
          <div className="sr-q" key={sub.key}>
            <div className="sr-q-head">
              <b>{sub.label}</b>
              {sides.length > 0 && (
                <span className="pill">{sides.map((s) => s.label).join(" / ")}</span>
              )}
              {sub.diagnostic && <span className="pill">not graded</span>}
            </div>
            {opensOn && (
              <span className="cz-note">
                Only asked when the answer above is <i>{opensOn}</i>.
              </span>
            )}
            {sub.help && <span className="sr-help">{sub.help}</span>}

            <ul className="sr-answers">
              {subTestFindings(sub).map((f) => {
                const v = verdict(test, sub, f);
                return (
                  <li key={f.key} className={f.key === PAINFUL ? "universal" : ""}>
                    <span className={`ms-dot ${v.cls === "gate" ? "none" : v.cls}`} />
                    <span className="sr-answer">
                      {f.label}
                      {/* Some gates have two acceptable baselines, so this
                          has to read right in the plural. */}
                      {f.normal && <em>passes</em>}
                    </span>
                    <span className={`sr-verdict v-${v.cls}`}>{v.text}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </article>
  );
}
