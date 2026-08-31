import { test } from "node:test";
import assert from "node:assert/strict";
import { ageOn, bandForSession, type LeaderboardAthlete } from "@/lib/leaderboard";

const athlete = (over: Partial<LeaderboardAthlete> = {}): LeaderboardAthlete => ({
  id: "a1", name: "Test Athlete", hand: "R",
  birthDate: null, level: null, ...over,
});

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

test("a throw made at 12 stays 12U after the birthday", () => {
  const a = athlete({ birthDate: "2013-06-15" });
  // the same session, resolved again years later, is still 12U
  assert.equal(bandForSession(a, "Youth", "2026-04-01"), "12U");
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
