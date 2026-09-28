"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import type { VeloRange, VeloSource } from "@/lib/veloTypes";
import { fetcher } from "@/lib/fetcher";
import { EMPTY } from "@/lib/velo";
import VeloSources, { ratingPill } from "./VeloSources";

/* ------------------------------------------------------------------ *
 * The velo ladder
 *
 * Coach-only, same shape as TestsView: an SWR fetch, a role check off
 * /api/me, and nothing rendered at all for anyone who isn't a coach. The 25
 * rows and 11 sources come from the two velo API routes, which already
 * enforce the coach gate server-side — this component only decides what a
 * coach sees, never who gets to see it.
 *
 * No value import from lib/veloData.ts or lib/veloSeed.ts anywhere in this
 * file: lib/clientSafe.test.ts fails the build on that, and it is the whole
 * point. The types come in erased, and the actual 25 rows arrive only over
 * the wire, only to a signed-in coach.
 * ------------------------------------------------------------------ */

type Me = { role: "coach" | "athlete" | "none"; athleteId: string | null };

const CATEGORY_ORDER = [
  "Youth (8U-12U)",
  "Youth (13U-14U)",
  "High School",
  "College",
  "Independent/Pro",
  "Affiliated MiLB/MLB",
];

const CONFIDENCE_NOTE: Record<string, string> = {
  High: "Multiple current sources agree. Safe to lean on.",
  Medium: "Reasonable support, but a gap or a single source somewhere.",
  Low: "Thin or dated support. Read it as a rough guess, not a line.",
  Unverified: "Not checked against a real source yet. Treat it as a placeholder.",
};

const CONFIDENCE_LEVELS = ["High", "Medium", "Low", "Unverified"] as const;

/** "82-90 mph" for a low/high pair that is never null at the same time. */
function fmtRange(low: number, high: number): string {
  return `${low}-${high} mph`;
}

/**
 * The band cell for one row.
 *
 * RHP and LHP show as two stacked lines when either hand has its own
 * numbers. Otherwise a combined band shows as one line with no hand label,
 * because there is nothing split to label. A row with neither renders
 * "No data yet" — never 0, never blank, since a null band here means no
 * sourced data exists yet, not that the velocity is zero.
 */
function Bands({ r }: { r: VeloRange }) {
  const hasRhp = r.rhpLow != null && r.rhpHigh != null;
  const hasLhp = r.lhpLow != null && r.lhpHigh != null;

  if (hasRhp || hasLhp) {
    return (
      <>
        {hasRhp && <span className="vl-band">RHP {fmtRange(r.rhpLow!, r.rhpHigh!)}</span>}
        {hasLhp && <span className="vl-band">LHP {fmtRange(r.lhpLow!, r.lhpHigh!)}</span>}
      </>
    );
  }

  if (r.combinedLow != null && r.combinedHigh != null) {
    return <span className="vl-band">{fmtRange(r.combinedLow, r.combinedHigh)}</span>;
  }

  return <span style={{ color: "var(--ink-faint)" }}>No data yet</span>;
}

