"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import type { MovementScreen } from "@/lib/types";
import { fetcher, api, ApiError } from "@/lib/fetcher";
import {
  SCREEN_GROUPS,
  SCREEN_TESTS,
  asymmetryReport,
  leadClock,
  rescreenStanding,
  retestPlan,
  screenReport,
  sidesOf,
  standingScreen,
  type Deviation,
  type GapTrend,
  type Hand,
  type RescreenCall,
  type ReportReading,
  type TestReport,
  type Trend,
} from "@/lib/screen";
import { fmtDate, todayISO } from "@/lib/velo";
import ScreenModal from "./ScreenModal";

/* ------------------------------------------------------------------ *
 * The screen, read back
 *
 * A work list, not a report card. It leads with what to do something about,
 * worst first, and says what moved since last time — the second screen is the
 * one that tells an athlete whether the work worked.
 *
 * The coach's note is stripped server-side before this ever loads for an
 * athlete; the `isCoach` guard below is a second lock on a door that is
 * already locked, not the lock itself.
 * ------------------------------------------------------------------ */

const TREND_LABEL: Record<Trend, string> = {
  new: "New",
  worsened: "Worse",
  improved: "Better",
  changed: "Changed",
  unchanged: "Same",
};

/** Which trend speaks for the whole test — the most notable, not the commonest. */
const TREND_RANK: Trend[] = ["new", "worsened", "improved", "changed", "unchanged"];
function rowTrend(work: ReportReading[]): Trend | null {
  for (const t of TREND_RANK) if (work.some((w) => w.trend === t)) return t;
  return null;
}

const GROUP_TITLE = new Map(SCREEN_GROUPS.map((g) => [g.id, g.title]));

const GAP_LABEL: Record<GapTrend, string> = {
  new: "New",
  narrowed: "Closing",
  widened: "Widening",
  unchanged: "Same",
  changed: "Changed",
};

/** The nearer of the two clocks, in a sentence. */
function nextUp(plan: ReturnType<typeof retestPlan>): string {
  const lead = leadClock(plan.full, plan.spot, plan.trigger);
  if (lead.kind === "trigger") return "Re-screen called — regardless of the clock";
  const what =
    lead.kind === "spot"
      ? `spot-check (${lead.tests.length} ${lead.tests.length === 1 ? "test" : "tests"})`
      : "full screen";
  if (lead.days === null) return "No full screen on record yet";
  if (lead.state === "not-due")
    return `Next ${what} in ${Math.max(1, lead.from - lead.days)}–${lead.to - lead.days} days`;
  return `${lead.state === "overdue" ? "Overdue" : "Due"}: ${what}`;
}

/** "Left" / "Dominant", or nothing on a test graded once. */
function sideLabel(reading: { field: ReportReading["field"] }): string | null {
  const { subTest, side } = reading.field;
  if (!side) return null;
  return sidesOf(subTest).find((s) => s.key === side)?.label ?? side;
}

