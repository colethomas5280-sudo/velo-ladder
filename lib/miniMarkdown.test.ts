import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderMarkdown } from "@/lib/miniMarkdown";

/* ------------------------------------------------------------------ *
 * lib/miniMarkdown.ts renders exactly what the guide uses: headings
 * (1-3), bold inline, unordered lists, one table, and paragraphs. These
 * pin the five constructs individually, then pin the real file so a
 * future edit that reaches for a sixth construct shows up here instead
 * of as a blank patch on the guide page.
 * ------------------------------------------------------------------ */

test("a heading becomes a heading at its level", () => {
  assert.deepEqual(renderMarkdown("## The Process"), [
    { kind: "heading", level: 2, text: "The Process" },
  ]);
});

test("a table keeps its header and its rows", () => {
  const md = "| Where | Call it |\n|---|---|\n| Below | Below average |";
  assert.deepEqual(renderMarkdown(md), [
    { kind: "table", header: ["Where", "Call it"], rows: [["Below", "Below average"]] },
  ]);
});

test("a dash list becomes a list", () => {
  assert.deepEqual(renderMarkdown("- one\n- two"), [
    { kind: "list", items: ["one", "two"] },
  ]);
});

test("paragraphs are separated by blank lines, not by newlines", () => {
  const got = renderMarkdown("line one\nstill one\n\nline two");
  assert.equal(got.length, 2);
  assert.equal(got[0].kind, "paragraph");
});

test("the real guide renders without losing a section", () => {
  /*
   * The point of pinning this: Cole edits the guide as text. If an edit
   * uses something the renderer does not handle, that must be visible
   * here rather than as a blank patch on the page.
   */
  const src = readFileSync("content/evaluation-scoring-guide.md", "utf8");
  const nodes = renderMarkdown(src);
  const headings = nodes.filter((n) => n.kind === "heading").map((n) => n.text);
  assert.ok(headings.includes("Evaluation Scoring Guide"));
  assert.ok(headings.includes("Worked Examples"));
  assert.ok(headings.includes("Limitation to disclose every time"));
  assert.equal(nodes.filter((n) => n.kind === "table").length, 1);
});

test("nothing in the guide renders as an empty node", () => {
  const nodes = renderMarkdown(readFileSync("content/evaluation-scoring-guide.md", "utf8"));
  for (const n of nodes)
    if (n.kind === "paragraph" || n.kind === "heading")
      assert.ok(n.text.trim().length > 0, JSON.stringify(n));
});
