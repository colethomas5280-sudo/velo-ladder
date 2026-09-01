"use client";

import { useEffect, useRef, useState } from "react";
import type { TrainingSession, RecoveryEntry } from "@/lib/types";
import {
  CHART_WINDOWS,
  STEP_DAYS,
  progressWindow,
  smoothPath,
} from "@/lib/progress";
import {
  type TrackerConfig,
  groupById,
  gid,
  fmt,
  fmtDateShort,
  todayISO,
} from "@/lib/velo";

/** The weight menu's overview option: every ball at once, best only. */
const ALL_WEIGHTS = "all";

/**
 * One colour per weight in `groups` order. `--bad` is deliberately absent:
 * at #bd4526 it is the same orange as `--accent` in a 2px line, which is why
 * `--chart-alt` exists.
 */
const WEIGHT_TOKENS = ["--accent", "--chalk", "--good", "--chart-alt", "--ink-dim"];

/** "Aug 26 – Sep 1", the reader's anchor once the window can move. */
function rangeLabel(from: string, to: string): string {
  const one = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };
  return `${one(from)} – ${one(to)}`;
}

const windowLabel = (days: number) =>
  days === STEP_DAYS ? "1 week" : `${days / STEP_DAYS} weeks`;

interface Line {
  label: string;
  token: string;
  width: number;
  values: (number | null)[];
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
  const [spanDays, setSpanDays] = useState<number>(CHART_WINDOWS[0]);
  /** 0 is the window ending today; each step is a week further back. */
  const [offsetWeeks, setOffsetWeeks] = useState(0);

  const showAll = groupId === ALL_WEIGHTS;
  const shown = showAll ? cfg.groups : [groupById(cfg, groupId)];

  /*
   * One call per weight on show, all through the same tested function. The day
   * skeleton, the recovery bars and the window bounds come out identical from
   * each — only the velocity differs — so the first result speaks for all of
   * them and "All weights" needs no second code path.
   */
  const wins = shown.map((g) =>
    progressWindow({
      sessions,
      recovery,
      keys: g.keys,
      trackerId,
      spanDays,
      offsetWeeks,
      asOf: todayISO(),
    }),
  );
  const w = wins[0];

  const lines: Line[] = showAll
    ? shown.map((g, i) => ({
        label: `${g.oz} oz`,
        token: WEIGHT_TOKENS[i % WEIGHT_TOKENS.length],
        width: 2,
        values: wins[i].days.map((d) => d.best),
      }))
    : [
        { label: "Floor", token: "--good", width: 1.6, values: w.days.map((d) => d.min) },
        { label: "Average", token: "--chalk", width: 1.8, values: w.days.map((d) => d.avg) },
        { label: "Best", token: "--accent", width: 2.4, values: w.days.map((d) => d.best) },
      ];

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
      const token = (name: string) => cs.getPropertyValue(name).trim();
      const dim = token("--ink-faint");
      const grid = token("--line");
      const chalk = token("--chalk");
      const panel = token("--panel");

      g.clearRect(0, 0, W, H);
      g.font = "11px var(--font-mono), monospace";
      g.textBaseline = "alphabetic";

      const days = w.days;
      const anyVelo = lines.some((l) => l.values.some((v) => v != null));
      if (!anyVelo && !w.recoveryDays) {
        g.fillStyle = dim;
        g.textAlign = "center";
        g.fillText("Nothing logged in this window.", W / 2, H / 2);
        return;
      }

      /*
       * Right padding carries the velocity endpoint values and then the
       * recovery axis outside them. On a phone that is 72px of a ~313px
       * canvas. The endpoint values give way there — the same numbers are in
       * the header and on the records panel — while the recovery axis stays,
       * since bars you cannot read a value off are what this chart replaced.
       */
      const compact = W < 420;
      const P = { l: 34, r: compact ? 26 : 72, t: 14, b: 24 };
      const plotW = W - P.l - P.r;
      const plotH = H - P.t - P.b;

