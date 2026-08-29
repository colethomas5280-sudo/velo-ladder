import type { Athlete, TrainingSession } from "@/lib/types";
import { fiveOzPR, fmt, fmtDate, sessionsOfType } from "@/lib/velo";

export default function Masthead({
  athlete,
  sessions,
  action,
}: {
  athlete: Athlete;
  sessions: TrainingSession[];
  /** Optional control rendered directly under the name (e.g. "Track a new session"). */
  action?: React.ReactNode;
}) {
  const mCount = sessionsOfType(sessions, "mound").length;
  const pCount = sessionsOfType(sessions, "pulldown").length;
  const latest = [...sessions].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const mPR = fiveOzPR(sessions, "mound");
  const pPR = fiveOzPR(sessions, "pulldown");

  return (
    <div className="mast">
      <div>
        <div className="eyebrow">Velocity development</div>
        <h2>{athlete.name}</h2>
        <div className="meta">
          <span>
            <b>{mCount}</b> mound
          </span>
          <span>
            <b>{pCount}</b> pull-down
          </span>
          <span>
            last session <b>{latest ? fmtDate(latest.date) : "–"}</b>
          </span>
          {athlete.hand && (
            <span>
              <b>{athlete.hand}</b>HP
            </span>
          )}
        </div>
        {action}
      </div>
      <div className="readouts">
        <div className="ro">
          <div className="n">{fmt(mPR)}</div>
          <div className="l">Mound 5oz PR</div>
        </div>
        <div className="ro">
          <div className="n">{fmt(pPR)}</div>
          <div className="l">Pull-Down 5oz PR</div>
        </div>
      </div>
    </div>
  );
}
