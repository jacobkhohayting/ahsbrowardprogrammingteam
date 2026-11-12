// Tests for the three leaderboard types (lib/standings.ts) and a few formatting helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStandings, pointsAt, standingsCsv } from "../lib/standings.ts";
import { contestPhase, formatClock, formatDuration, problemLabel } from "../lib/format.ts";

const START = "2026-11-14T15:00:00.000Z";
const at = (minutes, seconds = 0) => new Date(Date.parse(START) + minutes * 60000 + seconds * 1000).toISOString();

const PROBLEMS = [
  { id: 1, label: "A", title: "First", points: 500 },
  { id: 2, label: "B", title: "Second", points: 1000 },
  { id: 3, label: "C", title: "Third", points: 100 },
];
const person = (id, username) => ({ user_id: id, username, full_name: username.toUpperCase() });
const ANA = person(1, "ana");
const BEN = person(2, "ben");
const CAL = person(3, "cal");
const DEE = person(4, "dee");

let clock = 0;
/** A judged submission. `when` is minutes after the start. */
const sub = (who, problemId, verdict, when, status = "done") => ({
  ...who,
  problem_id: problemId,
  status,
  verdict,
  submitted_at: at(when, clock++ % 50),
});

const contest = (type, extra = {}) => ({
  start_at: START,
  leaderboard_type: type,
  penalty_per_wrong: 10,
  decay_per_minute: 2,
  wrong_penalty_pts: 0,
  ...extra,
});

const ranks = (standings) => standings.rows.map((row) => `${row.rank}:${row.username}`).join(" ");

test("short: most solves first, ties broken by the earlier last accepted submission", () => {
  const standings = computeStandings(contest("short"), PROBLEMS, [ANA, BEN, CAL, DEE], [
    sub(ANA, 1, "AC", 5),
    sub(ANA, 2, "AC", 50), // ana: 2 solved, last at 50
    sub(BEN, 1, "AC", 20),
    sub(BEN, 2, "AC", 30), // ben: 2 solved, last at 30 -> ahead of ana
    sub(CAL, 3, "AC", 1), // cal: 1 solved
  ]);
  assert.equal(ranks(standings), "1:ben 2:ana 3:cal 4:dee");
  assert.equal(standings.rows[0].solves, 2);
  assert.equal(standings.rows[3].solves, 0, "someone who entered but never submitted is still listed");
});

test("short: wrong attempts do not matter", () => {
  const standings = computeStandings(contest("short"), PROBLEMS, [], [
    sub(ANA, 1, "WA", 1),
    sub(ANA, 1, "WA", 2),
    sub(ANA, 1, "AC", 10),
    sub(BEN, 1, "AC", 11),
  ]);
  assert.equal(ranks(standings), "1:ana 2:ben");
  assert.equal(standings.rows[0].cells[1].attempts, 2);
});

test("equal results share a rank and the next rank is skipped", () => {
  const same = at(10);
  const standings = computeStandings(contest("short"), PROBLEMS, [CAL], [
    { ...ANA, problem_id: 1, status: "done", verdict: "AC", submitted_at: same },
    { ...BEN, problem_id: 1, status: "done", verdict: "AC", submitted_at: same },
  ]);
  assert.equal(ranks(standings), "1:ana 1:ben 3:cal");
});

test("long: penalty is minutes to each accepted solution plus 10 per rejected attempt before it", () => {
  const standings = computeStandings(contest("long"), PROBLEMS, [], [
    sub(ANA, 1, "WA", 3),
    sub(ANA, 1, "TLE", 8),
    sub(ANA, 1, "AC", 12), // 12 + 2 * 10 = 32
    sub(ANA, 2, "AC", 40), // 40
    sub(BEN, 1, "AC", 30), // 30
    sub(BEN, 2, "AC", 45), // 45 -> 75 total, more than ana's 72
  ]);
  assert.equal(standings.rows[0].username, "ana");
  assert.equal(standings.rows[0].penalty, 72);
  assert.equal(standings.rows[1].penalty, 75);
});

test("long: the penalty amount is configurable", () => {
  const standings = computeStandings(contest("long", { penalty_per_wrong: 20 }), PROBLEMS, [], [
    sub(ANA, 1, "RE", 1),
    sub(ANA, 1, "AC", 5),
  ]);
  assert.equal(standings.rows[0].penalty, 25);
});

test("long: rejected attempts on a problem that is never solved cost nothing", () => {
  const standings = computeStandings(contest("long"), PROBLEMS, [], [
    sub(ANA, 1, "AC", 10),
    sub(ANA, 2, "WA", 11),
    sub(ANA, 2, "WA", 12),
    sub(ANA, 2, "MLE", 13),
  ]);
  assert.equal(standings.rows[0].penalty, 10);
  assert.equal(standings.rows[0].cells[2].attempts, 3);
  assert.equal(standings.rows[0].cells[2].solved, false);
});

test("compilation errors and judge errors are never counted as attempts", () => {
  const standings = computeStandings(contest("long"), PROBLEMS, [], [
    sub(ANA, 1, "CE", 1),
    sub(ANA, 1, "JE", 2),
    sub(ANA, 1, "CE", 3),
    sub(ANA, 1, "AC", 4),
  ]);
  assert.equal(standings.rows[0].cells[1].attempts, 0);
  assert.equal(standings.rows[0].penalty, 4);
});

