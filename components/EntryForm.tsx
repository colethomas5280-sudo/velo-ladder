"use client";

import type { TrainingSession } from "@/lib/types";
import {
  type TrackerConfig,
  groupOf,
  prWithDate,
  lastBest,
  sessionsOfType,
  num,
  mean,
  fmt,
  fmtDate,
  todayISO,
  BOX_INDEXES,
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
  groupSize = 0,
  onSaveAll,
  activeName,
  error,
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
  groupSize?: number;
  onSaveAll?: () => void;
  activeName?: string;
  /** Save failure, shown in place until the next attempt. */
  error?: string | null;
}) {
  const ss = sessionsOfType(sessions, trackerId);
  const editing = !!draft.editingId;

  const setCell = (key: string, i: number, raw: string) => {
    // digits and one dot only, and at most one decimal place — what is stored
    // should always be exactly what the lane displays. A trailing "." is left
    // alone so "94." is typeable on the way to "94.9".
    const v = raw
      .replace(/[^0-9.]/g, "")
      .replace(/(\..*)\./g, "$1")
      .replace(/^(\d*\.\d).+$/, "$1");
    const arr = draft.throws[key]?.slice() ?? BOX_INDEXES.map(() => "");
    arr[i] = v;
    setDraft({ ...draft, throws: { ...draft.throws, [key]: arr } });
  };

  const sessionTop = (() => {
    const tops: number[] = [];
    for (const sl of cfg.slots) {
      const t = draft.throws[sl.key] || [];
      const h = BOX_INDEXES.slice(1).map((i) => num(t[i])).filter((v): v is number => !!v);
      if (h.length) tops.push(Math.max(...h));
    }
    return tops.length ? Math.max(...tops) : null;
  })();

  return (
    <div className="card pad">
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
          const pr = prWithDate(ss, grp.keys);
          const last = lastBest(ss, grp.keys, draft.editingId);
          const h = BOX_INDEXES.slice(1).map((i) => num(t[i])).filter((v): v is number => !!v);
          const liveMax = h.length ? Math.max(...h) : null;
          const beat = pr != null && liveMax != null && liveMax > pr.value;
          return (
            <div className="lane" key={sl.key}>
              <div className="lane-h">
                <span className="oz">{sl.oz}</span>
                <span className="u">oz</span>
                {sl.tag && <span className="tag">{sl.tag}</span>}
              </div>
              {BOX_INDEXES.map((i) => (
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
              <div className="lane-rec">
                <div
                  className="s"
                  data-date={last ? fmtDate(last.date) : undefined}
                >
                  <span className="v">{fmt(last?.value)}</span>
                  <span className="k">Last</span>
                </div>
                <div
                  className="s pr"
                  data-date={pr ? fmtDate(pr.date) : undefined}
                >
                  <span className="v">{fmt(pr?.value)}</span>
                  <span className="k">PR</span>
                </div>
              </div>
              <div className="lane-stat">
                {h.length > 0 && (
                  <>
                    max <b>{fmt(liveMax)}</b> · avg {fmt(mean(h))}
                    {beat && <span className="pr-hit"> new PR</span>}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="legend">
        <b>PLEASE READ:</b> Throw a regulation ball (5oz) for 1 rep at 80% effort
        to lock in timing, then 3-4 reps at 100%. Repeat that same pattern (1 rep
        @ 80%, then 3-4 @ 100%) through the 6 oz, 7 oz, back to 5oz, 4 oz, and
        finally 3 oz weighted balls, in that exact order. Track each throw as
        you go.
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

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {!readOnly && (
        <div className="row-actions">
          {groupSize >= 2 && onSaveAll ? (
            <>
              <button
                className="btn primary"
                onClick={onSaveAll}
                disabled={saving}
              >
                {saving ? "Saving…" : `Save all ${groupSize}`}
              </button>
              <button className="btn ghost" onClick={onSave} disabled={saving}>
                {editing
                  ? "Update this one"
                  : `Save ${activeName ?? "this one"} only`}
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={onSave} disabled={saving}>
              {saving
                ? "Saving…"
                : editing
                  ? "Update session"
                  : "Save session"}
            </button>
          )}
          <button className="btn ghost" onClick={onClear} disabled={saving}>
            {editing ? "Cancel" : "Clear"}
          </button>
          {sessionTop != null && (
            <span className="note">session top: {fmt(sessionTop)}</span>
          )}
        </div>
      )}
    </div>
  );
}
