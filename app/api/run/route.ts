import { NextResponse } from "next/server";
import { api, assertSameOrigin, positiveInt, readJson } from "@/lib/api";
import { getViewer } from "@/lib/auth";
import { getContest, hasEntered } from "@/lib/contests";
import { q1 } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { contestPhase, isLanguage } from "@/lib/format";
import { sandboxCredentialsOrNull } from "@/lib/judge/credentials";
import { runExamples } from "@/lib/judge/queue";
import { JudgeBusyError } from "@/lib/judge/runtime";
import { JudgeHostError } from "@/lib/judge/types";
import { allow } from "@/lib/ratelimit";
import { countUsage, getSettings } from "@/lib/settings";

export const maxDuration = 300;

/** "Run examples": tries the code on the public examples only. Nothing is stored or scored. */
export const POST = api(async (request) => {
  assertSameOrigin(request);
  const { user, isAdmin } = await getViewer();
  if (!user && !isAdmin) throw new UserError("Log in to run code.", 401);

  const body = await readJson(request);
  const problemId = positiveInt(body.problemId, "problem");
  const language = body.language;
  const source = typeof body.source === "string" ? body.source : "";
  if (!isLanguage(language)) throw new UserError("Choose a language.");
  if (!source.trim()) throw new UserError("Your code is empty.");
  if (Buffer.byteLength(source, "utf8") > 64 * 1024) throw new UserError("Your code is larger than 64 KB.");

  const problem = await q1<{ id: number; contest_id: number; examples: number }>(
    `select p.id, p.contest_id,
            (select count(*) from tests t where t.problem_id = p.id and t.is_example) as examples
     from problems p where p.id = $1`,
    [problemId],
  );
  const contest = problem ? await getContest(problem.contest_id) : null;
  if (!problem || !contest || (!contest.visible && !isAdmin)) throw new UserError("Problem not found.", 404);

  if (!isAdmin) {
    const settings = await getSettings();
    if (!settings.allowRun) throw new UserError("Running examples is switched off. Submit to get a verdict.", 403);
    if (contestPhase(contest.start_at, contest.end_at) !== "running") {
      throw new UserError("Code can only be run while the contest is running.", 403);
    }
    if (!(await hasEntered(contest.id, user!.id))) throw new UserError("Enter the contest first.", 403);
    if (!(await allow(`run:${user!.id}`, 10, 60))) {
      throw new UserError("You are running code very quickly. Wait a few seconds and try again.", 429);
    }
  }
  if (problem.examples === 0) throw new UserError("This problem has no examples to run.", 409);

  const credentials = await sandboxCredentialsOrNull();
  await countUsage("runs");
  try {
    const result = await runExamples(credentials, problem.id, language, source);
    return NextResponse.json({
      verdict: result.verdict,
      compileOutput: result.compile_output,
      message: result.verdict === "JE" ? result.message : "",
      tests: result.tests.map((t) => ({
        test: t.test,
        verdict: t.verdict,
        timeMs: t.time_ms,
        memoryKb: t.memory_kb,
        stdout: t.stdout ?? "",
        stdoutTruncated: !!t.stdout_truncated,
        stderr: t.stderr ?? "",
        detail: t.detail ?? "",
      })),
    });
  } catch (error) {
    if (error instanceof JudgeBusyError) throw new UserError(error.message + " Try again shortly.", 503);
    if (error instanceof JudgeHostError) {
      console.error("run examples failed:", error);
      throw new UserError(
        isAdmin ? error.message : "The judge is busy or unavailable right now. Try again in a moment.",
        503,
      );
    }
    throw error;
  }
});
