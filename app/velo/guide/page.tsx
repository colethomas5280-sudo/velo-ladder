import { redirect } from "next/navigation";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { auth } from "@/lib/auth";
import { renderMarkdown } from "@/lib/miniMarkdown";
import AppHeader from "@/components/AppHeader";
import GuideView from "@/components/GuideView";

/* ------------------------------------------------------------------ *
 * The evaluation scoring guide page
 *
 * A thin server shell, same shape as app/velo/page.tsx. The markdown file
 * is read and rendered to nodes here, server-side, and passed down as a
 * plain prop, so the browser never fetches content/evaluation-scoring-
 * guide.md directly. GuideView decides what a coach sees; this file only
 * decides who gets to reach the page at all.
 * ------------------------------------------------------------------ */

export const dynamic = "force-dynamic";

export default async function GuidePage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const src = readFileSync(
    join(process.cwd(), "content", "evaluation-scoring-guide.md"),
    "utf8",
  );
  const nodes = renderMarkdown(src);

  return (
    <div className="wrap">
      <AppHeader email={session.user.email} />
      <GuideView nodes={nodes} />
    </div>
  );
}
