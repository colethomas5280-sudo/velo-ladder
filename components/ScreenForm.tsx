"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import type { MovementScreen, TrainingSession } from "@/lib/types";
import { api, ApiError, fetcher } from "@/lib/fetcher";
import {
  NOT_TESTED,
  SCREEN_GROUPS,
  SCREEN_TESTS,
  alerts,
  fillNormal,
  isApplicable,
  screenCounts,
  screenFields,
  sessionsOn,
  sidesOf,
  subTestFindings,
  testMark,
  type Results,
  type ScreenTest,
  type SubTest,
  type TestMark,
} from "@/lib/screen";
import { TRACKERS, todayISO, fmtDate } from "@/lib/velo";
import { saveTestDraft, clearTestDraft, type TestDraft } from "@/lib/testDraft";

/* ------------------------------------------------------------------ *
 * Recording a movement screen
 *
 * Seventeen tests, thirty-five questions before anything branches. The form
 * opens collapsed so it reads as a checklist rather than a wall: a coach works
 * one test at a time in the gym, which is how the OnBaseU app presents it too,
 * and the row of marks doubles as the summary when reviewing an old screen.
 *
 * Nothing is answered for the coach. A blank reading stays out of the record
 * entirely rather than being stored as a normal nobody observed — "All normal"
 * is a button they press, not a default they have to notice and undo.
 * ------------------------------------------------------------------ */

/** How many readings in this test are answered, and how many were asked. */
function tally(test: ScreenTest, results: Results) {
  const fields = screenFields([test]).filter((f) => isApplicable(f, results));
  return { done: fields.filter((f) => results[f.key]).length, total: fields.length };
}

const MARK_LABEL: Record<TestMark, string> = {
  green: "Green",
  yellow: "Yellow",
  red: "Red",
  alert: "Painful",
};

/**
 * What "unchanged" is compared as. Key order must not matter: clearing a
 * reading and answering it again moves its key to the end of the object.
 */