/** One row, expandable to its notes and its sources. */
function LadderRow({
  r,
  sourcesBySlug,
}: {
  r: VeloRange;
  sourcesBySlug: Map<string, VeloSource>;
}) {
  const [open, setOpen] = useState(false);
  const refOnly = r.rowType !== "primary";
  const rowSources = r.sourceSlugs
    .map((slug) => sourcesBySlug.get(slug))
    .filter((s): s is VeloSource => s != null);

  return (
    <>
      <tr className={`sess${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)}>
        <td className="vl-level">
          <span className="caret">{open ? "▾" : "▸"}</span>
          {r.level}
          {refOnly && <span className="pill vl-refonly">Reference only</span>}
          {" "}
        </td>
        <td>
          <Bands r={r} />
          {" "}
        </td>
        <td className="vl-elite">
          {r.eliteTrajectoryRef != null ? `${r.eliteTrajectoryRef} mph` : EMPTY}
          {" "}
        </td>
        <td>
          {r.confidence ? ratingPill(r.confidence) : "No data yet"}
          {" "}
        </td>
        <td>
          {r.sourceSlugs.length > 0
            ? `${r.sourceSlugs.length} source${r.sourceSlugs.length === 1 ? "" : "s"}`
            : "No data yet"}
        </td>
      </tr>
      {open && (
        <tr className="detail">
          <td colSpan={5}>
            <div className="notes">
              {r.notes || "No notes on this row."}
            </div>
            {rowSources.length > 0 ? (
              <div className="mini">
                {rowSources.map((s) => (
                  <div key={s.slug}>
                    {ratingPill(s.quality)}{" "}
                    <a href={s.notionUrl} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <div className="notes">No sources logged yet.</div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function VeloLadder({ snapshotDate }: { snapshotDate: string }) {
  const { data: me, isLoading: meLoading } = useSWR<Me>("/api/me", fetcher);

  if (meLoading || !me) {
    return (
      <div className="card pad" style={{ color: "var(--ink-dim)" }}>
        Loading&hellip;
      </div>
    );
  }

  if (me.role !== "coach") {
    return (
      <div className="card pad empty">
        <div className="eyebrow">Velo Ladder</div>
        <h3>Not available</h3>
        <p>This page is for coaches only.</p>
      </div>
    );
  }

  return <VeloLadderBody snapshotDate={snapshotDate} />;
}

/**
 * The actual ladder data and its two fetches.
 *
 * Split out of VeloLadder so the /api/velo/ranges and /api/velo/sources
 * requests only ever fire once a coach is already confirmed — the same
 * shape TestsView uses for Roster/InhibitorsRoster. Fetching them
 * unconditionally in the parent would send every athlete who lands on this
 * page two round trips that can only ever come back 403.
 */
function VeloLadderBody({ snapshotDate }: { snapshotDate: string }) {
  const { data: rangesData } = useSWR<VeloRange[]>("/api/velo/ranges", fetcher);
  const { data: sourcesData } = useSWR<VeloSource[]>("/api/velo/sources", fetcher);
  const [tab, setTab] = useState<"ladder" | "sources">("ladder");

  const sources = useMemo(() => sourcesData ?? [], [sourcesData]);
  const sourcesBySlug = useMemo(
    () => new Map(sources.map((s) => [s.slug, s])),
    [sources],
  );

  const grouped = useMemo(() => {
    const ranges = rangesData ?? [];
    const byCategory = new Map<string, VeloRange[]>();
    for (const r of ranges) {
      const list = byCategory.get(r.category) ?? [];
      list.push(r);
      byCategory.set(r.category, list);
    }
    for (const list of byCategory.values()) {
      list.sort((a, b) => a.displayOrder - b.displayOrder);
    }
    return CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => ({
      category,
      rows: byCategory.get(category)!,
    }));
  }, [rangesData]);

  return (
    <>
      <div className="tests-head">
        <div className="eyebrow">Velo Ladder</div>
        <h2>Fastball velocity benchmarks</h2>
        <p className="vl-banner" role="note">
          Coach-only. Benchmarks are directional; check the Confidence rating
          before relying on a placement.
        </p>
        <p className="sub">Data snapshot: {snapshotDate}</p>
      </div>

      <div className="tabstrip">
        <button
          type="button"
          className={`atab data${tab === "ladder" ? " on" : ""}`}
          onClick={() => setTab("ladder")}
        >
          Ladder
        </button>
        <button
          type="button"
          className={`atab data${tab === "sources" ? " on" : ""}`}
          onClick={() => setTab("sources")}
        >
          Sources
        </button>
      </div>

      {tab === "ladder" ? (
        <>
          {grouped.map(({ category, rows }) => (
            <section className="card pad tests-card" key={category}>
              <div className="sec-h">
                <h3>{category}</h3>
              </div>
              <div className="scroll-x">
                <table className="roster-table">
                  <thead>
                    <tr>
                      <th>Level</th>
                      <th>Band</th>
                      <th>Elite Trajectory</th>
                      <th>Confidence</th>
                      <th>Sources</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <LadderRow key={r.slug} r={r} sourcesBySlug={sourcesBySlug} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          <section className="card pad tests-card">
            <div className="sec-h">
              <h3>Confidence</h3>
            </div>
            <ul className="rec-list">
              {CONFIDENCE_LEVELS.map((level) => (
                <li key={level}>
                  {ratingPill(level)}
                  <div className="feed-main">
                    <span className="feed-sub">{CONFIDENCE_NOTE[level]}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : (
        <VeloSources sources={sources} />
      )}
    </>
  );
}
