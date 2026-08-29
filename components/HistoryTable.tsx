import { Fragment } from "react";
import type { TrainingSession } from "@/lib/types";
import {
  type TrackerConfig,
  gid,
  recStatsG,
  sBestG,
  sAvg,
  sessionsOfType,
  fmt,
  fmtDate,
} from "@/lib/velo";

export default function HistoryTable({
  cfg,
  trackerId,
  sessions,
  expanded,
  toggle,
  onEdit,
  onDelete,
  onExport,
  readOnly,
}: {
  cfg: TrackerConfig;
  trackerId: "mound" | "pulldown";
  sessions: TrainingSession[];
  expanded: Set<string>;
  toggle: (id: string) => void;
  onEdit: (s: TrainingSession) => void;
  onDelete: (s: TrainingSession) => void;
  onExport: () => void;
  readOnly: boolean;
}) {
  const chrono = sessionsOfType(sessions, trackerId);
  const rows = [...chrono].reverse();
  const prByGroup: Record<string, number | null> = {};
  cfg.groups.forEach((gp) => {
    prByGroup[gid(gp)] = recStatsG(chrono, gp.keys).pr;
  });
  const colSpan = cfg.groups.length + 1 + (readOnly ? 0 : 1);

  return (
    <div className="card pad hist-card">
      <div className="sec-h">
        <h3>Session history</h3>
        <span className="sub">
          {rows.length} session{rows.length === 1 ? "" : "s"}
          {rows.length ? " · tap a row" : ""}
        </span>
      </div>

      {!rows.length ? (
        <p style={{ color: "var(--ink-dim)", fontSize: 13 }}>
          No {cfg.label.toLowerCase()} sessions logged yet. Fill the lanes above and
          hit <b>Save session</b>.
        </p>
      ) : (
        <>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  {cfg.groups.map((gp) => (
                    <th key={gid(gp)}>{gp.oz}oz</th>
                  ))}
                  {!readOnly && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const open = expanded.has(s.id);
                  return (
                    <Fragment key={s.id}>
                      <tr
                        className={`sess${open ? " open" : ""}`}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("button")) return;
                          toggle(s.id);
                        }}
                      >
                        <td className="date">
                          <span className="caret" />
                          {fmtDate(s.date)}
                        </td>
                        {cfg.groups.map((gp) => {
                          const b = sBestG(s, gp.keys);
                          const pr = prByGroup[gid(gp)];
                          const isPr = b != null && pr != null && b >= pr;
                          return (
                            <td key={gid(gp)}>
                              <span className={isPr ? "v is-pr" : "v"}>
                                {fmt(b, 0)}
                              </span>
                            </td>
                          );
                        })}
                        {!readOnly && (
                          <td className="act">
                            <button
                              className="btn sm ghost"
                              onClick={() => onEdit(s)}
                            >
                              Edit
                            </button>{" "}
                            <button
                              className="btn sm danger"
                              onClick={() => onDelete(s)}
                            >
                              Del
                            </button>
                          </td>
                        )}
                      </tr>
                      {open && (
                        <tr className="detail">
                          <td colSpan={colSpan}>
                            <div className="mini">
                              {cfg.slots.map((sl) => {
                                const t = s.throws[sl.key];
                                if (!t)
                                  return (
                                    <div key={sl.key}>
                                      {sl.oz}oz <b>–</b>
                                    </div>
                                  );
                                const primer = t[0] == null ? "–" : t[0];
                                const hs = [1, 2, 3]
                                  .map((i) => (t[i] == null ? "–" : t[i]))
                                  .join("  ");
                                return (
                                  <div key={sl.key}>
                                    {sl.oz}oz&nbsp; 80%: <b>{primer}</b> &nbsp; 100%:{" "}
                                    <b>{hs}</b> &nbsp; avg{" "}
                                    <b>{fmt(sAvg(s, sl.key), 1)}</b>
                                  </div>
                                );
                              })}
                            </div>
                            {s.notes && (
                              <div className="notes">&ldquo;{s.notes}&rdquo;</div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row-actions">
            <button className="btn sm ghost" onClick={onExport}>
              Export CSV
            </button>
          </div>
        </>
      )}
    </div>
  );
}
