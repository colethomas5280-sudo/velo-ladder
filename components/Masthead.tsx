import type { Athlete, TrainingSession } from "@/lib/types";
import { EMPTY, fiveOzPR, fmt, fmtDate, sessionsOfType, todayISO } from "@/lib/velo";
import { ageOn } from "@/lib/leaderboard";

export default function Masthead({
  athlete,
  sessions,
  action,
  onOpenSettings,
}: {
  athlete: Athlete;
  sessions: TrainingSession[];
  /** Optional control rendered directly under the name (e.g. "Track a new session"). */
  action?: React.ReactNode;
  /** Shown as a cog next to the identity row when the viewer may edit this profile. */
  onOpenSettings?: () => void;
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
          {athlete.inviteEmail ? (
            <a href={`mailto:${athlete.inviteEmail}`}>{athlete.inviteEmail}</a>
          ) : (
            <span>no email set</span>
          )}
          <span>{age != null ? `${age} yrs` : EMPTY}</span>
          <span>{athlete.heightIn != null ? `${fmt(athlete.heightIn)} in` : EMPTY}</span>
          <span>{athlete.weightLb != null ? `${fmt(athlete.weightLb)} lb` : EMPTY}</span>
          <span>Bats {athlete.bats || EMPTY}</span>
          <span>Throws {athlete.hand || EMPTY}</span>
          {onOpenSettings && (
            <button
              className="mast-cog"
              onClick={onOpenSettings}
              aria-label="Edit profile settings"
              title="Edit profile settings"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          )}
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
