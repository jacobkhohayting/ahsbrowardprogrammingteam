import { NextResponse } from "next/server";
import { api, assertSameOrigin, positiveInt, readJson } from "@/lib/api";
import { getViewer } from "@/lib/auth";
import { getContest, recordEntry, SUBMISSION_SELECT, toView, type SubmissionRow } from "@/lib/contests";
import { q1 } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { contestPhase, isLanguage } from "@/lib/format";
import { languageOptions } from "@/lib/judge/languages";
import { scheduleDrain } from "@/lib/judge/queue";
import { allow } from "@/lib/ratelimit";
import { countUsage } from "@/lib/settings";

export const maxDuration = 300;
const MAX_SOURCE_BYTES = 64 * 1024;

/** A student submits a solution. It is stored, queued, and judged right after this response. */
export const POST = api(async (request) => {
  assertSameOrigin(request);
  const { user, isAdmin } = await getViewer();
  if (!user) throw new UserError("Log in to submit.", 401);

  const body = await readJson(request);
  const contestId = positiveInt(body.contestId, "contest");
  const problemId = positiveInt(body.problemId, "problem");
  const language = body.language;
  const source = typeof body.source === "string" ? body.source : "";

  const contest = await getContest(contestId);
  if (!contest || (!contest.visible && !isAdmin)) throw new UserError("Contest not found.", 404);
  const phase = contestPhase(contest.start_at, contest.end_at);
  if (phase === "upcoming") throw new UserError("This contest has not started yet.", 403);
  if (phase === "ended") throw new UserError("This contest is over. Submissions are closed.", 403);

  const problem = await q1<{ id: number; tests: number }>(
    `select p.id, (select count(*) from tests t where t.problem_id = p.id) as tests
     from problems p where p.id = $1 and p.contest_id = $2`,
    [problemId, contestId],
  );
  if (!problem) throw new UserError("Problem not found in this contest.", 404);
  if (problem.tests === 0) throw new UserError("This problem has no tests yet. Please tell an organizer.", 409);

  if (!isLanguage(language)) throw new UserError("Choose a language.");
  const option = (await languageOptions()).find((o) => o.key === language);
  if (option && !option.available) throw new UserError(`${option.name} is not available on the judge right now.`);

  if (!source.trim()) throw new UserError("Your code is empty.");
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) throw new UserError("Your code is larger than 64 KB.");

  // You can submit as often as you like; this only stops accidental floods (double clicks, scripts).
  if (!(await allow(`submit:${user.id}`, 12, 60))) {
    throw new UserError("You are submitting very quickly. Wait a few seconds and try again.", 429);
  }

  await recordEntry(contestId, user.id);
  const inserted = await q1<{ id: number }>(
    `insert into submissions (user_id, contest_id, problem_id, language, source)
     values ($1, $2, $3, $4, $5) returning id`,
    [user.id, contestId, problemId, language, source],
  );
  await countUsage("submissions");
  await scheduleDrain();

  const row = await q1<SubmissionRow>(`${SUBMISSION_SELECT} where s.id = $1`, [inserted!.id]);
  return NextResponse.json({ id: inserted!.id, submission: toView(row!, false) });
});
