"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { AthleteOverview } from "@/lib/types";
import { fetcher } from "@/lib/fetcher";
import type { TestType } from "@/lib/testDraft";
import AthletePicker from "./AthletePicker";
import GroupSession from "./GroupSession";
import GroupTest from "./GroupTest";
import RecordChooser from "./RecordChooser";

/*
 * Start a session or a test from the homepage. The athlete list is fetched
 * only once a picker is wanted, so the homepage itself costs nothing extra.
 * The picker and the run screens render only once that list has arrived: a
 * roster that is still loading is not an empty one.
 */

type Flow = "session" | TestType;

type Step =
  | { kind: "idle" }
  | { kind: "choose-test" }
  | { kind: "pick"; flow: Flow }
  | { kind: "run"; flow: Flow; ids: string[] };

const REFRESH_KEYS = ["/api/dashboard", "/api/screens/overview", "/api/delivery/overview"];

export default function QuickStart() {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const { mutate } = useSWRConfig();
  const wantsList = step.kind === "pick" || step.kind === "run";
  const {
    data,
    error,
    mutate: reload,
  } = useSWR<AthleteOverview[]>(wantsList ? "/api/athletes/overview" : null, fetcher);
  const people = (data ?? [])
    .filter((a) => !a.archived)
    .map((a) => ({ id: a.id, name: a.name }));

  const refresh = async () => {
    for (const key of REFRESH_KEYS) {
      try {
        await mutate(key);
      } catch {
        /* a refresh that fails must never get in the way of the coach */
      }
    }
  };
  const idle = () => setStep({ kind: "idle" });
  const closeRun = () => {
    idle();
    void refresh();
  };

  return (
    <>
      <div className="quick-start">
        <button
          className="quick-btn"
          onClick={() => setStep({ kind: "pick", flow: "session" })}
        >
          <span className="quick-name">Track a new session</span>
          <span className="quick-tag">Mound or pulldown, for one athlete or several.</span>
        </button>
        <button className="quick-btn" onClick={() => setStep({ kind: "choose-test" })}>
          <span className="quick-name">Track a new test</span>
          <span className="quick-tag">Movement screen or Pitching Inhibitors.</span>
        </button>
      </div>

      {step.kind === "choose-test" && (
        <RecordChooser
          title="Track a new test"
          onClose={idle}
          onPick={(kind) => setStep({ kind: "pick", flow: kind })}
        />
      )}

      {wantsList && !data && (
        <ListStatus
          title={step.flow === "session" ? "Who is in this session?" : "Who is being tested?"}
          failed={!!error}
          onRetry={() => void reload()}
          onClose={idle}
        />
      )}

      {step.kind === "pick" && data && (
        <AthletePicker
          title={step.flow === "session" ? "Who is in this session?" : "Who is being tested?"}
          startLabel={(n) =>
            step.flow === "session"
              ? n
                ? `Start session with ${n}`
                : "Start session"
              : n
                ? `Start test with ${n}`
                : "Start test"
          }
          people={people}
          onClose={idle}
          onStart={(ids) => setStep({ kind: "run", flow: step.flow, ids })}
        />
      )}

      {step.kind === "run" && data && step.flow === "session" && (
        <GroupSession people={people} ids={step.ids} onSaved={refresh} onClose={closeRun} />
      )}

      {step.kind === "run" && data && step.flow !== "session" && (
        <GroupTest
          type={step.flow}
          people={people}
          ids={step.ids}
          onSaved={refresh}
          onClose={closeRun}
        />
      )}
    </>
  );
}

/** What stands in for the picker while the athlete list loads or fails to. */
function ListStatus({
  title,
  failed,
  onRetry,
  onClose,
}: {
  title: string;
  failed: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel narrow"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="picker">
          {failed ? (
            <>
              <p className="picker-empty">Couldn&apos;t load your athletes.</p>
              <button type="button" className="btn" onClick={onRetry}>
                Retry
              </button>
            </>
          ) : (
            <p className="picker-empty">Loading athletes…</p>
          )}
        </div>
      </div>
    </div>
  );
}
