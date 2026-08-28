"use client";

import { useEffect, useRef } from "react";
import type { TrainingSession } from "@/lib/types";
import {
  type TrackerConfig,
  groupById,
  gid,
  sBestG,
  sessionsOfType,
  mean,
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
      const panel = cs.getPropertyValue("--panel").trim();

      g.clearRect(0, 0, W, H);
      g.font = '11px var(--font-mono), monospace';
      g.textBaseline = "alphabetic";

      const pts = sessionsOfType(sessions, trackerId)
        .map((s) => ({ d: s.date, y: sBestG(s, group.keys) }))
        .filter((p): p is { d: string; y: number } => p.y != null);

      if (!pts.length) {
        g.fillStyle = dim;
        g.textAlign = "center";
        g.fillText("No 100% throws logged for this weight yet.", W / 2, H / 2);
        return;
      }

      const P = { l: 34, r: 14, t: 14, b: 24 };
      const ys = pts.map((p) => p.y);
      const mn = Math.min(...ys);
      const mx = Math.max(...ys);
      let lo = Math.floor(mn - 1.5);
      let hi = Math.ceil(mx + 1.5);
      if (hi - lo < 4) hi = lo + 4;
      const X = (i: number) =>
        P.l + (pts.length === 1 ? 0.5 : i / (pts.length - 1)) * (W - P.l - P.r);
      const Y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);

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

      const avg = mean(ys)!;
      const pr = mx;
      g.setLineDash([4, 4]);
      g.lineWidth = 1.4;
      g.strokeStyle = chalk;
      g.beginPath();
      g.moveTo(P.l, Y(avg));
      g.lineTo(W - P.r, Y(avg));
      g.stroke();
      g.strokeStyle = acc;
      g.beginPath();
      g.moveTo(P.l, Y(pr));
      g.lineTo(W - P.r, Y(pr));
      g.stroke();
      g.setLineDash([]);

      g.strokeStyle = acc;
      g.lineWidth = 2;
      g.beginPath();
      pts.forEach((p, i) => {
        const x = X(i);
        const y = Y(p.y);
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      g.stroke();
      pts.forEach((p, i) => {
        const x = X(i);
        const y = Y(p.y);
        const last = i === pts.length - 1;
        g.fillStyle = acc;
        g.beginPath();
        g.arc(x, y, last ? 4.5 : 3, 0, 7);
        g.fill();
        if (last) {
          g.strokeStyle = panel;
          g.lineWidth = 2;
          g.stroke();
        }
      });

      g.fillStyle = dim;
      g.textAlign = "center";
      const step = Math.max(1, Math.ceil(pts.length / 6));
      pts.forEach((p, i) => {
        if (i % step === 0 || i === pts.length - 1)
          g.fillText(fmtDateShort(p.d), X(i), H - 8);
      });

      const lp = pts[pts.length - 1];
      g.fillStyle = acc;
      g.textAlign = "right";
      g.font = '600 12px var(--font-mono), monospace';
      g.fillText(fmt(lp.y, 0), W - P.r, Math.max(Y(lp.y) - 9, 11));
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
        <span className="sub">Best 100% throw per session</span>
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
          <i className="l-b" />
          Session best
        </span>
        <span>
          <i className="l-p" />
          All-time PR
        </span>
        <span>
          <i className="l-a" />
          Average
        </span>
      </div>
    </div>
  );
}
