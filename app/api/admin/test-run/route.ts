import { NextResponse } from "next/server";
import { api, assertSameOrigin, positiveInt, readJson } from "@/lib/api";
import { getViewer } from "@/lib/auth";
import { SUBMISSION_SELECT, toView, type SubmissionRow } from "@/lib/contests";
import { q1 } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { isLanguage } from "@/lib/format";
import { scheduleDrain } from "@/lib/judge/queue";

export const maxDuration = 300;

/**
 * An organizer tries a solution against every test of a problem. It is judged like a
 * real submission but never shown to students and never counted anywhere.
 */
export const POST = api(async (request) => {
  assertSameOrigin(request);
  const { isAdmin } = await getViewer();
  if (!isAdmin) throw new UserError("Sign in to the admin area first.", 401);

  const body = await readJson(request);
  const problemId = positiveInt(body.problemId, "problem");
  const language = body.language;
  const source = typeof body.source === "string" ? body.source : "";
  if (!isLanguage(language)) throw new UserError("Choose a language.");
  if (!source.trim()) throw new UserError("The code is empty.");
  if (Buffer.byteLength(source, "utf8") > 256 * 1024) throw new UserError("The code is larger than 256 KB.");

  const problem = await q1<{ id: number; contest_id: number; tests: number }>(
    `select p.id, p.contest_id, (select count(*) from tests t where t.problem_id = p.id) as tests
     from problems p where p.id = $1`,
    [problemId],
  );
  if (!problem) throw new UserError("This problem no longer exists.", 404);
  if (problem.tests === 0) throw new UserError("Add at least one test first.", 409);

  const inserted = await q1<{ id: number }>(
    `insert into submissions (user_id, contest_id, problem_id, language, source, admin_test, priority)
     values (null, $1, $2, $3, $4, true, 1) returning id`,
    [problem.contest_id, problem.id, language, source],
  );
  await scheduleDrain();
  const row = await q1<SubmissionRow>(`${SUBMISSION_SELECT} where s.id = $1`, [inserted!.id]);
  return NextResponse.json({ id: inserted!.id, submission: toView(row!, false) });
});
