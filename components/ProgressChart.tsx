"use client";

import { useEffect, useRef, useState } from "react";
import type { TrainingSession, RecoveryEntry } from "@/lib/types";
import {
  CHART_WINDOWS,
  STEP_DAYS,
  progressWindow,
  type ProgressDay,
} from "@/lib/progress";
import {
  type TrackerConfig,
  groupById,
  gid,
  fmt,
  fmtDateShort,
  todayISO,
} from "@/lib/velo";

/** "Aug 26 – Sep 1", the reader's anchor once the window can move. */
function rangeLabel(from: string, to: string): string {
  const fmtOne = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };
  return `${fmtOne(from)} – ${fmtOne(to)}`;
}

export default function ProgressChart({
  cfg,
  trackerId,
  sessions,
  groupId,
  setGroupId,
  recovery = [],
}: {
  cfg: TrackerConfig;
  trackerId: "mound" | "pulldown";
  sessions: TrainingSession[];
  groupId: string;
  setGroupId: (id: string) => void;
  recovery?: RecoveryEntry[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const group = groupById(cfg, groupId);

  const [spanDays, setSpanDays] = useState<number>(CHART_WINDOWS[0]);
  /** 0 is the window ending today; each step is a week further back. */
  const [offsetWeeks, setOffsetWeeks] = useState(0);

  const w = progressWindow({
    sessions,
    recovery,
    keys: group.keys,
    trackerId,
    spanDays,
    offsetWeeks,
    asOf: todayISO(),
  });

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;

    const draw = () => {
      const wrap = cv.parentElement;
      if (!wrap) return;
      const W = wrap.clientWidth;
      const H = wrap.clientHeight;
      if (!W || !H) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = W * dpr;
      cv.height = H * dpr;
      const g = cv.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cs = getComputedStyle(document.documentElement);
      const dim = cs.getPropertyValue("--ink-faint").trim();
      const line = cs.getPropertyValue("--line").trim();
      const acc = cs.getPropertyValue("--accent").trim();
      const chalk = cs.getPropertyValue("--chalk").trim();
      const good = cs.getPropertyValue("--good").trim();
      const panel = cs.getPropertyValue("--panel").trim();

      g.clearRect(0, 0, W, H);
      g.font = "11px var(--font-mono), monospace";
      g.textBaseline = "alphabetic";

      const days = w.days;
      if (!w.sessionDays && !w.recoveryDays) {
        g.fillStyle = dim;
        g.textAlign = "center";
        g.fillText("Nothing logged in this window.", W / 2, H / 2);
        return;
      }

      /*
       * Right padding carries two things: the velocity endpoint values, then
       * the recovery axis outside them. On a phone that is 72px of a ~313px
       * canvas, which squeezes the plot to a third of the card. The endpoint
       * values give way there — the same numbers are on the records panel and
       * in the header — while the recovery axis stays, since bars you cannot
       * read a value off are the thing this chart was built to stop shipping.
       */
      const compact = W < 420;
      const P = { l: 34, r: compact ? 26 : 72, t: 14, b: 24 };
      const plotW = W - P.l - P.r;
      const plotH = H - P.t - P.b;

      /* ---- velocity scale, from whatever the window actually holds ---- */
      const vals = days.flatMap((d) =>
        d.best != null ? [d.best, d.avg as number, d.min as number] : [],
      );
      const hasVelo = vals.length > 0;
      const lo = hasVelo ? Math.floor(Math.min(...vals) - 1.5) : 0;
      let hi = hasVelo ? Math.ceil(Math.max(...vals) + 1.5) : 4;
      if (hi - lo < 4) hi = lo + 4;

      // One slot per day, so a bar and its session sit on the same centre.
      const slot = plotW / days.length;
      const X = (i: number) => P.l + slot * (i + 0.5);
      const Y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * plotH;
      const RY = (v: number) => P.t + (1 - v / 100) * plotH;

      /* ---- grid + velocity axis ---- */
      g.strokeStyle = line;
      g.fillStyle = dim;
      g.lineWidth = 1;
      g.textAlign = "right";
      for (let k = 0; k <= 4; k++) {
        const v = lo + ((hi - lo) * k) / 4;
        const yy = Y(v);
        g.beginPath();
        g.moveTo(P.l, yy);
        g.lineTo(W - P.r, yy);
        g.stroke();
        if (hasVelo) g.fillText(String(Math.round(v)), P.l - 6, yy + 3);
      }

      /* ---- recovery bars, behind everything ---- */
      if (w.recoveryDays) {
        const barW = Math.max(2, Math.min(slot - 2, 26));
        g.fillStyle = chalk;
        g.globalAlpha = 0.22;
        days.forEach((d, i) => {
          if (d.recovery == null) return;
          const y = RY(d.recovery);
          g.fillRect(X(i) - barW / 2, y, barW, P.t + plotH - y);
        });
        g.globalAlpha = 1;

        // Its own axis, on the right. An unlabelled scale can be looked at but
        // not read, which is what this chart used to offer.
        g.fillStyle = chalk;
        g.textAlign = "right";
        g.globalAlpha = 0.75;
        for (const v of [100, 50, 0]) g.fillText(String(v), W - 6, RY(v) + 3);
        g.globalAlpha = 1;
      }

      /* ---- all-time PR ceiling for this weight ---- */
      if (hasVelo) {
        const pr = Math.max(...days.map((d) => d.best ?? -Infinity));
        g.setLineDash([3, 4]);
        g.strokeStyle = acc;
        g.globalAlpha = 0.35;
        g.beginPath();
        g.moveTo(P.l, Y(pr));
        g.lineTo(W - P.r, Y(pr));
        g.stroke();
        g.globalAlpha = 1;
        g.setLineDash([]);
      }

      /* ---- velocity, drawn only where there was a session ---- */
      const thrown = days
        .map((d, i) => ({ d, i }))
        .filter((x) => x.d.best != null);

      const series: [keyof ProgressDay, string, number][] = [
        ["min", good, 1.6],
        ["avg", chalk, 1.8],
        ["best", acc, 2.4],
      ];

      for (const [key, color, width] of series) {
        // The line spans the gaps; the dots mark the days that are real.
        g.strokeStyle = color;
        g.lineWidth = width;
        g.beginPath();
        thrown.forEach((x, n) => {
          const px = X(x.i);
          const py = Y(x.d[key] as number);
          if (n) g.lineTo(px, py);
          else g.moveTo(px, py);
        });
        if (thrown.length > 1) g.stroke();

        for (const x of thrown) {
          g.fillStyle = color;
          g.beginPath();
          g.arc(X(x.i), Y(x.d[key] as number), 3, 0, 7);
          g.fill();
          g.strokeStyle = panel;
          g.lineWidth = 1.5;
          g.stroke();
        }

        const last = thrown[thrown.length - 1];
        if (last && !compact) {
          const py = Y(last.d[key] as number);
          g.fillStyle = color;
          g.textAlign = "left";
          g.font = "600 11px var(--font-mono), monospace";
          g.fillText(fmt(last.d[key] as number), W - P.r + 6, py + 3.5);
          g.font = "11px var(--font-mono), monospace";
        }
      }

      /* ---- date labels ---- */
      g.fillStyle = dim;
      g.textAlign = "center";
      const step = Math.max(1, Math.ceil(days.length / 7));
      days.forEach((d, i) => {
        if (i % step === 0 || i === days.length - 1)
          g.fillText(fmtDateShort(d.date), X(i), H - 8);
      });
    };

    draw();
    const ro = new ResizeObserver(draw);
    if (canvasRef.current?.parentElement)
      ro.observe(canvasRef.current.parentElement);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", draw);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", draw);
    };
  }, [w, trackerId]);

  return (
    <div className="card pad chart-card">
      <div className="sec-h">
        <h3>Progress</h3>
        <span className="sub">By day · 100% throws</span>
      </div>

      <div className="chips">
        {cfg.groups.map((gp) => {
          const id = gid(gp);
          return (
            <button
              key={id}
              className="chip"
              aria-pressed={id === groupId}
              onClick={() => setGroupId(id)}
            >
              {gp.oz} oz
            </button>
          );
        })}
      </div>

      <div className="chart-range">
        <div className="chips">
          {CHART_WINDOWS.map((d) => (
            <button
              key={d}
              className="chip"
              aria-pressed={d === spanDays}
              onClick={() => setSpanDays(d)}
            >
              {d / STEP_DAYS}w
            </button>
          ))}
        </div>
        <div className="pager">
          <button
            className="btn sm ghost"
            aria-label="Earlier week"
            disabled={!w.hasEarlier}
            onClick={() => setOffsetWeeks((p) => p + 1)}
          >
            ‹
          </button>
          <span className="range">{rangeLabel(w.from, w.to)}</span>
          <button
            className="btn sm ghost"
            aria-label="Later week"
            disabled={!w.hasLater}
            onClick={() => setOffsetWeeks((p) => Math.max(0, p - 1))}
          >
            ›
          </button>
          {/*
            * Always rendered, disabled at the present, because the arrows must
            * not move under the cursor. Showing it only once paged back made
            * the pager grow on the first click and the second click miss.
            */}
          <button
            className="btn sm ghost"
            disabled={!w.hasLater}
            onClick={() => setOffsetWeeks(0)}
          >
            Now
          </button>
        </div>
      </div>

      <div className="chart-wrap">
        <canvas ref={canvasRef} />
      </div>

      <div className="chart-legend">
        <span>
          <i className="l-best" />
          Best
        </span>
        <span>
          <i className="l-avg" />
          Average
        </span>
        <span>
          <i className="l-floor" />
          Floor
        </span>
        {w.recoveryDays > 0 && (
          <span>
            <i className="l-recovery" />
            Recovery (0–100, right)
          </span>
        )}
      </div>
    </div>
  );
}
