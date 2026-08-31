import { test } from "node:test";
import assert from "node:assert/strict";
import { ageOn, bandForSession, buildBoards, type LeaderboardAthlete } from "@/lib/leaderboard";
import type { TrainingSession } from "@/lib/types";

const athlete = (over: Partial<LeaderboardAthlete> = {}): LeaderboardAthlete => ({
  id: "a1", name: "Test Athlete", hand: "R",
  birthDate: null, level: null, ...over,
});

// p1 and p4 are the two pull-down 5 oz slots; index 0 is the 80% primer.
const session = (
  athleteId: string, date: string, level: string | null,
  throws: Record<string, (number | null)[]>,
): TrainingSession =>
  ({ id: date + athleteId, athleteId, type: "pulldown", date, notes: "",
     level, throws } as unknown as TrainingSession);

test("ageOn counts a birthday that has not happened yet", () => {
  assert.equal(ageOn("2012-06-15", "2026-06-14"), 13);
  assert.equal(ageOn("2012-06-15", "2026-06-15"), 14);
  assert.equal(ageOn("2012-06-15", "2026-12-01"), 14);
});

test("a stamped level maps straight to its band", () => {
  const a = athlete({ birthDate: "2012-06-15" });
  assert.equal(bandForSession(a, "High School", "2026-08-01"), "High School");
  assert.equal(bandForSession(a, "College", "2026-08-01"), "College");
  assert.equal(bandForSession(a, "Pro", "2026-08-01"), "Pro");
});

test("a stamped level beats the age band", () => {
  // 13 on this date, so 14U by age — but he trains with the high schoolers
  const a = athlete({ birthDate: "2013-01-01" });
  assert.equal(bandForSession(a, "High School", "2026-08-01"), "High School");
});

test("Youth subdivides by age on the day of the throw", () => {
  const a = athlete({ birthDate: "2013-06-15" });
  assert.equal(bandForSession(a, "Youth", "2026-04-01"), "12U"); // still 12
  assert.equal(bandForSession(a, "Youth", "2026-07-01"), "14U"); // turned 13
});

test("a 12U throw stays 12U even after the athlete ages off the youth boards", () => {
  const a = athlete({ birthDate: "2013-06-15" });
  // he is 17 as of this session date — off the youth boards entirely
  assert.equal(bandForSession(a, "Youth", "2030-08-01"), null);
  // but the throw he made at 11 is still, permanently, a 12U throw, because
  // the band is resolved against the session date and never against "now"
  assert.equal(bandForSession(a, "Youth", "2025-01-01"), "12U");
});

test("the 14U band ends the day the athlete turns 15", () => {
  // age exactly 14 on the session date: still 14U
  assert.equal(
    bandForSession(athlete({ birthDate: "2012-06-15" }), "Youth", "2026-06-15"),
    "14U",
  );
  // age exactly 15 on the session date: aged out, facility board only
  assert.equal(
    bandForSession(athlete({ birthDate: "2011-06-15" }), "Youth", "2026-06-15"),
    null,
  );
});

test("Youth with no birth date, or aged out, is facility-only", () => {
  assert.equal(bandForSession(athlete(), "Youth", "2026-08-01"), null);
  const old = athlete({ birthDate: "2009-01-01" }); // 17
  assert.equal(bandForSession(old, "Youth", "2026-08-01"), null);
});

test("no stamped level is facility-only", () => {
  const a = athlete({ birthDate: "2013-06-15" });
  assert.equal(bandForSession(a, null, "2026-08-01"), null);
});

test("ranks one row per athlete, using their best throw", () => {
  const athletes = [
    athlete({ id: "a", name: "Ann", level: "College" }),
    athlete({ id: "b", name: "Bo", level: "College" }),
  ];
  const sessions = [
    session("a", "2026-08-01", "College", { p1: [80, 90, 91, null, null] }),
    session("a", "2026-08-08", "College", { p1: [80, 95, 93, null, null] }),
    session("b", "2026-08-02", "College", { p1: [80, 94, null, null, null] }),
  ];
  const [facility] = buildBoards(athletes, sessions, "pulldown", 5, []);
  assert.equal(facility.key, "facility");
  assert.deepEqual(
    facility.rows.map((r) => [r.rank, r.name, r.velocity]),
    [[1, "Ann", 95], [2, "Bo", 94]],
  );
});

