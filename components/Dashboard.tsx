"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import type { DashboardData } from "@/lib/dashboard";
import { fetcher } from "@/lib/fetcher";
import { fmt, fmtDate, TRACKERS } from "@/lib/velo";
import CustomizeDashboard, {
  WIDGETS,
  type WidgetId,
  DEFAULT_WIDGETS,
  loadWidgets,
} from "./CustomizeDashboard";

export default function Dashboard() {
  const { data, isLoading } = useSWR<DashboardData>("/api/dashboard", fetcher);
  const [on, setOn] = useState<WidgetId[]>(DEFAULT_WIDGETS);
  const [customizing, setCustomizing] = useState(false);

  useEffect(() => setOn(loadWidgets()), []);
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

          <div className="dash-grid">
            {shown("leaderboard") && <Leaderboard data={data} />}
            {shown("prs") && <RecentPrs data={data} />}
            {shown("attention") && <NeedsAttention data={data} />}
            {shown("activity") && <Activity data={data} />}
            {shown("resources") && <ResourcesWidget data={data} />}
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
          onChange={setOn}
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

function Leaderboard({ data }: { data: DashboardData }) {
  const { date, rows } = data.leaderboard;
  return (
    <WidgetShell
      title="Best velos"
      sub={date ? fmtDate(date) : "no sessions yet"}
    >
      {rows.length === 0 ? (
        <Empty>Nothing logged yet.</Empty>
      ) : (
        <ol className="lb">
          {rows.slice(0, 8).map((r, i) => (
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
          ))}
        </ol>
      )}
    </WidgetShell>
  );
}

function RecentPrs({ data }: { data: DashboardData }) {
  return (
    <WidgetShell title="Recent PRs" sub="last 7 days">
      {data.recentPrs.length === 0 ? (
        <Empty>No new personal records this week.</Empty>
      ) : (
        <ul className="feed">
          {data.recentPrs.map((p, i) => (
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
    <WidgetShell title="Needs attention" sub="14+ days · pending invites">
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
                    {s.days == null ? "—" : `${s.days}d`}
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

function ResourcesWidget({ data }: { data: DashboardData }) {
  return (
    <WidgetShell title="Resources" sub="protocols & how-tos">
      {data.resources.length === 0 ? (
        <Empty>
          Nothing in the library yet.{" "}
          <Link href="/resources" className="name-link">
            Add the first one
          </Link>
          .
        </Empty>
      ) : (
        <>
          <ul className="feed">
            {data.resources.map((r) => (
              <li key={r.id}>
                <div className="feed-main">
                  <Link href="/resources" className="name-link">
                    {r.title}
                  </Link>
                  <span className="feed-sub">{r.category || "General"}</span>
                </div>
              </li>
            ))}
          </ul>
          <Link className="btn sm ghost" href="/resources" style={{ marginTop: 10, display: "inline-block" }}>
            Open resources
          </Link>
        </>
      )}
    </WidgetShell>
  );
}

export { WIDGETS };
