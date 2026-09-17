"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import type { DashboardData } from "@/lib/dashboard";
import { RECENT_DAYS, STALE_DAYS } from "@/lib/types";
import { fetcher } from "@/lib/fetcher";
import { EMPTY, fmt, fmtDate, TRACKERS } from "@/lib/velo";
import CustomizeDashboard, {
  WIDGETS,
  type WidgetId,
  setWidgets,
  useWidgets,
} from "./CustomizeDashboard";
import { useScreeningDue, screeningDueLabel } from "./RetestPrompt";

export default function Dashboard() {
  const { data, isLoading } = useSWR<DashboardData>("/api/dashboard", fetcher);
  const on = useWidgets();
  const [customizing, setCustomizing] = useState(false);
  const shown = (id: WidgetId) => on.includes(id);

  return (
    <div className="dash">
      <div className="sec-h">
        <h3>Dashboard</h3>
        <div className="sec-actions">
          <button className="btn ghost" onClick={() => setCustomizing(true)}>
            Customize
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="card pad" style={{ color: "var(--ink-dim)" }}>
          Loading…
        </div>
      )}

      {data && (
        <>
          {shown("snapshot") && <Snapshot data={data} />}

          {(shown("leaderboard") || shown("prs") || shown("setbacks")) && (
            <div className="dash-top">
              {shown("leaderboard") && <Leaderboard data={data} />}
              {shown("prs") && <RecentPrs data={data} />}
              {shown("setbacks") && <Setbacks data={data} />}
            </div>
          )}

          <div className="dash-grid">
            {shown("attention") && <NeedsAttention data={data} />}
            {shown("activity") && <Activity data={data} />}
            {shown("screening") && <ScreeningDue />}
          </div>

          {on.length === 0 && (
            <div className="card pad empty">
              <h3>Nothing on your dashboard</h3>
              <p>
                Every widget is switched off. Hit <b>Customize</b> to bring some
                back.
              </p>
            </div>
          )}
        </>
      )}

      {customizing && (
        <CustomizeDashboard
          value={on}
          onChange={setWidgets}
          onClose={() => setCustomizing(false)}
        />
      )}
    </div>
  );
}

/* ---------------- widgets ---------------- */

function Snapshot({ data }: { data: DashboardData }) {
  const s = data.snapshot;
  const tiles = [
    { n: s.athletes, l: "Athletes" },
    { n: s.activeThisWeek, l: "Active this week" },
    { n: s.sessionsThisWeek, l: "Sessions this week" },
    { n: s.prsThisWeek, l: "PRs this week" },
  ];
  return (
    <div className="snapshot">
      {tiles.map((t) => (
        <div className="ro" key={t.l}>
          <div className="n">{t.n}</div>
          <div className="l">{t.l}</div>
        </div>
      ))}
    </div>
  );
}

