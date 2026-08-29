"use client";

import { useEffect, useRef } from "react";
import type { TrainingSession } from "@/lib/types";
import {
  type TrackerConfig,
  groupById,
  gid,
  sBestG,
  sAvgG,
  sMinG,
  sessionsOfType,
  fmt,
  fmtDateShort,
} from "@/lib/velo";

export default function ProgressChart({
  cfg,
  trackerId,
  sessions,
  groupId,
  setGroupId,
}: {
  cfg: TrackerConfig;
  trackerId: "mound" | "pulldown";
  sessions: TrainingSession[];
  groupId: string;
  setGroupId: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const group = groupById(cfg, groupId);

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
      g.font = '11px var(--font-mono), monospace';
      g.textBaseline = "alphabetic";

      const rows = sessionsOfType(sessions, trackerId)
        .map((s) => ({
          d: s.date,
          best: sBestG(s, group.keys),
          avg: sAvgG(s, group.keys),
          min: sMinG(s, group.keys),
        }))
        .filter(
          (r): r is { d: string; best: number; avg: number; min: number } =>
            r.best != null && r.avg != null && r.min != null,
        );

      if (!rows.length) {
        g.fillStyle = dim;
        g.textAlign = "center";
        g.fillText("No 100% throws logged for this weight yet.", W / 2, H / 2);
        return;
      }

      const P = { l: 34, r: 40, t: 14, b: 24 };
      const allVals = rows.flatMap((r) => [r.best, r.avg, r.min]);
      const mn = Math.min(...allVals);
      const mx = Math.max(...allVals);
      let lo = Math.floor(mn - 1.5);
      let hi = Math.ceil(mx + 1.5);
      if (hi - lo < 4) hi = lo + 4;
      const X = (i: number) =>
        P.l + (rows.length === 1 ? 0.5 : i / (rows.length - 1)) * (W - P.l - P.r);
      const Y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);

      // grid + y labels
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
        g.fillText(String(Math.round(v)), P.l - 6, yy + 3);
      }

      // all-time PR ceiling (faint dashed)
      const pr = Math.max(...rows.map((r) => r.best));
      g.setLineDash([3, 4]);
      g.strokeStyle = acc;
      g.globalAlpha = 0.35;
      g.beginPath();
      g.moveTo(P.l, Y(pr));
      g.lineTo(W - P.r, Y(pr));
      g.stroke();
      g.globalAlpha = 1;
      g.setLineDash([]);

      const series: [keyof (typeof rows)[number], string, number][] = [
        ["min", good, 1.6],
        ["avg", chalk, 1.8],
        ["best", acc, 2.4],
      ];

      for (const [key, color, width] of series) {
        g.strokeStyle = color;
        g.lineWidth = width;
        g.beginPath();
        rows.forEach((r, i) => {
          const x = X(i);
          const y = Y(r[key] as number);
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        });
        g.stroke();
        // endpoint dot + value label
        const last = rows[rows.length - 1];
        const x = X(rows.length - 1);
        const y = Y(last[key] as number);
        g.fillStyle = color;
        g.beginPath();
        g.arc(x, y, 3.5, 0, 7);
        g.fill();
        g.strokeStyle = panel;
        g.lineWidth = 2;
        g.stroke();
        g.fillStyle = color;
        g.textAlign = "left";
        g.font = '600 11px var(--font-mono), monospace';
        g.fillText(fmt(last[key] as number, 1), W - P.r + 5, y + 3.5);
      }

      // x date labels
      g.fillStyle = dim;
      g.textAlign = "center";
      g.font = '11px var(--font-mono), monospace';
      const step = Math.max(1, Math.ceil(rows.length / 6));
      rows.forEach((r, i) => {
        if (i % step === 0 || i === rows.length - 1)
          g.fillText(fmtDateShort(r.d), X(i), H - 8);
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
  }, [sessions, group.keys, trackerId]);

  return (
    <div className="card pad chart-card">
      <div className="sec-h">
        <h3>Progress</h3>
        <span className="sub">Per session · 100% throws</span>
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
              {gp.oz} oz{gp.keys.length > 1 ? " · both sets" : ""}
            </button>
          );
        })}
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
      </div>
    </div>
  );
}
