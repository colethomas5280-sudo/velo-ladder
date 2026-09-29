"use client";

import type { VeloSource } from "@/lib/veloTypes";

/* ------------------------------------------------------------------ *
 * The sources behind the ladder
 *
 * All 11 rows from velo_sources, so a coach can see where a band actually
 * came from and how much weight to put on it. It takes the list as a prop
 * rather than fetching its own copy: VeloLadder already has it, resolved for
 * the row-detail sources list, and a second SWR key for the same data would
 * just be a second round trip.
 * ------------------------------------------------------------------ */

/** A plain pill for High/Medium; a warn pill for Low/Unverified, matching
 * how a `.pill.warn` already flags "look closer" elsewhere in this app. */
export function ratingPill(level: string) {
  const warn = level === "Low" || level === "Unverified";
  return <span className={warn ? "pill warn" : "pill"}>{level}</span>;
}

export default function VeloSources({ sources }: { sources: VeloSource[] }) {
  return (
    <section className="card pad tests-card">
      <div className="sec-h">
        <h3>Sources</h3>
        <span className="sub">
          {sources.length} source{sources.length === 1 ? "" : "s"} behind the ladder
        </span>
      </div>

      {sources.length === 0 ? (
        <p className="widget-empty">No sources loaded yet.</p>
      ) : (
        <ul className="rec-list">
          {sources.map((s) => (
            <li key={s.slug}>
              {ratingPill(s.quality)}
              <div className="feed-main">
                <b>{s.title}</b>
                <span className="feed-sub">
                  {s.dataType}
                  {s.publishedDate ? ` · Published ${s.publishedDate}` : ""}
                </span>
                <span className="feed-sub">{s.limitationsSummary}</span>
              </div>
              <a
                className="feed-val"
                href={s.notionUrl}
                target="_blank"
                rel="noreferrer"
              >
                Notion &rarr;
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