export default function ScreenPanel({
  athleteId,
  athleteName,
  hand,
  call,
  isCoach,
  onCalled,
}: {
  athleteId: string;
  athleteName: string;
  /** Throwing hand, for the arm-test caveat. Null when it isn't on file. */
  hand: Hand | null;
  /** A re-screen called by a trigger, if one is on the athlete's row. */
  call: RescreenCall | null;
  isCoach: boolean;
  onCalled?: () => void;
}) {
  const { data, mutate, isLoading } = useSWR<MovementScreen[]>(
    `/api/athletes/${athleteId}/screens`,
    fetcher,
  );
  const screens = useMemo(() => data ?? [], [data]);

  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [editing, setEditing] = useState<MovementScreen | "new" | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const show = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };

  // Newest first is how they're chosen; the API sends them oldest first.
  const ordered = useMemo(() => [...screens].reverse(), [screens]);
  const index = Math.max(
    0,
    pickedDate ? ordered.findIndex((s) => s.date === pickedDate) : 0,
  );
  const screen = ordered[index] ?? null;

  /*
   * The standing picture as of the screen being viewed, assembled per test
   * from every screen up to and including it. A spot-check covers three
   * tests; the other fourteen are still true, and reading one row would drop
   * them. `previous` is likewise each test's own last reading, not whatever
   * screen happens to sit before this one in the list.
   */
  const standing = useMemo(
    () => standingScreen(screens.filter((s) => !screen || s.date <= screen.date)),
    [screens, screen],
  );
  const reports = useMemo(
    () => (screen ? screenReport(standing.results, standing.previous) : []),
    [screen, standing],
  );
  const plan = useMemo(
    () => retestPlan(standing, todayISO(), undefined, call),
    [standing, call],
  );
  const standingCall = rescreenStanding(call, standing) ? call : null;
  // What this particular screen looked at, for the line that says so.
  const covered = useMemo(
    () =>
      screen
        ? Object.entries(standing.from).filter(([, d]) => d === screen.date).length
        : 0,
    [screen, standing],
  );

  const work = reports.filter((r) => r.work.length);
  const clean = reports.filter((r) => r.status === "clean");
  const skipped = reports.filter((r) => r.status === "skipped");
  const painful = reports.filter((r) => r.status === "alert");
  const cleared = reports.flatMap((r) => r.cleared);
  const carried = reports.flatMap((r) => r.unchecked);
  const gaps = useMemo(
    () =>
      screen
        ? asymmetryReport(standing.results, standing.previous, undefined, hand)
        : { standing: [], closed: [] },
    [screen, standing, hand],
  );

  /*
   * There is no single "previous screen" any more — each test compares
   * against its own last reading, which may have come from a different day.
   * So the question is whether ANY test has a reading behind it.
   */
  const hasPrevious = Object.keys(standing.previousFrom).length > 0;

  const moved = useMemo(() => {
    if (!hasPrevious) return null;
    const cleared = reports.reduce((n, r) => n + r.cleared.length, 0);
    const unchecked = reports.reduce((n, r) => n + r.unchecked.length, 0);
    const appeared = reports.reduce(
      (n, r) => n + r.work.filter((w) => w.trend === "new").length,
      0,
    );
    const still = reports.reduce(
      (n, r) => n + r.work.filter((w) => w.trend && w.trend !== "new").length,
      0,
    );
    return { cleared, unchecked, appeared, standing: still };
  }, [reports, hasPrevious]);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section className="card pad screen-card">
      <div className="sec-h">
        <h3>Movement screen</h3>
        <div className="sc-head-actions">
          {ordered.length > 1 && (
            <select
              className="ms-select sc-pick"
              aria-label="Which screen"
              value={screen?.date ?? ""}
              onChange={(e) => {
                setPickedDate(e.target.value);
                setOpen(new Set());
              }}
            >
              {ordered.map((s, i) => (
                <option key={s.date} value={s.date}>
                  {fmtDate(s.date)}
                  {i === 0 ? " · latest" : ""}
                </option>
              ))}
            </select>
          )}
          {isCoach && (
            <button
              className="btn sm"
              onClick={() =>
                setEditing(screens.find((s) => s.date === todayISO()) ?? "new")
              }
            >
              + Record a screen
            </button>
          )}
        </div>
      </div>

      {isLoading && !screen && (
        <p className="widget-empty">Loading…</p>
      )}

      {!isLoading && !screen && (
        <p className="widget-empty">
          {isCoach
            ? "No screen recorded yet. Run one and this becomes the work list."
            : "No screen recorded yet. Your coach will run one and it'll show up here."}
        </p>
      )}

      {screen && (
        <>
          <div className="sc-top">
            <div className={`sc-count ${work.length ? "has-work" : "clear"}`}>
              <span className="n">{work.length}</span>
              <span className="l">
                {work.length === 1 ? "test to work on" : "tests to work on"}
              </span>
            </div>
            <div className="sc-meta">
              <span className="sc-when">
                {covered === SCREEN_TESTS.length
                  ? "Full screen"
                  : `Spot-check · ${covered} ${covered === 1 ? "test" : "tests"}`}
                {" · "}
                {fmtDate(screen.date)}
              </span>
              <span className="cz-note">
                {clean.length} clean
                {skipped.length > 0 && ` · ${skipped.length} not screened`}
                {painful.length > 0 && ` · ${painful.length} flagged painful`}
              </span>
              <span className="cz-note">{nextUp(plan)}</span>
            </div>
          </div>

          {standingCall && (
            <p className="sc-called" role="status">
              <span className="eyebrow">Re-screen called</span>
              {standingCall.reason} · {fmtDate(standingCall.since)}. Regardless
              of the clock — a new block or a new movement pattern can expose or
              resolve a limitation, so the whole sheet is worth re-asking.
            </p>
          )}

          {moved && (
            <p className="sc-moved">
              <span className="eyebrow">Since each test was last checked</span>
              {[
                moved.cleared > 0 ? `${moved.cleared} cleared` : null,
                moved.appeared > 0 ? `${moved.appeared} new` : null,
                moved.standing > 0 ? `${moved.standing} still standing` : null,
                moved.unchecked > 0 ? `${moved.unchecked} not re-screened` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Nothing moved."}
            </p>
          )}

          {(gaps.standing.length > 0 || gaps.closed.length > 0) && (
            <div className="sc-gaps">
              <div className="eyebrow sc-h">Side to side</div>
              {gaps.standing.map((g) => (
                <div
                  className={`sc-gap${g.optional ? " optional" : ""}`}
                  key={`${g.test.key}.${g.subTest.key}`}
                >
                  <div className="sc-gap-head">
                    <b>{g.test.label}</b>
                    {g.trend && (
                      <span className={`sc-trend t-${g.trend}`}>
                        {GAP_LABEL[g.trend]}
                      </span>
                    )}
                  </div>
                  <span className="cz-note">{g.subTest.label}</span>
                  <div className="sc-gap-sides">
                    {g.sides.map((side) => (
                      <span
                        key={side.side}
                        className={side.side === g.worseSide ? "worse" : ""}
                      >
                        <em>{side.label}</em>
                        {side.finding.label}
                      </span>
                    ))}
                  </div>
                  {g.optional && (
                    <span className="cz-note">
                      Non-throwing arm. Symmetry here is nice to have, not a
                      prerequisite for performance — worth watching, not worth
                      chasing.
                    </span>
                  )}
                </div>
              ))}
              {gaps.closed.length > 0 && (
                <p className="sc-note-good">
                  <b>Levelled up since the last check:</b>{" "}
                  {gaps.closed.map((g) => g.test.label).join(", ")}
                </p>
              )}
            </div>
          )}

          {work.length > 0 ? (
            <>
              <div className="eyebrow sc-h">What to work on</div>
              <ul className="sc-list">
                {work.map((r) => (
                  <ReportRow
                    key={r.test.key}
                    report={r}
                    isOpen={open.has(r.test.key)}
                    onToggle={() => toggle(r.test.key)}
                  />
                ))}
              </ul>
            </>
          ) : (
            <p className="widget-empty">
              Nothing flagged on this screen. Keep the mobility work in the
              warm-up and it stays that way.
            </p>
          )}

          {/*
            * Cleared and carried-over live out here rather than inside the
            * rows, because the tests they belong to have no work on them —
            * a leg that came back clean drops off the work list entirely, and
            * with it the only good news on the screen. Same for a deviation
            * nobody re-screened: it sits under a test marked "not screened",
            * where an athlete would never find it.
            */}
          {hasPrevious && (
            <>
              <CarryBlock title="Cleared since the last check" list={cleared} good />
              <CarryBlock
                title="Left blank this time"
                list={carried}
                note="Recorded as a deviation before, and this screen opened the test but left the reading empty — so nothing here has been shown to have changed either way."
              />
            </>
          )}

          {clean.length > 0 && (
            <p className="sc-clean">
              <b>Clean:</b> {clean.map((r) => r.test.label).join(", ")}
            </p>
          )}
          {skipped.length > 0 && (
            <p className="sc-clean sc-dim">
              <b>Not screened:</b> {skipped.map((r) => r.test.label).join(", ")}
            </p>
          )}

          {isCoach && screen.notes && (
            <div className="insight sc-notes">
              <div className="eyebrow">Coach&apos;s note · not shown to the athlete</div>
              <p>{screen.notes}</p>
            </div>
          )}

          {isCoach && (
            <div className="sc-actions">
              <button className="btn sm ghost" onClick={() => setEditing(screen)}>
                Edit this screen
              </button>
              <CallRescreen
                athleteId={athleteId}
                standing={!!standingCall}
                onCalled={() => {
                  onCalled?.();
                  show("Re-screen called");
                }}
              />
            </div>
          )}
        </>
      )}

      {editing && (
        <ScreenModal
          athleteId={athleteId}
          athleteName={athleteName}
          initial={editing === "new" ? null : editing}
          takenDates={screens.map((s) => s.date)}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            setEditing(null);
            setPickedDate(null);
            await mutate();
            show(msg);
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </section>
  );
}

/**
 * The third trigger, which has no data behind it: a mechanical change with the
 * pitching coach is a conversation. Free text, because "we changed his glove
 * side" is not a value anyone would have put in a list.
 */
function CallRescreen({
  athleteId,
  standing,
  onCalled,
}: {
  athleteId: string;
  standing: boolean;
  onCalled: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (standing)
    return <span className="cz-note">A re-screen is already called.</span>;

  if (!open)
    return (
      <button className="btn sm ghost" onClick={() => setOpen(true)}>
        Call a re-screen
      </button>
    );

  return (
    <div className="sc-call">
      <input
        className="tin sc-call-why"
        placeholder="Why — e.g. new arm slot with Cole"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button
        className="btn sm primary"
        disabled={busy || !reason.trim()}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await api(`/api/athletes/${athleteId}/rescreen`, "POST", {
              reason: reason.trim(),
            });
            setOpen(false);
            setReason("");
            onCalled();
          } catch (e) {
            setErr(e instanceof ApiError ? e.message : "Couldn't call that.");
          }
          setBusy(false);
        }}
      >
        {busy ? "Calling…" : "Call it"}
      </button>
      <button className="btn sm ghost" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {err && (
        <span className="form-error" role="alert">
          {err}
        </span>
      )}
    </div>
  );
}

