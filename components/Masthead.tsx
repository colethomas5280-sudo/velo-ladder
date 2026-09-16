import type { Athlete, TrainingSession } from "@/lib/types";
import { EMPTY, fiveOzPR, fmt, fmtDate, sessionsOfType, todayISO } from "@/lib/velo";
import { ageOn } from "@/lib/leaderboard";

export default function Masthead({
  athlete,
  sessions,
  action,
  onLogRecovery,
}: {
  athlete: Athlete;
  sessions: TrainingSession[];
  /** Optional control rendered directly under the name (e.g. "Track a new session"). */
  action?: React.ReactNode;
  /** Shown above the PR tiles when the viewer may log recovery for this athlete. */
  onLogRecovery?: () => void;
}) {
  const mCount = sessionsOfType(sessions, "mound").length;
  const pCount = sessionsOfType(sessions, "pulldown").length;
  const latest = [...sessions].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const mPR = fiveOzPR(sessions, "mound");
  const pPR = fiveOzPR(sessions, "pulldown");
  const age = athlete.birthDate ? ageOn(athlete.birthDate, todayISO()) : null;

  return (
    <div className="mast">
      <div>
        <div className="eyebrow">Velocity development</div>
        <h2>{athlete.name}</h2>
        <div className="mast-id">
          <div className="mast-id-item">
            <span className="mast-id-label">Email</span>
            {athlete.inviteEmail ? (
              <a href={`mailto:${athlete.inviteEmail}`}>{athlete.inviteEmail}</a>
            ) : (
              <span>no email set</span>
            )}
          </div>
          <div className="mast-id-item">
            <span className="mast-id-label">Age</span>
            <span>{age != null ? `${age} yrs` : EMPTY}</span>
          </div>
          <div className="mast-id-item">
            <span className="mast-id-label">Height</span>
            <span>{athlete.heightIn != null ? `${fmt(athlete.heightIn)} in` : EMPTY}</span>
          </div>
          <div className="mast-id-item">
            <span className="mast-id-label">Weight</span>
            <span>{athlete.weightLb != null ? `${fmt(athlete.weightLb)} lb` : EMPTY}</span>
          </div>
          <div className="mast-id-item">
            <span className="mast-id-label">Bats</span>
            <span>{athlete.bats || EMPTY}</span>
          </div>
          <div className="mast-id-item">
            <span className="mast-id-label">Throws</span>
            <span>{athlete.hand || EMPTY}</span>
          </div>
        </div>
        <div className="meta">
          <span>
            <b>{mCount}</b> mound
          </span>
          <span>
            <b>{pCount}</b> pull-down
          </span>
          <span>
            last session <b>{latest ? fmtDate(latest.date) : EMPTY}</b>
          </span>
          {athlete.hand && (
            <span>
              <b>{athlete.hand}</b>HP
            </span>
          )}
        </div>
        {action}
      </div>
      <div className="mast-readouts">
        {onLogRecovery && (
          <button className="btn sm primary" onClick={onLogRecovery}>
            + Log Recovery
          </button>
        )}
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
    </div>
  );
}