      const vals = lines.flatMap((l) => l.values.filter((v): v is number => v != null));
      const lo = vals.length ? Math.floor(Math.min(...vals) - 1.5) : 0;
      let hi = vals.length ? Math.ceil(Math.max(...vals) + 1.5) : 4;
      if (hi - lo < 4) hi = lo + 4;

      const slot = plotW / days.length;
      const X = (i: number) => P.l + slot * (i + 0.5);
      const Y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * plotH;
      const RY = (v: number) => P.t + (1 - v / 100) * plotH;

      /* ---- grid + velocity axis ---- */
      g.strokeStyle = grid;
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
        if (vals.length) g.fillText(String(Math.round(v)), P.l - 6, yy + 3);
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

        g.fillStyle = chalk;
        g.textAlign = "right";
        g.globalAlpha = 0.75;
        for (const v of [100, 50, 0]) g.fillText(String(v), W - 6, RY(v) + 3);
        g.globalAlpha = 1;
      }

      /* ---- all-time ceiling, only when one weight is on screen ---- */
      if (!showAll && vals.length) {
        const pr = Math.max(...vals);
        g.setLineDash([3, 4]);
        g.strokeStyle = token("--accent");
        g.globalAlpha = 0.35;
        g.beginPath();
        g.moveTo(P.l, Y(pr));
        g.lineTo(W - P.r, Y(pr));
        g.stroke();
        g.globalAlpha = 1;
        g.setLineDash([]);
      }

      /* ---- the lines, drawn only where there was a session ---- */
      for (const l of lines) {
        const color = token(l.token);
        const pts = l.values
          .map((v, i) => ({ v, i }))
          .filter((x): x is { v: number; i: number } => x.v != null);
        if (!pts.length) continue;

        /*
         * The line spans the gaps; the dots mark the days that are real.
         * Curved rather than jointed, through monotone interpolation, so the
         * smoothing can never carry the line above a session that was thrown.
         */
        const screen = pts.map((x) => ({ x: X(x.i), y: Y(x.v) }));
        if (screen.length > 1) {
          g.strokeStyle = color;
          g.lineWidth = l.width;
          g.lineJoin = "round";
          g.lineCap = "round";
          g.beginPath();
          g.moveTo(screen[0].x, screen[0].y);
          for (const seg of smoothPath(screen))
            g.bezierCurveTo(seg.c1.x, seg.c1.y, seg.c2.x, seg.c2.y, seg.to.x, seg.to.y);
          g.stroke();
        }

        for (const x of pts) {
          g.fillStyle = color;
          g.beginPath();
          g.arc(X(x.i), Y(x.v), 3, 0, 7);
          g.fill();
          g.strokeStyle = panel;
          g.lineWidth = 1.5;
          g.stroke();
        }

        if (!compact) {
          const last = pts[pts.length - 1];
          g.fillStyle = color;
          g.textAlign = "left";
          g.font = "600 11px var(--font-mono), monospace";
          g.fillText(fmt(last.v), W - P.r + 6, Y(last.v) + 3.5);
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
  }, [w, lines, showAll, trackerId]);

  return (
    <div className="card pad chart-card">
      <div className="sec-h">
        <h3>Progress</h3>
        <span className="sub">By day · 100% throws</span>
      </div>

      <div className="chart-range">
        <div className="chart-selects">
          <label>
            <span>Ball weight</span>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              {cfg.groups.map((gp) => (
                <option key={gid(gp)} value={gid(gp)}>
                  {gp.oz} oz
                </option>
              ))}
              <option value={ALL_WEIGHTS}>All weights</option>
            </select>
          </label>

          <label>
            <span>Recovery</span>
            <select
              value={spanDays}
              onChange={(e) => setSpanDays(Number(e.target.value))}
            >
              {CHART_WINDOWS.map((d) => (
                <option key={d} value={d}>
                  {windowLabel(d)}
                </option>
              ))}
            </select>
          </label>
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
        {lines.map((l) => (
          <span key={l.label}>
            <i className="l-swatch" style={{ color: `var(${l.token})` }} />
            {l.label}
          </span>
        ))}
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