test("the 80% primer never places", () => {
  const athletes = [athlete({ id: "a", name: "Ann", level: "College" })];
  // 99 sits in box 0 — the primer — and must be ignored
  const sessions = [session("a", "2026-08-01", "College", { p1: [99, 88, null, null, null] })];
  const [facility] = buildBoards(athletes, sessions, "pulldown", 5, []);
  assert.equal(facility.rows[0].velocity, 88);
});

test("both 5 oz sets fold into one record", () => {
  const athletes = [athlete({ id: "a", name: "Ann", level: "College" })];
  // p1 is the opener, p4 the second 5 oz set; the best of both is the record
  const sessions = [
    session("a", "2026-08-01", "College", {
      p1: [80, 90, null, null, null],
      p4: [80, 96, null, null, null],
    }),
  ];
  const [facility] = buildBoards(athletes, sessions, "pulldown", 5, []);
  assert.equal(facility.rows.length, 1);
  assert.equal(facility.rows[0].velocity, 96);
});

test("band boards use the athlete's best within that band", () => {
  const a = athlete({ id: "a", name: "Ann", birthDate: "2013-06-15", level: "Youth" });
  const sessions = [
    session("a", "2026-04-01", "Youth", { p1: [80, 70, null, null, null] }), // 12U
    session("a", "2026-07-01", "Youth", { p1: [80, 78, null, null, null] }), // 14U
  ];
  const boards = buildBoards([a], sessions, "pulldown", 5, []);
  const byKey = Object.fromEntries(boards.map((b) => [b.key, b]));
  assert.equal(byKey["facility"].rows[0].velocity, 78);
  assert.equal(byKey["12U"].rows[0].velocity, 70);
  assert.equal(byKey["14U"].rows[0].velocity, 78);
});

test("an athlete with no level or birth date reaches only the facility board", () => {
  const a = athlete({ id: "a", name: "Ann" });
  const sessions = [session("a", "2026-08-01", null, { p1: [80, 91, null, null, null] })];
  const boards = buildBoards([a], sessions, "pulldown", 5, []);
  assert.deepEqual(boards.map((b) => b.key), ["facility"]);
});

test("empty boards are omitted", () => {
  const a = athlete({ id: "a", name: "Ann", level: "Pro" });
  const sessions = [session("a", "2026-08-01", "Pro", { p1: [80, 97, null, null, null] })];
  const boards = buildBoards([a], sessions, "pulldown", 5, []);
  assert.deepEqual(boards.map((b) => b.key), ["facility", "Pro"]);
});

test("ties break toward whoever got there first", () => {
  const athletes = [
    athlete({ id: "a", name: "Ann", level: "Pro" }),
    athlete({ id: "b", name: "Bo", level: "Pro" }),
  ];
  const sessions = [
    session("b", "2026-08-09", "Pro", { p1: [80, 92, null, null, null] }),
    session("a", "2026-08-01", "Pro", { p1: [80, 92, null, null, null] }),
  ];
  const [facility] = buildBoards(athletes, sessions, "pulldown", 5, []);
  assert.deepEqual(facility.rows.map((r) => r.name), ["Ann", "Bo"]);
});

test("the viewer is marked, and gets a standing when off the board", () => {
  const athletes = Array.from({ length: 12 }, (_, i) =>
    athlete({ id: "x" + i, name: "P" + i, level: "Pro" }));
  const sessions = athletes.map((a, i) =>
    session(a.id, "2026-08-01", "Pro", { p1: [80, 100 - i, null, null, null] }));
  const [facility] = buildBoards(athletes, sessions, "pulldown", 5, ["x11"]);
  assert.equal(facility.rows.length, 10);            // facility caps at 10
  assert.equal(facility.you?.rank, 12);              // 12th, so off the board
  assert.equal(facility.you?.velocity, 89);

  const [top] = buildBoards(athletes, sessions, "pulldown", 5, ["x0"]);
  assert.equal(top.rows[0].isYou, true);
  assert.equal(top.you, null);                       // already visible
});