function ReportRow({
  report,
  isOpen,
  onToggle,
}: {
  report: TestReport;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const trend = rowTrend(report.work);
  const dot = report.mark ?? "none";

  return (
    <li className={`sc-row${isOpen ? " open" : ""}`}>
      <button className="sc-row-head" aria-expanded={isOpen} onClick={onToggle}>
        <span className={`ms-dot ${dot}`} />
        <span className="sc-name">
          {report.test.label}
          <em>{GROUP_TITLE.get(report.test.group)}</em>
        </span>
        {trend && <span className={`sc-trend t-${trend}`}>{TREND_LABEL[trend]}</span>}
        <span className="caret">{isOpen ? "▾" : "▸"}</span>
      </button>

      {isOpen && (
        <div className="sc-row-body">
          <ul className="sc-findings">
            {report.work.map((w) => (
              <li key={w.field.key}>
                <span className="cz-note">{w.field.subTest.label}</span>
                <div className="sc-finding">
                  {sideLabel(w) && <span className="sc-side">{sideLabel(w)}</span>}
                  <b>{w.finding.label}</b>
                </div>
                {w.before && (
                  <span className="cz-note">Previously: {w.before.label}</span>
                )}
              </li>
            ))}
          </ul>

          {report.recorded < report.asked && (
            <span className="cz-note">
              {report.recorded} of {report.asked} readings recorded.
            </span>
          )}
        </div>
      )}
    </li>
  );
}

/** Deviations carried over from the previous screen, named by their test. */
function CarryBlock({
  title,
  list,
  good,
  note,
}: {
  title: string;
  list: Deviation[];
  good?: boolean;
  note?: string;
}) {
  if (!list.length) return null;
  return (
    <div className={`sc-block${good ? " sc-good" : ""}`}>
      <div className="eyebrow">{title}</div>
      <ul>
        {list.map((d) => {
          const side = sideLabel(d);
          return (
            <li key={d.field.key}>
              {d.field.test.label} — {d.finding.label}
              {side && ` (${side.toLowerCase()})`}
            </li>
          );
        })}
      </ul>
      {note && <span className="cz-note">{note}</span>}
    </div>
  );
}
