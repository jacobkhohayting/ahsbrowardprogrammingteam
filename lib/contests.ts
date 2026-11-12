import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { q, q1 } from "./db";
import { getViewer, type Viewer } from "./auth";
import { getSettings, type SiteSettings } from "./settings";
import {
  contestPhase,
  problemLabel,
  type Checker,
  type Language,
  type LeaderboardType,
  type Phase,
  type Verdict,
} from "./format";

export type Contest = {
  id: number;
  name: string;
  description: string;
  start_at: Date;
  end_at: Date;
  timezone: string;
  visible: boolean;
  leaderboard_type: LeaderboardType;
  penalty_per_wrong: number;
  decay_per_minute: number;
  wrong_penalty_pts: number;
  show_code_after: boolean;
  show_editorial: boolean;
  created_at: Date;
};

export type ContestSummary = Contest & { problem_count: number; participant_count: number };

export type Problem = {
  id: number;
  contest_id: number;
  ord: number;
  label: string;
  title: string;
  statement: string;
  editorial: string;
  solution_code: string;
  solution_language: Language;
  time_limit_ms: number;
  memory_limit_mb: number;
  checker: Checker;
  points: number;
  tests_version: number;
};

export const getContest = cache(async (id: number): Promise<Contest | null> => {
  if (!Number.isInteger(id) || id <= 0) return null;
  return q1<Contest>("select * from contests where id = $1", [id]);
});

/** The problems of a contest in order, with their letters (A, B, C, ...). */
export const getProblems = cache(async (contestId: number): Promise<Problem[]> => {
  const rows = await q<Omit<Problem, "label">>(
    `select id, contest_id, ord, title, statement, editorial, solution_code, solution_language,
            time_limit_ms, memory_limit_mb, checker, points, tests_version
     from problems where contest_id = $1 order by ord, id`,
    [contestId],
  );
  return rows.map((row, index) => ({ ...row, label: problemLabel(index) }));
});

export async function listContests(includeHidden: boolean): Promise<ContestSummary[]> {
  return q<ContestSummary>(
    `select c.*,
            (select count(*) from problems p where p.contest_id = c.id) as problem_count,
            (select count(*) from contest_entries e where e.contest_id = c.id) as participant_count
     from contests c
     ${includeHidden ? "" : "where c.visible"}
     order by c.start_at desc, c.id desc`,
  );
}

export const hasEntered = cache(async (contestId: number, userId: number): Promise<boolean> => {
  return (
    (await q1("select 1 as x from contest_entries where contest_id = $1 and user_id = $2", [contestId, userId])) !==
    null
  );
});

export async function recordEntry(contestId: number, userId: number): Promise<void> {
  await q(
    "insert into contest_entries (contest_id, user_id) values ($1, $2) on conflict do nothing",
    [contestId, userId],
  );
}

export type ContestContext = {
  contest: Contest;
  viewer: Viewer;
  phase: Phase;
  entered: boolean;
  /**
   * ok       - may read the problems
   * upcoming - the contest has not started
   * login    - running; needs an account
   * enter    - running; logged in but has not entered yet
   */
  access: "ok" | "upcoming" | "login" | "enter";
};

/**
 * Loads a contest for the current visitor and works out what they may see.
 * Hidden contests do not exist for anyone but organizers.
 */
export async function contestContext(rawId: string | number): Promise<ContestContext> {
  const id = Number(rawId);
  const [contest, viewer] = await Promise.all([getContest(id), getViewer()]);
  if (!contest || (!contest.visible && !viewer.isAdmin)) notFound();
  const phase = contestPhase(contest.start_at, contest.end_at);
  const entered = viewer.user ? await hasEntered(contest.id, viewer.user.id) : false;
  let access: ContestContext["access"] = "ok";
  if (!viewer.isAdmin) {
    if (phase === "upcoming") access = "upcoming";
    else if (phase === "running") access = !viewer.user ? "login" : entered ? "ok" : "enter";
  }
  return { contest, viewer, phase, entered, access };
}