function WidgetShell({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card pad widget">
      <div className="sec-h">
        <h3>{title}</h3>
        {sub && <span className="sub">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="widget-empty">{children}</p>;
}

/*
 * Shared by the three top-row cards (Best velos, Recent PRs, Setback
 * flags) so none of them can grow taller than the others — Best velos
 * always renders exactly this many slots, and the other two are capped
 * to match rather than stretching the row to fit an open-ended list.
 */
const TOP_ROW_LIMIT = 5;

function Leaderboard({ data }: { data: DashboardData }) {
  const { date, rows } = data.leaderboard;
  const top = Array.from(
    { length: TOP_ROW_LIMIT },
    (_, i) => rows[i] ?? null,
  );
  return (
    <WidgetShell
      title="Best velos"
      sub={date ? fmtDate(date) : "no sessions yet"}
    >
      <ol className="lb">
        {top.map((r, i) =>
          r ? (
            <li key={r.athleteId}>
              <span className="lb-rank">{i + 1}</span>
              <Link href={`/athletes/${r.athleteId}`} className="name-link">
                {r.name}
              </Link>
              <span className="lb-meta">
                {r.oz}oz · {TRACKERS[r.tracker].label}
              </span>
              <span className="lb-velo">{fmt(r.velo)}</span>
            </li>
          ) : (
            <li key={`blank-${i}`}>
              <span className="lb-rank">{i + 1}</span>
              <span className="lb-none">No Records</span>
            </li>
          ),
        )}
      </ol>
    </WidgetShell>
  );
}

function RecentPrs({ data }: { data: DashboardData }) {
  return (
    <WidgetShell title="Recent PRs" sub={`last ${RECENT_DAYS} days`}>
      {data.recentPrs.length === 0 ? (
        <Empty>No new personal records this week.</Empty>
      ) : (
        <ul className="feed">
          {data.recentPrs.slice(0, TOP_ROW_LIMIT).map((p, i) => (
            <li key={`${p.athleteId}-${p.tracker}-${p.oz}-${i}`}>
              <div className="feed-main">
                <Link href={`/athletes/${p.athleteId}`} className="name-link">
                  {p.name}
                </Link>
                <span className="feed-sub">
                  {p.oz}oz {TRACKERS[p.tracker].label} · {fmtDate(p.date)}
                </span>
              </div>
              <div className="feed-val">
                <b>{fmt(p.velo)}</b>
                {p.previous != null && (
                  <span className="delta">
                    +{fmt(p.velo - p.previous)} from {fmt(p.previous)}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </WidgetShell>
  );
}

function NeedsAttention({ data }: { data: DashboardData }) {
  const { stale, pendingInvites } = data;
  const nothing = stale.length === 0 && pendingInvites.length === 0;
  return (
    <WidgetShell title="Needs attention" sub={`${STALE_DAYS}+ days · pending invites`}>
      {nothing ? (
        <Empty>Everyone&rsquo;s current. Nothing to chase.</Empty>
      ) : (
        <>
          {pendingInvites.length > 0 && (
            <ul className="feed">
              {pendingInvites.map((p) => (
                <li key={p.athleteId}>
                  <div className="feed-main">
                    <Link
                      href={`/athletes/${p.athleteId}`}
                      className="name-link"
                    >
                      {p.name}
                    </Link>
                    <span className="feed-sub">
                      {p.hasEmail
                        ? "invite not accepted yet"
                        : "no login email set"}
                    </span>
                  </div>
                  <span className="pill warn">setup</span>
                </li>
              ))}
            </ul>
          )}
          {stale.length > 0 && (
            <ul className="feed">
              {stale.map((s) => (
                <li key={s.athleteId}>
                  <div className="feed-main">
                    <Link
                      href={`/athletes/${s.athleteId}`}
                      className="name-link"
                    >
                      {s.name}
                    </Link>
                    <span className="feed-sub">
                      {s.lastDate
                        ? `last threw ${fmtDate(s.lastDate)}`
                        : "never logged a session"}
                    </span>
                  </div>
                  <span className="pill">
                    {s.days == null ? EMPTY : `${s.days}d`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </WidgetShell>
  );
}

function Activity({ data }: { data: DashboardData }) {
  return (
    <WidgetShell title="Recent activity" sub="latest sessions">
      {data.activity.length === 0 ? (
        <Empty>No sessions logged yet.</Empty>
      ) : (
        <ul className="feed">
          {data.activity.map((a, i) => (
            <li key={`${a.athleteId}-${a.date}-${i}`}>
              <div className="feed-main">
                <Link href={`/athletes/${a.athleteId}`} className="name-link">
                  {a.name}
                </Link>
                <span className="feed-sub">
                  {TRACKERS[a.tracker].label} · {fmtDate(a.date)}
                </span>
              </div>
              <div className="feed-val">
                <b>{fmt(a.best)}</b>
              </div>
            </li>
          ))}
        </ul>
      )}
    </WidgetShell>
  );
}

const SETBACK_LABEL = {
  soreness: "Soreness",
  cns: "CNS readiness",
  injury: "Reported pain",
} as const;

function Setbacks({ data }: { data: DashboardData }) {
  return (
    <WidgetShell title="Setback flags" sub="worst first">
      {data.setbacks.length === 0 ? (
        <Empty>Nothing flagged. Everyone&rsquo;s clear to work.</Empty>
      ) : (
        <ul className="feed">
          {data.setbacks.slice(0, TOP_ROW_LIMIT).map((s) => (
            <li key={s.id}>
              <div className="feed-main">
                <Link href={`/athletes/${s.athleteId}`} className="name-link">
                  {s.name}
                </Link>
                <span className="feed-sub">{s.detail}</span>
              </div>
              <span className={`pill ${s.kind === "injury" ? "warn" : ""}`}>
                {SETBACK_LABEL[s.kind]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </WidgetShell>
  );
}

function ScreeningDue() {
  const due = useScreeningDue();
  return (
    <WidgetShell title="Screening due" sub="movement screens">
      {due.length === 0 ? (
        <Empty>Nobody&rsquo;s due for a screen right now.</Empty>
      ) : (
        <ul className="feed">
          {due.slice(0, 8).map(({ row, clocks }) => (
            <li key={row.athleteId}>
              <div className="feed-main">
                <Link href={`/athletes/${row.athleteId}`} className="name-link">
                  {row.name}
                </Link>
                <span className="feed-sub">
                  {row.called
                    ? row.called.reason
                    : screeningDueLabel(clocks.lead, row.spotTests)}
                </span>
              </div>
              <span
                className={`pill ${clocks.lead.state === "overdue" ? "warn" : ""}`}
              >
                {clocks.lead.state === "overdue" ? "overdue" : "due"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </WidgetShell>
  );
}

export { WIDGETS };
