import { redirect } from "next/navigation";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getScope } from "@/lib/scope";
import { renderMarkdown } from "@/lib/miniMarkdown";
import AppHeader from "@/components/AppHeader";
import GuideView from "@/components/GuideView";

/* ------------------------------------------------------------------ *
 * The evaluation scoring guide page
 *
 * Coach only, and enforced HERE, on the server, before the file is read.
 *
 * This is not the shape app/velo/page.tsx uses, and the difference is
 * deliberate. That page passes a snapshot date down and lets the client
 * fetch the real rows from routes that enforce the role. This page has no
 * route to fetch from: the guide is a file, and the only way to hand it to a
 * component is as a prop. A prop from a server component is serialized into
 * the payload the browser receives, so a client-side role check would hide
 * the guide from an athlete while still delivering every word of it.
 *
 * So a non-coach never reaches the readFileSync below. No guide text exists
 * anywhere it could be serialized. The browser also never fetches the
 * markdown file itself; it is read off disk here and rendered to nodes.
 * ------------------------------------------------------------------ */

export const dynamic = "force-dynamic";

export default async function GuidePage() {
  const scope = await getScope();
  if (!scope) redirect("/login");

  if (scope.role !== "coach") {
    return (
      <div className="wrap">
        <AppHeader email={scope.email} />
        <div className="card pad empty">
          <div className="eyebrow">Evaluation Scoring Guide</div>
          <h3>Not available</h3>
          <p>This page is for coaches only.</p>
        </div>
      </div>
    );
  }

  const src = readFileSync(
    join(process.cwd(), "content", "evaluation-scoring-guide.md"),
    "utf8",
  );
  const nodes = renderMarkdown(src);

  return (
    <div className="wrap">
      <AppHeader email={scope.email} />
      <GuideView nodes={nodes} />
    </div>
  );
}