/** Whether this visitor sees full names next to usernames. */
export function showsFullNames(viewer: Viewer, settings: SiteSettings): boolean {
  if (viewer.isAdmin) return true;
  if (settings.namesVisibility === "everyone") return true;
  return settings.namesVisibility === "members" && viewer.user !== null;
}

export async function namesVisible(): Promise<boolean> {
  const [viewer, settings] = await Promise.all([getViewer(), getSettings()]);
  return showsFullNames(viewer, settings);
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------
export type SubmissionRow = {
  id: number;
  user_id: number | null;
  contest_id: number;
  problem_id: number;
  language: Language;
  status: "queued" | "judging" | "done";
  verdict: Verdict | null;
  failed_test: number | null;
  tests_passed: number;
  tests_total: number;
  time_ms: number | null;
  memory_kb: number | null;
  submitted_at: Date;
  judged_at: Date | null;
  invalidated: boolean;
  admin_test: boolean;
  username: string | null;
  full_name: string | null;
  problem_title: string;
  problem_index: number;
  contest_name: string;
};

export const SUBMISSION_SELECT = `
  select s.id, s.user_id, s.contest_id, s.problem_id, s.language, s.status, s.verdict, s.failed_test,
         s.tests_passed, s.tests_total, s.time_ms, s.memory_kb, s.submitted_at, s.judged_at,
         s.invalidated, s.admin_test, u.username, u.full_name, p.title as problem_title,
         (select count(*) from problems p2
           where p2.contest_id = p.contest_id
             and (p2.ord < p.ord or (p2.ord = p.ord and p2.id < p.id))) as problem_index,
         c.name as contest_name
  from submissions s
  left join users u on u.id = s.user_id
  join problems p on p.id = s.problem_id
  join contests c on c.id = s.contest_id`;

/** The same, plus the code, compiler output and per-test results (for the submission's own page). */
export const SUBMISSION_DETAIL_SELECT = SUBMISSION_SELECT.replace(
  "select s.id,",
  "select s.source, s.compile_output, s.judge_log, s.message, s.attempts, s.id,",
);

/** The fields of a submission that are safe to send to any browser. */
export type SubmissionView = {
  id: number;
  who: string;
  fullName: string | null;
  contestId: number;
  contestName: string;
  problemIndex: number;
  problemLabel: string;
  problemTitle: string;
  language: Language;
  status: "queued" | "judging" | "done";
  verdict: Verdict | null;
  failedTest: number | null;
  timeMs: number | null;
  memoryKb: number | null;
  submittedAt: string;
  invalidated: boolean;
  adminTest: boolean;
};

export function toView(row: SubmissionRow, withFullName: boolean): SubmissionView {
  return {
    id: row.id,
    who: row.admin_test ? "organizer test" : (row.username ?? "deleted user"),
    fullName: withFullName && !row.admin_test ? row.full_name : null,
    contestId: row.contest_id,
    contestName: row.contest_name,
    problemIndex: row.problem_index,
    problemLabel: problemLabel(row.problem_index),
    problemTitle: row.problem_title,
    language: row.language,
    status: row.status,
    verdict: row.verdict,
    failedTest: row.failed_test,
    timeMs: row.time_ms,
    memoryKb: row.memory_kb,
    submittedAt: row.submitted_at.toISOString(),
    invalidated: row.invalidated,
    adminTest: row.admin_test,
  };
}

/**
 * Who may read a submission's source code:
 * organizers, its author, and - once the contest is over and the organizer allowed it - everyone.
 */
export function canViewSource(
  viewer: Viewer,
  submission: { user_id: number | null; admin_test: boolean },
  contest: Contest,
): boolean {
  if (viewer.isAdmin) return true;
  if (submission.admin_test) return false;
  if (viewer.user && submission.user_id === viewer.user.id) return true;
  return contestPhase(contest.start_at, contest.end_at) === "ended" && contest.show_code_after;
}