test("only the first accepted submission counts; later ones are ignored", () => {
  const standings = computeStandings(contest("long"), PROBLEMS, [], [
    sub(ANA, 1, "AC", 7),
    sub(ANA, 1, "WA", 9),
    sub(ANA, 1, "AC", 30),
  ]);
  const cell = standings.rows[0].cells[1];
  assert.equal(cell.time_s, 7 * 60 + (cell.time_s % 60));
  assert.equal(cell.attempts, 0);
  assert.equal(standings.rows[0].solves, 1);
  assert.equal(standings.rows[0].penalty, 7);
});

test("long: seconds are dropped, penalties use whole minutes", () => {
  const standings = computeStandings(contest("long"), PROBLEMS, [], [
    { ...ANA, problem_id: 1, status: "done", verdict: "AC", submitted_at: at(9, 59) },
  ]);
  assert.equal(standings.rows[0].penalty, 9);
});

test("adaptive: a problem loses points every full minute, never below zero", () => {
  assert.equal(pointsAt(500, 2, 0, 0), 500);
  assert.equal(pointsAt(500, 2, 0, 59_999), 500, "nothing is lost inside the first minute");
  assert.equal(pointsAt(500, 2, 0, 60_000), 498);
  assert.equal(pointsAt(500, 2, 0, 10 * 60_000 + 30_000), 480);
  assert.equal(pointsAt(100, 2, 0, 600 * 60_000), 0);
  assert.equal(pointsAt(500, 2.5, 0, 3 * 60_000), 492.5);
  assert.equal(pointsAt(500, 2, 25, 10 * 60_000, 3), 405, "optional loss per rejected attempt");
});

test("adaptive: highest total points wins, then the earlier last accepted", () => {
  const standings = computeStandings(contest("adaptive"), PROBLEMS, [DEE], [
    sub(ANA, 2, "AC", 100), // 1000 - 200 = 800
    sub(BEN, 1, "AC", 10), // 500 - 20 = 480
    sub(BEN, 3, "AC", 20), // 100 - 40 = 60  -> 540
    sub(CAL, 3, "AC", 60), // 100 - 120 -> 0
  ]);
  assert.equal(ranks(standings), "1:ana 2:ben 3:cal 4:dee");
  assert.equal(standings.rows[0].points, 800);
  assert.equal(standings.rows[1].points, 540);
  assert.equal(standings.rows[2].points, 0);
  assert.equal(standings.rows[2].solves, 1);
});

test("adaptive: rejected attempts can cost points when the organizer sets that", () => {
  const standings = computeStandings(contest("adaptive", { wrong_penalty_pts: 50 }), PROBLEMS, [], [
    sub(ANA, 1, "WA", 1),
    sub(ANA, 1, "WA", 2),
    sub(ANA, 1, "AC", 5), // 500 - 10 - 100 = 390
  ]);
  assert.equal(standings.rows[0].points, 390);
});

test("submissions still being judged are shown as pending and not scored", () => {
  const standings = computeStandings(contest("short"), PROBLEMS, [], [
    sub(ANA, 1, null, 5, "queued"),
    sub(ANA, 2, null, 6, "judging"),
  ]);
  assert.equal(standings.rows[0].solves, 0);
  assert.equal(standings.rows[0].cells[1].pending, 1);
  assert.equal(standings.rows[0].cells[2].pending, 1);
});

test("submissions to a problem that was removed are ignored", () => {
  const standings = computeStandings(contest("short"), PROBLEMS, [BEN], [sub(ANA, 99, "AC", 5), sub(BEN, 99, "AC", 6)]);
  assert.equal(ranks(standings), "1:ben");
  assert.equal(standings.rows[0].solves, 0);
});

test("the spreadsheet export has one row per person and is safe to open", () => {
  const tricky = { user_id: 9, username: "eve", full_name: '=HYPERLINK("http://bad")' };
  const standings = computeStandings(contest("long"), PROBLEMS, [tricky], [
    sub(ANA, 1, "WA", 1),
    sub(ANA, 1, "AC", 5),
  ]);
  const withNames = standingsCsv(standings, true).trim().split("\n");
  assert.equal(withNames.length, 3);
  assert.equal(withNames[0], '"rank","username","full_name","solved","penalty","A","B","C"');
  assert.match(withNames[1], /^"1","ana","ANA","1","15","solved at \d+s, 1 wrong","",""$/);
  assert.ok(withNames[2].includes(`"'=HYPERLINK`), "formulas in names are neutralized");
  const withoutNames = standingsCsv(standings, false).trim().split("\n");
  assert.equal(withoutNames[0], '"rank","username","solved","penalty","A","B","C"');
  assert.ok(!withoutNames.join("\n").includes("HYPERLINK"));
});

test("problem letters, clocks and durations", () => {
  assert.deepEqual([0, 1, 25, 26, 27, 51, 52].map(problemLabel), ["A", "B", "Z", "AA", "AB", "AZ", "BA"]);
  assert.equal(formatClock(59), "00:59");
  assert.equal(formatClock(3725), "1:02:05");
  assert.equal(formatDuration(45), "45 min");
  assert.equal(formatDuration(150), "2 h 30 min");
  assert.equal(formatDuration(120), "2 h");
  assert.equal(formatDuration(60 * 24 * 30), "30 days");
});

test("a contest is upcoming, running, then ended", () => {
  const start = "2026-11-14T15:00:00Z";
  const end = "2026-11-14T17:00:00Z";
  assert.equal(contestPhase(start, end, Date.parse("2026-11-14T14:59:59Z")), "upcoming");
  assert.equal(contestPhase(start, end, Date.parse(start)), "running");
  assert.equal(contestPhase(start, end, Date.parse("2026-11-14T16:59:59Z")), "running");
  assert.equal(contestPhase(start, end, Date.parse(end)), "ended");
});
