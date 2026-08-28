import type { TrainingSession } from "@/lib/types";
import {
  type TrackerConfig,
  recStatsG,
  sBestG,
  sessionsOfType,
  fmt,
} from "@/lib/velo";

function Spark({ vals }: { vals: number[] }) {
  if (vals.length < 2)
    return <svg className="spark" viewBox="0 0 100 26" preserveAspectRatio="none" />;
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const rng = mx - mn || 1;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * 100;
    const y = 24 - ((v - mn) / rng) * 22;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const [lx, ly] = pts[pts.length - 1].split(",");
  return (
    <svg className="spark" viewBox="0 0 100 26" preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke="var(--chalk)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        points={pts.join(" ")}
      />
      <circle cx={lx} cy={ly} r="2.4" fill="var(--accent)" />
    </svg>
  );
}

export default function RecordsPanel({
  cfg,
  trackerId,
  sessions,
}: {
  cfg: TrackerConfig;
  trackerId: "mound" | "pulldown";
  sessions: TrainingSession[];
}) {
  const ss = sessionsOfType(sessions, trackerId);
  return (
    <div className="card pad">
      <div className="sec-h">
        <h3>Personal records</h3>
        <span className="sub">{cfg.label} · 100% only</span>
      </div>
      <div className="rec">
        {cfg.groups.map((gp) => {
          const r = recStatsG(ss, gp.keys);
          const bests = ss
            .map((s) => sBestG(s, gp.keys))
            .filter((v): v is number => v != null);
          return (
            <div className="rec-item" key={gp.keys.join("+")}>
              <div className="rec-top">
                <div className="rec-oz">
                  {gp.oz}
                  <small>{gp.keys.length > 1 ? "oz · both sets" : "oz"}</small>
                </div>
                <div className="trio">
                  <div className="stat pr">
                    <div className="v">{fmt(r.pr, 0)}</div>
                    <div className="k">PR</div>
                  </div>
                  <div className="stat">
                    <div className="v">{fmt(r.avg, 1)}</div>
                    <div className="k">Avg</div>
                  </div>
                  <div className="stat">
                    <div className="v">{fmt(r.min, 0)}</div>
                    <div className="k">Floor</div>
                  </div>
                </div>
              </div>
              <Spark vals={bests} />
              <div className="rec-n">
                {r.n} scored throw{r.n === 1 ? "" : "s"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