function stable(results: Results, notes: string): string {
  const sorted = Object.fromEntries(
    Object.entries(results).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return JSON.stringify({ results: sorted, notes });
}

export default function ScreenForm({
  athleteId,
  initial,
  takenDates,
  onSaved,
  onCancel,
  group = false,
  draft = null,
  persist = false,
  onDirty,
  register,
}: {
  athleteId: string;
  /** The screen this opens on, today's if one was already recorded. */
  initial: MovementScreen | null;
  /** Dates that already hold a screen, so a new one can warn before it lands on one. */
  takenDates: string[];
  onSaved: (msg: string) => void;
  /** Renders a Cancel button when given. */
  onCancel?: () => void;
  /** Group mode: no Cancel and no Delete (deleting stays on the athlete's own page). */
  group?: boolean;
  /** Unsaved answers to start from, restored after a reload. */
  draft?: TestDraft | null;
  /** Keep a draft in the browser while there are unsaved answers. */
  persist?: boolean;
  /**
   * Told whenever "has unsaved changes" flips. Called from an effect, so keep
   * it cheap and idempotent.
   */
  onDirty?: (dirty: boolean) => void;
  /**
   * Gives a parent a way to trigger Save; resolves true on success. It is
   * called after EVERY render with the latest closure, so a parent must keep
   * the function in a ref, never in state (that would loop).
   */
  register?: (save: () => Promise<boolean>) => void;
}) {
  /*
   * State, not a prop, because the coach can step off it. A screen is
   * identified by its date, so editing one holds the date still — but landing
   * on today's screen must not be a dead end for someone entering Saturday's
   * on Monday, hence "record a different date" below.
   */
  // The saved record is only the one being edited if the draft (when there is
  // one) is for the same date. A draft for another date is a new screen.
  const [editing] = useState(() =>
    initial && initial.date === (draft?.date ?? initial.date) ? initial : null,
  );
  const [existing, setExisting] = useState<MovementScreen | null>(editing);
  const [date, setDate] = useState(draft?.date ?? editing?.date ?? todayISO());
  const [results, setResults] = useState<Results>(
    (draft?.data as Results | undefined) ?? editing?.results ?? {},
  );
  const [notes, setNotes] = useState(draft ? draft.notes : (editing?.notes ?? ""));
  const [justSaved, setJustSaved] = useState(false);
  // What "unchanged" means: the saved record (or blank), moved forward after each save.
  const [baseline, setBaseline] = useState(() =>
    stable(editing?.results ?? {}, editing?.notes ?? ""),
  );
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  /*
   * Screen fresh, not post-throwing: shoulder and thoracic readings sit low
   * after a bullpen, and a screen taken then records a limitation the athlete
   * doesn't have on Wednesday. Only the DAY is stored, never the hour, so the
   * note asks rather than asserts — a screen taken that morning is fine.
   */
  const { data: sessionData } = useSWR<TrainingSession[]>(
    `/api/athletes/${athleteId}/sessions`,
    fetcher,
  );
  const threw = useMemo(() => {
    const on = sessionsOn(sessionData ?? [], date);
    // Two bullpens in a day shouldn't read "mound and mound".
    const kinds = [...new Set(on.map((s) => s.type))];
    return { count: on.length, kinds };
  }, [sessionData, date]);

  const counts = useMemo(() => screenCounts(results), [results]);
  const flagged = useMemo(() => alerts(results), [results]);
  const asked = counts.normal + counts.deviation + counts.notTested + counts.blank;
  const answered = asked - counts.blank;

  /*
   * What "mark the rest normal" would actually assert, named on the button —
   * a coach who has run three tests should see the number that gives it away.
   *
   * Counted in TESTS rather than readings, because filling a gate opens the
   * branch beneath it: the reading count would come out higher than the
   * "n of m recorded" line beside it and read as a contradiction.
   *
   * And counted by what the button would actually change, not by what is
   * unanswered. A test sitting on an open branch with no normal answer — one
   * leg short of the bat, waiting on the pelvis-held reading — can never be
   * completed this way, and a button that keeps offering to finish it is
   * offering nothing.
   */
  const untouched = useMemo(
    () =>
      SCREEN_TESTS.filter(
        (t) =>
          Object.keys(fillNormal(results, [t])).length > Object.keys(results).length,
      ).length,
    [results],
  );

  const clash = !existing && !justSaved && takenDates.includes(date);

  const setField = (key: string, value: string) =>
    setResults((prev) => {
      const next = { ...prev };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const dirty = stable(results, notes) !== baseline;

  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);

  // A draft exists only while there are unsaved answers, so an empty or
  // back-to-saved form leaves nothing behind to date a later test wrongly.
  useEffect(() => {
    if (!persist) return;
    if (dirty && Object.keys(results).length > 0) {
      saveTestDraft("screen", athleteId, { date, notes, data: results });
    } else {
      clearTestDraft("screen", athleteId);
    }
  }, [persist, dirty, results, notes, date, athleteId]);

  async function save(): Promise<boolean> {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/athletes/${athleteId}/screens`, "POST", {
        date,
        results,
        notes: notes.trim(),
      });
      const updating = !!existing || justSaved;
      setJustSaved(true);
      setBaseline(stable(results, notes));
      setBusy(false);
      onSaved(updating ? "Screen updated" : "Screen saved");
      return true;
    } catch (e) {
      setErr(
        e instanceof ApiError ? e.message : "Couldn't save that. Check your connection.",
      );
      setBusy(false);
      return false;
    }
  }

  // Re-registered every render so a parent always calls the latest closure.
  useEffect(() => {
    register?.(save);
  });

  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/athletes/${athleteId}/screens?date=${date}`, "DELETE");
      onSaved("Screen deleted");
    } catch (e) {
      setErr(
        e instanceof ApiError ? e.message : "Couldn't delete that. Check your connection.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="ms">
      <div className="ms-top">
        <label className="field">
          <span>Date</span>
          <input
            type="date"
            value={date}
            max={todayISO()}
            disabled={!!existing || justSaved}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <div className="ms-progress">
          <b>
            {answered} of {asked}
          </b>
          <span>readings recorded</span>
        </div>
      </div>

      {existing && (
        <p className="ms-note">
          Editing the screen from {fmtDate(existing.date)}. The date is what
          identifies it.
          {/* Group mode has no Delete and a reset would leave a blank form over a saved screen. */}
          {!group && (
            <>
              {" "}
              To move a screen, delete it and record it again.{" "}
              <button
                className="linkish"
                onClick={() => {
                  setExisting(null);
                  setResults({});
                  setNotes("");
                  setConfirmDelete(false);
                }}
              >
                Record a different date instead
              </button>
            </>
          )}
        </p>
      )}
      {threw.count > 0 && (
        <p className="ms-note warn" role="status">
          <b>
            Threw on this date:{" "}
            {threw.kinds
              .map((k) => TRACKERS[k].label.toLowerCase())
              .join(" and ")}
            .
          </b>{" "}
          If the screen came after, the shoulder and thoracic readings will
          sit low. Worth recording anyway, and worth knowing it isn&rsquo;t a
          fresh number.
        </p>
      )}

      {clash && (
        <p className="ms-note warn" role="status">
          A screen already exists for {fmtDate(date)}. Saving will
          replace it.
        </p>
      )}

      {SCREEN_GROUPS.map((sg) => {
        const tests = SCREEN_TESTS.filter((t) => t.group === sg.id);
        if (!tests.length) return null;
        return (
          <div className="ms-group" key={sg.id}>
            <div className="eyebrow">{sg.title}</div>
            {tests.map((test) => (
              <TestCard
                key={test.key}
                test={test}
                results={results}
                isOpen={open.has(test.key)}
                onToggle={() => toggle(test.key)}
                onField={setField}
                onAllNormal={() =>
                  setResults((prev) => fillNormal(prev, [test]))
                }
              />
            ))}
          </div>
        );
      })}

      {flagged.length > 0 && (
        <p className="ms-note warn">
          {flagged.length === 1 ? "One reading is" : `${flagged.length} readings are`}{" "}
          marked painful. Those replace the colour rather than joining the scale.
        </p>
      )}

      <label className="field">
        <span>Notes (coach only, never shown to the athlete)</span>
        <textarea
          placeholder="Guarding on the left, suspect he's protecting the shoulder…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>

      {err != null && (
        <p className="form-error" role="alert">
          {err || "Couldn't save that."}
        </p>
      )}

      <div className="ms-actions">
        <button className="btn primary" disabled={busy} onClick={save}>
          {busy ? "Saving…" : existing || justSaved ? "Update screen" : "Save screen"}
        </button>
        {untouched > 0 && (
          <button
            className="btn"
            disabled={busy}
            onClick={() => setResults((prev) => fillNormal(prev))}
          >
            Mark {untouched} remaining {untouched === 1 ? "test" : "tests"} normal
          </button>
        )}
        {onCancel && !group && (
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        {existing &&
          !group &&
          (confirmDelete ? (
            <button className="btn danger" disabled={busy} onClick={remove}>
              Really delete?
            </button>
          ) : (
            <button
              className="btn ghost ms-del"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </button>
          ))}
      </div>
    </div>
  );
}

function TestCard({
  test,
  results,
  isOpen,
  onToggle,
  onField,
  onAllNormal,
}: {
  test: ScreenTest;
  results: Results;
  isOpen: boolean;
  onToggle: () => void;
  onField: (key: string, value: string) => void;
  onAllNormal: () => void;
}) {
  const mark = testMark(test, results);
  const { done, total } = tally(test, results);
  // Offered only while it would do something — see the footer button's note.
  const canFill =
    Object.keys(fillNormal(results, [test])).length > Object.keys(results).length;

  return (
    <section className={`ms-test${isOpen ? " open" : ""}`}>
      <div>
        <button
          className="ms-test-toggle"
          aria-expanded={isOpen}
          onClick={onToggle}
        >
          <span className={`ms-dot ${mark ?? "none"}`} />
          <span className="ms-test-name">{test.label}</span>
          <span className="ms-mark">{mark ? MARK_LABEL[mark] : ""}</span>
          <span className="ms-count">
            {done}/{total}
          </span>
          <span className="caret">{isOpen ? "▾" : "▸"}</span>
        </button>
      </div>

      {isOpen && (
        <div className="ms-test-body">
          {/*
            * Outside the toggle button on purpose: a link nested in a button
            * is neither valid markup nor reliably clickable.
            */}
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
          {test.subTests.map((subTest) => (
            <Question
              key={subTest.key}
              test={test}
              subTest={subTest}
              results={results}
              onField={onField}
            />
          ))}
          {canFill && (
            <button className="btn sm ms-normal" onClick={onAllNormal}>
              All normal
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Question({
  test,
  subTest,
  results,
  onField,
}: {
  test: ScreenTest;
  subTest: SubTest;
  results: Results;
  onField: (key: string, value: string) => void;
}) {
  const sides = sidesOf(subTest);
  const fields = screenFields([test]).filter(
    (f) => f.subTest.key === subTest.key && isApplicable(f, results),
  );
  // A branch nobody opened is not a blank question, it is a question that was
  // never asked — so it is absent rather than disabled.
  if (!fields.length) return null;

  const options = subTestFindings(subTest);

  return (
    <div className="ms-q">
      <div className="ms-q-label">
        <b>{subTest.label}</b>
        {subTest.help && <span className="ms-help">{subTest.help}</span>}
      </div>
      <div className={`ms-answers${sides.length ? " sided" : ""}`}>
        {fields.map((f) => {
          const side = sides.find((s) => s.key === f.side);
          return (
            <label className="ms-answer" key={f.key}>
              {side && <span className="ms-side">{side.label}</span>}
              <select
                className="ms-select"
                aria-label={
                  side ? `${subTest.label} · ${side.label}` : subTest.label
                }
                value={results[f.key] ?? ""}
                onChange={(e) => onField(f.key, e.target.value)}
              >
                <option value="">Not recorded</option>
                {options.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
                {/*
                  * A diagnostic question records context, not a reading, so
                  * "not tested" says nothing "not recorded" hasn't already —
                  * and reads as nonsense against "where was this tested?".
                  */}
                {!subTest.diagnostic && (
                  <option value={NOT_TESTED}>Not tested</option>
                )}
              </select>
            </label>
          );
        })}
      </div>
    </div>
  );
}
