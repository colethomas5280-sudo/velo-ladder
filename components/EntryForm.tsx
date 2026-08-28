"use client";

import type { TrainingSession } from "@/lib/types";
import {
  type TrackerConfig,
  groupOf,
  recStatsG,
  lastBest,
  sessionsOfType,
  num,
  mean,
  fmt,
  todayISO,
} from "@/lib/velo";
import type { Draft } from "@/lib/draft";

export default function EntryForm({
  cfg,
  trackerId,
  sessions,
  draft,
  setDraft,
  onSave,
  onClear,
  saving,
  readOnly,
}: {
  cfg: TrackerConfig;
  trackerId: "mound" | "pulldown";
  sessions: TrainingSession[];
  draft: Draft;
  setDraft: (next: Draft) => void;
  onSave: () => void;
  onClear: () => void;
  saving: boolean;
  readOnly: boolean;
}) {
  const ss = sessionsOfType(sessions, trackerId);
  const editing = !!draft.editingId;

  const setCell = (key: string, i: number, raw: string) => {
    const v = raw.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
    const arr = draft.throws[key]?.slice() ?? ["", "", "", ""];
    arr[i] = v;
    setDraft({ ...draft, throws: { ...draft.throws, [key]: arr } });
  };

  const sessionTop = (() => {
    const tops: number[] = [];
    for (const sl of cfg.slots) {
      const t = draft.throws[sl.key] || [];
      const h = [1, 2, 3].map((i) => num(t[i])).filter((v): v is number => !!v);
      if (h.length) tops.push(Math.max(...h));
    }
    return tops.length ? Math.max(...tops) : null;
  })();

  return (
    <div className="card pad">
      <div className="sec-h">
        <h3>{editing ? "Edit session" : `New ${cfg.label} session`}</h3>
        <span className="sub">{cfg.tag}</span>
      </div>

      <div className="entry-top">
        <div className="field">
          <label>Session date</label>
          <input
            type="date"
            value={draft.date || todayISO()}
            disabled={readOnly}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
          />
        </div>
        {editing && <span className="editing-flag">● editing existing entry</span>}
      </div>

      <div className="lanes">
        {cfg.slots.map((sl) => {
          const t = draft.throws[sl.key] || [];
          const grp = groupOf(cfg, sl.key);
          const pr = recStatsG(ss, grp.keys).pr;
          const last = lastBest(ss, grp.keys, draft.editingId);
          const h = [1, 2, 3].map((i) => num(t[i])).filter((v): v is number => !!v);
          const liveMax = h.length ? Math.max(...h) : null;
          const beat = pr != null && liveMax != null && liveMax > pr;
          return (
            <div className="lane" key={sl.key}>
              <div className="lane-h">
                <span className="oz">{sl.oz}</span>
                <span className="u">oz</span>
                <span className="tag">{sl.tag || " "}</span>
              </div>
              {[0, 1, 2, 3].map((i) => (
                <div className={`throw${i === 0 ? " warm" : ""}`} key={i}>
                  <label>{i === 0 ? "80%" : i}</label>
                  <input
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="·"
                    disabled={readOnly}
                    value={t[i] ?? ""}
                    onChange={(e) => setCell(sl.key, i, e.target.value)}
                  />
                </div>
              ))}
              <div className="lane-ref">
                last <b>{fmt(last, 0)}</b> ·{" "}
                <span className="pr">PR {fmt(pr, 0)}</span>
              </div>
              <div className="lane-stat">
                {h.length > 0 && (
                  <>
                    max <b>{fmt(liveMax, 0)}</b> · avg {fmt(mean(h), 1)}
                    {beat && <span className="pr-hit"> new PR</span>}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="legend">
        <b>Box 80%</b> is the primer — not scored. <b>Boxes 1–3</b> are 100% intent
        and set the PR, average, and velocity floor.
      </p>

      <div className="field" style={{ marginTop: 14 }}>
        <label>Notes (optional)</label>
        <textarea
          placeholder="Cues, how it felt, arm condition…"
          disabled={readOnly}
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </div>

      {!readOnly && (
        <div className="row-actions">
          <button className="btn primary" onClick={onSave} disabled={saving}>
            {saving
              ? "Saving…"
              : editing
                ? "Update session"
                : "Save session"}
          </button>
          <button className="btn ghost" onClick={onClear} disabled={saving}>
            {editing ? "Cancel" : "Clear"}
          </button>
          {sessionTop != null && (
            <span className="note">session top: {fmt(sessionTop, 0)}</span>
          )}
        </div>
      )}
    </div>
  );
}
