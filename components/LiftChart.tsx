"use client";

import { useMemo } from "react";
import { smoothPath, type Pt } from "@/lib/progress";
import {
  METRIC_UNIT,
  fmtMetric,
  type LiftMode,
  type LiftPoint,
} from "@/lib/strength";
import { fmtDateShort } from "@/lib/velo";

/* ------------------------------------------------------------------ *
 * One lift's line
 *
 * SVG rather than the canvas the velocity chart uses. That one carries five
 * weights, a recovery track and a movable window; this carries one series,
 * and an SVG of it is a dozen lines, scales itself, and can be read by a test.
 *
 * Plotted against the CALENDAR, not against session number. Six weeks off and
 * a session back is a six-week gap, and evenly spacing the points would draw
 * it as steady progress.
 * ------------------------------------------------------------------ */

const W = 640;
const H = 180;
const PAD = { top: 14, right: 12, bottom: 22, left: 40 };

const dayNum = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

export default function LiftChart({
  series,
  mode,
  label,
}: {
  series: LiftPoint[];
  mode: LiftMode;
  label: string;
}) {
  const points = useMemo(
    () => series.filter((p): p is LiftPoint & { value: number } => p.value != null),
    [series],
  );

  const geometry = useMemo(() => {
    if (points.length < 2) return null;

    const xs = points.map((p) => dayNum(p.date));
    const ys = points.map((p) => p.value);
    const x0 = xs[0];
    const x1 = xs[xs.length - 1];
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    /*
     * A flat series has no range to divide by. Padding it by a tenth of the
     * value puts the line through the middle instead of on the top edge —
     * or, with a bare `hi - lo`, straight through a division by zero.
     */
    const span = hi - lo || Math.max(1, hi * 0.1);
    const pad = span * 0.15;
    const min = lo - pad;
    const max = hi + pad;

    const px = (iso: string) =>
      PAD.left +
      ((dayNum(iso) - x0) / (x1 - x0 || 1)) * (W - PAD.left - PAD.right);
    const py = (v: number) =>
      PAD.top + (1 - (v - min) / (max - min)) * (H - PAD.top - PAD.bottom);

    const pts: Pt[] = points.map((p) => ({ x: px(p.date), y: py(p.value) }));
    const d =
      `M ${pts[0].x} ${pts[0].y} ` +
      smoothPath(pts)
        .map((s) => `C ${s.c1.x} ${s.c1.y} ${s.c2.x} ${s.c2.y} ${s.to.x} ${s.to.y}`)
        .join(" ");

    return { pts, d, min, max, hi, py, px };
  }, [points]);

  if (!points.length)
    return (
      <p className="widget-empty">
        Nothing to chart yet for {label.toLowerCase()}.
      </p>
    );

  if (!geometry)
    return (
      <p className="widget-empty">
        One session logged — {fmtMetric(points[0].value, mode)} on{" "}
        {fmtDateShort(points[0].date)}. The line starts at two.
      </p>
    );

  const { pts, d, hi, py } = geometry;

  return (
    <div className="lc">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="lc-svg"
        role="img"
        aria-label={`${label}: ${fmtMetric(points[0].value, mode)} on ${fmtDateShort(points[0].date)} to ${fmtMetric(points[points.length - 1].value, mode)} on ${fmtDateShort(points[points.length - 1].date)}`}
      >
        {/* The personal best, so the line is read against something. */}
        <line
          className="lc-pr"
          x1={PAD.left}
          x2={W - PAD.right}
          y1={py(hi)}
          y2={py(hi)}
        />
        <text className="lc-axis" x={PAD.left - 6} y={py(hi) + 4} textAnchor="end">
          {Math.round(hi)}
        </text>
        <path className="lc-line" d={d} />
        {pts.map((p, i) => (
          <circle
            key={points[i].date}
            className={points[i].record ? "lc-dot lc-rec" : "lc-dot"}
            cx={p.x}
            cy={p.y}
            r={points[i].record ? 4.5 : 3}
          />
        ))}
        <text className="lc-axis" x={PAD.left} y={H - 6}>
          {fmtDateShort(points[0].date)}
        </text>
        <text className="lc-axis" x={W - PAD.right} y={H - 6} textAnchor="end">
          {fmtDateShort(points[points.length - 1].date)}
        </text>
      </svg>
      <div className="lc-foot">
        {label} · {METRIC_UNIT[mode]} ·{" "}
        {/*
          * "of N" only when they differ. A session that charts nothing — a
          * back squat done for twenty reps, say — is still a session the
          * athlete did, and calling the line's four points "4 sessions" on a
          * lift done five times is a quiet undercount of their own work.
          */}
        {points.length === series.length
          ? `${points.length} sessions`
          : `${points.length} of ${series.length} sessions plotted`}
      </div>
    </div>
  );
}
